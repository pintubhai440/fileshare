import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: true, // अब हमें JSON बॉडी चाहिए
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // 1. Frontend से फाइल नहीं, सिर्फ उसका नाम और टाइप मांगें
    const { name, type } = req.body;

    // 2. Auth Setup (वही पुराना सही वाला)
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

    // 3. Access Token निकालें
    const { token } = await oauth2Client.getAccessToken();

    // 4. Google से "Resumable Upload Link" मांगें
    const metadata = {
      name: name,
      parents: [process.env.GOOGLE_FOLDER_ID],
    };

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': type
      },
      body: JSON.stringify(metadata)
    });

    // 5. Google ने जो Link दिया (Header में), वो निकालें
    const uploadUrl = response.headers.get('location');

    if (!uploadUrl) throw new Error('Google did not provide an upload URL');

    // 6. वो Link फ्रंटएंड को भेज दें
    res.status(200).json({ uploadUrl });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
}
