import { google } from 'googleapis';

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { name, type, folderId, isFolder } = req.body; // New params

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const { token } = await oauth2Client.getAccessToken();

    // 1. अगर फोल्डर बनाना है (If request is to create a folder)
    if (isFolder) {
      const fileMetadata = {
        name: name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [process.env.GOOGLE_FOLDER_ID] // Main folder ke andar
      };

      const response = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fileMetadata)
      });
      
      const folder = await response.json();
      return res.status(200).json({ id: folder.id });
    }

    // 2. अगर फाइल अपलोड करनी है (File Upload Logic)
    // अगर folderId आया है तो वहां डालो, नहीं तो Main folder में
    const parents = folderId ? [folderId] : [process.env.GOOGLE_FOLDER_ID];

    const metadata = {
      name: name,
      parents: parents, 
    };

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': type,
      },
      body: JSON.stringify(metadata)
    });

    const uploadUrl = response.headers.get('location');
    res.status(200).json({ uploadUrl });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
}
