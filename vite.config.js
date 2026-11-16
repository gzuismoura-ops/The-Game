import { defineConfig } from 'vite';

// Y'SMARA build config.
// - Everything is bundled locally: no CDN, no external font, no network at runtime.
// - `base: './'` makes the built game work from any static path (including inside a WebView/APK).
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    hmr: { clientPort: 443 },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return null;
        },
      },
    },
  },
});
