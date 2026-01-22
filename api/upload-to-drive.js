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

    // 1. Auth Setup
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

    // 2. Token Get
    const { token } = await oauth2Client.getAccessToken();

    // 3. Metadata
    const metadata = {
      name: name,
      parents: [process.env.GOOGLE_FOLDER_ID],
    };

    // 🔥 FIX: URL में '&fields=id,webViewLink' जोड़ा गया है
    // इससे Google को पता चलेगा कि अपलोड खत्म होने पर Link वापस भेजना है
    const googleApiUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink';

    const response = await fetch(googleApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': type,
        'Origin': req.headers.origin || 'https://fileshare-umber.vercel.app' // CORS Fix
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
