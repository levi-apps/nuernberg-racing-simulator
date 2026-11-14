import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages liegt unter /<repo>/; lokal und sonst unter /
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
