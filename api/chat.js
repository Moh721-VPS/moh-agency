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

  try {
    const { history } = req.body;

    console.log('📥 Received chat request');
    console.log('History length:', history?.length);
    console.log('GEMINI_API_KEY env:', process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Missing');

    // Basic validation
    if (!Array.isArray(history)) {
      console.error('❌ History is not an array:', typeof history);
      return res.status(400).json({
        error: 'Invalid history',
        response: 'Please send a valid message array.'
      });
    }

    if (history.length === 0) {
      console.error('❌ History is empty');
      return res.status(400).json({
        error: 'Empty history',
        response: 'Please include at least one message.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY env var not set');
      return res.status(500).json({
        error: 'API key not configured',
        response: 'The chat service is not configured. Please contact support.'
      });
    }

    // Transform frontend format to Gemini API format
    const contents = history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.parts[0].text }]
    }));

    const systemPrompt = `You are Moh AI, the automation consultant for Moh Agency — a specialized AI automation agency based in Doha, Qatar. 

Your role is to help prospects understand how AI integration and Make.com automation can transform their business. Be conversational, knowledgeable, and helpful.

Key things to know about Moh Agency:
- We specialize in AI Integration (Gemini, Claude), Make.com automation workflows, and custom solutions
- We're based in Doha, Qatar but work with clients globally
- Our services include: AI chatbots, content pipelines, workflow automation, lead capture, data sync
- We follow a 4-step process: Discovery → Design → Build → Deploy
- We typically deliver solutions within 90 days

When appropriate, encourage the user to book a discovery call. Subtly suggest this but don't be pushy. Focus on understanding their needs first.

Be warm, professional, and genuinely helpful. Ask clarifying questions to understand their business challenges.`;

    console.log('🚀 Calling Gemini API...');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          contents: contents,
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 500
          }
        })
      }
    );

    console.log('📊 Gemini response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Gemini returned ${response.status}:`, errorText.substring(0, 300));
      return res.status(502).json({
        error: `Gemini error: ${response.status}`,
        response: 'The AI service is not responding. Please try again in a moment.'
      });
    }

    const data = await response.json();
    console.log('📦 Gemini response:', JSON.stringify(data).substring(0, 500));

    // Extract text from Gemini response
    const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!responseText) {
      console.error('❌ Response text is empty:', JSON.stringify(data));
      return res.status(502).json({
        error: 'Empty response',
        response: 'Received an empty response from Gemini. Please try again.'
      });
    }

    console.log('✅ Chat request successful');
    return res.status(200).json({
      response: responseText
    });

  } catch (error) {
    console.error('❌ Endpoint error:', error.message);
    console.error('Stack:', error.stack);
    
    return res.status(500).json({
      error: error.message || 'Server error',
      response: 'An error occurred. Please try again in a moment.'
    });
  }
}
