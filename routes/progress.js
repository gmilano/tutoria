import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';

const router = Router();

// ── GET /api/progress — mi progreso ──────────────────────
router.get('/', requireAuth, async (req, res) => {
  const progress = await prisma.progress.findMany({
    where: { userId: req.user.id },
    orderBy: { updatedAt: 'desc' }
  });
  res.json({ progress });
});

// ── POST /api/progress — guardar/actualizar progreso ──────
router.post('/', requireAuth, async (req, res) => {
  const { subject, topicId, topicName, completed, quizScore, timeSpentMs } = req.body;
  if (!subject || !topicId) return res.status(400).json({ error: 'subject y topicId requeridos' });

  const prog = await prisma.progress.upsert({
    where: { userId_subject_topicId: { userId: req.user.id, subject, topicId } },
    update: {
      completed: completed ?? undefined,
      quizScore: quizScore ?? undefined,
      timeSpentMs: timeSpentMs ? { increment: timeSpentMs } : undefined,
      attempts: { increment: 1 },
      lastStudied: new Date()
    },
    create: {
      userId: req.user.id, subject, topicId, topicName: topicName || topicId,
      completed: completed || false, quizScore, timeSpentMs: timeSpentMs || 0, attempts: 1,
      lastStudied: new Date()
    }
  });
  res.json({ progress: prog });
});

// ── GET /api/progress/students — docente ve su clase ─────
router.get('/students', requireAuth, requireRole('TEACHER', 'DIRECTOR', 'ADMIN'), async (req, res) => {
  const { subject, group } = req.query;
  const students = await prisma.user.findMany({
    where: { orgId: req.user.orgId, role: 'STUDENT', group: group || undefined },
    include: {
      progress: { where: subject ? { subject } : undefined },
      chatSessions: { select: { id: true, subject: true, updatedAt: true }, take: 5, orderBy: { updatedAt: 'desc' } }
    }
  });
  res.json({ students: students.map(s => {
    const { passwordHash, ...safe } = s;
    return safe;
  })});
});

export default router;
