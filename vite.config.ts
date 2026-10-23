import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = process.env.OPSDESK_DEV_BACKEND_PORT ?? '4311';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: false },
      '/docs': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: false }, // built documentation is served by the API server
    },
  },
});
