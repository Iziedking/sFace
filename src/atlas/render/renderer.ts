import type { AtlasState } from '../../../shared/atlas/state';
import type { GenesisObjective } from '../../../shared/atlas/districts/genesis-garden';

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
    context.fillStyle = '#f4ede0';
    context.fillRect(0, 0, this.width, this.height);

    const scale = this.width / VIEW_WIDTH;
    const viewHeight = this.height / scale;
    const cameraX = clamp(state.player.x - VIEW_WIDTH * 0.42, 0, Math.max(0, state.mission.width - VIEW_WIDTH));
    const cameraY = clamp(state.player.y - viewHeight * 0.5, 0, Math.max(0, state.mission.height - viewHeight));
    const point = (x: number, y: number): [number, number] => [(x - cameraX) * scale, (y - cameraY) * scale];

    drawGarden(context, this.width, this.height, state.tick, this.reducedMotion);
    drawPath(context, point, state);
    drawDistantBeacon(context, point(44_000, 4_000), scale);

    for (const fault of state.faults) if (fault.active) drawFault(context, point(fault.x, fault.y), fault.radius * scale);
    for (const relay of state.relays) drawRelay(context, point(relay.x, relay.y), relay.scanned, relay.connected, scale);
    drawCourier(context, point(state.rescue.x, state.rescue.y), state.rescue.rescued, scale);
    drawGate(context, point(state.gate.x, state.gate.y), state.gate.unlocked, scale);
    drawDestination(context, point(objective.target.x, objective.target.y), state.tick, this.reducedMotion);
    drawExplorer(context, point(state.player.x, state.player.y), state.player.facing, state.player.shieldTicks > 0, scale);
    context.restore();
  }
}

function drawGarden(context: CanvasRenderingContext2D, width: number, height: number, tick: number, reducedMotion: boolean): void {
  context.fillStyle = '#eadfc8';
  context.fillRect(0, height * 0.62, width, height * 0.38);
  context.strokeStyle = '#d5c7aa';
  context.lineWidth = 1;
  const drift = reducedMotion ? 0 : tick % 80;
  for (let x = -80 + drift; x < width + 80; x += 80) {
    context.beginPath();
    context.moveTo(x, height * 0.62);
    context.lineTo(x - 30, height);
    context.stroke();
  }
  context.fillStyle = '#b9c79a';
  context.fillRect(0, height * 0.12, width, height * 0.18);
  context.fillStyle = '#9eae7c';
  for (let x = 20; x < width; x += 120) {
    context.beginPath();
    context.moveTo(x, height * 0.3);
    context.lineTo(x + 42, height * 0.2);
    context.lineTo(x + 84, height * 0.3);
    context.fill();
  }
}

