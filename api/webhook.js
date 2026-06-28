export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, data } = req.body;
  const webhookUrl = type === 'contact' 
    ? process.env.MAKE_CONTACT_WEBHOOK 
    : process.env.MAKE_CHAT_WEBHOOK;

  if (!webhookUrl) {
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'Webhook failed', status: response.status });
    }

    const text = await response.text();
    
    let result;
    try {
      result = JSON.parse(text);
    } catch (parseError) {
      console.error('Invalid JSON from Make.com:', text.substring(0, 200));
      return res.status(500).json({ 
        error: 'Make.com returned invalid response'
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
