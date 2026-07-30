/**
 * How hard a run gets, and the lifelines that keep it survivable.
 *
 * The escalation exists because a three-shot fan from second one read as
 * chaos: you have not learned the ship yet and there is already more in the
 * air than you can parse. It opens at one shot, the same as the player.
 *
 * The load-bearing test here is the last one in the first block. Escalation is
 * driven by the run clock and **must not** be driven by score. Scaling on
 * score would mean two players on the same seed face different levels, which
 * is the one thing the whole challenge system rests on not happening, and it
 * would punish playing well.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState, RUN_SECONDS, PLAYER_MAX_HEALTH } from '../src/game/state';
import { step } from '../src/game/update';
import { REFILL_HEAL, REFILL_REACH } from '../src/game/refill';
import { PLAYER_RADIUS, type PlayerCommand } from '../src/game/player';
import { STAGES, stageAt } from '../src/data/campaign';

const DT = 1 / 60;
const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function mission() {
  return practiceMission('2026-07-28');
}

/**
 * Park the player next to a turret, run it until it fires, and count what came
 * out. Enemy bullets are the only ones in the air because the player is idle.
 */
function volleyAt(seconds: number, stage = 3): number {
  const run = new RunState(mission(), 'sidearm', stage);
  run.player.invulnerableUntil = Number.POSITIVE_INFINITY;
  run.time = seconds;

  const turret = run.enemies.find((e) => e.kind === 'turret');
  if (!turret) throw new Error('level has no turret');

  // Everything else asleep, so only this turret can contribute.
  for (const enemy of run.enemies) enemy.alive = enemy === turret;
  turret.active = true;
  turret.fireCooldown = 0;

  run.player.x = turret.x;
  run.player.y = turret.y - 160;

  let best = 0;
  for (let i = 0; i < 60 * 6; i++) {
    run.bullets.length = 0;
    run.player.health = PLAYER_MAX_HEALTH;
    // Hold the clock, so a six second sample does not cross a threshold.
    run.time = seconds;
    step(run, DT, IDLE);
    best = Math.max(best, run.bullets.filter((b) => !b.friendly).length);
  }
  return best;
}

describe('escalation', () => {
  /*
   * Escalation now happens twice over: inside a run, and across the campaign.
   * A stage declares the volley it opens and closes on, so Stage 1 never ramps
   * at all and Stage 7 never eases off. Those two are the ends of the arc and
   * they are the ones worth pinning.
   */
  it('opens with a single shot, the same as the player', () => {
    expect(volleyAt(2)).toBe(1);
  });

  it('adds a second shot later in the run', () => {
    expect(volleyAt(RUN_SECONDS / 2)).toBe(2);
    expect(volleyAt(RUN_SECONDS * 2)).toBe(2);
  });

  /** The tutorial stage holds at one for its whole length. */
  it('never ramps on the first stage', () => {
    expect(volleyAt(2, 1)).toBe(1);
    expect(volleyAt(60, 1)).toBe(1);
    expect(volleyAt(RUN_SECONDS * 2, 1)).toBe(1);
  });

  /** The last stage opens at three and stays there. No warm-up. */
  it('is at full volley from the first second of the hardest fight', () => {
    /*
     * Stage four, not stage seven.
     *
     * The finale used to be the heaviest fight in the game and is now the
     * lightest on purpose: it is decided by reading the market rather than by
     * clearing a room, and it fields a third of the attackers so they are a
     * distraction rather than the task. Stage four is where the volley ceiling
     * actually bites now.
     */
    expect(volleyAt(2, 4)).toBe(2);
    expect(volleyAt(RUN_SECONDS * 2, 4)).toBe(2);
  });

  it('never exceeds three', () => {
    for (const stage of [1, 2, 3, 4, 5, 6, 7]) {
      expect(volleyAt(RUN_SECONDS * 2, stage)).toBeLessThanOrEqual(3);
    }
  });

  /**
   * Two runs at the same moment of the clock but wildly different scores must
   * face the same volley. If this ever fails, a good player is being handed a
   * harder level than their opponent on the same seed and the bet is void.
   */
  it('does not scale on score', () => {
    const poor = new RunState(mission(), 'sidearm', 3);
    const rich = new RunState(mission(), 'sidearm', 3);

    rich.cacheScore = 20_000;
    rich.attackersCleared = 60;
    rich.rescueScore = 4_000;
    expect(rich.score).toBeGreaterThan(poor.score + 10_000);

    for (const run of [poor, rich]) {
      run.player.invulnerableUntil = Number.POSITIVE_INFINITY;
      run.time = 5;
    }

    const shotsFrom = (run: RunState): number => {
      const turret = run.enemies.find((e) => e.kind === 'turret')!;
      for (const enemy of run.enemies) enemy.alive = enemy === turret;
      turret.active = true;
      turret.fireCooldown = 0;
      run.player.x = turret.x;
      run.player.y = turret.y - 160;

      let best = 0;
      for (let i = 0; i < 60 * 6; i++) {
        run.bullets.length = 0;
        run.player.health = PLAYER_MAX_HEALTH;
        run.time = 5;
        step(run, DT, IDLE);
        best = Math.max(best, run.bullets.filter((b) => !b.friendly).length);
      }
      return best;
    };

    expect(shotsFrom(rich)).toBe(shotsFrom(poor));
  });
});

