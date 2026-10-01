import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * Vite-Konfiguration des Renderers (Electron + Browser-Dev-Modus mit Fake-Backend).
 * Die Workspace-Pakete (@studio/core, @studio/render) sind TypeScript-Quellen und werden direkt
 * mitkompiliert (nicht vorgebündelt).
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const root = `${here}src/renderer`;

/** CSP nur im Build (der Dev-Server braucht Inline-Skripte für React Refresh). */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: studio-asset:",
  "media-src 'self' data: blob: studio-asset:",
  "font-src 'self' data: studio-asset:",
  "connect-src 'self' data: blob: studio-asset:",
  "frame-src 'self' data: blob: http://127.0.0.1:* http://localhost:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'studio-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export const RENDERER_DEV_PORT = Number(process.env.STUDIO_RENDERER_PORT ?? 5199);

export default defineConfig({
  root,
  base: './',
  plugins: [react(), cspPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom', 'remotion', '@remotion/player'],
  },
  optimizeDeps: {
    exclude: ['@studio/core', '@studio/render'],
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'zustand', 'zustand/vanilla', 'zod', 'remotion', '@remotion/player'],
  },
  server: {
    port: RENDERER_DEV_PORT,
    strictPort: true,
    fs: { allow: [`${here}../..`] },
  },
  build: {
    outDir: `${here}out/renderer`,
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: true,
  },
});
