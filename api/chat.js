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

  const { name, email, subject, message, timestamp } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const webhookUrl = process.env.MAKE_CONTACT_WEBHOOK;

  if (!webhookUrl) {
    console.error('MAKE_CONTACT_WEBHOOK not configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  try {
    console.log('Calling Make.com contact webhook');

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name,
        email,
        subject,
        message,
        timestamp: timestamp || new Date().toISOString()
      }),
      timeout: 30000
    });

    if (!response.ok) {
      console.error(`Make.com returned ${response.status}`);
      return res.status(500).json({ error: 'Webhook failed' });
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      result = { success: true };
    }

    return res.status(200).json({ success: true, ...result });

  } catch (error) {
    console.error('Contact webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
