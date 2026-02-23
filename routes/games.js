import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── POST /api/games/generate — genera juego HTML con GPT ──
router.post('/generate', requireAuth, async (req, res) => {
  const { prompt, subject, topic, type = 'quiz' } = req.body;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  const systemPrompt = `Generás juegos educativos HTML+CSS+JS en un solo archivo. Sin CDN. Mobile-first. El juego debe ser sobre "${topic}" de la materia "${subject}" del bachillerato ANEP Uruguay. Tipo de juego: ${type}. Respondé SOLO con el código HTML completo, sin markdown ni explicaciones. Termina con 'Creado con TutorIA 🎓'. Max 200 líneas.`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt || `Creá un juego tipo ${type} sobre ${topic} para ${subject}` }
        ],
        max_tokens: 4000,
        temperature: 0.8
      })
    });

    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message || 'OpenAI error' });
    }

    const d = await r.json();
    let htmlContent = d.choices[0].message.content;
    // Strip markdown code fences if present
    htmlContent = htmlContent.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');

    // Extract title from HTML
    const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : `${type} — ${topic}`.slice(0, 80);

    const game = await prisma.game.create({
      data: {
        title,
        description: prompt || `Juego tipo ${type} sobre ${topic}`,
        subject,
        topic,
        htmlContent,
        userId: req.user.id,
        orgId: req.user.orgId
      }
    });

    res.json({ game: { id: game.id, title: game.title, htmlContent: game.htmlContent } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
