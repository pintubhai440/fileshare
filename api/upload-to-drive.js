import { google } from 'googleapis';
import multiparty from 'multiparty';
import fs from 'fs';

// Vercel Configuration: Body parsing disable keeps multiparty working
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const form = new multiparty.Form();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'Error parsing form data' });
    }

    try {
      // 1. OAuth2 Client Setup (OLD Service Account Code Removed)
      // अब हम Client ID और Secret का उपयोग कर रहे हैं जो आपने Cloud Console से निकाला है
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        "https://developers.google.com/oauthplayground" // Redirect URI match होना चाहिए
      );

      // 2. Set Credentials using Refresh Token
      // यह सबसे ज़रूरी स्टेप है - इससे गूगल को पता चलता है कि आप (Owner) फाइल अपलोड कर रहे हैं
      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
      });

      // 3. Initialize Drive
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      // File handling logic remains the same
      const uploadedFile = files.file[0];
      const fileName = fields.name ? fields.name[0] : uploadedFile.originalFilename;
      const fileType = fields.type ? fields.type[0] : 'application/octet-stream';

      // 4. Create File Metadata
      const fileMetadata = {
        name: fileName,
        parents: [process.env.GOOGLE_FOLDER_ID], // Target Folder ID
      };

      const media = {
        mimeType: fileType,
        body: fs.createReadStream(uploadedFile.path),
      };

      // 5. Upload to Drive (Uses User Quota)
      const response = await drive.files.create({
        requestBody: fileMetadata, // Note: v3 uses 'requestBody', not 'resource'
        media: media,
        fields: 'id, webViewLink',
        supportsAllDrives: true,
      });

      // Success Response
      res.status(200).json({ 
        success: true, 
        viewerLink: response.data.webViewLink,
        fileId: response.data.id 
      });

    } catch (error) {
      console.error('Google Drive Upload Error:', error);
      // Detailed error logging for debugging
      const errorMessage = error.response?.data?.error?.message || error.message;
      res.status(500).json({ error: errorMessage });
    }
  });
}
