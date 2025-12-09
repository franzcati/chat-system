import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      // Solo útil para desarrollo local
      '/api': {
        target: 'http://localhost:5000', // backend local dev
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist', // carpeta de build que servirá nginx
    rollupOptions: {
      output: {
        manualChunks: undefined, // opcional, si quieres code splitting
      },
    },
  },
});