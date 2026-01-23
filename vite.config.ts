// pintubhai440/fileshare/fileshare-c54f6aad70ff6fddf9043c5ac69c7d568013bc37/vite.config.ts

import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    // Multiple keys collect karna
    const apiKeys = Object.keys(env).reduce((prev, next) => {
      if (next.startsWith('GEMINI_API_KEY_')) {
        prev[next] = JSON.stringify(env[next]);
      }
      return prev;
    }, {
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY) // Fallback for original key
    });

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        ...apiKeys, // Yahan saari keys inject ho jayengi
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
