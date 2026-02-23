import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes     from './routes/auth.js';
import progressRoutes from './routes/progress.js';
import sessionRoutes  from './routes/sessions.js';
import mediaRoutes    from './routes/media.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files — demo/ and root
app.use('/curriculum', express.static(join(__dirname, 'curriculum')));
app.use('/demo/img',   express.static(join(__dirname, 'demo/img')));
app.use('/pitch',      express.static(join(__dirname, 'pitch')));
app.use(express.static(__dirname)); // index.html, etc.

// ── Auth / Progress / Sessions routes ────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/media',    mediaRoutes);

// ── /api/verify-code — access gate ───────────────────────
app.post('/api/verify-code', (req, res) => {
  const { code } = req.body;
  const expected = process.env.ACCESS_CODE;
  if (!expected) return res.json({ ok: true }); // no code required
  if (code === expected) return res.json({ ok: true });
  res.status(401).json({ ok: false, error: 'Código incorrecto' });
});

// ── /api/models — what's available ───────────────────────
app.get('/api/models', async (req, res) => {
  const models = [];
  if (process.env.OPENAI_API_KEY) {
    models.push({ id: 'openai', name: 'GPT-4o mini', provider: 'OpenAI', cost: 'low' });
  }
  // Check Ollama
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const d = await r.json();
      (d.models || []).forEach(m => models.push({
        id: 'ollama:' + m.name, name: m.name, provider: 'Ollama (local)', cost: 'free',
        size: m.details?.parameter_size
      }));
    }
  } catch { /* Ollama not running */ }
  res.json({ models });
});

// ── /api/chat — main tutor endpoint ──────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages = [], subject = 'Historia', topic = 'Revolución Francesa', year = '4°', model = 'auto' } = req.body;

  const systemPrompt = `Eres TutorIA, un tutor de ${subject} para ${year} año de bachillerato uruguayo (programa ANEP/CES).
Tema actual: ${topic}

Instrucciones:
- Respondé siempre en español rioplatense (vos, tuteo)
- Estilo pedagógico, cercano y motivador
- Máximo 3 párrafos cortos por respuesta
- Al finalizar, hacé una pregunta para verificar comprensión
- Usá emojis con moderación para hacer el aprendizaje más amigable
- Si el alumno pregunta algo fuera del tema, redirigilo gentilmente`;

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  // Decide backend
  const useOllama = model.startsWith('ollama:') || (!process.env.OPENAI_API_KEY && model === 'auto');

  if (useOllama) {
    // ── Ollama local ───────────────────────────────────────
    const ollamaModel = model.startsWith('ollama:') ? model.replace('ollama:', '') : 'qwen2.5:14b';
    try {
      const r = await fetch('http://localhost:11434/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          messages: allMessages,
          stream: false,
          options: { temperature: 0.75, num_predict: 600 }
        }),
        signal: AbortSignal.timeout(60000)
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}`);
      const d = await r.json();
      const reply = d.choices?.[0]?.message?.content || d.message?.content;
      return res.json({ reply, model: ollamaModel, provider: 'ollama' });
    } catch (e) {
      console.error('Ollama error:', e.message);
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: 'Ollama no disponible: ' + e.message });
      }
      // Fallback to OpenAI
      console.log('Falling back to OpenAI...');
    }
  }

  // ── OpenAI ─────────────────────────────────────────────
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No API key configured. Set OPENAI_API_KEY in .env' });
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: allMessages,
        max_tokens: 600,
        temperature: 0.75
      })
    });
    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message || 'OpenAI error' });
    }
    const d = await r.json();
    const reply = d.choices[0].message.content;
    return res.json({ reply, model: 'gpt-4o-mini', provider: 'openai', tokens: d.usage });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── /api/generate-image — DALL-E ──────────────────────────
app.post('/api/generate-image', async (req, res) => {
  const { prompt, subject, topic } = req.body;
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'No API key' });
  const fullPrompt = prompt || `Educational illustration for ${subject} class, topic: ${topic}. High quality, academic style, suitable for students.`;
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt: fullPrompt, n: 1, size: '1792x1024', quality: 'hd' })
    });
    const d = await r.json();
    if (d.data) return res.json({ url: d.data[0].url });
    return res.status(500).json({ error: d.error?.message });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPA fallback ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

createServer(app).listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  🎓  TutorIA — Servidor local            ║
  ║                                          ║
  ║  http://localhost:${PORT}                    ║
  ║                                          ║
  ║  OpenAI:  ${process.env.OPENAI_API_KEY ? '✅ configurado' : '❌ sin clave'}              ║
  ║  Ollama:  esperando conexión...          ║
  ╚══════════════════════════════════════════╝
  `);
});
