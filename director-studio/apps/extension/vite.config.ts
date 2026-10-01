import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: `${here}ui`,
  base: '/',
  publicDir: `${here}public`,
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'remotion', '@remotion/player'] },
  server: { port: 5200, strictPort: true, fs: { allow: [`${here}../..`] } },
  build: {
    outDir: `${here}../../../dist/client`,
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    chunkSizeWarningLimit: 2200,
    rollupOptions: { input: { editor: `${here}ui/index.html`, sandbox: `${here}ui/media-sandbox.html` } },
  },
});
