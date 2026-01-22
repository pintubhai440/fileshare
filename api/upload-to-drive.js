import { google } from 'googleapis';
import multiparty from 'multiparty';
import fs from 'fs';

// Vercel के लिए configuration: बॉडी पार्सिंग को बंद करना ज़रूरी है ताकि multiparty फाइल स्ट्रीम को संभाल सके
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // केवल POST रिक्वेस्ट को अनुमति दें
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
      // Vercel Environment Variables से क्रेडेंशियल्स लें
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });

      const drive = google.drive({ version: 'v3', auth });

      // FormData से फाइल और मेटाडेटा निकालें
      const uploadedFile = files.file[0];
      const fileName = fields.name ? fields.name[0] : uploadedFile.originalFilename;
      const fileType = fields.type ? fields.type[0] : 'application/octet-stream';

      const fileMetadata = {
        name: fileName,
        parents: [process.env.GOOGLE_FOLDER_ID], // आपका टारगेट फोल्डर ID
      };

      const media = {
        mimeType: fileType,
        body: fs.createReadStream(uploadedFile.path), // टेम्परेरी पाथ से फाइल स्ट्रीम करें
      };

      // गूगल ड्राइव पर फाइल बनाएँ
      const response = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, webViewLink',
        supportsAllDrives: true,
        keepRevisionForever: true
      });

      // सफलता पर लिंक वापस भेजें
      res.status(200).json({ 
        success: true, 
        viewerLink: response.data.webViewLink,
        fileId: response.data.id 
      });

    } catch (error) {
      console.error('Google Drive Upload Error:', error);
      res.status(500).json({ error: error.message });
    }
  });
}
