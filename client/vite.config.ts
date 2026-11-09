import { defineConfig } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    fs: { allow: [root] },
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
    },
  },
  resolve: {
    alias: { '@assets': path.resolve(root, 'assets') },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
