export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { history } = req.body;

  if (!Array.isArray(history)) {
    return res.status(400).json({ error: 'Invalid request format', response: 'Please send a valid message' });
  }

  const webhookUrl = process.env.MAKE_CHAT_WEBHOOK;

  if (!webhookUrl) {
    console.error('MAKE_CHAT_WEBHOOK not configured');
    return res.status(500).json({ 
      error: 'Webhook not configured in Vercel', 
      response: 'Chat service is temporarily unavailable. Please try again later.' 
    });
  }

  try {
    console.log('Calling Make.com webhook:', webhookUrl.substring(0, 50) + '...');
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        history: history,
        timestamp: new Date().toISOString()
      }),
      timeout: 30000
    });

    console.log('Make.com response status:', response.status);

    if (!response.ok) {
      console.error(`Make.com returned ${response.status}: ${response.statusText}`);
      return res.status(500).json({ 
        error: `Make.com error: ${response.status}`,
        response: 'Sorry, I\'m having trouble right now. Please try again.' 
      });
    }

    const text = await response.text();
    console.log('Make.com raw response:', text.substring(0, 200));

    let result;
    try {
      result = JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse Make.com JSON:', parseError.message);
      return res.status(500).json({ 
        error: 'Invalid JSON from Make.com',
        response: 'Make.com returned an invalid response. Please check your scenario.' 
      });
    }

    const responseText = result.response || result.text || result.answer || 'No response from AI';
    
    return res.status(200).json({
      response: responseText,
      showBookButton: result.showBookButton || false
    });

  } catch (error) {
    console.error('Chat webhook error:', error.message);
    return res.status(500).json({ 
      error: error.message,
      response: 'Network error. Please check your connection and try again.' 
    });
  }
}
