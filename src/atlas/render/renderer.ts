import { ATLAS_FALLBACK_PALETTE } from '../palette';
import type { AtlasState } from '../../../shared/atlas/state';
import type { GenesisObjective } from '../../../shared/atlas/districts/genesis-garden';
import type { LastLanternState } from '../../../shared/atlas/adventures/last-lantern';
import type { AtlasRole } from '../../../shared/atlas/types';

const VIEW_WIDTH = 8_000;

export class AtlasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private readonly reducedMotion: boolean;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('NIM Atlas requires a two-dimensional canvas.');
    this.context = context;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  draw(state: AtlasState, objective: GenesisObjective): void {
    const context = this.context;
    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.fillStyle = ATLAS_FALLBACK_PALETTE.ground;
    context.fillRect(0, 0, this.width, this.height);

    const scale = this.width / VIEW_WIDTH;
    const viewHeight = this.height / scale;
    const cameraX = clamp(state.player.x - VIEW_WIDTH * 0.42, 0, Math.max(0, state.mission.width - VIEW_WIDTH));
    const cameraY = clamp(state.player.y - viewHeight * 0.5, 0, Math.max(0, state.mission.height - viewHeight));
    const point = (x: number, y: number): [number, number] => [(x - cameraX) * scale, (y - cameraY) * scale];

    drawGarden(context, this.width, this.height, state.tick, this.reducedMotion);
    drawPath(context, point, state);
    drawDistantBeacon(context, point(44_000, 4_000), scale);

    for (const fault of state.faults) if (fault.active) drawRouteHazard(context, point(fault.x, fault.y), fault.radius * scale);
    for (const relay of state.relays) drawRelay(context, point(relay.x, relay.y), relay.scanned, relay.connected, scale);
    drawCourier(context, point(state.rescue.x, state.rescue.y), state.rescue.rescued, scale);
    drawGate(context, point(state.gate.x, state.gate.y), state.gate.unlocked, scale);
    drawDestination(context, point(objective.target.x, objective.target.y), state.tick, this.reducedMotion);
    drawMatureHuman(context, point(state.player.x, state.player.y), state.player.facing, state.player.shieldTicks > 0, scale, state.tick, 'YOU');
    context.restore();
  }

  drawHarbor(phase: LastLanternState['phase'], role: AtlasRole): void {
    const context = this.context;
    const restored = phase === 'tower-lit';
    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.relayScanned : ATLAS_FALLBACK_PALETTE.sandLight;
    context.fillRect(0, 0, this.width, this.height);
    context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.ground : ATLAS_FALLBACK_PALETTE.groundDim;
    context.fillRect(0, 0, this.width, this.height * 0.48);
    drawHarborSkyline(context, this.width, this.height, restored);
    drawHarborWater(context, this.width, this.height, restored, this.reducedMotion);
    drawHarborLanternShop(context, this.width * 0.13, this.height * 0.43, restored);
    drawHarborTower(context, this.width * 0.82, this.height * 0.21, this.height * 0.53, restored);
    drawHarborFerry(context, this.width * (restored ? 0.58 : 0.48), this.height * 0.69, restored);
    drawHarborWayfinding(context, this.width, this.height, restored);
    drawMatureHuman(context, [this.width * 0.28, this.height * 0.63], 'right', false, 0.9, restored ? 20 : 0, 'MARA');
    drawMatureHuman(context, [this.width * 0.38, this.height * 0.69], 'right', false, 0.9, 0, role === 'builder' ? 'BUILDER' : 'EXPLORER');
    context.restore();
  }

  drawDistrict(districtId: string, restored: boolean): void {
    const context = this.context;
    const palette = districtPalette(districtId);
    context.save();
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.fillStyle = ATLAS_FALLBACK_PALETTE.ground;
    context.fillRect(0, 0, this.width, this.height);
    context.fillStyle = palette.ground;
    context.fillRect(0, this.height * 0.52, this.width, this.height * 0.48);
    context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
    context.lineWidth = 5;
    for (let index = 0; index < 6; index += 1) {
      const x = this.width * (0.08 + index * 0.18);
      const top = this.height * (0.2 + (index % 2) * 0.12);
      context.beginPath();
      context.moveTo(x, this.height * 0.68);
      context.lineTo(x, top);
      context.stroke();
      context.fillStyle = restored ? palette.active : ATLAS_FALLBACK_PALETTE.line;
      context.beginPath();
      context.arc(x, top, 18, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.strokeStyle = restored ? palette.active : ATLAS_FALLBACK_PALETTE.muted;
    context.lineWidth = 9;
    context.beginPath();
    context.moveTo(0, this.height * 0.68);
    context.lineTo(this.width, this.height * 0.38);
    context.stroke();
    context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
    context.font = `900 ${Math.max(15, Math.min(28, this.width / 28))}px ui-monospace, monospace`;
    context.fillText(districtId.replace(/-/g, ' ').toUpperCase(), 24, this.height - 34);
    context.restore();
  }
}

/**
 * Compatibility name for the existing canvas implementation. The public Atlas
 * adapter uses `FallbackAtlasRenderer`; this alias keeps older callers stable
 * while the renderer migration is staged.
 */
export type LegacyAtlasRenderer = AtlasRenderer;

function drawHarborSkyline(context: CanvasRenderingContext2D, width: number, height: number, restored: boolean): void {
  context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.builderPath : ATLAS_FALLBACK_PALETTE.stone;
  for (let x = -30; x < width + 80; x += 130) {
    context.beginPath();
    context.moveTo(x, height * 0.48);
    context.lineTo(x + 55, height * 0.3);
    context.lineTo(x + 110, height * 0.48);
    context.fill();
  }
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 8;
  context.beginPath();
  context.moveTo(0, height * 0.55);
  context.lineTo(width, height * 0.55);
  context.stroke();
}

function drawHarborWater(context: CanvasRenderingContext2D, width: number, height: number, restored: boolean, reducedMotion: boolean): void {
  context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.selection : ATLAS_FALLBACK_PALETTE.slate;
  context.fillRect(0, height * 0.55, width, height * 0.45);
  context.strokeStyle = restored ? ATLAS_FALLBACK_PALETTE.ground : ATLAS_FALLBACK_PALETTE.routeQuiet;
  context.lineWidth = 3;
  const offset = reducedMotion ? 0 : Date.now() / 90 % 50;
  for (let y = height * 0.61; y < height; y += 48) {
    for (let x = -60 + offset; x < width; x += 110) {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 44, y);
      context.stroke();
    }
  }
}

