// Both the Three rig adapter and the motion verifier consume these flat-ground
// gait rules. No renderer, wall clock, or player-input authority lives here.
export interface AtlasGaitState {
  readonly phase: number;
  readonly amount: number;
  readonly runBlend: number;
}

export interface AtlasGaitBodyPose {
  readonly drop: number;
  readonly rise: number;
  readonly sway: number;
  readonly pelvisRoll: number;
  readonly pelvisYaw: number;
  readonly chestYaw: number;
  readonly lean: number;
}

export interface AtlasGaitArmPose {
  readonly shoulderPitch: number;
  readonly shoulderRoll: number;
  readonly elbowFlex: number;
}

export function advanceAtlasGait(state: AtlasGaitState, seconds: number, speed: number, scale: number, legLength: number, running: boolean): AtlasGaitState {
  const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(0.1, seconds)) : 0;
  const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  if (!(scale > 0) || !(legLength > 0) || !Number.isFinite(scale + legLength)) throw new Error('Gait requires positive finite scale and leg length.');
  const amountBlend = 1 - Math.exp(-7 * dt);
  const runBlendRate = 1 - Math.exp(-6 * dt);
  const runBlend = state.runBlend + ((running ? 1 : 0) - state.runBlend) * runBlendRate;
  const stride = atlasGaitStride(legLength, runBlend);
  const fullPoseSpeed = scale * (1.45 + runBlend * 0.75);
  const targetAmount = smoothstep(scale * 0.08, fullPoseSpeed, safeSpeed);
  return {
    phase: (state.phase + safeSpeed * dt / (scale * stride)) % 1,
    amount: state.amount + (targetAmount - state.amount) * amountBlend,
    runBlend,
  };
}

export function atlasGaitStride(legLength: number, runBlend: number): number {
  return legLength * (2.62 + runBlend * 0.66);
}

export function atlasGaitFoot(phase: number, legLength: number, runBlend: number): { forward: number; lift: number; pitch: number; planted: boolean } {
  const t = ((phase % 1) + 1) % 1;
  const stance = 0.62 - runBlend * 0.2;
  // Reach is bounded by the leg, while stride controls cadence. Tying both to
  // the same number forced either a frantic shuffle or impossible leg targets.
  const reach = legLength * (0.96 + runBlend * 0.18);
  if (t <= stance) return { forward: reach * (0.5 - t / stance), lift: 0, pitch: 0, planted: true };
  const swing = (t - stance) / (1 - stance);
  return {
    forward: reach * (-0.5 + swing * swing * (3 - 2 * swing)),
    lift: Math.sin(swing * Math.PI) ** 2 * legLength * (0.12 + runBlend * 0.13),
    pitch: Math.sin(swing * Math.PI) * (0.14 + runBlend * 0.12),
    planted: false,
  };
}

export function atlasGaitBody(phase: number, legLength: number, runBlend: number, amount: number): AtlasGaitBodyPose {
  const t = ((phase % 1) + 1) % 1;
  const cycle = t * Math.PI * 2;
  const weightShift = Math.sin(cycle) * amount;
  return {
    drop: legLength * (0.072 + runBlend * 0.048) * amount,
    rise: -Math.cos(cycle * 2) * legLength * (0.012 + runBlend * 0.018) * amount,
    sway: weightShift * legLength * (0.028 - runBlend * 0.01),
    pelvisRoll: weightShift * (0.045 - runBlend * 0.012),
    pelvisYaw: weightShift * (0.085 + runBlend * 0.025),
    chestYaw: weightShift * -(0.055 + runBlend * 0.018),
    lean: (0.035 + runBlend * 0.12) * amount,
  };
}

export function atlasGaitArm(phase: number, runBlend: number, amount: number): AtlasGaitArmPose {
  const cycle = ((phase % 1) + 1) % 1 * Math.PI * 2;
  const shoulderPitch = -Math.cos(cycle) * (0.38 + runBlend * 0.3) * amount;
  return {
    shoulderPitch,
    shoulderRoll: (0.045 + runBlend * 0.035) * amount,
    elbowFlex: -(0.16 + runBlend * 0.42 + Math.max(0, -shoulderPitch) * 0.22) * amount,
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

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}
