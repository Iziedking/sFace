import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Bind on all interfaces so you can open the dev server from a phone on
    // the same network. Testing this in a desktop browser only tells you the
    // desktop story, and the target is a WebView on a phone.
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    // The whole game is a few hundred KB of source with one dependency. If
    // this ever warns, something got pulled in that should not have been.
    chunkSizeWarningLimit: 600,
  },
});
