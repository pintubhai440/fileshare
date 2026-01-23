import { GoogleGenAI } from "@google/genai";

// ==========================================
// 1. KEY ROTATION LOGIC (10 KEYS SUPPORT)
// ==========================================

const getAllKeys = () => {
  const possibleKeys = [
    // @ts-ignore
    process.env.GEMINI_API_KEY_1,
    // @ts-ignore
    process.env.GEMINI_API_KEY_2,
    // @ts-ignore
    process.env.GEMINI_API_KEY_3,
    // @ts-ignore
    process.env.GEMINI_API_KEY_4,
    // @ts-ignore
    process.env.GEMINI_API_KEY_5,
    // @ts-ignore
    process.env.GEMINI_API_KEY_6,
    // @ts-ignore
    process.env.GEMINI_API_KEY_7,
    // @ts-ignore
    process.env.GEMINI_API_KEY_8,
    // @ts-ignore
    process.env.GEMINI_API_KEY_9,
    // @ts-ignore
    process.env.GEMINI_API_KEY_10,
    // @ts-ignore
    process.env.API_KEY,      // Fallback 1
    // @ts-ignore
    process.env.GEMINI_API_KEY // Fallback 2
  ];

  // Sirf wahi keys rakhein jo actually exist karti hain (not empty)
  return possibleKeys.filter(key => key && key.trim().length > 0);
};

const API_KEYS = getAllKeys();
let currentKeyIndex = 0;

console.log(`Loaded ${API_KEYS.length} API Keys for rotation.`);

// Helper: Get Current Client
const getClient = () => {
  if (API_KEYS.length === 0) {
    console.error("No API Keys found!");
    throw new Error("API Key configurations missing. Please check your .env or Vercel settings.");
  }
  const key = API_KEYS[currentKeyIndex];
  return new GoogleGenAI({ apiKey: key });
};

// Main Rotation Wrapper
// Yeh function error aane par automatic agli key try karta hai
const executeWithFallback = async <T>(operation: (ai: GoogleGenAI) => Promise<T>): Promise<T> => {
  let attempts = 0;
  
  // Try until we run out of keys (one full cycle)
  while (attempts < API_KEYS.length) {
    try {
      const ai = getClient();
      return await operation(ai);
    } catch (error: any) {
      console.error(`Attempt with Key ${currentKeyIndex + 1} failed:`, error.message);

      // Check for Quota Error (429) or Service Unavailable (503)
      const isQuotaError = error?.message?.includes('429') || 
                           error?.status === 429 || 
                           error?.toString().includes('Quota') || 
                           error?.toString().includes('Resource has been exhausted');

      if (isQuotaError) {
        console.warn(`⚠️ Key ${currentKeyIndex + 1} exhausted. Switching to next key...`);
        
        // Rotate Key
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
        attempts++;
      } else {
        // Agar koi aur error hai (jaise Network Error), toh turant throw karo
        throw error;
      }
    }
  }
  throw new Error("All API Keys exhausted. Please try again later.");
};

// ==========================================
// 2. FILE HELPERS
// ==========================================

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

// ==========================================
// 3. AI SERVICES (Wrapped with Rotation)
// ==========================================

/**
 * 1. Smart Chatbot
 */
export const sendChatMessage = async (
  history: { role: string; parts: { text: string }[] }[],
  message: string
) => {
  return executeWithFallback(async (ai) => {
    const systemInstruction = `
      You are the intelligent assistant for 'SecureShare AI', a secure P2P file transfer platform.
      YOUR KNOWLEDGE BASE:
      - Identity: You are the SecureShare AI Bot.
      - Core Tech: WebRTC (PeerJS). NO SERVER STORAGE.
      - Privacy: Files are 100% private, existing only in RAM. 
      - Deletion: Files vanish instantly when tab closes.
      TONE: Helpful, technical, and concise.
    `;

    // Using 'gemini-2.0-flash' for speed and better quota limits
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash', 
      contents: [
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
      }
    });

    const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response.";

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const urls = groundingChunks
      ?.map((chunk: any) => chunk.web ? { title: chunk.web.title, uri: chunk.web.uri } : null)
      .filter((u: any) => u !== null) || [];

    return {
      text: text,
      urls: urls
    };
  });
};

/**
 * 2. Analyze Image/Video
 */
export const analyzeFileContent = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    return "File type not supported for AI analysis.";
  }

  const filePart = await fileToGenerativePart(file);

  return executeWithFallback(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          filePart,
          { text: "Analyze this file. Be concise but professional." }
        ]
      }
    });

    return response.text || "No analysis available.";
  });
};

/**
 * 3. Transcribe Audio
 */
export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  const reader = new FileReader();
  
  return new Promise((resolve, reject) => {
    reader.onloadend = async () => {
      try {
        const base64data = (reader.result as string).split(',')[1];
        
        // Execute inside rotation logic
        const result = await executeWithFallback(async (ai) => {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
              parts: [
                { inlineData: { mimeType: audioBlob.type || 'audio/wav', data: base64data } },
                { text: "Transcribe this audio accurately." }
              ]
            }
          });
          return response.text || "";
        });
        
        resolve(result);
      } catch (e) { reject(e); }
    };
    reader.readAsDataURL(audioBlob);
  });
};

/**
 * 4. Text-to-Speech (Audio Generation)
 */
export const generateSpeech = async (text: string): Promise<ArrayBuffer> => {
  return executeWithFallback(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts", // Flash is reliable for TTS
      contents: [{ 
        parts: [{ text: `Read this aloud naturally (audio only): "${text}"` }] 
      }],
      config: {
        responseModalities: ["AUDIO"], // Force Audio mode
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    // Loop through parts to find the actual audio data
    const parts = response.candidates?.[0]?.content?.parts || [];
    let base64Audio = null;

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        base64Audio = part.inlineData.data;
        break; 
      }
    }
    
    if (!base64Audio) throw new Error("No audio data found in response.");
    
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  });
};
