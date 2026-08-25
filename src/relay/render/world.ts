import type { RelayState } from '../../../shared/relay/state';

export function drawRelayWorld(context: CanvasRenderingContext2D, state: RelayState, width: number, height: number): void {
  context.fillStyle = '#171411';
  context.fillRect(0, 0, width, height);
  const xScale = width / 120_000;
  const yScale = height / 5_400;
  context.strokeStyle = 'rgba(244,237,224,0.12)';
  context.lineWidth = 1;
  for (let x = 0; x < width; x += Math.max(32, width / 8)) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
  context.save();
  context.font = '800 10px ui-monospace, SFMono-Regular, monospace';
  context.textBaseline = 'middle';
  for (const gate of state.gates) {
    const x = gate.x * xScale;
    const y = height - gate.y * yScale;
    context.fillStyle = '#f28b30';
    context.globalAlpha = 0.9;
    context.beginPath(); context.arc(x, y, Math.max(18, 360 * xScale), 0, Math.PI * 2); context.strokeStyle = '#f28b30'; context.lineWidth = 3; context.stroke();
    context.fillRect(Math.max(8, x - 40), Math.max(8, y - 30), 80, 16);
    context.fillStyle = '#171411'; context.textAlign = 'center'; context.fillText('BANK GATE', x, Math.max(16, y - 22));
  }
  context.restore();
  context.save();
  context.font = '800 10px ui-monospace, SFMono-Regular, monospace';
  context.textBaseline = 'middle';
  for (const node of state.nodes) {
    if (node.status === 'banked' || node.status === 'dropped') continue;
    const x = node.x * xScale;
    const y = height - node.y * yScale;
    context.fillStyle = node.status === 'carried' ? '#f4ede0' : '#f28b30';
    context.strokeStyle = '#f4ede0'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(x, y - 7); context.lineTo(x + 7, y); context.lineTo(x, y + 7); context.lineTo(x - 7, y); context.closePath(); context.fill(); context.stroke();
    if (node.status === 'carried') { context.fillStyle = '#f4ede0'; context.textAlign = 'left'; context.fillText('NODE', Math.min(width - 42, x + 11), y); }
  }
  context.restore();
  context.save();
  context.font = '800 10px ui-monospace, SFMono-Regular, monospace';
  context.textBaseline = 'middle';
  for (const hazard of state.hazards) {
    const x = hazard.x * xScale;
    const y = height - hazard.y * yScale;
    context.fillStyle = 'rgba(255,96,64,0.72)';
    context.beginPath(); context.arc(x, y, Math.max(7, hazard.radius * xScale), 0, Math.PI * 2); context.fill();
    context.strokeStyle = '#171411'; context.lineWidth = 2; context.beginPath(); context.moveTo(x - 4, y - 4); context.lineTo(x + 4, y + 4); context.moveTo(x + 4, y - 4); context.lineTo(x - 4, y + 4); context.stroke();
  }
  context.restore();
  context.save();
  context.fillStyle = 'rgba(23,20,17,.82)'; context.fillRect(12, height - 34, Math.min(width - 24, 310), 22);
  context.fillStyle = '#f4ede0'; context.font = '800 10px ui-monospace, SFMono-Regular, monospace'; context.textBaseline = 'middle'; context.textAlign = 'left'; context.fillText('NODE = COLLECT  |  BANK GATE = SCORE  |  HAZARD = AVOID', 20, height - 23);
  context.restore();
}
