import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Paths are anchored to this file, so the build works from any working directory.
const here = fileURLToPath(new URL('.', import.meta.url));

// The kiosk runs in Fully Kiosk's WebView on an old Fire tablet: treat it as old Chromium and
// build to ES2017 (brief Part 11). Preact's JSX through Vite's own transform, no plugin.
export default defineConfig({
  root: here,
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2017',
    cssTarget: 'chrome61',
  },
  server: {
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
