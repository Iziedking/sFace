/**
 * Surviving a refresh.
 *
 * The failure this guards is not a crash, it is a resumed run that is quietly
 * not the run you were playing: two attackers back on their feet, a gate shut
 * that you opened, a score short by a cache. Nothing reports it and it reads as
 * a game bug rather than a save bug, so the tests here compare the whole state
 * rather than spot-checking the fields somebody happened to think of.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { capture, matches, restore } from '../src/game/snapshot';
import type { PlayerCommand } from '../src/game/player';

const FLY: PlayerCommand = { moveX: 1, moveY: -0.3, aimX: 1, aimY: 0, firing: true };
const MISSION = practiceMission('2026-07-31');

function played(stage = 1, frames = 240): RunState {
  const state = new RunState(MISSION, 'sidearm', stage);
  for (let i = 0; i < frames; i++) step(state, 1 / 60, FLY);
  return state;
}

/**
 * Everything a resumed run has to agree about, as one comparable blob.
 *
 * The rng position is in here deliberately. Without it these tests passed with
 * the stream restore commented out: nothing the run touches in a few seconds of
 * flying diverges visibly, so the seam looked clean while the second half of the
 * level was quietly running on a different stream. Checking the position itself
 * is the only honest way to pin it.
 */
function shape(state: RunState): string {
  return JSON.stringify({
    rng: state.runRng.save(),
    time: state.time,
    phase: state.phase,
    score: state.score,
    player: state.player,
    purse: state.purse,
    attackersCleared: state.attackersCleared,
    facesFreed: state.facesFreed,
    facesExtracted: state.facesExtracted,
    cachesTaken: state.cachesTaken,
    enemies: state.enemies.map((e) => [e.id, e.alive, e.health, e.x, e.y, e.active]),
    faces: state.faces.map((f) => [f.id, f.state, f.x, f.y, f.caged]),
  });
}

describe('a run survives being rebuilt from a snapshot', () => {
  it('comes back identical', () => {
    const original = played();
    const snapshot = JSON.parse(JSON.stringify(capture(original)));

    const revived = new RunState(MISSION, 'sidearm', 1);
    restore(revived, snapshot);

    expect(shape(revived)).toBe(shape(original));
  });

  it('carries on the same way it would have', () => {
    /*
     * The one that matters most.
     *
     * Matching at the moment of restore is not enough: if the reactive random
     * stream is not where it was, the second half of the level behaves like a
     * different level, and the run diverges from the one that was banked while
     * looking perfectly healthy at the seam.
     */
    const original = played();
    const snapshot = JSON.parse(JSON.stringify(capture(original)));

    const revived = new RunState(MISSION, 'sidearm', 1);
    restore(revived, snapshot);

    for (let i = 0; i < 180; i++) {
      step(original, 1 / 60, FLY);
      step(revived, 1 / 60, FLY);
    }

    expect(shape(revived)).toBe(shape(original));
  });

  it('works on a city stage, where the world is a different shape', () => {
    const original = played(5);
    const snapshot = JSON.parse(JSON.stringify(capture(original)));

    const revived = new RunState(MISSION, 'sidearm', 5);
    restore(revived, snapshot);

    expect(shape(revived)).toBe(shape(original));
    expect(revived.city).not.toBeNull();
  });

  it('works on the ring city', () => {
    const original = played(7);
    const snapshot = JSON.parse(JSON.stringify(capture(original)));

    const revived = new RunState(MISSION, 'sidearm', 7);
    restore(revived, snapshot);

    expect(shape(revived)).toBe(shape(original));
    expect(revived.rings).not.toBeNull();
  });
});

describe('a snapshot does not outlive its mission', () => {
  it('is refused against a different seed', () => {
    /*
     * Midnight UTC redraws the world. A snapshot against yesterday's coin
     * describes a level that no longer exists, and restoring it would put a
     * player at coordinates from a chart that is not on screen.
     */
    const snapshot = capture(played());

    expect(matches(snapshot, MISSION.seed)).toBe(true);
    expect(matches(snapshot, '2026-08-01:zzz:0.00:fng50:aaaa')).toBe(false);
  });

  it('is refused when the shape has changed under it', () => {
    // An old blob from a previous build is dropped rather than half-read.
    const snapshot = { ...capture(played()), version: 0 };
    expect(matches(snapshot, MISSION.seed)).toBe(false);
  });
});

describe('what a snapshot deliberately does not hold', () => {
  it('leaves the level to the seed', () => {
    /*
     * The terrain, the streets and the rings are a pure function of the seed, so
     * storing them would create a second source of truth for something that
     * already has one. This also keeps the blob small enough for sessionStorage
     * on a phone.
     */
    const snapshot = capture(played(5));

    expect(snapshot.fields).not.toHaveProperty('terrain');
    expect(snapshot.fields).not.toHaveProperty('city');
    expect(snapshot.fields).not.toHaveProperty('mission');
    // stage holds a `clear` predicate, which would not survive JSON at all.
    expect(snapshot.fields).not.toHaveProperty('stage');
  });

  it('stays small enough to store', () => {
    // sessionStorage is commonly 5MB. A stage 7 run is the biggest world.
    const bytes = JSON.stringify(capture(played(7))).length;
    expect(bytes).toBeLessThan(400_000);
  });
});
