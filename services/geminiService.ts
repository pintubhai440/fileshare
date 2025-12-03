import { GoogleGenAI, Modality } from "@google/genai";

// Ensure API Key is picked up from Vite env
const apiKey = process.env.API_KEY || ''; 
const ai = new GoogleGenAI({ apiKey });

// Helper to encode file for Gemini
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("File too large for AI analysis (Max 20MB allowed for this demo).");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        if (reader.error) throw reader.error;
        if (!reader.result) throw new Error("Failed to read file.");
        
        const resultStr = reader.result as string;
        const base64String = resultStr.split(',')[1];
        
        resolve({
          inlineData: {
            data: base64String,
            mimeType: file.type || 'application/octet-stream'
          }
        });
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = (e) => reject(new Error(`FileReader Error: ${e.target?.error?.message}`));
    reader.readAsDataURL(file);
  });
};

/**
 * 1. Smart Chatbot (Using Gemini 2.5 Pro)
 */
export const sendChatMessage = async (
  history: { role: string; parts: { text: string }[] }[],
  message: string
) => {
  try {
    const systemInstruction = `
      You are the intelligent assistant for 'SecureShare AI', a secure P2P file transfer platform.
      YOUR KNOWLEDGE BASE:
      - Identity: You are the SecureShare AI Bot (Powered by Gemini 2.5).
      - Core Tech: WebRTC (PeerJS) for direct Device-to-Device transfer. NO SERVER STORAGE.
      - Privacy: Files are 100% private, existing only in RAM. 
      - Deletion: Files vanish instantly when the tab is closed or transfer ends.
      TONE: Helpful, technical, and concise.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: [
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        thinkingConfig: { thinkingBudget: 1024 },
        tools: [{ googleSearch: {} }], 
      }
    });

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const urls = groundingChunks
      ?.map((chunk: any) => chunk.web ? { title: chunk.web.title, uri: chunk.web.uri } : null)
      .filter((u: any) => u !== null) || [];

    return {
      text: response.text || "I couldn't generate a response.",
      urls: urls
    };
  } catch (error: any) {
    console.error("Chat Error:", error);
    return {
      text: "Connection error. Please check your API key.",
      urls: []
    };
  }
};

/**
 * 2. Analyze Image/Video (Using Gemini 2.5 Pro)
 */
export const analyzeFileContent = async (file: File): Promise<string> => {
  try {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      return "File type not supported for AI analysis.";
    }

    const filePart = await fileToGenerativePart(file);

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: {
        parts: [
          filePart,
          { text: "Analyze this file. Be concise but professional." }
        ]
      }
    });

    return response.text || "No analysis available.";
  } catch (error: any) {
    console.error("Analysis Error:", error);
    return "Failed to analyze file.";
  }
};

/**
 * 3. Transcribe Audio (Using Gemini 2.0 Flash for stability)
 */
export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  try {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onloadend = async () => {
        try {
          const base64data = (reader.result as string).split(',')[1];
          
          const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: {
              parts: [
                { inlineData: { mimeType: audioBlob.type || 'audio/wav', data: base64data } },
                { text: "Transcribe this audio accurately." }
              ]
            }
          });
          resolve(response.text || "");
        } catch (e) { reject(e); }
      };
      reader.readAsDataURL(audioBlob);
    });
  } catch (error) {
    console.error("Transcription Error:", error);
    throw error;
  }
};

/**
 * 4. Text-to-Speech (Using Gemini 2.0 Flash Exp for Audio Output)
 */
export const generateSpeech = async (text: string): Promise<ArrayBuffer> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio generated");
    
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    console.error("TTS Error:", error);
    throw error;
  }
};
