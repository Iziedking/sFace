import { AtlasApp } from './app/atlas-app';

const ui = document.querySelector<HTMLElement>('#ui');
const canvas = document.querySelector<HTMLCanvasElement>('#stage');

if (ui && canvas) {
  new AtlasApp(ui, canvas).boot();
}
