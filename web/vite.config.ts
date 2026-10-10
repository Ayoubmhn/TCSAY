import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Les appels /api passent par Vite vers l'API NestJS : pas de CORS en développement.
    proxy: { '/api': 'http://localhost:3000' },
    // Partage provisoire depuis le PC (tunnel Cloudflare) : adresse https://….trycloudflare.com.
    allowedHosts: ['.trycloudflare.com'],
  },
});
