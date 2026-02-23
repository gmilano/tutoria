// Vercel Serverless Function — TutorIA Chat API Proxy
// Keeps the OpenAI key server-side (env var OPENAI_API_KEY)

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const { messages, subject, topic, year } = req.body;

  const systemPrompt = `Eres TutorIA, un tutor de Historia para bachillerato uruguayo (programa ANEP/CES).
Año: ${year || '4°'} · Materia: ${subject || 'Historia'} · Tema actual: ${topic || 'Revolución Francesa 1789'}

Instrucciones:
- Respondé siempre en español rioplatense (vos, etc.)
- Estilo pedagógico, cercano, con ejemplos concretos
- Máximo 3 párrafos cortos por respuesta
- Cuando el alumno responde mal, corregí con amabilidad y explicá
- Usá emojis ocasionalmente para hacer el aprendizaje más amigable
- Si el alumno pregunta algo fuera del tema, redirigilo gentilmente
- Al final de tu respuesta podés hacer una pregunta para verificar comprensión`;

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...(messages || [])
  ];

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: allMessages,
        max_tokens: 600,
        temperature: 0.75
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'OpenAI error' });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    return res.status(200).json({ reply, tokens: data.usage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
