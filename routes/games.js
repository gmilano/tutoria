import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GAME_SYSTEM = (subject, topic, type) =>
  `Sos un experto creador de juegos educativos HTML+CSS+JS para bachillerato ANEP Uruguay.
Materia: ${subject}. Tema: ${topic}. Tipo: ${type}.
REGLAS ABSOLUTAS:
- Respondé SIEMPRE con el HTML completo y funcional del juego (nada más, sin explicaciones)
- Todo en un solo archivo HTML: CSS en <style>, JS en <script>
- Sin dependencias externas (sin CDN, sin fetch, sin APIs)
- Mobile-first, colores vivos, emojis, divertido y educativo
- El juego debe tener un objetivo claro y ser jugable
- Terminá con un footer "Creado con TutorIA 🎓"
- Cuando el usuario pide cambios, devolvés el HTML completo actualizado con los cambios aplicados`;

function stripFences(s) {
  return s.replace(/^```html?\n?/i, '').replace(/^```\n?/, '').replace(/\n?```$/i, '').trim();
}

// ── POST /api/games/generate — primera generación ────────
router.post('/generate', requireAuth, async (req, res) => {
  const { prompt, subject, topic, type = 'quiz' } = req.body;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: GAME_SYSTEM(subject, topic, type) },
          { role: 'user', content: prompt || `Creá un juego tipo ${type} sobre "${topic}" para ${subject}` }
        ],
        max_tokens: 4000,
        temperature: 0.8
      })
    });

    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }); }

    const d = await r.json();
    const htmlContent = stripFences(d.choices[0].message.content);
    const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : `${type} — ${topic}`.slice(0, 80);

    const game = await prisma.game.create({
      data: { title, description: prompt, subject, topic, htmlContent, userId: req.user.id, orgId: req.user.orgId }
    });

    res.json({ game: { id: game.id, title: game.title, htmlContent: game.htmlContent } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/games/:id/iterate — mejorar con conversación
// Body: { userMessage, history: [{role, content}] }
// La history son los mensajes previos (user+assistant) del chat del juego
// El último assistant message SIEMPRE debe ser el HTML actual del juego
router.post('/:id/iterate', requireAuth, async (req, res) => {
  const { userMessage, history = [] } = req.body;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  const game = await prisma.game.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!game) return res.status(404).json({ error: 'Juego no encontrado' });

  try {
    // history contiene el diálogo previo; el último mensaje assistant = HTML actual
    const messages = [
      { role: 'system', content: GAME_SYSTEM(game.subject, game.topic, 'iteración') },
      ...history,
      { role: 'user', content: userMessage }
    ];

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 4000, temperature: 0.7 })
    });

    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }); }

    const d = await r.json();
    const htmlContent = stripFences(d.choices[0].message.content);

    // Actualizar HTML en DB
    await prisma.game.update({ where: { id: game.id }, data: { htmlContent } });

    res.json({ htmlContent, gameId: game.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/games/my — mis juegos ────────────────────────
router.get('/my', requireAuth, async (req, res) => {
  const games = await prisma.game.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, subject: true, topic: true, published: true, plays: true, createdAt: true }
  });
  res.json({ games });
});

// ── GET /api/games/gallery — juegos publicados de la org ──
router.get('/gallery', requireAuth, async (req, res) => {
  const where = { orgId: req.user.orgId, published: true };
  if (req.query.subject) where.subject = req.query.subject;
  const games = await prisma.game.findMany({
    where,
    orderBy: req.query.sort === 'plays' ? { plays: 'desc' } : { createdAt: 'desc' },
    select: {
      id: true, title: true, subject: true, topic: true, plays: true, createdAt: true,
      user: { select: { name: true } }
    }
  });
  res.json({ games });
});

// ── GET /api/games/:id/play — servir HTML del juego ───────
router.get('/:id/play', async (req, res) => {
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game) return res.status(404).send('Juego no encontrado');
  // Increment plays
  await prisma.game.update({ where: { id: game.id }, data: { plays: { increment: 1 } } });
  res.setHeader('Content-Type', 'text/html');
  res.send(game.htmlContent);
});

// ── POST /api/games/:id/publish — publicar (solo dueño) ──
router.post('/:id/publish', requireAuth, async (req, res) => {
  const game = await prisma.game.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!game) return res.status(404).json({ error: 'Juego no encontrado' });
  await prisma.game.update({ where: { id: game.id }, data: { published: true } });
  res.json({ ok: true });
});

// ── DELETE /api/games/:id — eliminar (solo dueño) ─────────
router.delete('/:id', requireAuth, async (req, res) => {
  const game = await prisma.game.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!game) return res.status(404).json({ error: 'Juego no encontrado' });
  await prisma.game.delete({ where: { id: game.id } });
  res.json({ ok: true });
});

export default router;