function drawHarborLanternShop(context: CanvasRenderingContext2D, x: number, y: number, restored: boolean): void {
  const width = 270;
  const height = 190;
  context.save();
  context.lineJoin = 'round';
  context.fillStyle = ATLAS_FALLBACK_PALETTE.ground;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 6;
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);
  context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.active : ATLAS_FALLBACK_PALETTE.activeDim;
  context.beginPath();
  context.moveTo(x - 22, y + 8);
  context.lineTo(x + width / 2, y - 42);
  context.lineTo(x + width + 22, y + 8);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
  context.font = '900 15px ui-monospace, monospace';
  context.fillText('MARA / LANTERN SHOP', x + 12, y - 5);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.beaconGold;
  context.fillRect(x + 24, y + 58, 72, 82);
  context.strokeRect(x + 24, y + 58, 72, 82);
  context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.relayScanned : ATLAS_FALLBACK_PALETTE.muted;
  context.beginPath();
  context.arc(x + 60, y + 98, 21, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.ground;
  context.fillRect(x + 132, y + 58, 104, 82);
  context.strokeRect(x + 132, y + 58, 104, 82);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
  context.font = '800 12px ui-monospace, monospace';
  context.fillText(restored ? 'OPEN' : 'WAITING', x + 153, y + 104);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
  context.fillRect(x + 103, y + height - 42, 64, 42);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.ground;
  context.font = '900 10px ui-monospace, monospace';
  context.fillText('NIMIQ PAY', x + 113, y + height - 18);
  context.restore();
}

