import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
const router = Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// GET /api/checkpoints?subject=Historia — estado del programa
router.get('/', requireAuth, async (req, res) => {
  const { subject } = req.query;
  const where = { userId: req.user.id };
  if (subject) where.subject = subject;
  const checkpoints = await prisma.checkpoint.findMany({ where, orderBy: { createdAt: 'asc' } });
  res.json({ checkpoints });
});

// POST /api/checkpoints/start — iniciar un checkpoint
// Body: { subject, topicId, topicName, mode }
router.post('/start', requireAuth, async (req, res) => {
  const { subject, topicId, topicName, mode } = req.body;

  // Upsert — si ya existe, solo resetear attempts o retornar el existente
  const existing = await prisma.checkpoint.findUnique({
    where: { userId_subject_topicId: { userId: req.user.id, subject, topicId } }
  });

  if (existing?.passed) return res.json({ checkpoint: existing, alreadyPassed: true });

  const cp = existing || await prisma.checkpoint.create({
    data: { userId: req.user.id, subject, topicId, topicName, mode, attempts: 0 }
  });

  // Generar el contenido del checkpoint según el modo
  let content = null;

  if (mode === 'quiz') {
    // Generar 5 preguntas de opción múltiple sobre el tema
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Generás quizzes educativos para bachillerato ANEP Uruguay. Respondé SOLO con JSON válido.`
        }, {
          role: 'user',
          content: `Creá 5 preguntas de opción múltiple sobre "${topicName}" para la materia ${subject}.

JSON exacto (sin markdown):
{
  "questions": [
    {
      "question": "¿...?",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": 0,
      "explanation": "Breve explicación de la respuesta correcta"
    }
  ]
}`
        }],
        max_tokens: 1500,
        temperature: 0.4
      })
    });
    const d = await r.json();
    const raw = d.choices[0].message.content.replace(/^```json?\n?/,'').replace(/\n?```$/,'');
    content = JSON.parse(raw);
  }

  if (mode === 'questions') {
    content = {
      instructions: `Para demostrar que entendiste "${topicName}", hacé 3 preguntas que muestren pensamiento crítico. No preguntes fechas o nombres exactos — preguntá sobre causas, consecuencias, relaciones, o por qués.`,
      evaluationCriteria: `Una pregunta ES de pensamiento crítico si: analiza causas/consecuencias, compara eventos, cuestiona motivaciones, o conecta con el presente. NO lo es si solo pide un dato o fecha.`
    };
  }

  res.json({ checkpoint: cp, content });
});

// POST /api/checkpoints/evaluate — evaluar respuesta del checkpoint
// Body: { checkpointId, mode, answers (quiz) | questions (questions mode) }
router.post('/evaluate', requireAuth, async (req, res) => {
  const { checkpointId, mode, answers, questions } = req.body;

  const cp = await prisma.checkpoint.findFirst({ where: { id: checkpointId, userId: req.user.id } });
  if (!cp) return res.status(404).json({ error: 'Checkpoint no encontrado' });

  let score = 0;
  let passed = false;
  let feedback = '';
  let data = {};

  if (mode === 'quiz' && answers) {
    // answers = [{ questionIndex, selectedOption, isCorrect }]
    const correct = answers.filter(a => a.isCorrect).length;
    score = Math.round((correct / answers.length) * 100);
    passed = score >= 70;
    feedback = passed
      ? `¡Excelente! ${correct}/5 respuestas correctas (${score}%). Tema desbloqueado 🎉`
      : `${correct}/5 correctas (${score}%). Necesitás 70% para pasar. ¡Seguí practicando!`;
    data = { answers, correct, total: answers.length };
  }

  if (mode === 'questions' && questions) {
    // Evaluar las preguntas del alumno con IA
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Evaluás preguntas de alumnos de bachillerato. Una pregunta ES de pensamiento crítico si analiza causas, consecuencias, relaciones o compara. NO lo es si solo pide un dato. Respondé SOLO con JSON.`
        }, {
          role: 'user',
          content: `Tema: "${cp.topicName}" (${cp.subject}).

El alumno hizo estas preguntas:
${questions.map((q, i) => `${i+1}. ${q}`).join('\n')}

Evaluá cada una. JSON exacto:
{
  "evaluations": [
    { "question": "...", "level": "profunda|superficial", "score": 0-10, "feedback": "..." }
  ],
  "totalScore": 0-30,
  "passed": true/false,
  "generalFeedback": "..."
}`
        }],
        max_tokens: 800,
        temperature: 0.3
      })
    });
    const d = await r.json();
    const raw = d.choices[0].message.content.replace(/^```json?\n?/,'').replace(/\n?```$/,'');
    const evaluation = JSON.parse(raw);
    score = Math.round((evaluation.totalScore / 30) * 100);
    passed = evaluation.passed;
    feedback = evaluation.generalFeedback;
    data = { questions, evaluation: evaluation.evaluations };
  }

  // Actualizar checkpoint en DB
  const updated = await prisma.checkpoint.update({
    where: { id: cp.id },
    data: {
      passed,
      score,
      attempts: { increment: 1 },
      data,
      unlockedAt: passed ? new Date() : null,
      mode
    }
  });

  // Si pasó, también actualizar progress
  if (passed) {
    await prisma.progress.upsert({
      where: { userId_subject_topicId: { userId: req.user.id, subject: cp.subject, topicId: cp.topicId } },
      update: { completed: true, quizScore: score },
      create: { userId: req.user.id, subject: cp.subject, topicId: cp.topicId, topicName: cp.topicName, completed: true, quizScore: score, timeSpentMs: 0 }
    });
  }

  res.json({ passed, score, feedback, checkpoint: updated, data });
});

export default router;
