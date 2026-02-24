import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import multer from 'multer';
import prisma from '../lib/db.js';

const router = Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── POST /api/media/tts — Text-to-Speech ─────────────────
// Returns MP3 audio buffer for the tutor's response
router.post('/tts', requireAuth, async (req, res) => {
  const { text, voice = 'nova', model = 'tts-1' } = req.body;
  if (!text) return res.status(400).json({ error: 'text requerido' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  // Truncate to 4096 chars max
  const input = text.slice(0, 4096);

  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model, voice, input, response_format: 'mp3' })
    });

    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message || 'TTS error' });
    }

    const audioBuffer = await r.arrayBuffer();
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength,
      'Cache-Control': 'public, max-age=3600'
    });
    res.send(Buffer.from(audioBuffer));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/media/image — DALL-E 3 HD ──────────────────
router.post('/image', requireAuth, async (req, res) => {
  const { subject, topic, style = 'educational' } = req.body;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  const styleGuide = {
    educational: 'clean educational illustration, textbook style, clear and informative',
    artistic:    'artistic watercolor illustration, vibrant colors, expressive',
    historical:  'historical painting style, dramatic lighting, period-accurate details',
    scientific:  'scientific diagram, precise and labeled, white background'
  }[style] || 'clean educational illustration';

  const prompt = `${styleGuide} depicting "${topic}" for ${subject} class in Uruguay. No text or labels. High quality.`;

  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1792x1024',
        quality: 'hd'
      })
    });

    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message || 'Image gen error' });
    }

    const d = await r.json();
    res.json({ url: d.data[0].url, revised_prompt: d.data[0].revised_prompt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/media/video — Sora 2 ───────────────────────
// Endpoint correcto: POST /v1/videos con {model, prompt} solo
router.post('/video', requireAuth, async (req, res) => {
  const { subject, topic } = req.body;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  const prompt = `Short educational video about "${topic}" for ${subject} class in Uruguay. Visual, engaging, pedagogically rich. No text overlays.`;

  try {
    const r = await fetch('https://api.openai.com/v1/videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: 'sora-2', prompt })
    });

    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message || 'Sora error' });
    }

    const d = await r.json();
    res.json({ jobId: d.id, status: d.status, progress: d.progress || 0, seconds: d.seconds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/media/video/:jobId — poll Sora job ───────────
router.get('/video/:jobId', requireAuth, async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  try {
    const r = await fetch(`https://api.openai.com/v1/videos/${req.params.jobId}`, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    });

    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message });
    }

    const d = await r.json();
    // Video content served via our proxy endpoint when completed
    const url = d.status === 'completed'
      ? `/api/media/video/${d.id}/content`
      : null;
    res.json({
      jobId: d.id,
      status: d.status,       // 'queued' | 'in_progress' | 'completed' | 'failed'
      url,
      progress: d.progress || 0,
      seconds: d.seconds
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/media/video/:jobId/content — stream video ────
router.get('/video/:jobId/content', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).end();
  try {
    const r = await fetch(`https://api.openai.com/v1/videos/${req.params.jobId}/content`, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    });
    if (!r.ok) return res.status(r.status).end();
    res.set('Content-Type', r.headers.get('content-type') || 'video/mp4');
    res.set('Cache-Control', 'public, max-age=3600');
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).end();
  }
});

