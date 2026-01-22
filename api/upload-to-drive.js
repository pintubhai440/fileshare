import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { name, type } = req.body;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

    const { token } = await oauth2Client.getAccessToken();

    const metadata = {
      name: name,
      parents: [process.env.GOOGLE_FOLDER_ID],
    };

    // 🔥 Google से लिंक मांगते वक़्त 'Origin' बताना ज़रूरी है
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': type,
        // ✅ CORS FIX: Google को बता रहे हैं कि फाइल इस वेबसाइट से आएगी
        'Origin': req.headers.origin || 'https://fileshare-umber.vercel.app' 
      },
      body: JSON.stringify(metadata)
    });

    const uploadUrl = response.headers.get('location');

    if (!uploadUrl) throw new Error('Google did not provide an upload URL');

    res.status(200).json({ uploadUrl });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
}