function drawHarborTower(context: CanvasRenderingContext2D, x: number, y: number, height: number, restored: boolean): void {
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 7;
  context.fillStyle = ATLAS_FALLBACK_PALETTE.ground;
  context.beginPath();
  context.moveTo(x - 54, y + height);
  context.lineTo(x - 34, y + 82);
  context.lineTo(x + 34, y + 82);
  context.lineTo(x + 54, y + height);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.relayScanned : ATLAS_FALLBACK_PALETTE.line;
  context.fillRect(x - 54, y + 26, 108, 70);
  context.strokeRect(x - 54, y + 26, 108, 70);
  if (restored) {
    context.fillStyle = 'rgba(246, 200, 95, .35)';
    context.beginPath();
    context.moveTo(x - 48, y + 40);
    context.lineTo(x - 250, y - 40);
    context.lineTo(x - 250, y + 140);
    context.closePath();
    context.fill();
  }
}

function drawHarborFerry(context: CanvasRenderingContext2D, x: number, y: number, restored: boolean): void {
  context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.active : ATLAS_FALLBACK_PALETTE.muted;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(x - 105, y);
  context.lineTo(x + 105, y);
  context.lineTo(x + 65, y + 54);
  context.lineTo(x - 65, y + 54);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.ground;
  context.fillRect(x - 30, y - 55, 60, 55);
  context.strokeRect(x - 30, y - 55, 60, 55);
}

function drawHarborWayfinding(context: CanvasRenderingContext2D, width: number, height: number, restored: boolean): void {
  context.save();
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 10;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(width * 0.08, height * 0.78);
  context.lineTo(width * 0.28, height * 0.69);
  context.lineTo(width * 0.48, height * 0.74);
  context.lineTo(width * 0.82, height * 0.55);
  context.stroke();
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.active;
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
  context.font = '900 13px ui-monospace, monospace';
  context.fillText('PAY HARBOR', width * 0.06, height * 0.12);
  context.fillStyle = restored ? ATLAS_FALLBACK_PALETTE.settled : ATLAS_FALLBACK_PALETTE.active;
  context.fillText('FOLLOW THE PINK WAY', width * 0.06, height * 0.16);
  context.restore();
}

function districtPalette(districtId: string): { ground: string; active: string } {
  if (districtId === 'light-forest') return { ground: ATLAS_FALLBACK_PALETTE.builderPath, active: ATLAS_FALLBACK_PALETTE.settled };
  if (districtId === 'albatross-causeway') return { ground: ATLAS_FALLBACK_PALETTE.waterLight, active: ATLAS_FALLBACK_PALETTE.selection };
  if (districtId === 'validator-peaks') return { ground: ATLAS_FALLBACK_PALETTE.sandDeep, active: ATLAS_FALLBACK_PALETTE.relayScanned };
  if (districtId === 'builder-city') return { ground: ATLAS_FALLBACK_PALETTE.groundBuilder, active: ATLAS_FALLBACK_PALETTE.active };
  return { ground: ATLAS_FALLBACK_PALETTE.groundRaised, active: ATLAS_FALLBACK_PALETTE.active };
}

