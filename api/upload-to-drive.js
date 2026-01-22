import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: true, // JSON Body चाहिए
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { name, type } = req.body; // Frontend से Name और Type ले रहे हैं

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

    // Google से "Link" मांग रहे हैं (Upload नहीं कर रहे)
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': type,
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
