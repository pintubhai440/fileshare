// pintubhai440/fileshare/fileshare-c54f6aad70ff6fddf9043c5ac69c7d568013bc37/services/geminiService.ts

import { GoogleGenAI } from "@google/genai";

// 1. COLLECT ALL KEYS FROM ENV
const getAllKeys = () => {
  const keys: string[] = [];
  
  // Check specifically named keys (1 to 6)
  for (let i = 1; i <= 6; i++) {
    // @ts-ignore
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }

  // Fallback to standard key if no numbered keys exist
  if (keys.length === 0 && process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  
  return keys;
};

const API_KEYS = getAllKeys();
let currentKeyIndex = 0;

console.log(`Loaded ${API_KEYS.length} API Keys for rotation.`);

// 2. HELPER: GET CURRENT CLIENT
const getClient = () => {
  const key = API_KEYS[currentKeyIndex];
  if (!key) throw new Error("No API Keys found in Environment Variables.");
  return new GoogleGenAI({ apiKey: key });
};

// 3. ROTATION LOGIC WRAPPER
// Yeh function try karega, agar fail hua toh next key pe jayega
const executeWithFallback = async <T>(operation: (ai: GoogleGenAI) => Promise<T>): Promise<T> => {
  let attempts = 0;
  
  while (attempts < API_KEYS.length) {
    try {
      const ai = getClient();
      return await operation(ai);
    } catch (error: any) {
      // Check for Quota Error (429)
      if (error?.message?.includes('429') || error?.status === 429 || error?.toString().includes('Quota')) {
        console.warn(`Key ${currentKeyIndex + 1} exhausted. Switching to next key...`);
        
        // Rotate Key
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
        attempts++;
      } else {
        // Agar koi aur error hai (like Network), toh throw karo
        throw error;
      }
    }
  }
  throw new Error("All API Keys exhausted. Please try again later.");
};

// --- SERVICES ---

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

// 1. Smart Chatbot (Rotated)
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

    // Note: 'gemini-2.0-flash' is faster and has higher limits than 'pro'
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash', 
      contents: [
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
      }
    });

    const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response.";
    
    // Safe grounding check
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const urls = groundingChunks
      ?.map((chunk: any) => chunk.web ? { title: chunk.web.title, uri: chunk.web.uri } : null)
      .filter((u: any) => u !== null) || [];

    return { text, urls };
  });
};

// 2. Analyze Image/Video (Rotated)
export const analyzeFileContent = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    return "File type not supported for AI analysis.";
  }

  const filePart = await fileToGenerativePart(file);

  return executeWithFallback(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
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

// 3. Transcribe Audio (Rotated)
export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  const reader = new FileReader();
  
  return new Promise((resolve, reject) => {
    reader.onloadend = async () => {
      try {
        const base64data = (reader.result as string).split(',')[1];
        
        const result = await executeWithFallback(async (ai) => {
          const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
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

// 4. Text-to-Speech (Rotated)
export const generateSpeech = async (text: string): Promise<ArrayBuffer> => {
  return executeWithFallback(async (ai) => {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ 
        parts: [{ text: `Read this aloud naturally (audio only): "${text}"` }] 
      }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    let base64Audio = null;

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        base64Audio = part.inlineData.data;
        break; 
      }
    }
    
    if (!base64Audio) throw new Error("No audio data found.");
    
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  });
};