function drawGarden(context: CanvasRenderingContext2D, width: number, height: number, tick: number, reducedMotion: boolean): void {
  context.fillStyle = ATLAS_FALLBACK_PALETTE.foliageLight;
  context.fillRect(0, 0, width, height * 0.48);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.foliageMid;
  context.beginPath();
  context.moveTo(0, height * 0.48);
  context.quadraticCurveTo(width * 0.2, height * 0.25, width * 0.42, height * 0.46);
  context.quadraticCurveTo(width * 0.68, height * 0.2, width, height * 0.44);
  context.lineTo(width, height * 0.62);
  context.lineTo(0, height * 0.62);
  context.closePath();
  context.fill();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.groundRaised;
  context.fillRect(0, height * 0.62, width, height * 0.38);
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.sandDeep;
  context.lineWidth = 1;
  const drift = reducedMotion ? 0 : tick % 80;
  for (let x = -80 + drift; x < width + 80; x += 80) {
    context.beginPath();
    context.moveTo(x, height * 0.62);
    context.lineTo(x - 30, height);
    context.stroke();
  }
  drawGardenBuilding(context, width * 0.08, height * 0.35, width * 0.16, height * 0.2, ATLAS_FALLBACK_PALETTE.sandWarm, 'FIELD OFFICE');
  drawGardenBuilding(context, width * 0.7, height * 0.31, width * 0.18, height * 0.24, ATLAS_FALLBACK_PALETTE.builderPath, 'ROUTE HOUSE');
  for (let index = 0; index < 7; index += 1) drawGardenTree(context, width * (0.04 + index * 0.15), height * (0.54 + (index % 2) * 0.03), 0.75 + (index % 3) * 0.1);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
  context.font = '900 11px ui-monospace, monospace';
  context.fillText('GENESIS GARDEN / PAY HARBOR OUTSKIRTS', 18, height * 0.58);
}

function drawGardenBuilding(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, name: string): void {
  context.save();
  context.fillStyle = color;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 3;
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.activeDim;
  context.beginPath();
  context.moveTo(x - 8, y);
  context.lineTo(x + width / 2, y - height * 0.35);
  context.lineTo(x + width + 8, y);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
  context.fillRect(x + width * 0.12, y + height * 0.32, width * 0.22, height * 0.24);
  context.fillRect(x + width * 0.66, y + height * 0.32, width * 0.22, height * 0.24);
  context.font = '900 9px ui-monospace, monospace';
  context.fillText(name, x + 7, y + height - 8);
  context.restore();
}

