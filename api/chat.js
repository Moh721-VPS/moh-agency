const ALLOWED_ORIGINS = ['https://moh-agency.vercel.app', 'http://localhost:3000'];
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 120000;

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['cf-connecting-ip'] || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (record && now > record.resetTime) rateLimitMap.delete(ip);
  const current = rateLimitMap.get(ip);
  if (!current) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }
  if (current.count >= RATE_LIMIT_MAX) return { allowed: false };
  current.count += 1;
  return { allowed: true };
}

function setCORSHeaders(req, res) {
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCORSHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed', response: 'Invalid request' });

  const clientIP = getClientIP(req);
  const rateLimit = checkRateLimit(clientIP);
  if (!rateLimit.allowed) {
    return res.status(429).json({ error: 'Too many requests', response: 'Please wait before trying again.' });
  }

  const { history } = req.body;
  if (!Array.isArray(history) || history.length === 0 || history.length > 50) {
    return res.status(400).json({ error: 'Invalid history', response: 'Sorry, I\'m having trouble processing your message.' });
  }

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_GEMINI_API_KEY not set');
    return res.status(500).json({ error: 'API key missing', response: 'Service unavailable, please try again.' });
  }

  try {
    const prompt = "You are Moh AI, the intake assistant for Moh Agency — a WhatsApp & Make.com automation agency in Doha, Qatar. ONLY help with automation workflows within our business scope: AI integration, chatbots, WhatsApp automation, workflow automation, and CRM sync. When a lead describes a workflow, first evaluate if it is possible and within our business scope. If it requires development outside our stack (e.g., building native mobile apps, custom website development from scratch, heavy coding outside of APIs/Make.com), politely explain that it falls outside our core specialization. If it IS within our scope, analyze their requirements (estimate steps, triggers/actions, and platforms needed) and provide a quick breakdown along with the exact cost in QAR. Pricing Tiers: 1) Basic Tier (100 QAR): 1 trigger/action, 1 platform. 2) Standard Tier (150 QAR): Up to 5 steps, 5 triggers/actions, 2 platforms. 3) Premium Tier (285 QAR): Complex multistep, 10 triggers/actions, 5 platforms, 2 Make scenarios, 1 custom API configuration. If the lead responds to a follow-up question by saying no, or indicates they have no further questions or other workflows to add, immediately guide them to wrap up and proceed with the current proposal. If a lead asks anything completely unrelated, politely decline and ask: 'What business process would you like to automate?' Keep responses concise and professional. CRITICAL FORMATTING RULE: Do not use any markdown formatting or asterisk symbols. You MUST use standard line breaks for any newlines or lists. Do NOT use HTML tags like <br>. Example:\n1) First step\n2) Second step\n3) Third step. CRITICAL OUTPUT REQUIREMENT: You MUST format EVERY single response as a valid, raw JSON object. Do not include markdown blocks like ```json or any text outside the JSON block. Use this exact schema: {\"response\": \"Your plain text reply to the lead goes here.\", \"showBookButton\": boolean} Set \"showBookButton\" to true if the lead explicitly states they want to proceed, asks to book a call, has agreed on a project scope, or says they have no other projects or questions left to address. Otherwise, set it to false.";

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: prompt }] },
        contents: history,
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('Gemini error:', err.substring(0, 200));
      return res.status(502).json({ error: 'Gemini error', response: 'I\'m having trouble right now. Please try again.' });
    }

    const data = await geminiRes.json();
    let responseText = '';
    let showBookButton = false;

    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      try {
        const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
        responseText = parsed.response || '';
        showBookButton = parsed.showBookButton === true;
      } catch (e) {
        responseText = data.candidates[0].content.parts[0].text;
      }
    }

    if (!responseText) {
      return res.status(502).json({ error: 'Empty response', response: 'I\'m having trouble responding. Please try again.' });
    }

    return res.status(200).json({ response: responseText, showBookButton });
  } catch (error) {
    console.error('Error:', error.message);
    return res.status(502).json({ error: 'Server error', response: 'Please try again in a moment.' });
  }
}
