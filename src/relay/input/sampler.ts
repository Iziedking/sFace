import { RELAY_STEER_MAX, RELAY_STEER_MIN } from '../../../shared/relay/constants';

export function clampRelaySteer(value: number): number {
  return Math.max(RELAY_STEER_MIN, Math.min(RELAY_STEER_MAX, Math.round(value)));
}

export class RelayInputSampler {
  private touchTarget = 0;
  private keyboardTarget: number | null = null;

  setTouchSteer(value: number): void { this.touchTarget = clampRelaySteer(value); }
  setKeyboardSteer(value: number): void { this.keyboardTarget = clampRelaySteer(value); }
  clearKeyboardSteer(): void { this.keyboardTarget = null; }
  sample(): number { return this.keyboardTarget ?? this.touchTarget; }
}
