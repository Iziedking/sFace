/**
 * The campaign.
 *
 * Two things here are load bearing and everything else is arithmetic.
 *
 * The first is that a stage is genuinely a different level: two stages on the
 * same day must not lay out the same enemies in the same places with a
 * different label on top, or the arc is a lie. The second is that the arc only
 * goes one way. If a client can hand itself Stage 7 on its first run, the six
 * stages it is a resolution to never happened and the fiction collapses along
 * with the difficulty curve.
 */

import { describe, expect, it } from 'vitest';

import {
  STAGES,
  campaignComplete,
  nextStage,
  progressOf,
  stageAt,
  stageUnlocked,
} from '../src/data/campaign';
import { practiceMission } from '../src/game/mission';
import { RunState, PLAYER_MAX_HEALTH } from '../src/game/state';
import { step } from '../src/game/update';

function mission() {
  return practiceMission('2026-07-28');
}

describe('the arc', () => {
  it('runs one to seven with no gaps', () => {
    expect(STAGES.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  /**
   * Every dial that makes a stage harder has to point the same way, or the
   * campaign has a soft spot in the middle that reads as a bug.
   */
  it('gets harder every single stage', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const prev = STAGES[i - 1]!;
      const next = STAGES[i]!;

      expect(next.density).toBeGreaterThan(prev.density);
      expect(next.seconds).toBeLessThanOrEqual(prev.seconds);
      expect(next.span).toBeGreaterThan(prev.span);
      expect(next.bounty).toBeGreaterThan(prev.bounty);
      expect(next.minDifficulty).toBeGreaterThanOrEqual(prev.minDifficulty);
      expect(next.volley[1]).toBeGreaterThanOrEqual(prev.volley[1]);
    }
  });

  it('never asks for more than three rounds a volley', () => {
    for (const stage of STAGES) {
      expect(stage.volley[0]).toBeGreaterThanOrEqual(1);
      expect(stage.volley[1]).toBeLessThanOrEqual(3);
      expect(stage.volley[1]).toBeGreaterThanOrEqual(stage.volley[0]);
    }
  });

  it('says what it restores and what clears it', () => {
    for (const stage of STAGES) {
      expect(stage.restores.length).toBeGreaterThan(8);
      expect(stage.objective.length).toBeGreaterThan(8);
      expect(stage.brief.length).toBeGreaterThan(60);
    }
  });
});

describe('unlocking', () => {
  it('opens exactly one stage ahead of what has been cleared', () => {
    expect(stageUnlocked(1, 0)).toBe(true);
    expect(stageUnlocked(2, 0)).toBe(false);
    expect(stageUnlocked(2, 1)).toBe(true);
    expect(stageUnlocked(3, 1)).toBe(false);
    expect(stageUnlocked(7, 6)).toBe(true);
  });

  it('keeps everything open once the campaign is done', () => {
    for (const stage of STAGES) expect(stageUnlocked(stage.n, 7)).toBe(true);
    expect(campaignComplete(7)).toBe(true);
    expect(campaignComplete(6)).toBe(false);
  });

  it('points a new pilot at Stage 1 and a finished one at Stage 7', () => {
    expect(nextStage(0).n).toBe(1);
    expect(nextStage(3).n).toBe(4);
    expect(nextStage(7).n).toBe(7);
  });

  it('falls back to the first stage for a number that is not one', () => {
    expect(stageAt(0).n).toBe(1);
    expect(stageAt(99).n).toBe(1);
    expect(stageAt(-3).n).toBe(1);
  });
});

describe('a stage is a different level', () => {
  /**
   * The one that would make the campaign cosmetic. If Stage 1 and Stage 4 on
   * the same day produced the same layout, the whole thing is one level with
   * seven labels.
   */
  it('lays out differently from every other stage on the same day', () => {
    const print = (n: number) => {
      const run = new RunState(mission(), 'sidearm', n);
      return run.enemies
        .map((e) => `${e.kind}:${e.x.toFixed(2)}:${e.y.toFixed(2)}`)
        .join('|');
    };

    const seen = new Set(STAGES.map((s) => print(s.n)));
    expect(seen.size).toBe(STAGES.length);
  });

  /** And is still identical for two players flying the same one. */
  it('is identical for two pilots on the same stage and seed', () => {
    const print = (n: number) => {
      const run = new RunState(mission(), 'sidearm', n);
      return [
        run.enemies.map((e) => `${e.kind}:${e.x.toFixed(4)}:${e.y.toFixed(4)}`).join('|'),
        run.caches.map((c) => `${c.tier}:${c.x.toFixed(4)}:${c.y.toFixed(4)}`).join('|'),
        run.faces.map((f) => `${f.handle}:${f.x.toFixed(4)}`).join('|'),
      ].join('\n');
    };

    for (const stage of STAGES) expect(print(stage.n)).toEqual(print(stage.n));
  });

  it('gives a later stage a longer level and more to shoot at', () => {
    const first = new RunState(mission(), 'sidearm', 1);
    const last = new RunState(mission(), 'sidearm', 7);

    expect(last.extractionX).toBeGreaterThan(first.extractionX);
    expect(last.enemies.length).toBeGreaterThan(first.enemies.length);
    expect(last.caches.length).toBeGreaterThan(first.caches.length);
    expect(last.seconds).toBeLessThan(first.seconds);
  });

  it('lays out a level worth flying even on the shortest stage', () => {
    const run = new RunState(mission(), 'sidearm', 1);
    expect(run.extractionX).toBeGreaterThan(3_000);
    expect(run.faces.length).toBeGreaterThan(0);
    expect(run.caches.filter((c) => c.tier === 'relic')).toHaveLength(1);
    expect(run.refills.length).toBeGreaterThan(0);
  });

  it('pays more for a later stage', () => {
    const first = new RunState(mission(), 'sidearm', 1);
    const last = new RunState(mission(), 'sidearm', 7);
    first.cacheScore = 1_000;
    last.cacheScore = 1_000;
    expect(last.score).toBeGreaterThan(first.score);
  });
});

describe('objectives', () => {
  const perfect = {
    extracted: 5,
    caches: 11,
    relic: true,
    attackers: 40,
    survived: true,
    hull: 1,
  };

  it('is met by a perfect run on every stage', () => {
    for (const stage of STAGES) expect(stage.clear(perfect)).toBe(true);
  });

  it('is not met by a run that ended in the ground', () => {
    for (const stage of STAGES) {
      expect(stage.clear({ ...perfect, survived: false })).toBe(false);
    }
  });

  it('reads the numbers off a finished run', () => {
    const run = new RunState(mission(), 'sidearm', 1);
    run.facesExtracted = 3;
    run.cachesTaken = 4;
    run.relicTaken = true;
    run.attackersCleared = 9;
    run.phase = 'extracted';
    run.player.health = 50;

    const progress = progressOf(run, PLAYER_MAX_HEALTH);
    expect(progress).toEqual({
      extracted: 3,
      caches: 4,
      relic: true,
      attackers: 9,
      survived: true,
      hull: 0.5,
    });
    expect(stageAt(1).clear(progress)).toBe(true);
  });

  /** Stage 1 is the tutorial. It has to be clearable without heroics. */
  it('lets a modest run clear the first stage', () => {
    expect(
      stageAt(1).clear({
        extracted: 0,
        caches: 1,
        relic: true,
        attackers: 0,
        survived: true,
        hull: 0.1,
      }),
    ).toBe(true);
  });

  /** Stage 7 is not. It has to refuse anything short of everything. */
  it('refuses anything less than everything on the last stage', () => {
    const stage = stageAt(7);
    expect(stage.clear({ ...perfect, extracted: 4 })).toBe(false);
    expect(stage.clear({ ...perfect, relic: false })).toBe(false);
    expect(stage.clear({ ...perfect, caches: 7 })).toBe(false);
  });
});

describe('the look', () => {
  /**
   * Seven stages on the same chart would otherwise be seven identical pictures
   * with a different number on them. Every stage has to be visually its own
   * place, and the hatching has to tighten the whole way in.
   */
  it('gives every stage its own sky and ground', () => {
    expect(new Set(STAGES.map((s) => s.look.sky)).size).toBe(STAGES.length);
    expect(new Set(STAGES.map((s) => s.look.ground)).size).toBe(STAGES.length);
  });

  it('tightens the ground hatching stage by stage', () => {
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i]!.look.hatch).toBeLessThan(STAGES[i - 1]!.look.hatch);
    }
  });

  it('keeps every colour a flat hex, never a gradient or an alpha', () => {
    for (const stage of STAGES) {
      expect(stage.look.sky).toMatch(/^#[0-9a-f]{6}$/);
      expect(stage.look.ground).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('runners', () => {
  /**
   * The floor was the safest place on the level, which is backwards: the caches
   * are down there and they are supposed to cost something. Runners are the
   * price of flying low, so they must not exist while a player is still
   * learning the stick.
   */
  it('stays out of the first two stages entirely', () => {
    expect(stageAt(1).runners).toBe(0);
    expect(stageAt(2).runners).toBe(0);
    expect(stageAt(3).runners).toBeGreaterThan(0);
  });

  it('takes over more of the ground the further in you get', () => {
    for (let i = 3; i < STAGES.length; i++) {
      expect(STAGES[i]!.runners).toBeGreaterThan(STAGES[i - 1]!.runners);
    }
    // Never the majority. A level of nothing but chasers is one habit again.
    for (const stage of STAGES) expect(stage.runners).toBeLessThan(0.5);
  });

  it('actually places them on a late stage and never on an early one', () => {
    const early = new RunState(mission(), 'sidearm', 1);
    const late = new RunState(mission(), 'sidearm', 7);

    expect(early.enemies.filter((e) => e.kind === 'runner')).toHaveLength(0);
    expect(late.enemies.filter((e) => e.kind === 'runner').length).toBeGreaterThan(0);
  });

  /**
   * A runner rides the chart. Placement puts it near the ground and the first
   * update seats it exactly, which is what keeps it on the terrain as the day
   * climbs and drops rather than sliding through a hill.
   */
  it('rides the chart exactly once it is running', () => {
    const run = new RunState(mission(), 'sidearm', 7);
    const runners = run.enemies.filter((e) => e.kind === 'runner');
    expect(runners.length).toBeGreaterThan(0);

    for (const runner of runners) {
      runner.active = true;
      // Placed near the ground before anything has updated it.
      expect(Math.abs(runner.y - run.terrain.groundAt(runner.x))).toBeLessThan(120);
    }

    // Park the player among them so they all wake, then step once.
    run.player.x = runners[0]!.x;
    step(run, 1 / 60, { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false });

    for (const runner of runners) {
      if (!runner.alive || !runner.active) continue;
      if (Math.abs(runner.x - run.player.x) > 900) continue;
      expect(runner.y).toBeCloseTo(run.terrain.groundAt(runner.x) - 22, 5);
    }
  });
});

describe('anticipation', () => {
  /**
   * A locked stage has to be worth wanting. The tease is the only thing a
   * player sees of Stage 5 while they are on Stage 2, so every stage needs one
   * and no two may read the same.
   */
  it('gives every stage its own tease', () => {
    for (const stage of STAGES) {
      expect(stage.tease.scene.length).toBeGreaterThan(25);
      expect(stage.tease.threat.length).toBeGreaterThan(20);
    }
    expect(new Set(STAGES.map((s) => s.tease.scene)).size).toBe(STAGES.length);
    expect(new Set(STAGES.map((s) => s.tease.threat)).size).toBe(STAGES.length);
  });

  /** The first stage is the tutorial, so it is the only one with clear skies. */
  it('starts clear and never goes back to it', () => {
    expect(STAGES[0]!.look.weather).toBe('clear');
    expect(STAGES[0]!.look.density).toBe(0);
    for (const stage of STAGES.slice(1)) {
      expect(stage.look.weather).not.toBe('clear');
      expect(stage.look.density).toBeGreaterThan(0);
    }
  });

  /**
   * Weather is atmosphere and must never be difficulty. A stage that is harder
   * to READ is not a harder stage, it is an unfair one, and every stage has to
   * stay a fair bet.
   */
  it('keeps weather thin enough to see through', () => {
    for (const stage of STAGES) {
      expect(stage.look.density).toBeLessThanOrEqual(1);
    }
  });

  it('saves the embers for the last stage', () => {
    expect(STAGES[STAGES.length - 1]!.look.weather).toBe('ember');
    expect(STAGES.filter((s) => s.look.weather === 'ember')).toHaveLength(1);
  });
});
