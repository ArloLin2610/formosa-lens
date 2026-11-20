import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The site is fully static. `npm run data:build` writes public/data, then `npm run dev`.
// Relative base: the built site works from any path, including GitHub Pages' /formosa-lens/.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', sourcemap: false },
});
