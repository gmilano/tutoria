import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

const router = Router();

// POST /api/voice/session — crea ephemeral token para WebRTC
router.post('/session', requireAuth, async (req, res) => {
  const { subject, topic, studentName } = req.body;

  const systemPrompt = `Sos el tutor personal de ${studentName || 'el alumno'} para ${subject || 'bachillerato'} ANEP Uruguay. Tema: ${topic || 'general'}. Hablás en español rioplatense, sos amigable, claro y pedagógico. Hacés preguntas para verificar comprensión. Respondés en voz natural, sin markdown.`;

  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-realtime-preview',
        voice: 'nova',
        instructions: systemPrompt,
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: { type: 'server_vad', silence_duration_ms: 800 }
      })
    });

    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message || 'Error creando sesión' });
    }

    const session = await r.json();
    res.json({
      token: session.client_secret?.value,
      sessionId: session.id,
      expiresAt: session.client_secret?.expires_at
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
