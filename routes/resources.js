import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

const router = Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── GET /api/resources?topic=X&subject=Y ─────────────────
// GPT recomienda videos de YouTube educativos reales para el tema
router.get('/', requireAuth, async (req, res) => {
  const { topic, subject } = req.query;
  if (!topic || !subject) return res.status(400).json({ error: 'topic y subject requeridos' });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Sin API key' });

  const prompt = `Sos un profesor uruguayo de ${subject}. Necesito recursos educativos reales para el tema: "${topic}".

Devolvé un JSON válido (sin markdown) con esta estructura exacta:
{
  "videos": [
    {"title": "...", "videoId": "...", "channel": "...", "duration": "..."},
    {"title": "...", "videoId": "...", "channel": "...", "duration": "..."}
  ],
  "summary": "Resumen del tema en 2 oraciones, en español rioplatense",
  "keyFacts": ["hecho 1", "hecho 2", "hecho 3", "hecho 4"],
  "readingUrl": "https://es.wikipedia.org/wiki/...",
  "readingTitle": "Artículo de Wikipedia recomendado"
}

REGLAS para los videos:
- Deben ser videos REALES de YouTube que existan (usá tu conocimiento de videos populares)
- Preferí canales educativos en español: Unicoos, HistoriaParaTodos, DW Español, Khan Academy en Español, National Geographic España, El Mapa de Sebas, Historia Siglo 20, Muy Interesante, Date un Voltio
- Los videoId deben ser IDs reales de YouTube (11 caracteres alfanuméricos)
- Si no conocés un ID exacto para este tema, usá un video muy conocido del canal sobre el tema general
- Ejemplo IDs conocidos: Khan Academy Revolución Francesa = "wSsDIiq3dFk", Unicoos = canal de matemáticas

Respondé SOLO con el JSON, sin texto adicional.`;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.3
      })
    });

    if (!r.ok) {
      const err = await r.json();
      return res.status(r.status).json({ error: err.error?.message });
    }

    const d = await r.json();
    const raw = d.choices[0].message.content.trim();

    // Limpiar posible markdown
    const jsonStr = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
    const data = JSON.parse(jsonStr);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
