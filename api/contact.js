// ============================================================================
// api/contact.js - COPY THIS ENTIRE FILE
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

export default async function handler(req, res) {
  setCORSHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientIP = getClientIP(req);
  const rateLimitCheck = checkRateLimit(clientIP);

  if (!rateLimitCheck.allowed) {
    console.warn(`Rate limit exceeded for contact form submission from IP: ${clientIP}`);
    res.setHeader('Retry-After', Math.ceil((rateLimitCheck.resetTime - Date.now()) / 1000));
    return res.status(429).json({
      error: 'Too many requests',
      response: 'You are submitting forms too quickly. Please wait before trying again.'
    });
  }

  let { name, email, subject, message, timestamp } = req.body;

  if (typeof name !== 'string' || typeof email !== 'string' || 
      typeof subject !== 'string' || typeof message !== 'string') {
    console.warn('Invalid contact form submission: type check failed', { 
      nameType: typeof name, 
      emailType: typeof email,
      subjectType: typeof subject,
      messageType: typeof message,
      ipAddress: clientIP 
    });
    return res.status(400).json({
      error: 'Invalid input types',
      response: 'Please fill out all fields with text values.'
    });
  }

  name = name.trim();
  email = email.trim();
  subject = subject.trim();
  message = message.trim();

  if (name.length < 2) {
    return res.status(400).json({
      error: 'Name too short',
      response: 'Your name must be at least 2 characters long.'
    });
  }
  if (name.length > 100) {
    return res.status(400).json({
      error: 'Name too long',
      response: 'Your name must not exceed 100 characters.'
    });
  }

  if (!EMAIL_REGEX.test(email)) {
    console.warn('Invalid email format submitted', { email, ipAddress: clientIP });
    return res.status(400).json({
      error: 'Invalid email format',
      response: 'Please provide a valid email address (e.g., name@example.com).'
    });
  }
  if (email.length > 255) {
    return res.status(400).json({
      error: 'Email too long',
      response: 'Email address must not exceed 255 characters.'
    });
  }

  if (subject.length < 3) {
    return res.status(400).json({
      error: 'Subject too short',
      response: 'Subject must be at least 3 characters long.'
    });
  }
  if (subject.length > 150) {
    return res.status(400).json({
      error: 'Subject too long',
      response: 'Subject must not exceed 150 characters.'
    });
  }

  if (message.length < 10) {
    return res.status(400).json({
      error: 'Message too short',
      response: 'Your message must be at least 10 characters long.'
    });
  }
  if (message.length > 2000) {
    return res.status(400).json({
      error: 'Message too long',
      response: 'Your message must not exceed 2000 characters.'
    });
  }

  const webhookUrl = process.env.MAKE_CONTACT_WEBHOOK;

  if (!webhookUrl) {
    console.error('MAKE_CONTACT_WEBHOOK not configured in environment');
    return res.status(500).json({
      error: 'Webhook not configured',
      response: 'Contact service is temporarily unavailable.'
    });
  }

  try {
    console.log('Submitting contact form via Make.com webhook', {
      ipAddress: clientIP,
      emailDomain: email.split('@')[1],
      timestamp: new Date().toISOString()
    });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        subject,
        message,
        timestamp: timestamp || new Date().toISOString(),
        submitterIP: clientIP
      }),
      timeout: 30000
    });

    console.log('Make.com contact webhook response status:', response.status);

    if (!response.ok) {
      console.error(`Make.com returned ${response.status} for contact form`);
      const errorText = await response.text();
      console.error('Error details:', errorText.substring(0, 300));
      return res.status(502).json({
        error: `Webhook failed with status ${response.status}`,
        response: 'Your message could not be sent at this time. Please try again later.'
      });
    }

    const text = await response.text();
    let result = { success: true };

    try {
      result = JSON.parse(text);
    } catch (parseError) {
      console.log('Make.com returned non-JSON response (expected for some scenarios)');
    }

    return res.status(200).json({ 
      success: true, 
      response: 'Your message has been received. We will get back to you soon.',
      ...result 
    });

  } catch (error) {
    console.error('Contact webhook error:', {
      message: error.message,
      code: error.code,
      ipAddress: clientIP,
      timestamp: new Date().toISOString()
    });

    return res.status(502).json({
      error: error.message || 'Network error',
      response: 'Unable to send your message. Please check your connection and try again.'
    });
  }
}
