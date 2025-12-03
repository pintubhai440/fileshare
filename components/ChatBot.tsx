import React, { useState, useRef, useEffect } from 'react';
// Changed import path from alias '@/' back to relative '../' to fix build error
import { sendChatMessage, transcribeAudio, generateSpeech } from '../services/geminiService';
import { ChatMessage } from '../types';

export const ChatBot: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', role: 'model', text: 'Hello! I am your secure file transfer assistant. How can I help you today?', groundingUrls: [] }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  
  // Track which message is currently playing audio
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      const response = await sendChatMessage(history, userMsg.text);
      
      const botMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        text: response.text,
        groundingUrls: response.urls
      };
      
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "Sorry, I encountered an error." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceInput = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorder.onstop = async () => {
          const mimeType = mediaRecorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          
          setIsLoading(true);
          try {
            const transcription = await transcribeAudio(audioBlob);
            setInput(transcription);
          } catch (err) {
            console.error(err);
            setInput("Could not transcribe audio.");
          } finally {
            setIsLoading(false);
            stream.getTracks().forEach(track => track.stop());
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error(err);
        alert("Microphone access denied or not available.");
      }
    }
  };

  // ✅ FIXED TTS FUNCTION
  const playTTS = async (text: string, msgId: string) => {
    try {
      // 1. Show Loading State
      setPlayingMessageId(msgId);
      
      const audioBuffer = await generateSpeech(text);
      
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      
      // 2. Critical Fix: Resume AudioContext if browser suspended it
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const source = audioContext.createBufferSource();
      
      audioContext.decodeAudioData(audioBuffer, (buffer) => {
        source.buffer = buffer;
        source.connect(audioContext.destination);
        
        // Reset state when audio finishes
        source.onended = () => setPlayingMessageId(null);
        
        source.start(0);
      }, (e) => {
        console.error("Error decoding audio data", e);
        setPlayingMessageId(null);
        alert("Error playing audio. Format not supported.");
      });

    } catch (e) {
      console.error("Audio playback failed", e);
      setPlayingMessageId(null);
      alert("Failed to generate speech. Please check console.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-4 flex justify-between items-center">
        <h3 className="text-white font-bold flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
          Smart Assistant
        </h3>
        <span className="text-xs bg-white/20 px-2 py-0.5 rounded text-white">Gemini 2.5 Pro</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl p-3 ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-br-none' 
                : 'bg-gray-700 text-gray-100 rounded-bl-none'
            }`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              
              {/* Grounding Sources */}
              {msg.groundingUrls && msg.groundingUrls.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/10 text-xs">
                  <p className="font-semibold opacity-70 mb-1">Sources:</p>
                  <div className="flex flex-wrap gap-2">
                    {msg.groundingUrls.map((u, i) => (
                      <a key={i} href={u.uri} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:underline bg-black/20 px-1.5 py-0.5 rounded truncate max-w-full block">
                        {u.title}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* TTS Button for Bot */}
              {msg.role === 'model' && (
                <button 
                  onClick={() => playTTS(msg.text, msg.id)}
                  disabled={playingMessageId !== null && playingMessageId !== msg.id} // Disable other buttons while one plays
                  className={`mt-2 text-xs flex items-center gap-1 transition-colors ${
                    playingMessageId === msg.id 
                      ? 'text-green-400 font-bold' 
                      : 'opacity-60 hover:opacity-100 hover:text-blue-300'
                  }`}
                >
                  {playingMessageId === msg.id ? (
                     <>
                       <div className="flex space-x-1">
                         <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce"></div>
                         <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce delay-100"></div>
                         <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-bounce delay-200"></div>
                       </div>
                       <span className="ml-1">Playing...</span>
                     </>
                  ) : (
                     <>
                       <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                       Read Aloud
                     </>
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-700 rounded-2xl rounded-bl-none p-3 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-100"></div>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-200"></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-gray-750 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <button
            onClick={handleVoiceInput}
            className={`p-2 rounded-full transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-400 hover:text-white'}`}
            title="Voice Input"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask AI anything..."
            className="flex-1 bg-gray-900 border border-gray-600 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() && !isLoading}
            className="p-2 bg-blue-600 rounded-full text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};
