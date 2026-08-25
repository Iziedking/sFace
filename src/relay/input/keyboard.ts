import { clampRelaySteer } from './sampler';

export function installRelayKeyboardInput(target: Window, onSteer: (value: number) => void, onClear: () => void): () => void {
  const down = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(event.key)) return;
    event.preventDefault();
    onSteer(clampRelaySteer(event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a' ? -127 : 127));
  };
  const up = (event: KeyboardEvent): void => {
    if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(event.key)) onClear();
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return () => { target.removeEventListener('keydown', down); target.removeEventListener('keyup', up); };
}
