import type { RelayState } from '../../../shared/relay/state';
import { drawRelayEffects } from './effects';
import { drawRelayPod } from './pod';
import { drawRelayWorld } from './world';

export class RelayRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Relay canvas is unavailable.');
    this.context = context;
  }

  resize(): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  draw(state: RelayState): void {
    const rect = this.canvas.getBoundingClientRect();
    drawRelayWorld(this.context, state, rect.width, rect.height);
    drawRelayPod(this.context, state, rect.width, rect.height);
    drawRelayEffects(this.context);
  }
}
