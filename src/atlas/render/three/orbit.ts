export interface AtlasIdleOrbit {
  headingAt(elapsedSeconds: number): number;
  readonly active: boolean;
}

export interface AtlasIdleOrbitOptions {
  readonly radiansPerSecond?: number;
  readonly reducedMotion?: boolean;
}

const TAU = Math.PI * 2;
// A full turn in about 84 seconds. Slow enough that the menu reads as a place
// you are standing in rather than a turntable.
const DEFAULT_RADIANS_PER_SECOND = TAU / 84;

/*
 * The welcome screen's camera drift.
 *
 * Deliberately not a camera mode. AtlasCameraFrame already takes
 * cameraHeadingRadians, so an orbit is a number that grows with time and the
 * rig does the rest. Nothing in the renderer changes.
 */
export function createIdleOrbit(options: AtlasIdleOrbitOptions = {}): AtlasIdleOrbit {
  const active = options.reducedMotion !== true;
  const speed = options.radiansPerSecond ?? DEFAULT_RADIANS_PER_SECOND;
  return {
    active,
    headingAt(elapsedSeconds: number): number {
      if (!active || !Number.isFinite(elapsedSeconds)) return 0;
      return (((elapsedSeconds * speed) % TAU) + TAU) % TAU;
    },
  };
}
