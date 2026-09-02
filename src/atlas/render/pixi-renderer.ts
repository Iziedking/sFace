import { Application, Container, Graphics, Text } from 'pixi.js';
import type { AtlasLivingWorldSnapshot } from '../../../shared/atlas/living-world';
import type { PayHarborSceneProjection } from '../scenes/pay-harbor';
import type { AtlasSceneRenderer, AtlasRendererOptions } from './contracts';

export interface PixiRendererBackend extends AtlasSceneRenderer {}

export class PixiAtlasRenderer implements AtlasSceneRenderer {
  constructor(private readonly backend: PixiRendererBackend = new PixiRendererBackendImpl()) {}

  initialize(host: HTMLElement, options: AtlasRendererOptions): Promise<void> {
    return this.backend.initialize(host, normalizeOptions(options));
  }

  loadDistrict(districtId: string): Promise<void> {
    return this.backend.loadDistrict(districtId);
  }

  render(snapshot: AtlasLivingWorldSnapshot): void {
    this.backend.render(snapshot);
  }

  renderPayHarbor(scene: PayHarborSceneProjection): void {
    this.render(scene.snapshot);
  }

  resize(width: number, height: number, resolution: number): void {
    this.backend.resize(clampDimension(width), clampDimension(height), clampResolution(resolution));
  }

  releaseDistrict(districtId: string): Promise<void> {
    return this.backend.releaseDistrict(districtId);
  }

  destroy(): Promise<void> {
    return this.backend.destroy();
  }
}

class PixiRendererBackendImpl implements PixiRendererBackend {
  private application: Application | null = null;
  private scene: Container | null = null;
  private width = 1;
  private height = 1;
  private loadedDistrict: string | null = null;

  async initialize(host: HTMLElement, options: AtlasRendererOptions): Promise<void> {
    if (this.application) throw new Error('Pixi Atlas renderer is already initialized.');
    const application = new Application();
    await application.init({
      autoStart: false,
      autoDensity: true,
      antialias: true,
      backgroundColor: 0xf4ede0,
      preference: 'webgl',
      resolution: clampResolution(options.resolution),
    });
    this.application = application;
    this.scene = new Container();
    application.stage.addChild(this.scene);
    host.append(application.canvas);
    this.resize(host.clientWidth, host.clientHeight, options.resolution);
    this.renderEmptyState();
  }

  async loadDistrict(districtId: string): Promise<void> {
    if (!this.application || !this.scene) throw new Error('Pixi Atlas renderer is not initialized.');
    if (this.loadedDistrict === districtId) return;
    this.loadedDistrict = districtId;
  }

  render(snapshot: AtlasLivingWorldSnapshot): void {
    if (!this.application || !this.scene) throw new Error('Pixi Atlas renderer is not initialized.');
    this.clearScene();
    const background = new Graphics().rect(0, 0, this.width, this.height).fill({ color: 0xf4ede0 });
    this.scene.addChild(background);
    const route = new Graphics().rect(this.width * 0.08, this.height * 0.72, this.width * 0.84, Math.max(18, this.height * 0.06)).fill({ color: 0xeadfc8 });
    this.scene.addChild(route);
    const entities = [...snapshot.entities]
      .filter((entity) => entity.active)
      .sort((left, right) => left.y + left.depth - (right.y + right.depth) || left.id.localeCompare(right.id));
    for (const entity of entities) this.scene.addChild(createEntityNode(entity.id, entity.kind, entity.x, entity.y, this.width, this.height));
    const player = new Graphics()
      .circle((snapshot.player.x / 2_400) * this.width, (snapshot.player.y / 1_400) * this.height, Math.max(12, this.width * 0.018))
      .fill({ color: 0xff5a1f })
      .stroke({ width: 3, color: 0x14110e });
    this.scene.addChild(player);
  }

  resize(width: number, height: number, resolution: number): void {
    this.width = clampDimension(width);
    this.height = clampDimension(height);
    this.application?.renderer.resize(this.width, this.height);
    if (this.application) this.application.renderer.resolution = clampResolution(resolution);
  }

  async releaseDistrict(districtId: string): Promise<void> {
    if (this.loadedDistrict === districtId) this.loadedDistrict = null;
  }

  async destroy(): Promise<void> {
    const application = this.application;
    this.application = null;
    this.scene = null;
    this.loadedDistrict = null;
    if (application) {
      const canvas = application.canvas;
      application.destroy();
      canvas.remove();
    }
  }

  private clearScene(): void {
    if (!this.scene) return;
    for (const child of this.scene.removeChildren()) child.destroy({ children: true });
  }

  private renderEmptyState(): void {
    if (!this.scene) return;
    this.clearScene();
    const background = new Graphics().rect(0, 0, this.width, this.height).fill({ color: 0xf4ede0 });
    const title = new Text({
      text: 'NIM ATLAS / LOADING PAY HARBOR',
      style: { fill: 0x14110e, fontFamily: 'ui-monospace, monospace', fontSize: 16, fontWeight: '700' },
    });
    title.x = 24;
    title.y = 24;
    this.scene.addChild(background, title);
  }
}

function createEntityNode(id: string, kind: string, x: number, y: number, width: number, height: number): Container {
  const node = new Container();
  node.x = (x / 2_400) * width;
  node.y = (y / 1_400) * height;
  const color = kind === 'light' ? 0xff5a1f : kind === 'transport' ? 0x8fc8c2 : kind === 'resident' ? 0x8fb3a8 : 0x65513b;
  const marker = new Graphics().circle(0, 0, Math.max(10, width * 0.014)).fill({ color }).stroke({ width: 2, color: 0x14110e });
  const label = new Text({ text: id.replace(/-/g, ' ').toUpperCase(), style: { fill: 0x14110e, fontFamily: 'ui-monospace, monospace', fontSize: 9 } });
  label.x = Math.max(10, width * 0.014) + 6;
  label.y = -6;
  node.addChild(marker, label);
  return node;
}

function normalizeOptions(options: AtlasRendererOptions): AtlasRendererOptions {
  return { reducedMotion: options.reducedMotion, resolution: clampResolution(options.resolution) };
}

function clampDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function clampResolution(value: number): number {
  return Number.isFinite(value) ? Math.min(2, Math.max(1, value)) : 1;
}
