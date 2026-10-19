// Vercel serverless endpoint: POST /api/chat
// Keeps GROQ_API_KEY on the server. The browser only ever talks to this route.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const MAX_MESSAGE_CHARS = 2000; // per message
const MAX_HISTORY = 12; // most recent messages sent as context
const MAX_TOTAL_CHARS = 12000; // across the bounded history
const MAX_BODY_BYTES = 64 * 1024;
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 25000;

const SYSTEM_PROMPT =
  'You are Orbit, a friendly, curious and capable general-purpose AI assistant. ' +
  'Answer questions on any topic, explain concepts clearly, brainstorm ideas, write and edit content, and handle follow-up questions using the conversation so far. ' +
  'Be concise by default and go deeper when asked. Use short paragraphs, and use lists or code blocks when they help. ' +
  'If you are unsure or do not know something, say so instead of guessing.';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// Validates and bounds the incoming history. Returns { messages } or { error }.
export function sanitizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Send at least one message.' };
  const cleaned = [];
  for (const m of input) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.trim();
    if (!content) continue;
    if (content.length > MAX_MESSAGE_CHARS) {
      return { error: `Messages can be up to ${MAX_MESSAGE_CHARS} characters.` };
    }
    cleaned.push({ role: m.role, content });
  }
  let recent = cleaned.slice(-MAX_HISTORY);
  while (recent.length > 1 && recent.reduce((n, m) => n + m.content.length, 0) > MAX_TOTAL_CHARS) {
    recent = recent.slice(1);
  }
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  if (!recent.length || recent[recent.length - 1].role !== 'user') {
    return { error: 'The last message must be from the user.' };
  }
  return { messages: recent };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return send(res, 500, { error: 'Orbit is not configured yet: the server is missing GROQ_API_KEY.' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    if (e && e.code === 'TOO_LARGE') return send(res, 413, { error: 'Request too large.' });
    return send(res, 400, { error: 'Invalid JSON.' });
  }

  const { messages, error } = sanitizeMessages(body && body.messages);
  if (error) return send(res, 400, { error });

  const model = (process.env.GROQ_MODEL || '').trim() || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
    });

    if (!upstream.ok) {
      // Log details server-side only; never forward upstream bodies or headers to the browser.
      const detail = await upstream.text().catch(() => '');
      console.error('Groq error', upstream.status, detail.slice(0, 500));
      if (upstream.status === 401 || upstream.status === 403) {
        return send(res, 502, { error: 'The server could not authenticate with Groq. Check GROQ_API_KEY.' });
      }
      if (upstream.status === 429) {
        return send(res, 429, { error: 'Orbit is getting too many requests right now. Try again in a moment.' });
      }
      if (upstream.status === 404 || upstream.status === 400) {
        return send(res, 502, { error: 'Groq rejected the request. Check that GROQ_MODEL is a valid model.' });
      }
      return send(res, 502, { error: 'The AI service had a problem. Please try again.' });
    }

    const data = await upstream.json();
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      return send(res, 502, { error: 'The AI service returned an empty reply. Please try again.' });
    }
    return send(res, 200, { reply: reply.trim(), model });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return send(res, 504, { error: 'The AI took too long to respond. Please try again.' });
    }
    console.error('Chat handler error', e && e.message);
    return send(res, 502, { error: 'Could not reach the AI service. Please try again.' });
  } finally {
    clearTimeout(timer);
  }
}
