import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current working directory.
    const env = loadEnv(mode, '.', '');

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // 1. Explicitly defining keys 1 to 10 so Vite can replace them at build time
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
        'process.env.GEMINI_API_KEY_11': JSON.stringify(env.GEMINI_API_KEY_11 || ''),
        'process.env.GEMINI_API_KEY_12': JSON.stringify(env.GEMINI_API_KEY_12 || ''),
        'process.env.GEMINI_API_KEY_13': JSON.stringify(env.GEMINI_API_KEY_13 || ''),
        'process.env.GEMINI_API_KEY_14': JSON.stringify(env.GEMINI_API_KEY_14 || ''),
        'process.env.GEMINI_API_KEY_15': JSON.stringify(env.GEMINI_API_KEY_15 || ''),
        'process.env.GEMINI_API_KEY_16': JSON.stringify(env.GEMINI_API_KEY_16 || ''),
        'process.env.GEMINI_API_KEY_17': JSON.stringify(env.GEMINI_API_KEY_17 || ''),
        'process.env.GEMINI_API_KEY_18': JSON.stringify(env.GEMINI_API_KEY_18 || ''),
        'process.env.GEMINI_API_KEY_19': JSON.stringify(env.GEMINI_API_KEY_19 || ''),
        'process.env.GEMINI_API_KEY_20': JSON.stringify(env.GEMINI_API_KEY_20 || ''),
        'process.env.GEMINI_API_KEY_21': JSON.stringify(env.GEMINI_API_KEY_21 || ''),
        'process.env.GEMINI_API_KEY_22': JSON.stringify(env.GEMINI_API_KEY_22 || ''),
        'process.env.GEMINI_API_KEY_23': JSON.stringify(env.GEMINI_API_KEY_23 || ''),

        // 2. Fallbacks for standard keys
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
