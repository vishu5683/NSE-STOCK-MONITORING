import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { upstoxPlugin } from './server/upstoxLive.js';

// base './' keeps asset and data paths relative, so the same build works on
// GitHub Pages (project sub-path) and on Vercel (root).
// Port 5173 is fixed so the Upstox redirect URL stays the same while testing.
export default defineConfig({
  base: './',
  plugins: [react(), upstoxPlugin()],
  server: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 900 },
});
