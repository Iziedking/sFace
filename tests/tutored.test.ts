/**
 * The one concession the tour asks of the simulation, and its limits.
 *
 * A player being told which button fires should not also be fighting, so the
 * card comes with invulnerability. That is a change to the game, and every
 * change to this game has to answer the same question: can two people on one
 * seed still be playing the same game, and can the service still bound what
 * either of them claims?
 *
 * The answer here is yes, and these tests are why. Nothing about the tour
 * touches the clock, the seed, the level, or the step rate. It stops one
 * function from taking health off, which cannot raise a score and cannot
 * lengthen a run. A tutored run therefore verifies against exactly the same
 * ceiling as every other run on that seed, with no special case anywhere in the
 * submit path.
 */

import { describe, expect, it } from 'vitest';

import { levelFacts } from '../server/verify';
import { practiceMission } from '../src/game/mission';
import { RunState, PLAYER_MAX_HEALTH } from '../src/game/state';
import { damagePlayer } from '../src/game/player';

const MISSION = practiceMission('2026-08-11');

describe('the tour is not a way to survive', () => {
  it('ignores damage only while the card is actually up', () => {
    const run = new RunState(MISSION, 'sidearm', 1);
    run.tutored = true;

    damagePlayer(run, 40);
    expect(run.player.health).toBe(PLAYER_MAX_HEALTH);

    // Off the instant the tour ends, which main.ts does on the same frame the
    // machine reports it has finished.
    run.tutored = false;
    damagePlayer(run, 40);
    expect(run.player.health).toBe(PLAYER_MAX_HEALTH - 40);
  });

  it('defaults to off, so a run has to ask for it', () => {
    const run = new RunState(MISSION, 'sidearm', 1);
    expect(run.tutored).toBe(false);

    damagePlayer(run, 10);
    expect(run.player.health).toBeLessThan(PLAYER_MAX_HEALTH);
  });

  it('cannot be used to outlive the clock', () => {
    const run = new RunState(MISSION, 'sidearm', 1);
    run.tutored = true;

    // Whatever the tour does, the deadline is the stage's own and the run is
    // over when it passes. Not being shot is not extra time.
    run.time = run.seconds + 1;
    expect(run.timeLeft).toBe(0);
  });
});

describe('a tutored run is an ordinary run to the service', () => {
  it('leaves the level and its ceiling exactly where they were', () => {
    const wire = JSON.parse(JSON.stringify(MISSION));

    const plain = new RunState(MISSION, 'sidearm', 1);
    const tutored = new RunState(MISSION, 'sidearm', 1);
    tutored.tutored = true;

    // Same seed, same level. The tour is not part of what the level is built
    // from, which is the property the whole daily challenge rests on.
    expect(tutored.enemies.length).toBe(plain.enemies.length);
    expect(tutored.caches.length).toBe(plain.caches.length);
    expect(tutored.seconds).toBe(plain.seconds);

    const facts = levelFacts(wire, 1);
    expect(facts).not.toBeNull();
    expect(facts!.enemies).toBe(tutored.enemies.length);
    expect(facts!.seconds).toBe(tutored.seconds);
  });
});
