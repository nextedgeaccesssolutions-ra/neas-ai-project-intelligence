// Vercel Node serverless function for NEAS JARVIS.
// Configure NEAS_AI_API_KEY, NEAS_AI_BASE_URL and NEAS_AI_MODEL in Vercel Preview env vars.
const MAX_BODY = 12_000;
const ALLOWED_AGENTS = new Set(['orchestrator','strategy','research','finance','sales','marketing','operations','engineering','documents','creative','project-controls','renewables']);

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function selectAgent(message) {
  const text = message.toLowerCase();
  if (/rope access|rescue|risk assessment|method statement|hse|working at height/.test(text)) return 'engineering';
  if (/boq|estimate|quotation|cost|budget|cash flow|bond|insurance/.test(text)) return 'finance';
  if (/gantt|s-curve|schedule|project progress|field report/.test(text)) return 'project-controls';
  if (/wind|blade|met mast|renewable|turbine/.test(text)) return 'renewables';
  if (/seo|marketing|campaign|social media|content/.test(text)) return 'marketing';
  if (/lead|client|sales|proposal|crm/.test(text)) return 'sales';
  if (/document|method statement|report|sop|procedure/.test(text)) return 'documents';
  if (/research|competitor|market|latest|find information/.test(text)) return 'research';
  return 'orchestrator';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try { if (new URL(origin).host !== host) return send(res, 403, { error: 'Cross-origin request blocked.' }); }
    catch { return send(res, 403, { error: 'Invalid request origin.' }); }
  }
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return send(res, 413, { error: 'Message is too large.' });
  let body;
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(raw); }
  catch { return send(res, 400, { error: 'Invalid JSON request.' }); }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || messages.length > 20) return send(res, 400, { error: 'Send between 1 and 20 recent messages.' });
  const clean = messages.map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }));
  if (clean.some(m => !['user','assistant'].includes(m.role) || !m.content.trim())) return send(res, 400, { error: 'Invalid message format.' });
  const latest = [...clean].reverse().find(m => m.role === 'user');
  if (!latest) return send(res, 400, { error: 'A user message is required.' });
  const agent = selectAgent(latest.content);
  const key = process.env.NEAS_AI_API_KEY;
  const base = (process.env.NEAS_AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\\/$/, '');
  const model = process.env.NEAS_AI_MODEL || 'llama-3.3-70b-versatile';
  if (!key) return send(res, 503, { error: 'AI provider is not configured. Add NEAS_AI_API_KEY to the Vercel Preview environment variables. No secret belongs in the browser.' });
  const system = [
    'You are NEAS JARVIS, the AI operations assistant for NextEdge Access Solutions in the Philippines.',
    'Support rope access, renewable energy, offshore/onshore, wind turbines, met masts, telecom, facade, industrial services, training and project controls.',
    'Respond professionally and practically. Understand English, Filipino and Taglish; reply in the language style used by the user.',
    'Never claim access to NEAS records, tools, files, live systems or integrations unless actually provided in this request.',
    'For safety-critical rope access, rescue, engineering, inspection and HSE topics, provide decision support only and require competent-person review.',
    'Do not invent project quantities, prices, certifications, inspection findings, legal compliance or external facts. State assumptions and uncertainty.',
    'You are currently an MVP assistant without database retrieval or action permissions. Never say you have executed an external action.'
  ].join(' ');
  try {
    const response = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.4, max_tokens: 900, messages: [{ role: 'system', content: system }, ...clean] })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 401 ? 'AI provider rejected the configured key.' : response.status === 429 ? 'AI provider rate limit reached. Try again shortly.' : 'AI provider request failed.';
      return send(res, response.status === 429 ? 429 : 502, { error: message });
    }
    const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof answer !== 'string' || !answer.trim()) return send(res, 502, { error: 'AI provider returned an empty response.' });
    return send(res, 200, { answer: answer.trim(), agent, model });
  } catch (error) {
    return send(res, 502, { error: 'Unable to reach the AI provider. Check the Preview deployment logs and provider status.' });
  }
}
