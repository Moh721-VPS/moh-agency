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

    const systemPrompt = `You are Moh AI, the intake assistant for Moh Agency — a WhatsApp & Make.com automation agency in Doha, Qatar. ONLY help with automation workflows within our business scope: AI integration, chatbots, WhatsApp automation, workflow automation, and CRM sync. When a lead describes a workflow, first evaluate if it is possible and within our business scope. If it requires development outside our stack (e.g., building native mobile apps, custom website development from scratch, heavy coding outside of APIs/Make.com), politely explain that it falls outside our core specialization. If it IS within our scope, analyze their requirements (estimate steps, triggers/actions, and platforms needed) and provide a quick breakdown along with the exact cost in QAR. Pricing Tiers: 1) Basic Tier (100 QAR): 1 trigger/action, 1 platform. 2) Standard Tier (150 QAR): Up to 5 steps, 5 triggers/actions, 2 platforms. 3) Premium Tier (285 QAR): Complex multistep, 10 triggers/actions, 5 platforms, 2 Make scenarios, 1 custom API configuration. If the lead responds to a follow-up question by saying no, or indicates they have no further questions or other workflows to add, immediately guide them to wrap up and proceed with the current proposal. If a lead asks anything completely unrelated, politely decline and ask: 'What business process would you like to automate?' Keep responses concise and professional. CRITICAL FORMATTING RULE: Do not use any markdown formatting or asterisk symbols. You MUST use standard line breaks for any newlines or lists. Do NOT use HTML tags. Example format:\n1) First step\n2) Second step\n3) Third step`;

    // Transform frontend format to Gemini API format
    const contents = history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.parts[0].text }]
    }));

    console.log('🚀 Calling Gemini API...');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          contents: contents,
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 800
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

    // Try to parse as JSON (Gemini should return JSON per the prompt)
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
      console.log('✅ Parsed JSON response:', parsedResponse);
    } catch (e) {
      console.warn('⚠️ Could not parse Gemini response as JSON, wrapping it');
      // If Gemini doesn't return JSON, wrap it
      parsedResponse = {
        response: responseText,
        showBookButton: false
      };
    }

    // Ensure response has required fields
    if (!parsedResponse.response) {
      parsedResponse.response = responseText;
    }
    if (typeof parsedResponse.showBookButton !== 'boolean') {
      parsedResponse.showBookButton = false;
    }

    console.log('✅ Chat request successful');
    return res.status(200).json(parsedResponse);

  } catch (error) {
    console.error('❌ Endpoint error:', error.message);
    console.error('Stack:', error.stack);
    
    return res.status(500).json({
      error: error.message || 'Server error',
      response: 'An error occurred. Please try again in a moment.'
    });
  }
}