// ── POST /api/media/transcribe — Whisper STT ────────────
router.post('/transcribe', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  try {
    const form = new FormData();
    form.append('file', new Blob([file.buffer], { type: file.mimetype }), 'audio.webm');
    form.append('model', 'whisper-1');
    form.append('language', 'es');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: form
    });

    const d = await r.json();
    res.json({ text: d.text || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/media/save/image — descarga y guarda imagen ──
router.post('/save/image', requireAuth, async (req, res) => {
  const { url, title, subject, topic } = req.body;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('No se pudo descargar la imagen');
    const buf = Buffer.from(await r.arrayBuffer());
    const mimeType = r.headers.get('content-type') || 'image/png';
    const asset = await prisma.mediaAsset.create({
      data: { type: 'image', title: title || 'Imagen', subject, topic, mimeType, data: buf, size: buf.length, userId: req.user.id, orgId: req.user.orgId }
    });
    res.json({ assetId: asset.id, size: buf.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/media/save/video — guarda referencia Sora ───
router.post('/save/video', requireAuth, async (req, res) => {
  const { jobId, title, subject, topic } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId requerido' });
  try {
    // Descargar y guardar el video como bytes
    const r = await fetch(`https://api.openai.com/v1/videos/${jobId}/content`, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    });
    if (!r.ok) throw new Error('Video no disponible aún');
    const buf = Buffer.from(await r.arrayBuffer());
    const asset = await prisma.mediaAsset.create({
      data: { type: 'video', title: title || 'Video', subject, topic, mimeType: 'video/mp4', data: buf, size: buf.length, jobId, userId: req.user.id, orgId: req.user.orgId }
    });
    res.json({ assetId: asset.id, size: buf.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── LONG VIDEO — job store en memoria ─────────────────────
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
const execAsync = promisify(execCb);

const longVideoJobs = new Map();

function soraPrompts(subject, topic) {
  return [
    `Educational intro for "${topic}" in ${subject}. Cinematic opening shot establishing context. Vivid, colorful, no text. Uruguay high school level.`,
    `Key concepts of "${topic}" in ${subject}. Dynamic visual explanation, engaging motion graphics style. Educational, vivid, no text overlays.`,
    `Conclusion and real-world impact of "${topic}" in ${subject}. Inspiring closing visuals, hopeful mood, no text. Educational documentary style.`
  ];
}

async function soraGenerate(prompt, apiKey) {
  const r = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sora-2', prompt })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Sora error');
  return d.id;
}

async function soraWait(jobId, apiKey, onProgress) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const r = await fetch(`https://api.openai.com/v1/videos/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const d = await r.json();
    if (onProgress) onProgress(d.status, d.progress);
    if (d.status === 'completed') return jobId;
    if (d.status === 'failed') throw new Error('Sora video falló');
  }
  throw new Error('Timeout generando video');
}

async function downloadSoraVideo(jobId, apiKey) {
  const r = await fetch(`https://api.openai.com/v1/videos/${jobId}/content`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (!r.ok) throw new Error('No se pudo descargar video Sora');
  return Buffer.from(await r.arrayBuffer());
}

async function runLongVideoJob(longJobId, subject, topic, userId, orgId, apiKey) {
  const job = longVideoJobs.get(longJobId);
  const prompts = soraPrompts(subject, topic);
  const buffers = [];

  try {
    for (let i = 0; i < prompts.length; i++) {
      job.step = `clip_${i+1}`;
      job.label = `Generando clip ${i+1}/3...`;

      const soraId = await soraGenerate(prompts[i], apiKey);
      await soraWait(soraId, apiKey, (status) => {
        job.label = `Clip ${i+1}/3 — ${status === 'processing' ? 'procesando...' : status}`;
      });
      const buf = await downloadSoraVideo(soraId, apiKey);
      buffers.push(buf);
      job.progress = Math.round(((i+1) / 3) * 80);
    }

    // Concatenar con ffmpeg
    job.step = 'concat';
    job.label = 'Uniendo clips con ffmpeg...';
    job.progress = 85;

    const tmpDir = join(tmpdir(), `tutoria-${longJobId}`);
    await mkdir(tmpDir, { recursive: true });

    const filePaths = [];
    for (let i = 0; i < buffers.length; i++) {
      const p = join(tmpDir, `clip${i}.mp4`);
      await writeFile(p, buffers[i]);
      filePaths.push(p);
    }

    const listFile = join(tmpDir, 'list.txt');
    await writeFile(listFile, filePaths.map(p => `file '${p}'`).join('\n'));

    const outFile = join(tmpDir, 'output.mp4');
    await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outFile}"`);

    const finalBuf = await readFile(outFile);
    await rm(tmpDir, { recursive: true, force: true });

    job.progress = 95;
    job.label = 'Guardando...';

    // Guardar en DB
    const asset = await prisma.mediaAsset.create({
      data: {
        type: 'video',
        title: `${topic} — Video completo`,
        subject, topic,
        mimeType: 'video/mp4',
        data: finalBuf,
        size: finalBuf.length,
        userId, orgId
      }
    });

    job.status = 'completed';
    job.assetId = asset.id;
    job.progress = 100;
    job.label = '✅ Video listo';
  } catch (e) {
    job.status = 'failed';
    job.label = '❌ ' + e.message;
    console.error('Long video error:', e.message);
  }
}

// POST /api/media/video/long — iniciar
router.post('/video/long', requireAuth, async (req, res) => {
  const { subject, topic } = req.body;
  if (!subject || !topic) return res.status(400).json({ error: 'subject y topic requeridos' });
  const longJobId = `lv-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  longVideoJobs.set(longJobId, { status: 'running', step: 'init', label: 'Iniciando...', progress: 0 });
  // Correr en background sin await
  runLongVideoJob(longJobId, subject, topic, req.user.id, req.user.orgId, process.env.OPENAI_API_KEY)
    .catch(e => console.error('Long video job error:', e));
  res.json({ longJobId });
});

// GET /api/media/video/long/:jobId — poll
router.get('/video/long/:jobId', requireAuth, (req, res) => {
  const job = longVideoJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  res.json(job);
});

// ── GET /api/media/assets — lista mis assets ───────────────
router.get('/assets', requireAuth, async (req, res) => {
  const assets = await prisma.mediaAsset.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, title: true, subject: true, topic: true, mimeType: true, size: true, createdAt: true }
  });
  res.json({ assets });
});

// ── GET /api/media/asset/:id — servir el asset ─────────────
router.get('/asset/:id', requireAuth, async (req, res) => {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!asset || !asset.data) return res.status(404).end();
  res.set('Content-Type', asset.mimeType);
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(asset.data);
});

export default router;
