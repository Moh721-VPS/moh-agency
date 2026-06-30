// ============================================================================
// SHARED CONFIGURATION & UTILITIES
// ============================================================================

const ALLOWED_ORIGINS = [
  'https://moh-agency.vercel.app',
  'http://localhost:3000'
];

const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

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

  if (record && now > record.resetTime) {
    rateLimitMap.delete(ip);
  }

  const current = rateLimitMap.get(ip);

  if (!current) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetTime: now + RATE_LIMIT_WINDOW };
  }

  if (current.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetTime: current.resetTime };
  }

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

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req, res) {
  setCORSHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', response: 'Invalid request method' });
  }

  const clientIP = getClientIP(req);
  const rateLimitCheck = checkRateLimit(clientIP);

  if (!rateLimitCheck.allowed) {
    console.warn(`Rate limit exceeded for IP: ${clientIP}`);
    res.setHeader('Retry-After', Math.ceil((rateLimitCheck.resetTime - Date.now()) / 1000));
    return res.status(429).json({
      error: 'Too many requests',
      response: 'I\'m processing requests a bit slowly right now. Please wait a moment and try again.'
    });
  }

  const { history } = req.body;

  if (!Array.isArray(history)) {
    console.warn('Invalid request: history is not an array', { type: typeof history });
    return res.status(400).json({
      error: 'Invalid request format',
      response: 'Sorry, I\'m having trouble processing your message. Please try again.'
    });
  }

  if (history.length === 0) {
    return res.status(400).json({
      error: 'Empty history',
      response: 'Sorry, I\'m having trouble processing your message. Please try again.'
    });
  }

  if (history.length > 50) {
    console.warn(`History array exceeds max length: ${history.length} messages`);
    return res.status(400).json({
      error: 'History too long',
      response: 'This conversation has gotten quite long. Please start a new chat and I\'ll be happy to help again.'
    });
  }

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (typeof entry !== 'object' || entry === null) {
      return res.status(400).json({
        error: 'Invalid history entry',
        response: 'Sorry, I\'m having trouble processing your message. Please try again.'
      });
    }
    if (!['user', 'model', 'assistant'].includes(entry.role)) {
      return res.status(400).json({
        error: 'Invalid role in history',
        response: 'Sorry, I\'m having trouble processing your message. Please try again.'
      });
    }
  }

  const webhookUrl = process.env.MAKE_CHAT_WEBHOOK;

  if (!webhookUrl) {
    console.error('MAKE_CHAT_WEBHOOK not configured in environment');
    return res.status(500).json({
      error: 'Webhook not configured',
      response: 'I\'m currently unavailable. Please try again in a few moments, or reach out to us directly.'
    });
  }

  try {
    console.log('Calling Make.com webhook for chat', {
      ipAddress: clientIP,
      historyLength: history.length,
      timestamp: new Date().toISOString()
    });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history }),
      timeout: 30000
    });

    console.log('Make.com response status:', response.status);

    if (!response.ok) {
      console.error(`Make.com returned ${response.status}: ${response.statusText}`);
      const errorText = await response.text();
      console.error('Make.com error body:', errorText.substring(0, 500));
      return res.status(502).json({
        error: `Upstream service error: ${response.status}`,
        response: 'I\'m having trouble responding right now. Please try again in a moment.'
      });
    }

    const text = await response.text();
    console.log('=== RAW MAKE.COM RESPONSE START ===');
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers.entries()));
    console.log('Body:', text);
    console.log('=== RAW MAKE.COM RESPONSE END ===');

    // Try to parse as JSON
    let result;
    try {
      result = JSON.parse(text);
      console.log('Successfully parsed as JSON:', result);
    } catch (parseError) {
      console.error('JSON parse failed:', parseError.message);
      console.error('Attempted to parse:', text.substring(0, 500));
      
      // Make.com might have returned plain text or error
      return res.status(502).json({
        error: 'Invalid JSON response from upstream',
        response: 'I\'m currently unavailable. Please try again in a few moments.',
        debugInfo: `Could not parse response as JSON. Raw: ${text.substring(0, 200)}`
      });
    }

    // Check if response itself contains an error object (from Gemini API)
    if (result.error) {
      console.error('Gemini/Make.com returned error object:', result.error);
      return res.status(502).json({
        error: 'Upstream service error',
        response: 'I\'m currently unavailable. Please try again in a few moments.',
        upstreamError: result.error
      });
    }

    // Extract response text (try multiple field names)
    const responseText = result.response || result.text || result.answer || result.content || '';
    
    console.log('Extracted response text:', responseText.substring(0, 200));
    console.log('showBookButton value:', result.showBookButton);

    // Validate response is not empty
    if (typeof responseText !== 'string' || responseText.trim().length === 0) {
      console.error('Response text is empty or invalid', { result, type: typeof responseText });
      return res.status(502).json({
        error: 'Empty response from upstream',
        response: 'I\'m currently unavailable. Please try again in a few moments.',
        debugInfo: `Response object: ${JSON.stringify(result)}`
      });
    }

    // Success response
    console.log('Chat request successful, returning to frontend');
    return res.status(200).json({
      response: responseText,
      showBookButton: result.showBookButton === true
    });

  } catch (error) {
    console.error('Chat webhook error:', {
      message: error.message,
      code: error.code,
      ipAddress: clientIP,
      timestamp: new Date().toISOString()
    });

    return res.status(502).json({
      error: error.message || 'Network error',
      response: 'I\'m currently unavailable. Please try again in a few moments.'
    });
  }
}
