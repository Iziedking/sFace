export interface AtlasCameraPoint { x: number; y: number; }

export interface AtlasCameraResize {
  viewportWidth: number;
  viewportHeight: number;
  worldWidth: number;
  worldHeight: number;
}

export interface AtlasCameraView extends AtlasCameraPoint {
  width: number;
  height: number;
}

export interface AtlasInteractionRect extends AtlasCameraPoint {
  width: number;
  height: number;
}

export class AtlasCamera {
  private readonly reducedMotion: boolean;
  private target: AtlasCameraPoint = { x: 0, y: 0 };
  private current: AtlasCameraPoint = { x: 0, y: 0 };
  private viewport = { width: 1, height: 1 };
  private world = { width: 1, height: 1 };

  constructor(options: { reducedMotion: boolean }) {
    this.reducedMotion = options.reducedMotion;
  }

  resize(size: AtlasCameraResize): void {
    assertFinite(size);
    this.viewport = { width: clampDimension(size.viewportWidth), height: clampDimension(size.viewportHeight) };
    this.world = { width: clampDimension(size.worldWidth), height: clampDimension(size.worldHeight) };
    this.current = this.clampView(this.current);
    this.target = this.clampTarget(this.target);
  }

  follow(point: AtlasCameraPoint): void {
    assertFinite(point);
    this.target = this.clampTarget({ x: Math.round(point.x), y: Math.round(point.y) });
  }

  update(): void {
    const desired = this.desiredViewOrigin();
    this.current = this.reducedMotion ? desired : {
      x: approach(this.current.x, desired.x),
      y: approach(this.current.y, desired.y),
    };
  }

  get view(): AtlasCameraView {
    return { x: this.current.x, y: this.current.y, width: this.viewport.width, height: this.viewport.height };
  }

  get interactionRect(): AtlasInteractionRect {
    const inset = Math.min(16, Math.floor(Math.min(this.viewport.width, this.viewport.height) / 4));
    return {
      x: this.current.x + inset,
      y: this.current.y + inset,
      width: Math.max(1, this.viewport.width - inset * 2),
      height: Math.max(1, this.viewport.height - inset * 2),
    };
  }

  project(point: AtlasCameraPoint): AtlasCameraPoint {
    assertFinite(point);
    return { x: Math.round(point.x - this.current.x), y: Math.round(point.y - this.current.y) };
  }

  private desiredViewOrigin(): AtlasCameraPoint {
    return this.clampView({
      x: this.target.x - Math.floor(this.viewport.width / 2),
      y: this.target.y - Math.floor(this.viewport.height / 2),
    });
  }

  private clampTarget(point: AtlasCameraPoint): AtlasCameraPoint {
    return { x: clamp(point.x, 0, this.world.width), y: clamp(point.y, 0, this.world.height) };
  }

  private clampView(point: AtlasCameraPoint): AtlasCameraPoint {
    return {
      x: clamp(point.x, 0, Math.max(0, this.world.width - this.viewport.width)),
      y: clamp(point.y, 0, Math.max(0, this.world.height - this.viewport.height)),
    };
  }
}

function approach(current: number, target: number): number {
  if (current === target) return current;
  const next = current + Math.trunc((target - current) / 4);
  return next === current ? target : next;
}

function assertFinite(size: AtlasCameraResize | AtlasCameraPoint): void {
  if ('viewportWidth' in size) {
    if (![size.viewportWidth, size.viewportHeight, size.worldWidth, size.worldHeight].every(Number.isFinite)) throw new Error('Atlas camera values must be finite.');
    return;
  }
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y)) throw new Error('Atlas camera values must be finite.');
}

function clampDimension(value: number): number {
  return Math.max(1, Math.round(value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
