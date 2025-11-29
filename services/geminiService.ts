import { GoogleGenAI, Type, Modality } from "@google/genai";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Helper to encode file for Gemini
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  // Prevent crash with large files (limit to 20MB for inline base64)
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("File too large for AI analysis (Max 20MB allowed for this demo).");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onloadend = () => {
      try {
        if (reader.error) {
          throw reader.error;
        }
        
        // Check if result exists
        if (!reader.result) {
          throw new Error("Failed to read file: Result is empty.");
        }
        
        const resultStr = reader.result as string;
        
        // Ensure valid Data URL format
        if (!resultStr.includes(',')) {
          throw new Error("Invalid file read result.");
        }

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

    reader.onerror = (e) => {
      reject(new Error(`FileReader Error: ${e.target?.error?.message || "Unknown error"}`));
    };

    reader.readAsDataURL(file);
  });
};

/**
 * 1. Smart Chatbot with Thinking Budget & Google Search
 * Uses: gemini-3-pro-preview
 */
export const sendChatMessage = async (
  history: { role: string; parts: { text: string }[] }[],
  message: string
) => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        thinkingConfig: { thinkingBudget: 32768 }, // Max thinking for complex queries
        tools: [{ googleSearch: {} }], // Grounding
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
      text: "I encountered an error processing your request.",
      urls: []
    };
  }
};

/**
 * 2. Analyze Image/Video Content
 * Uses: gemini-3-pro-preview
 */
export const analyzeFileContent = async (file: File): Promise<string> => {
  try {
    // Only analyze images or videos
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      return "File type not supported for AI analysis.";
    }

    const filePart = await fileToGenerativePart(file);

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: {
        parts: [
          filePart,
          { text: "Analyze this file. If it's an image, describe it in detail. If it's a video, summarize the key events. Be concise but professional." }
        ]
      }
    });

    return response.text || "No analysis available.";
  } catch (error: any) {
    console.error("Analysis Error:", error);
    if (error.message && error.message.includes("File too large")) {
      return error.message;
    }
    return "Failed to analyze file. The file might be corrupted or too large.";
  }
};

/**
 * 3. Transcribe Audio (Speech-to-Text)
 * Uses: gemini-2.5-flash
 */
export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  try {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onloadend = async () => {
        try {
          if (reader.error) throw reader.error;
          if (!reader.result) throw new Error("Audio read failed.");

          const base64data = (reader.result as string).split(',')[1];
          if (!base64data) throw new Error("Invalid audio data.");

          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: audioBlob.type || 'audio/wav',
                    data: base64data
                  }
                },
                { text: "Transcribe this audio accurately." }
              ]
            }
          });
          resolve(response.text || "");
        } catch (e) {
          reject(e);
        }
      };
      
      reader.onerror = (e) => reject(new Error(`FileReader Error: ${e.target?.error?.message}`));
      reader.readAsDataURL(audioBlob);
    });
  } catch (error) {
    console.error("Transcription Error:", error);
    throw error;
  }
};

/**
 * 4. Text-to-Speech
 * Uses: gemini-2.5-flash-preview-tts
 */
export const generateSpeech = async (text: string): Promise<ArrayBuffer> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
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
    
    // Decode base64 to ArrayBuffer
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