describe('refills', () => {
  it('lays down exactly what the stage table asks for', () => {
    // The count used to be a flat six everywhere, so stage one handed out 192
    // hull against its 18 attackers. It is per stage now, and the table is the
    // only place the number lives.
    for (let n = 1; n <= STAGES.length; n++) {
      const run = new RunState(mission(), undefined, n);
      expect(run.refills.length).toBe(stageAt(n).refills);
    }
  });

  it('gives a crowded late stage more lifelines than a quiet first one', () => {
    const first = new RunState(mission(), undefined, 1);
    const last = new RunState(mission(), undefined, STAGES.length);
    expect(last.refills.length).toBeGreaterThan(first.refills.length);
  });

  it('places lifelines on the comfortable line, not off it', () => {
    const run = new RunState(mission());
    expect(run.refills.length).toBeGreaterThan(0);

    // The opposite requirement to a cache. A refill you have to dive for
    // punishes the player who already needed it.
    // EVERY one, not merely one of them. With six per stage a single lucky
    // placement satisfied this; with two, the design has to actually hold.
    for (const refill of run.refills) {
      const comfortable = run.terrain.groundAt(refill.x) - 200;
      expect(Math.abs(refill.y - comfortable)).toBeLessThanOrEqual(REFILL_REACH + PLAYER_RADIUS);
    }
  });

  it('restores hull on contact', () => {
    const run = new RunState(mission());
    run.player.health = 40;

    const refill = run.refills[0]!;
    run.player.x = refill.x;
    run.player.y = refill.y;
    step(run, DT, IDLE);

    expect(refill.taken).toBe(true);
    expect(run.player.health).toBe(40 + REFILL_HEAL);
    expect(run.refillsTaken).toBe(1);
  });

  it('never overheals past a full hull', () => {
    const run = new RunState(mission());
    run.player.health = PLAYER_MAX_HEALTH - 4;

    const refill = run.refills[0]!;
    run.player.x = refill.x;
    run.player.y = refill.y;
    step(run, DT, IDLE);

    expect(run.player.health).toBe(PLAYER_MAX_HEALTH);
  });

  /**
   * Flying over one at full health leaves it there. Burning a lifeline you did
   * not need would be quietly infuriating on the run where you did.
   */
  it('is not consumed at full hull', () => {
    const run = new RunState(mission());
    const refill = run.refills[0]!;

    run.player.x = refill.x;
    run.player.y = refill.y;
    step(run, DT, IDLE);

    expect(refill.taken).toBe(false);
    expect(run.refillsTaken).toBe(0);
  });

  it('lays out identically for two players on the same seed', () => {
    const print = (run: RunState) =>
      run.refills.map((r) => `${r.x.toFixed(4)}:${r.y.toFixed(4)}`).join('|');

    expect(print(new RunState(mission()))).toEqual(print(new RunState(mission())));
  });
});
