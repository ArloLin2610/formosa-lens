import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `npm run dev` serves the UI only; API routes live in Netlify Functions.
// Run `npm run dev:netlify` (Netlify CLI) to serve both on one port, or set
// VITE_API_PROXY to a deployed site to develop the UI against production data.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: process.env.VITE_API_PROXY
      ? { '/api': { target: process.env.VITE_API_PROXY, changeOrigin: true } }
      : undefined,
  },
  build: { target: 'es2022', sourcemap: false },
});
