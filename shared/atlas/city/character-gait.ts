// Both the Three rig adapter and the motion verifier consume these flat-ground
// gait rules. No renderer, wall clock, or player-input authority lives here.
export interface AtlasGaitState {
  readonly phase: number;
  readonly amount: number;
  readonly runBlend: number;
}

export function advanceAtlasGait(state: AtlasGaitState, seconds: number, speed: number, scale: number, legLength: number, running: boolean): AtlasGaitState {
  const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(0.1, seconds)) : 0;
  const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  if (!(scale > 0) || !(legLength > 0) || !Number.isFinite(scale + legLength)) throw new Error('Gait requires positive finite scale and leg length.');
  const blend = 1 - Math.exp(-12 * dt);
  const runBlend = state.runBlend + ((running ? 1 : 0) - state.runBlend) * blend;
  const stride = atlasGaitStride(legLength, runBlend);
  return {
    phase: (state.phase + safeSpeed * dt / (scale * stride)) % 1,
    amount: state.amount + (Math.min(1, safeSpeed / (scale * 0.45)) - state.amount) * blend,
    runBlend,
  };
}

export function atlasGaitStride(legLength: number, runBlend: number): number {
  return legLength * (1.18 + runBlend * 0.47);
}

export function atlasGaitFoot(phase: number, legLength: number, runBlend: number): { forward: number; lift: number; planted: boolean } {
  const t = ((phase % 1) + 1) % 1;
  const stance = 0.62 - runBlend * 0.2;
  const reach = atlasGaitStride(legLength, runBlend) * stance;
  if (t <= stance) return { forward: reach * (0.5 - t / stance), lift: 0, planted: true };
  const swing = (t - stance) / (1 - stance);
  return {
    forward: reach * (-0.5 + swing * swing * (3 - 2 * swing)),
    lift: Math.sin(swing * Math.PI) ** 2 * legLength * (0.12 + runBlend * 0.13),
    planted: false,
  };
}

export function solveAtlasLeg(upperLength: number, lowerLength: number, down: number, forward: number): { hip: number; knee: number } {
  if (![upperLength, lowerLength, down, forward].every(Number.isFinite) || upperLength <= 0 || lowerLength <= 0) throw new Error('Leg solver requires finite coordinates and positive lengths.');
  const distance = Math.max(Math.abs(upperLength - lowerLength) + 0.00001, Math.min(upperLength + lowerLength - 0.00001, Math.hypot(down, forward)));
  const cosine = (a: number): number => Math.acos(Math.max(-1, Math.min(1, a)));
  return {
    hip: -Math.atan2(forward, down) - cosine((upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance)),
    knee: Math.PI - cosine((upperLength ** 2 + lowerLength ** 2 - distance ** 2) / (2 * upperLength * lowerLength)),
  };
}
