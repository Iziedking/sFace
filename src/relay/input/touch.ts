import { clampRelaySteer } from './sampler';

export function mapTouchToSteer(x: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return clampRelaySteer((x / width) * 254 - 127);
}

export function installRelayTouchInput(element: HTMLElement, onSteer: (value: number) => void): () => void {
  const move = (event: PointerEvent): void => {
    const rect = element.getBoundingClientRect();
    onSteer(mapTouchToSteer(event.clientX - rect.left, rect.width));
  };
  const start = (event: PointerEvent): void => {
    element.setPointerCapture?.(event.pointerId);
    move(event);
  };
  element.addEventListener('pointerdown', start, { passive: true });
  element.addEventListener('pointermove', move, { passive: true });
  return () => {
    element.removeEventListener('pointerdown', start);
    element.removeEventListener('pointermove', move);
  };
}
