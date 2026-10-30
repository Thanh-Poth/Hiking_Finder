import { defineConfig } from 'vite';

// Base relative : fonctionne sur GitHub Pages (sous-dossier) comme sur Cloudflare Pages.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
