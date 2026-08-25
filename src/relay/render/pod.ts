import type { RelayState } from '../../../shared/relay/state';

export function drawRelayPod(context: CanvasRenderingContext2D, state: RelayState, width: number, height: number): void {
  const x = state.pod.x / 120_000 * width;
  const y = height - state.pod.y / 5_400 * height;
  context.save();
  context.translate(x, y);
  context.fillStyle = '#f28b30';
  context.strokeStyle = '#f4ede0';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, -18); context.lineTo(14, 16); context.lineTo(0, 10); context.lineTo(-14, 16); context.closePath();
  context.fill(); context.stroke();
  context.fillStyle = '#f4ede0'; context.font = '800 10px ui-monospace, SFMono-Regular, monospace'; context.textAlign = 'center'; context.textBaseline = 'bottom'; context.fillText('YOU', 0, -22);
  context.restore();
}
