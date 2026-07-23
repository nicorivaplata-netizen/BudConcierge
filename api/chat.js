export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Allow requests from your own domain only (update this when you have a real domain)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { messages, system } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Forward to Anthropic — API key stays here on the server, never exposed to the browser
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    let anthropicRes;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: 'CRITICAL: Always respond in English only, regardless of any other language in the conversation or user messages.\n\n' + (system || ''),
          messages
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch(fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'Request timed out. Please try again.' });
      }
      throw fetchErr;
    }

    if (!anthropicRes.ok) {
      const error = await anthropicRes.json();
      return res.status(anthropicRes.status).json({ error: error.error?.message || 'API error' });
    }

    const data = await anthropicRes.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
