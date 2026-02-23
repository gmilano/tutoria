import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import authRoutes     from './routes/auth.js';
import progressRoutes from './routes/progress.js';
import sessionRoutes  from './routes/sessions.js';
import mediaRoutes    from './routes/media.js';
import chatRoutes     from './routes/chat.js';
import gamesRoutes     from './routes/games.js';
import resourcesRoutes from './routes/resources.js';

// ── Curriculum cache ─────────────────────────────────────────
const curriculumCache = {};

async function loadCurriculum(subjectId) {
  if (curriculumCache[subjectId]) return curriculumCache[subjectId];

  // Try individual subject file first, then fall back to the full file
  const nameMap = {
    'historia-4': 'historia', 'matematica-4': 'matematica', 'lengua-4': 'lengua',
    'biologia-4': 'biologia', 'fisica-4': 'fisica', 'quimica-4': 'quimica',
    'geografia-4': 'geografia', 'ingles-4': 'ingles', 'informatica-4': 'informatica',
    'economia-5-eco': 'economia',
  };

  const fileName = nameMap[subjectId];
  if (fileName) {
    try {
      const raw = await readFile(join(__dirname, `curriculum/${fileName}.json`), 'utf-8');
      const data = JSON.parse(raw);
      curriculumCache[subjectId] = data;
      return data;
    } catch { /* fall through to full file */ }
  }

  // Fall back to the complete curriculum file
  try {
    const raw = await readFile(join(__dirname, 'curriculum/anep-bachillerato-completo.json'), 'utf-8');
    const full = JSON.parse(raw);
    const subj = full.materias.find(m => m.id === subjectId);
    if (subj) curriculumCache[subjectId] = subj;
    return subj || null;
  } catch {
    return null;
  }
}

function findTopicInCurriculum(curriculum, topicTitle) {
  if (!curriculum?.unidades) return null;
  for (const u of curriculum.unidades) {
    for (const t of u.temas || []) {
      if (t.titulo === topicTitle || topicTitle.includes(t.titulo) || t.titulo.includes(topicTitle)) {
        return { ...t, unidad: u.titulo };
      }
    }
  }
  return null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
app.use('/api/chat',     chatRoutes);
app.use('/api/games',     gamesRoutes);
app.use('/api/resources', resourcesRoutes);

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
  const { messages = [], subject = 'Historia', topic = 'Revolución Francesa', year = '4°', model = 'auto', subjectId, studentName } = req.body;

  // Load curriculum data for richer context
  const curriculum = subjectId ? await loadCurriculum(subjectId) : null;
  const topicData = curriculum ? findTopicInCurriculum(curriculum, topic) : null;

  let contextBlock = '';
  if (topicData) {
    const conceptos = topicData.conceptosClave?.join(', ') || '';
    const objetivos = topicData.objetivos?.map(o => `  - ${o}`).join('\n') || '';
    const contenidos = topicData.contenidos?.map(c => `  - ${c}`).join('\n') || '';
    contextBlock = `
Unidad: ${topicData.unidad || ''}
Conceptos clave del tema: ${conceptos}
${objetivos ? `Objetivos de aprendizaje:\n${objetivos}` : ''}
${contenidos ? `Contenidos a cubrir:\n${contenidos}` : ''}`;
  } else if (curriculum) {
    // At least include the subject description
    contextBlock = `\nDescripción de la materia: ${curriculum.descripcion || ''}`;
  }

  const greeting = studentName ? `El alumno se llama ${studentName}. Usá su nombre de vez en cuando para personalizar la interacción.` : '';

  const systemPrompt = `Eres TutorIA, un tutor de ${subject} para ${year} año de bachillerato uruguayo (programa ANEP/CES).
Tema actual: ${topic}
${contextBlock}

${greeting}

Instrucciones pedagógicas:
- Respondé siempre en español rioplatense (vos, tuteo)
- Estilo pedagógico socrático: guiá al alumno con preguntas, no des la respuesta directa
- Sé cercano, motivador y positivo. Celebrá los aciertos del alumno
- Máximo 3 párrafos cortos por respuesta
- Al finalizar, hacé una pregunta reflexiva para verificar comprensión
- Usá emojis con moderación para hacer el aprendizaje más amigable
- Si el alumno pregunta algo fuera del tema, redirigilo gentilmente
- Relacioná los conceptos con la realidad uruguaya cuando sea posible
- Si el alumno se equivoca, no lo corrijas bruscamente: guialo hacia la respuesta correcta`;

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
