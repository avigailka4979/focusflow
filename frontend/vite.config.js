import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api and /health are proxied to the local backend.
// In Docker, the client's nginx does the same proxying (see nginx/default.conf.template).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': process.env.BACKEND_URL || 'http://localhost:8000',
      '/health': process.env.BACKEND_URL || 'http://localhost:8000',
    },
  },
  preview: {
    port: 3000,
    proxy: { '/api': process.env.BACKEND_URL || 'http://localhost:8000', '/health': process.env.BACKEND_URL || 'http://localhost:8000' },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
