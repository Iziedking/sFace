import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
    // This used to read "a few hundred KB of source with one dependency", set to
    // 600, and it was right until the native 3D city landed. Three.js is about
    // 940 KB minified and it now trips the warning on every single build, which
    // is the worst state for a guard to be in: it fires, it is correct to
    // ignore, and so it stops being read.
    //
    // The number that actually matters is the eager entry chunk, currently
    // about 221 KB (64 KB gzipped). Three.js is not in it. It sits in the
    // scene-graph chunk behind the `await import('../render/scene-graph')` in
    // initializeLivingCity, so a phone that never opens the city never
    // downloads it, and a device that fails the WebGL capability check falls
    // through to the pixi and canvas renderers instead.
    //
    // So the limit is set above the deferred 3D chunk and below a second copy
    // of it. If this warns again, either three.js got pulled into the entry
    // chunk (check that the dynamic import above is still dynamic) or a
    // comparable dependency was added, and both are worth stopping for.
    chunkSizeWarningLimit: 1100,
  },
});