function drawPath(context: CanvasRenderingContext2D, point: (x: number, y: number) => [number, number], state: AtlasState): void {
  const stops = [state.mission.spawn, state.relays[0]!, state.rescue, state.gate];
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#171411';
  context.lineWidth = 22;
  context.beginPath();
  stops.forEach((stop, index) => {
    const [x, y] = point(stop.x, stop.y);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.strokeStyle = '#f28b30';
  context.lineWidth = 8;
  context.stroke();
}

function drawRelay(context: CanvasRenderingContext2D, [x, y]: [number, number], scanned: boolean, connected: boolean, scale: number): void {
  const size = Math.max(34, 580 * scale);
  context.save();
  context.translate(x, y);
  context.fillStyle = connected ? '#f28b30' : scanned ? '#f6c85f' : '#171411';
  context.strokeStyle = '#171411';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * 0.5, 0);
  context.lineTo(0, size * 0.65);
  context.lineTo(-size * 0.5, 0);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = connected ? '#171411' : '#f4ede0';
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
  context.fillStyle = rescued ? '#5bb98c' : '#f4ede0';
  context.strokeStyle = '#171411';
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
  context.strokeStyle = '#171411';
  context.lineWidth = Math.max(8, 140 * scale);
  context.beginPath();
  context.moveTo(-width / 2, height / 2);
  context.lineTo(-width / 2, -height * 0.12);
  context.arc(0, -height * 0.12, width / 2, Math.PI, 0);
  context.lineTo(width / 2, height / 2);
  context.stroke();
  if (unlocked) {
    context.strokeStyle = '#f28b30';
    context.lineWidth = 6;
    context.stroke();
  } else {
    context.fillStyle = '#171411';
    context.fillRect(-width * 0.35, -height * 0.05, width * 0.7, height * 0.55);
  }
  label(context, unlocked ? 'GENESIS GATE / OPEN' : 'GENESIS GATE / LOCKED', 0, height * 0.72);
  context.restore();
}

function drawFault(context: CanvasRenderingContext2D, [x, y]: [number, number], radius: number): void {
  const size = Math.max(28, radius);
  context.save();
  context.translate(x, y);
  context.fillStyle = '#d55238';
  context.strokeStyle = '#171411';
  context.lineWidth = 3;
  context.beginPath();
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    const distance = index % 2 === 0 ? size : size * 0.55;
    const px = Math.cos(angle) * distance;
    const py = Math.sin(angle) * distance;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = '#171411';
  context.font = `900 ${Math.max(16, size * 0.35)}px ui-monospace, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('FAULT', 0, 0);
  context.restore();
}

function drawExplorer(context: CanvasRenderingContext2D, [x, y]: [number, number], facing: 'up' | 'down' | 'left' | 'right', shielded: boolean, scale: number): void {
  const size = Math.max(26, 420 * scale);
  context.save();
  context.translate(x, y);
  if (shielded) {
    context.strokeStyle = '#4e9ccf';
    context.lineWidth = 5;
    context.beginPath();
    context.arc(0, 0, size * 1.25, 0, Math.PI * 2);
    context.stroke();
  }
  context.fillStyle = '#f4ede0';
  context.strokeStyle = '#171411';
  context.lineWidth = 4;
  context.beginPath();
  context.arc(0, -size * 0.55, size * 0.28, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillRect(-size * 0.34, -size * 0.18, size * 0.68, size * 0.76);
  context.strokeRect(-size * 0.34, -size * 0.18, size * 0.68, size * 0.76);
  context.beginPath();
  if (facing === 'left' || facing === 'right') {
    context.moveTo(-size * 0.48, size * 0.05);
    context.lineTo(-size * 0.78, size * 0.26);
    context.moveTo(size * 0.48, size * 0.05);
    context.lineTo(size * 0.78, size * 0.26);
  } else {
    context.moveTo(-size * 0.18, size * 0.58);
    context.lineTo(-size * 0.28, size * 0.96);
    context.moveTo(size * 0.18, size * 0.58);
    context.lineTo(size * 0.28, size * 0.96);
  }
  context.stroke();
  context.fillStyle = '#171411';
  const eyeX = facing === 'left' ? -size * 0.09 : facing === 'right' ? size * 0.09 : 0;
  context.beginPath();
  context.arc(eyeX, -size * 0.59, size * 0.04, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#f28b30';
  context.fillRect(-size * 0.16, -size * 0.05, size * 0.32, size * 0.25);
  label(context, 'YOU / HUMAN', 0, size + 22);
  context.restore();
}

function drawDestination(context: CanvasRenderingContext2D, [x, y]: [number, number], tick: number, reducedMotion: boolean): void {
  const pulse = reducedMotion ? 0 : (tick % 30) * 0.7;
  context.save();
  context.translate(x, y);
  context.strokeStyle = '#f28b30';
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
  context.strokeStyle = '#171411';
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
  context.fillStyle = '#171411';
  context.fillRect(x - width / 2, y - 10, width, 20);
  context.fillStyle = '#f4ede0';
  context.fillText(text, x, y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