function drawGardenTree(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.save();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.timber;
  context.fillRect(x - 5 * size, y - 50 * size, 10 * size, 54 * size);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.settled;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 2;
  for (const [offsetX, offsetY, radius] of [[0, -70, 34], [-23, -48, 24], [23, -48, 24]] as const) {
    context.beginPath();
    context.arc(x + offsetX * size, y + offsetY * size, radius * size, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawPath(context: CanvasRenderingContext2D, point: (x: number, y: number) => [number, number], state: AtlasState): void {
  const stops = [state.mission.spawn, state.relays[0]!, state.rescue, state.gate];
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 22;
  context.beginPath();
  stops.forEach((stop, index) => {
    const [x, y] = point(stop.x, stop.y);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.active;
  context.lineWidth = 8;
  context.stroke();
}

function drawRelay(context: CanvasRenderingContext2D, [x, y]: [number, number], scanned: boolean, connected: boolean, scale: number): void {
  const size = Math.max(34, 580 * scale);
  context.save();
  context.translate(x, y);
  context.fillStyle = connected ? ATLAS_FALLBACK_PALETTE.active : scanned ? ATLAS_FALLBACK_PALETTE.relayScanned : ATLAS_FALLBACK_PALETTE.line;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * 0.5, 0);
  context.lineTo(0, size * 0.65);
  context.lineTo(-size * 0.5, 0);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = connected ? ATLAS_FALLBACK_PALETTE.line : ATLAS_FALLBACK_PALETTE.ground;
  context.font = `900 ${Math.max(18, size * 0.34)}px ui-monospace, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('N', 0, -size * 0.05);
  label(context, 'ADDRESS STONE', 0, size + 26);
  context.restore();
}

function drawCourier(context: CanvasRenderingContext2D, [x, y]: [number, number], rescued: boolean, scale: number): void {
  const size = Math.max(24, 360 * scale);
  context.save();
  context.translate(x, y);
  context.fillStyle = rescued ? ATLAS_FALLBACK_PALETTE.rescued : ATLAS_FALLBACK_PALETTE.ground;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 4;
  context.beginPath();
  context.arc(0, -size * 0.55, size * 0.28, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillRect(-size * 0.3, -size * 0.2, size * 0.6, size * 0.85);
  context.strokeRect(-size * 0.3, -size * 0.2, size * 0.6, size * 0.85);
  label(context, rescued ? 'MARA / READY' : 'MARA / HARBOR KEEPER', 0, size + 24);
  context.restore();
}

function drawGate(context: CanvasRenderingContext2D, [x, y]: [number, number], unlocked: boolean, scale: number): void {
  const width = Math.max(100, 1_500 * scale);
  const height = Math.max(140, 2_100 * scale);
  context.save();
  context.translate(x, y);
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = Math.max(8, 140 * scale);
  context.beginPath();
  context.moveTo(-width / 2, height / 2);
  context.lineTo(-width / 2, -height * 0.12);
  context.arc(0, -height * 0.12, width / 2, Math.PI, 0);
  context.lineTo(width / 2, height / 2);
  context.stroke();
  if (unlocked) {
    context.strokeStyle = ATLAS_FALLBACK_PALETTE.active;
    context.lineWidth = 6;
    context.stroke();
  } else {
    context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
    context.fillRect(-width * 0.35, -height * 0.05, width * 0.7, height * 0.55);
  }
  label(context, unlocked ? 'GENESIS GATE / OPEN' : 'GENESIS GATE / LOCKED', 0, height * 0.72);
  context.restore();
}

function drawRouteHazard(context: CanvasRenderingContext2D, [x, y]: [number, number], radius: number): void {
  const size = Math.max(15, Math.min(28, radius * 0.12));
  context.save();
  context.translate(x, y);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.warn;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 3;
  context.beginPath();
  context.arc(0, 0, size, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.ground;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(-size * 0.35, -size * 0.35);
  context.lineTo(size * 0.35, size * 0.35);
  context.moveTo(size * 0.35, -size * 0.35);
  context.lineTo(-size * 0.35, size * 0.35);
  context.stroke();
  context.restore();
}

function drawMatureHuman(context: CanvasRenderingContext2D, [x, y]: [number, number], facing: 'up' | 'down' | 'left' | 'right', shielded: boolean, scale: number, tick: number, name: string): void {
  const size = Math.max(48, 390 * scale);
  const walking = tick > 0 && tick % 18 < 9;
  const sideFacing = facing === 'left' || facing === 'right';
  const direction = facing === 'left' ? -1 : 1;
  context.save();
  context.translate(x, y);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.fillStyle = 'rgba(23, 20, 17, .22)';
  context.beginPath();
  context.ellipse(0, size * 0.48, size * 0.42, size * 0.13, 0, 0, Math.PI * 2);
  context.fill();
  if (shielded) {
    context.strokeStyle = ATLAS_FALLBACK_PALETTE.waterDeep;
    context.lineWidth = Math.max(3, size * 0.025);
    context.beginPath();
    context.arc(0, 0, size * 0.62, 0, Math.PI * 2);
    context.stroke();
  }

  context.strokeStyle = ATLAS_FALLBACK_PALETTE.shadow;
  context.lineWidth = Math.max(7, size * 0.095);
  context.beginPath();
  context.moveTo(-size * 0.15, size * 0.2);
  context.lineTo(-size * (0.2 + (walking ? 0.08 : 0)), size * 0.53);
  context.moveTo(size * 0.15, size * 0.2);
  context.lineTo(size * (0.2 + (walking ? 0.08 : 0)), size * 0.53);
  context.stroke();
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = Math.max(8, size * 0.11);
  context.beginPath();
  context.moveTo(-size * (0.2 + (walking ? 0.08 : 0)), size * 0.53);
  context.lineTo(-size * (0.05 + (walking ? 0.08 : 0)), size * 0.53);
  context.moveTo(size * (0.2 + (walking ? 0.08 : 0)), size * 0.53);
  context.lineTo(size * (0.35 + (walking ? 0.08 : 0)), size * 0.53);
  context.stroke();

  context.fillStyle = name === 'MARA' ? ATLAS_FALLBACK_PALETTE.activeDim : ATLAS_FALLBACK_PALETTE.selection;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = Math.max(4, size * 0.035);
  context.beginPath();
  context.moveTo(-size * 0.28, -size * 0.22);
  context.quadraticCurveTo(0, -size * 0.34, size * 0.28, -size * 0.22);
  context.lineTo(size * 0.23, size * 0.26);
  context.quadraticCurveTo(0, size * 0.36, -size * 0.23, size * 0.26);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.skinWarm;
  context.fillRect(-size * 0.07, -size * 0.3, size * 0.14, size * 0.14);
  context.strokeRect(-size * 0.07, -size * 0.3, size * 0.14, size * 0.14);
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = Math.max(5, size * 0.055);
  context.beginPath();
  context.moveTo(-size * 0.23, -size * 0.13);
  context.lineTo(-size * 0.42 * direction, size * 0.1);
  context.moveTo(size * 0.23, -size * 0.13);
  context.lineTo(size * 0.42 * direction, size * 0.1);
  context.stroke();
  if (name === 'MARA') {
    context.fillStyle = ATLAS_FALLBACK_PALETTE.beaconGold;
    context.fillRect(-size * 0.13, size * 0.01, size * 0.26, size * 0.14);
    context.strokeRect(-size * 0.13, size * 0.01, size * 0.26, size * 0.14);
  } else {
    context.fillStyle = ATLAS_FALLBACK_PALETTE.active;
    context.fillRect(-size * 0.04, -size * 0.14, size * 0.08, size * 0.3);
  }

  context.fillStyle = ATLAS_FALLBACK_PALETTE.skinWarm;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = Math.max(3, size * 0.03);
  context.beginPath();
  context.ellipse(sideFacing ? direction * size * 0.02 : 0, -size * 0.51, size * 0.21, size * 0.23, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.timberDark;
  context.beginPath();
  context.arc(sideFacing ? direction * size * 0.01 : 0, -size * 0.59, size * 0.2, Math.PI, Math.PI * 2);
  context.lineTo(direction * size * 0.19, -size * 0.48);
  context.quadraticCurveTo(0, -size * 0.4, -direction * size * 0.19, -size * 0.48);
  context.closePath();
  context.fill();
  context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
  const eyeX = sideFacing ? direction * size * 0.1 : direction * size * 0.08;
  context.beginPath();
  context.arc(eyeX, -size * 0.52, size * 0.025, 0, Math.PI * 2);
  context.fill();
  if (!sideFacing) {
    context.beginPath();
    context.arc(-eyeX, -size * 0.52, size * 0.025, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.clay;
  context.lineWidth = Math.max(2, size * 0.018);
  context.beginPath();
  context.arc(sideFacing ? direction * size * 0.02 : 0, -size * 0.46, size * 0.055, 0.15, Math.PI - 0.15);
  context.stroke();
  label(context, name === 'MARA' ? 'MARA / KEEPER' : `YOU / ${name}`, 0, size * 0.72);
  context.restore();
}

function drawDestination(context: CanvasRenderingContext2D, [x, y]: [number, number], tick: number, reducedMotion: boolean): void {
  const pulse = reducedMotion ? 0 : (tick % 30) * 0.7;
  context.save();
  context.translate(x, y);
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.active;
  context.lineWidth = 4;
  context.setLineDash([10, 8]);
  context.beginPath();
  context.arc(0, 0, 56 + pulse, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawDistantBeacon(context: CanvasRenderingContext2D, [x, y]: [number, number], scale: number): void {
  const size = Math.max(80, 2_400 * scale);
  context.save();
  context.translate(x, y);
  context.globalAlpha = 0.28;
  context.strokeStyle = ATLAS_FALLBACK_PALETTE.line;
  context.lineWidth = 6;
  for (let ring = 1; ring <= 3; ring += 1) {
    context.beginPath();
    context.arc(0, 0, size * ring * 0.33, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.restore();
}

function label(context: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  context.font = '800 11px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const width = context.measureText(text).width + 14;
  context.fillStyle = ATLAS_FALLBACK_PALETTE.line;
  context.fillRect(x - width / 2, y - 10, width, 20);
  context.fillStyle = ATLAS_FALLBACK_PALETTE.ground;
  context.fillText(text, x, y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
