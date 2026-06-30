// ============================================================================
// SHARED CONFIGURATION & UTILITIES
// ============================================================================

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
// MAIN HANDLER - GEMINI 2.5 FLASH API
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

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    console.error('GOOGLE_GEMINI_API_KEY not configured in environment');
    return res.status(500).json({
      error: 'API key not configured',
      response: 'I\'m currently unavailable. Please try again in a few moments.'
    });
  }

  try {
    console.log('Calling Google Gemini 2.5 Flash API', {
      ipAddress: clientIP,
      historyLength: history.length,
      timestamp: new Date().toISOString()
    });

    const systemPrompt = "You are Moh AI, the intake assistant for Moh Agency — a WhatsApp & Make.com automation agency in Doha, Qatar. ONLY help with automation workflows within our business scope: AI integration, chatbots, WhatsApp automation, workflow automation, and CRM sync. When a lead describes a workflow, first evaluate if it is possible and within our business scope. If it requires development outside our stack (e.g., building native mobile apps, custom website development from scratch, heavy coding outside of APIs/Make.com), politely explain that it falls outside our core specialization. If it IS within our scope, analyze their requirements (estimate steps, triggers/actions, and platforms needed) and provide a quick breakdown along with the exact cost in QAR. Pricing Tiers: 1) Basic Tier (100 QAR): 1 trigger/action, 1 platform. 2) Standard Tier (150 QAR): Up to 5 steps, 5 triggers/actions, 2 platforms. 3) Premium Tier (285 QAR): Complex multistep, 10 triggers/actions, 5 platforms, 2 Make scenarios, 1 custom API configuration. If the lead responds to a follow-up question by saying no, or indicates they have no further questions or other workflows to add, immediately guide them to wrap up and proceed with the current proposal. If a lead asks anything completely unrelated, politely decline and ask: 'What business process would you like to automate?' Keep responses concise and professional. CRITICAL FORMATTING RULE: Do not use any markdown formatting or asterisk symbols. You MUST use standard line breaks for any newlines or lists. Do NOT use HTML tags like <br>. Example:\n1) First step\n2) Second step\n3) Third step. CRITICAL OUTPUT REQUIREMENT: You MUST format EVERY single response as a valid, raw JSON object. Do not include markdown blocks like ```json or any text outside the JSON block. Use this exact schema: {\"response\": \"Your plain text reply to the lead goes here.\", \"showBookButton\": boolean} Set \"showBookButton\" to true if the lead explicitly states they want to proceed, asks to book a call, has agreed on a project scope, or says they have no other projects or questions left to address. Otherwise, set it to false.";

    const geminiPayload = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: history,
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    console.log('Gemini payload prepared, calling Gemini 2.5 Flash API...');

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiPayload)
      }
    );

    console.log('Gemini response status:', geminiResponse.status);

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`Gemini API returned ${geminiResponse.status}:`, errorText.substring(0, 500));
      return res.status(502).json({
        error: `Gemini API error: ${geminiResponse.status}`,
        response: 'I\'m having trouble responding right now. Please try again in a moment.'
      });
    }

    const text = await geminiResponse.text();
    console.log('Raw Gemini response received, parsing...');

    let geminiData;
    try {
      geminiData = JSON.parse(text);
      console.log('Successfully parsed Gemini response');
    } catch (parseError) {
      console.error('Failed to parse Gemini JSON:', parseError.message);
      console.error('Raw text:', text.substring(0, 500));
      return res.status(502).json({
        error: 'Invalid response from Gemini',
        response: 'I\'m currently unavailable. Please try again in a few moments.'
      });
    }

    // Extract response from Gemini's JSON output
    let responseText = '';
    let showBookButton = false;

    // Handle if Gemini returns in candidates format
    if (geminiData.candidates && geminiData.candidates[0]) {
      const candidateText = geminiData.candidates[0]?.content?.parts?.[0]?.text || '';
      console.log('Response from candidates:', candidateText.substring(0, 100));
      
      try {
        const parsed = JSON.parse(candidateText);
        responseText = parsed.response || '';
        showBookButton = parsed.showBookButton === true;
        console.log('Parsed JSON from candidate text');
      } catch (e) {
        console.warn('Could not parse candidate text as JSON, using raw text');
        responseText = candidateText;
      }
    } else if (geminiData.response) {
      // Direct response field
      responseText = geminiData.response;
      showBookButton = geminiData.showBookButton === true;
    }

    if (!responseText || typeof responseText !== 'string') {
      console.error('No response text in Gemini data', geminiData);
      return res.status(502).json({
        error: 'Empty response from Gemini',
        response: 'I\'m having trouble responding right now. Please try again in a moment.'
      });
    }

    console.log('Response extracted:', responseText.substring(0, 100));
    console.log('Show booking button:', showBookButton);
    console.log('Chat request successful, returning to frontend');

    return res.status(200).json({
      response: responseText,
      showBookButton: showBookButton
    });

  } catch (error) {
    console.error('Chat error:', {
      message: error.message,
      stack: error.stack,
      ipAddress: clientIP,
      timestamp: new Date().toISOString()
    });

    return res.status(502).json({
      error: error.message || 'Network error',
      response: 'I\'m currently unavailable. Please try again in a few moments.'
    });
  }
}
