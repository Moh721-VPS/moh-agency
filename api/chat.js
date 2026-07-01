const ALLOWED_ORIGINS = [
  'https://moh-agency.vercel.app',
  'http://localhost:3000'
];

const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 120000;

function getClientIP(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
          req.headers['cf-connecting-ip'] ||
          req.headers['x-client-ip'] ||
          'unknown');
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (record && now > record.resetTime) rateLimitMap.delete(ip);
  const current = rateLimitMap.get(ip);
  if (!current) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetTime: now + RATE_LIMIT_WINDOW };
  }
  if (current.count >= RATE_LIMIT_MAX) return { allowed: false, remaining: 0, resetTime: current.resetTime };
  current.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - current.count, resetTime: current.resetTime };
}

function setCORSHeaders(req, res) {
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'null');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
}

export default async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientIP = getClientIP(req);
  const rateLimitCheck = checkRateLimit(clientIP);
  if (!rateLimitCheck.allowed) {
    res.setHeader('Retry-After', Math.ceil((rateLimitCheck.resetTime - Date.now()) / 1000));
    return res.status(429).json({ error: 'Too many requests', response: 'Please wait a moment and try again.' });
  }

  const { history } = req.body;
  if (!Array.isArray(history) || history.length === 0 || history.length > 50) {
    return res.status(400).json({ error: 'Invalid history', response: 'Please try again.' });
  }

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API not configured', response: 'Please try again later.' });

  try {
    const systemPrompt = "You are Moh AI, intake assistant for Moh Agency — WhatsApp & Make.com automation in Doha, Qatar. Help with: AI integration, chatbots, WhatsApp automation, workflow automation, CRM sync. If outside scope, explain politely. For valid requests: analyze requirements and provide cost in QAR. Tiers: Basic 100QAR (1 trigger, 1 platform), Standard 150QAR (5 steps, 2 platforms), Premium 285QAR (complex, 5 platforms). No markdown. Response MUST be valid JSON: {\"response\": \"text\", \"showBookButton\": boolean}. Set showBookButton true if lead wants to proceed/book.";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: history,
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!response.ok) return res.status(502).json({ error: 'API error', response: 'Please try again.' });

    const data = await response.json();
    const candidateText = data.candidates[0]?.content?.parts?.[0]?.text;
    
    if (!candidateText) return res.status(502).json({ error: 'No response', response: 'Please try again.' });

    let parsed = JSON.parse(candidateText);
    let responseText = parsed.response || '';
    let showBookButton = parsed.showBookButton === true;

    if (!responseText) return res.status(502).json({ error: 'Empty response', response: 'Please try again.' });

    return res.status(200).json({ response: responseText, showBookButton });

  } catch (error) {
    console.error('Chat error:', error.message);
    return res.status(502).json({ error: 'Error', response: 'Please try again.' });
  }
}
