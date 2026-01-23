// vite.config.ts

import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // 1 se 10 tak saari keys yahan define kar rahe hain
        'process.env.GEMINI_API_KEY_1': JSON.stringify(env.GEMINI_API_KEY_1 || ''),
        'process.env.GEMINI_API_KEY_2': JSON.stringify(env.GEMINI_API_KEY_2 || ''),
        'process.env.GEMINI_API_KEY_3': JSON.stringify(env.GEMINI_API_KEY_3 || ''),
        'process.env.GEMINI_API_KEY_4': JSON.stringify(env.GEMINI_API_KEY_4 || ''),
        'process.env.GEMINI_API_KEY_5': JSON.stringify(env.GEMINI_API_KEY_5 || ''),
        'process.env.GEMINI_API_KEY_6': JSON.stringify(env.GEMINI_API_KEY_6 || ''),
        'process.env.GEMINI_API_KEY_7': JSON.stringify(env.GEMINI_API_KEY_7 || ''),
        'process.env.GEMINI_API_KEY_8': JSON.stringify(env.GEMINI_API_KEY_8 || ''),
        'process.env.GEMINI_API_KEY_9': JSON.stringify(env.GEMINI_API_KEY_9 || ''),
        'process.env.GEMINI_API_KEY_10': JSON.stringify(env.GEMINI_API_KEY_10 || ''),
        
        // Fallbacks
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
