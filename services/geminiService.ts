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

  return possibleKeys.filter(key => key && key.trim().length > 0);
};

const API_KEYS = getAllKeys();
let currentKeyIndex = 0;

console.log(`Loaded ${API_KEYS.length} API Keys for rotation.`);

const getClient = () => {
  if (API_KEYS.length === 0) throw new Error("No API Keys found!");
  const key = API_KEYS[currentKeyIndex];
  return new GoogleGenAI({ apiKey: key });
};

const executeWithFallback = async <T>(operation: (ai: GoogleGenAI) => Promise<T>): Promise<T> => {
  let attempts = 0;
  while (attempts < API_KEYS.length) {
    try {
      const ai = getClient();
      return await operation(ai);
    } catch (error: any) {
      console.error(`Attempt with Key ${currentKeyIndex + 1} failed:`, error.message);
      
      const isQuotaError = error?.message?.includes('429') || 
                           error?.status === 429 || 
                           error?.toString().includes('Quota');

      if (isQuotaError) {
        console.warn(`⚠️ Key ${currentKeyIndex + 1} exhausted. Switching to next key...`);
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
        attempts++;
      } else {
        throw error;
      }
    }
  }
  throw new Error("All API Keys exhausted.");
};

// ==========================================
// 2. FILE HELPERS
// ==========================================

export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  if (file.size > 20 * 1024 * 1024) throw new Error("File too large (Max 20MB).");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        const base64String = (reader.result as string).split(',')[1];
        resolve({ inlineData: { data: base64String, mimeType: file.type || 'application/octet-stream' } });
      } catch (e) { reject(e); }
    };
    reader.onerror = (e) => reject(new Error("FileReader Error"));
    reader.readAsDataURL(file);
  });
};

// ==========================================
// 3. AI SERVICES (UPDATED MODELS)
// ==========================================

// 1. Smart Chatbot (Using Gemini 2.5 Flash for speed)
export const sendChatMessage = async (
  history: { role: string; parts: { text: string }[] }[],
  message: string
) => {
  return executeWithFallback(async (ai) => {
    const systemInstruction = `You are 'SecureShare AI'. Keep answers short, technical, and helpful.`;
    
    // Using the stable Gemini 2.5 Flash model
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash', 
      contents: [
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: { systemInstruction: { parts: [{ text: systemInstruction }] } }
    });

    const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const urls = groundingChunks?.map((chunk: any) => chunk.web ? { title: chunk.web.title, uri: chunk.web.uri } : null).filter((u: any) => u !== null) || [];

    return { text, urls };
  });
};

// 2. Analyze Image/Video (Using Gemini 2.5 Flash)
export const analyzeFileContent = async (file: File): Promise<string> => {
  const filePart = await fileToGenerativePart(file);
  return executeWithFallback(async (ai) => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [ filePart, { text: "Analyze this file concisely." } ] }
    });
    return response.text || "No analysis available.";
  });
};

// 3. Transcribe Audio (Using Gemini 2.5 Flash)
export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64data = (reader.result as string).split(',')[1];
        const result = await executeWithFallback(async (ai) => {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
              parts: [
                { inlineData: { mimeType: audioBlob.type || 'audio/wav', data: base64data } },
                { text: "Transcribe this audio." }
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

// 4. Text-to-Speech (Trying Gemini 2.5 Flash TTS with fallback)
export const generateSpeech = async (text: string): Promise<ArrayBuffer> => {
  return executeWithFallback(async (ai) => {
    let response;
    
    try {
      // 🎯 PRIORITY 1: Try the latest specialized TTS model
      response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts", 
        contents: [{ parts: [{ text: `Read this aloud: "${text}"` }] }],
        config: {
          responseModalities: ["AUDIO"], 
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
    } catch (err) {
      console.warn("Gemini 2.5 TTS failed, falling back to 2.0 Flash Exp...", err);
      // 🛡️ FALLBACK: Use Gemini 2.0 Flash Exp if 2.5 fails (Reliable Backup)
      response = await ai.models.generateContent({
        model: "gemini-2.0-flash-exp", 
        contents: [{ parts: [{ text: `Read this aloud: "${text}"` }] }],
        config: {
          responseModalities: ["AUDIO"], 
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
    }

    const parts = response.candidates?.[0]?.content?.parts || [];
    let base64Audio = null;

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        base64Audio = part.inlineData.data;
        break; 
      }
    }
    
    if (!base64Audio) throw new Error("AI did not return audio data.");
    
    // Clean Base64 to prevent format errors
    const cleanBase64 = base64Audio.replace(/[\n\r\s]/g, '');
    const binaryString = atob(cleanBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  });
};
