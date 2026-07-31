/**
 * Freezing a run so a refresh does not throw it away.
 *
 * Reloading mid-stage used to cost the whole run. The page came back at the
 * right stage and at the start of it, which is worse than it sounds: on a phone
 * a refresh is not something you choose. The browser reclaims a backgrounded
 * tab, a notification takes you out, the wallet reloads its WebView, and ninety
 * seconds of play is gone with no warning and nothing to blame.
 *
 * ## Why this is small
 *
 * The level is a pure function of the seed. Terrain, streets, rings, where every
 * attacker and every cage started: all of it comes back byte for byte from
 * `new RunState(mission, weapon, stage)`. None of that is worth storing and
 * storing it would create a second source of truth for a level that already has
 * one. What a snapshot holds is only what play has changed since.
 *
 * ## Why it walks the object instead of listing fields
 *
 * A hand-written list of fields is a list that goes stale. Someone adds a
 * counter to RunState, forgets this file, and a resumed run is subtly wrong in a
 * way nothing reports: the score is off, or a gate is shut that was opened, and
 * it looks like a game bug rather than a save bug. So this walks whatever is
 * there and skips a named set of structural things, which fails in the safe
 * direction. A new field is captured by default.
 *
 * ## What this does not do
 *
 * It does not make a score more trustworthy or less. The service bounds a
 * submitted score by rebuilding the level from the seed and refusing a claim the
 * level cannot support, and that check does not care whether the run happened in
 * one sitting. Editing this blob by hand buys nothing a plain edit of the score
 * would not have bought, and neither gets past the rebuild.
 */

import { RunState } from './state';

/**
 * Rebuilt by the constructor, or meaningless across a reload.
 *
 * `mission`, `terrain`, `city`, `rings`, `weapon` and `stage` are the level
 * itself. `stage` in particular holds a `clear` predicate, which is a function
 * and would not survive JSON at all.
 *
 * `events` is drained every frame by the presentation layer, so anything left in
 * it at the moment of a reload is a sound that never got played.
 */
const STRUCTURAL = new Set([
  'mission',
  'terrain',
  'city',
  'rings',
  'weapon',
  'stage',
  'runRng',
  'levelRng',
  'events',
]);

export interface RunSnapshot {
  /** Bumped when the shape changes, so an old blob is dropped not misread. */
  version: number;
  /** The mission this was played on. A snapshot does not survive midnight. */
  seed: string;
  stage: number;
  weapon: string;
  practice: boolean;
  taster: boolean;
  preview: boolean;
  /** The reactive stream's position, so the second half is not a new level. */
  rng: number;
  fields: Record<string, unknown>;
}

const VERSION = 1;

export function capture(state: RunState): RunSnapshot {
  const fields: Record<string, unknown> = {};

  for (const key of Object.keys(state)) {
    if (STRUCTURAL.has(key)) continue;
    const value = (state as unknown as Record<string, unknown>)[key];
    if (typeof value === 'function') continue;
    fields[key] = value;
  }

  return {
    version: VERSION,
    seed: state.mission.seed,
    stage: state.stage.n,
    weapon: state.weapon.id,
    practice: state.practice,
    taster: state.taster,
    preview: state.preview,
    rng: state.runRng.save(),
    fields,
  };
}

/**
 * Is this snapshot about the run we are able to rebuild?
 *
 * The seed check is what stops yesterday's run reappearing on today's coin. The
 * mission changes at midnight UTC and the level changes with it, so a snapshot
 * against a different seed describes a level that no longer exists.
 */
export function matches(snapshot: RunSnapshot, seed: string): boolean {
  return snapshot.version === VERSION && snapshot.seed === seed;
}

/**
 * Pour a snapshot back into a freshly built run.
 *
 * The arrays on RunState are `readonly`, meaning the reference cannot be
 * replaced, so their contents are spliced rather than assigned. That is the
 * right shape anyway: everything else in the game holds those same references.
 */
export function restore(state: RunState, snapshot: RunSnapshot): void {
  state.runRng.load(snapshot.rng);

  const target = state as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(snapshot.fields)) {
    if (STRUCTURAL.has(key)) continue;

    const current = target[key];

    if (Array.isArray(current) && Array.isArray(value)) {
      current.length = 0;
      current.push(...value);
      continue;
    }

    /*
     * An object field is filled rather than replaced, for the same reason the
     * arrays are. `player`, `purse` and `car` are all handed to other modules at
     * construction, and swapping the reference here would leave those modules
     * pointing at the run we just threw away.
     */
    if (current && typeof current === 'object' && value && typeof value === 'object') {
      Object.assign(current, value);
      continue;
    }

    // A null becoming an object, or the other way round, means the two runs are
    // not the same shape and the level would not have matched either.
    if (current === null || current === undefined || typeof current !== 'object') {
      target[key] = value;
    }
  }
}
