import { Router } from 'express';
import OpenAI from 'openai';
import { requireAuth } from '../lib/auth.js';

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildSystemPrompt(subject, topic, studentName) {
  return `Sos el tutor personal de ${studentName || 'el alumno'} para ${subject} del bachillerato ANEP Uruguay. Tema actual: ${topic}. Respondé en español rioplatense, con emojis, máximo 3 párrafos cortos. Citá fuentes del programa ANEP. Si hay preguntas, hacé una pregunta de comprensión al final.`;
}

// ── POST /api/chat/stream — SSE streaming de tokens ──────
router.post('/stream', requireAuth, async (req, res) => {
  const { messages, subject, topic, studentName } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const systemPrompt = buildSystemPrompt(subject, topic, studentName);

  try {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
      max_tokens: 800
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullContent += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ done: true, content: fullContent })}\n\n`);
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

export default router;
