import type { AtlasLivingWorldSnapshot } from '../../../shared/atlas/living-world';
import type { AtlasSceneRenderer, AtlasRendererOptions } from './contracts';
import { AtlasRenderer } from './renderer';
import { parseAtlasCityScene, type AtlasCitySceneV1 } from '../../../shared/atlas/city/types';
import type { AtlasCityPlayerState } from '../../../shared/atlas/city/player';
import type { AtlasCitizenPresentation } from '../../../shared/atlas/city/crowd';
import type { AtlasCityInteractionPresentation } from './contracts';
import { paintCityMap } from './city-map';
import { routeAtlasCitizenPath } from '../../../shared/atlas/city/citizen-motion';

export class FallbackAtlasRenderer implements AtlasSceneRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private legacyRenderer: AtlasRenderer | null = null;
  private assets: AtlasRendererOptions['assetManager'];
  private scene: AtlasCitySceneV1 | null = null;
  private width = 1;
  private height = 1;

  constructor(private readonly canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas')) {}

  async initialize(host: HTMLElement, options: AtlasRendererOptions): Promise<void> {
    if (this.legacyRenderer) throw new Error('Fallback Atlas renderer is already initialized.');
    const canvas = this.canvasFactory();
    canvas.className = 'atlas-renderer-fallback';
    canvas.setAttribute('aria-label', 'NIM Atlas low-detail renderer');
    host.append(canvas);
    this.canvas = canvas;
    this.legacyRenderer = new AtlasRenderer(canvas);
    this.legacyRenderer.resize();
    this.legacyRenderer.drawDistrict('pay-harbor', false);
    this.assets = options.assetManager;
  }

  async loadDistrict(_districtId: string): Promise<void> {
    this.requireRenderer();
    if (this.assets) this.scene = parseAtlasCityScene(JSON.parse(new TextDecoder().decode(await this.assets.loadBytes(`/atlas/3d/v1/${_districtId}/scene.json`))) as unknown);
    if (this.scene) this.scene = { ...this.scene, paths: this.scene.paths.map(path => routeAtlasCitizenPath(path, this.scene!.colliders)) };
  }

  render(snapshot: AtlasLivingWorldSnapshot, crowd?: readonly AtlasCitizenPresentation[], player?: AtlasCityPlayerState, interaction?: AtlasCityInteractionPresentation): void {
    const context = this.canvas?.getContext('2d');
    if (player && this.scene && context && this.canvas) {
      context.save();
      context.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
      const color = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
      paintCityMap({
        rect: (x, y, w, h, c) => { context.fillStyle = color(c); context.fillRect(x, y, w, h); },
        circle: (x, y, r, c) => { context.fillStyle = color(c); context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.fill(); },
        line: (points, w, c) => { context.strokeStyle = color(c); context.lineWidth = w; context.beginPath(); points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y)); context.stroke(); },
      }, this.scene, this.width, this.height, player, snapshot.restoration === 'restored', interaction, crowd, snapshot.simulation.tick / 30);
      context.restore();
      return;
    }
    this.requireRenderer().drawDistrict(snapshot.districtId, snapshot.restoration === 'restored');
  }

  resize(width: number, height: number, _resolution: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const canvas = this.canvas;
    if (!canvas) return;
    if (width > 0) canvas.style.width = `${Math.round(width)}px`;
    if (height > 0) canvas.style.height = `${Math.round(height)}px`;
    this.requireRenderer().resize();
  }

  async releaseDistrict(_districtId: string): Promise<void> {
    this.requireRenderer();
    if (this.scene?.districtId === _districtId) this.scene = null;
  }

  async destroy(): Promise<void> {
    const canvas = this.canvas;
    this.canvas = null;
    this.legacyRenderer = null;
    canvas?.remove();
  }

  private requireRenderer(): AtlasRenderer {
    if (!this.legacyRenderer) throw new Error('Fallback Atlas renderer is not initialized.');
    return this.legacyRenderer;
  }
}
