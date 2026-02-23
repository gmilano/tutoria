import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

// ── GET /api/sessions — mis sesiones de chat ──────────────
router.get('/', requireAuth, async (req, res) => {
  const sessions = await prisma.chatSession.findMany({
    where: { userId: req.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: { id: true, subject: true, topic: true, year: true, summary: true, createdAt: true, updatedAt: true }
  });
  res.json({ sessions });
});

// ── GET /api/sessions/:id — historial de una sesión ───────
router.get('/:id', requireAuth, async (req, res) => {
  const session = await prisma.chatSession.findFirst({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({ session });
});

// ── POST /api/sessions — crear o actualizar sesión ────────
router.post('/', requireAuth, async (req, res) => {
  const { sessionId, subject, topic, year, messages } = req.body;
  if (!subject || !topic || !messages) return res.status(400).json({ error: 'Faltan campos' });

  // Auto-summary: primer y último mensaje del alumno
  const userMsgs = messages.filter(m => m.role === 'user');
  const summary = userMsgs.length
    ? `${userMsgs[0].content.slice(0, 80)}...`
    : null;

  let session;
  if (sessionId) {
    session = await prisma.chatSession.update({
      where: { id: sessionId },
      data: { messages, summary, updatedAt: new Date() }
    });
  } else {
    session = await prisma.chatSession.create({
      data: { userId: req.user.id, subject, topic, year: year || '4°', messages, summary }
    });
  }
  res.json({ session });
});

// ── DELETE /api/sessions/:id ──────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  await prisma.chatSession.deleteMany({
    where: { id: req.params.id, userId: req.user.id }
  });
  res.json({ ok: true });
});

export default router;
