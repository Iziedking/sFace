import { AtlasApp } from './app/atlas-app';

const ui = document.querySelector<HTMLElement>('#ui');
const canvas = document.querySelector<HTMLCanvasElement>('#stage');

if (ui && canvas) {
  const app = new AtlasApp(ui, canvas);
  app.boot();
  /*
   * Screenshot capture hook, off unless asked for.
   *
   * scripts/shoot-atlas.mjs needs the lantern screen, which is several
   * gameplay steps into the city. Gating on a query parameter keeps this out of
   * the way of every real session while giving the tool a supported entry
   * instead of a simulated walk.
   */
  if (new URLSearchParams(window.location.search).has('capture')) {
    (window as unknown as { atlasCapture?: AtlasApp }).atlasCapture = app;
  }
}
