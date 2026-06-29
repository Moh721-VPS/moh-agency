// ============================================================================
// SHARED CONFIGURATION & UTILITIES
// ============================================================================

const ALLOWED_ORIGINS = [
  'https://moh-agency.vercel.app',
  'http://localhost:3000'
];

const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const PHONE_REGEX = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;

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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientIP = getClientIP(req);
  const rateLimitCheck = checkRateLimit(clientIP);

  if (!rateLimitCheck.allowed) {
    console.warn(`Rate limit exceeded for booking submission from IP: ${clientIP}`);
    res.setHeader('Retry-After', Math.ceil((rateLimitCheck.resetTime - Date.now()) / 1000));
    return res.status(429).json({
      error: 'Too many requests',
      response: 'You are submitting requests too quickly. Please wait before trying again.'
    });
  }

  let { firstName, lastName, email, phone, company, needs, timestamp } = req.body;

  // Type checks
  if (typeof firstName !== 'string' || typeof lastName !== 'string' || 
      typeof email !== 'string' || typeof phone !== 'string' || 
      typeof company !== 'string' || typeof needs !== 'string') {
    console.warn('Invalid booking submission: type check failed', { 
      firstNameType: typeof firstName,
      lastNameType: typeof lastName,
      emailType: typeof email,
      phoneType: typeof phone,
      companyType: typeof company,
      needsType: typeof needs,
      ipAddress: clientIP 
    });
    return res.status(400).json({
      error: 'Invalid input types',
      response: 'Please fill out all fields correctly.'
    });
  }

  // Trim whitespace
  firstName = firstName.trim();
  lastName = lastName.trim();
  email = email.trim();
  phone = phone.trim();
  company = company.trim();
  needs = needs.trim();

  // Validate First Name
  if (firstName.length < 2) {
    return res.status(400).json({
      error: 'First name too short',
      response: 'First name must be at least 2 characters long.'
    });
  }
  if (firstName.length > 50) {
    return res.status(400).json({
      error: 'First name too long',
      response: 'First name must not exceed 50 characters.'
    });
  }

  // Validate Last Name
  if (lastName.length < 2) {
    return res.status(400).json({
      error: 'Last name too short',
      response: 'Last name must be at least 2 characters long.'
    });
  }
  if (lastName.length > 50) {
    return res.status(400).json({
      error: 'Last name too long',
      response: 'Last name must not exceed 50 characters.'
    });
  }

  // Validate Email
  if (!EMAIL_REGEX.test(email)) {
    console.warn('Invalid email format in booking', { email, ipAddress: clientIP });
    return res.status(400).json({
      error: 'Invalid email format',
      response: 'Please provide a valid email address.'
    });
  }
  if (email.length > 255) {
    return res.status(400).json({
      error: 'Email too long',
      response: 'Email address must not exceed 255 characters.'
    });
  }

  // Validate Phone
  if (!PHONE_REGEX.test(phone)) {
    console.warn('Invalid phone format in booking', { phone, ipAddress: clientIP });
    return res.status(400).json({
      error: 'Invalid phone format',
      response: 'Please provide a valid phone number.'
    });
  }
  if (phone.length > 20) {
    return res.status(400).json({
      error: 'Phone too long',
      response: 'Phone number must not exceed 20 characters.'
    });
  }

  // Validate Company
  if (company.length < 2) {
    return res.status(400).json({
      error: 'Company too short',
      response: 'Company name must be at least 2 characters long.'
    });
  }
  if (company.length > 100) {
    return res.status(400).json({
      error: 'Company too long',
      response: 'Company name must not exceed 100 characters.'
    });
  }

  // Validate Needs
  if (needs.length < 10) {
    return res.status(400).json({
      error: 'Needs too short',
      response: 'Please tell us more about your needs (at least 10 characters).'
    });
  }
  if (needs.length > 2000) {
    return res.status(400).json({
      error: 'Needs too long',
      response: 'Your message must not exceed 2000 characters.'
    });
  }

  const webhookUrl = process.env.MAKE_BOOKING_WEBHOOK;

  if (!webhookUrl) {
    console.error('MAKE_BOOKING_WEBHOOK not configured in environment');
    return res.status(500).json({
      error: 'Webhook not configured',
      response: 'Booking service is temporarily unavailable.'
    });
  }

  try {
    console.log('Submitting booking request via Make.com webhook', {
      ipAddress: clientIP,
      emailDomain: email.split('@')[1],
      timestamp: new Date().toISOString()
    });

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        phone,
        company,
        needs,
        timestamp: timestamp || new Date().toISOString(),
        submitterIP: clientIP
      }),
      timeout: 30000
    });

    console.log('Make.com booking webhook response status:', response.status);

    if (!response.ok) {
      console.error(`Make.com returned ${response.status} for booking`);
      const errorText = await response.text();
      console.error('Error details:', errorText.substring(0, 300));
      return res.status(502).json({
        error: `Webhook failed with status ${response.status}`,
        response: 'Your booking request could not be processed. Please try again later.'
      });
    }

    const text = await response.text();
    let result = { success: true };

    try {
      result = JSON.parse(text);
    } catch (parseError) {
      console.log('Make.com returned non-JSON response for booking');
    }

    return res.status(200).json({ 
      success: true, 
      response: 'Your booking request has been received. We will contact you within 24 hours to confirm.',
      ...result 
    });

  } catch (error) {
    console.error('Booking webhook error:', {
      message: error.message,
      code: error.code,
      ipAddress: clientIP,
      timestamp: new Date().toISOString()
    });

    return res.status(502).json({
      error: error.message || 'Network error',
      response: 'Unable to process your booking. Please check your connection and try again.'
    });
  }
}
