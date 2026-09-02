import type { AtlasLivingWorldSnapshot } from '../../../shared/atlas/living-world';
import type { AtlasSceneRenderer, AtlasRendererOptions } from './contracts';
import { AtlasRenderer } from './renderer';

export class FallbackAtlasRenderer implements AtlasSceneRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private legacyRenderer: AtlasRenderer | null = null;

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
    void options;
  }

  async loadDistrict(_districtId: string): Promise<void> {
    this.requireRenderer();
  }

  render(snapshot: AtlasLivingWorldSnapshot): void {
    this.requireRenderer().drawDistrict(snapshot.districtId, snapshot.restoration === 'restored');
  }

  resize(width: number, height: number, _resolution: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (width > 0) canvas.style.width = `${Math.round(width)}px`;
    if (height > 0) canvas.style.height = `${Math.round(height)}px`;
    this.requireRenderer().resize();
  }

  async releaseDistrict(_districtId: string): Promise<void> {
    this.requireRenderer();
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
