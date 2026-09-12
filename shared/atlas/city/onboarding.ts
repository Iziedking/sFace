/*
 * When Atlas is allowed to start asking the player for things.
 *
 * A play test on a phone reported the city as "too small and concised", that
 * "who you talk to is just standing right in front of you", and asked to
 * "allow some free play movement before finding who to talk to". Measured, all
 * three were the same fault: the mission card rendered before the player had
 * taken a step, and the first thing it pointed at was 3.8 m away.
 *
 * So the first minute belongs to the player. The rule lives here rather than
 * in the app because a renderer should not be the thing that decides when a
 * game begins, and because a rule inside a DOM class cannot be tested.
 */

/** Metres of wandering that count as having seen the place. */
export const ATLAS_FREE_PLAY_METRES = 10;

/**
 * Seconds after which the game starts anyway.
 *
 * Not a nicety. A player who puts the phone down, or who cannot work out the
 * joystick, must not be left in a city that never asks them for anything: a
 * gate with no timeout is indistinguishable from a broken build.
 */
export const ATLAS_FREE_PLAY_SECONDS = 40;

export interface AtlasFreePlayInput {
  /** Distance from where the player arrived, in metres. */
  readonly metresExplored: number;
  /** Seconds since arrival. */
  readonly secondsElapsed: number;
  /** Which chapter the run is on, or null when there is no run. */
  readonly chapter: number | null;
  readonly stage: string | null;
  /** How many actions the run has already recorded. */
  readonly actionsTaken: number;
}

/**
 * Whether the opening is over and the mission card may appear.
 *
 * Only a first arrival is ever held back. Someone resuming a run has already
 * explored, and making them wander again to get their card back would be a
 * punishment for coming back.
 */
export function atlasFreePlayComplete(input: AtlasFreePlayInput): boolean {
  const firstArrival = input.chapter === 0 && input.stage === 'arrive' && input.actionsTaken === 0;
  if (!firstArrival) return true;
  if (!Number.isFinite(input.metresExplored) || !Number.isFinite(input.secondsElapsed)) return true;
  return input.metresExplored >= ATLAS_FREE_PLAY_METRES || input.secondsElapsed >= ATLAS_FREE_PLAY_SECONDS;
}
