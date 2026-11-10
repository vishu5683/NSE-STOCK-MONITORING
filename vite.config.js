import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset and data paths relative, so the same build works on
// GitHub Pages (project sub-path) and on Vercel (root).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 },
});
