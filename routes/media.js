import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

const router = Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

export default router;
