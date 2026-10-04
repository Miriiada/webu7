import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const base = process.env.APP_BASE_PATH || loadEnv(mode, process.cwd(), 'APP_BASE_PATH').APP_BASE_PATH || '/';
  if (base !== '/' && !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\/?$/.test(base)) throw new Error('Invalid APP_BASE_PATH');
  return { base: base.endsWith('/') ? base : `${base}/`, plugins: [react()], build: { outDir: 'dist', sourcemap: false, rollupOptions: { output: { manualChunks: { markdown: ['react-markdown'] } } } } };
});
