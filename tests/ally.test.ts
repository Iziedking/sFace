/**
 * Stage seven: the projects that outlasted the cycle, and the seals they open.
 *
 * The properties worth pinning are the ones that make it a march rather than a
 * sprint: a seal cannot be passed without the ally it waits for, a seal already
 * crossed never shuts behind you, and the names come from real market rows
 * rather than from anything invented.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission, type DailyMission, type Survivor } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { blockingSeal, reachableX, recruited, ALLY_REACH } from '../src/game/ally';
import { stageAt } from '../src/data/campaign';
import type { PlayerCommand } from '../src/game/player';

const STILL: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function survivors(count: number): Survivor[] {
  return Array.from({ length: count }, (_, i) => ({
    ticker: ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'ADA'][i] ?? `T${i}`,
    name: `Project ${i}`,
    rank: i + 1,
    changePct: i % 2 === 0 ? 2.4 : -1.1,
  }));
}

/** A day whose market call worked, so the allies have real names. */
function marketDay(): DailyMission {
  return { ...practiceMission('2026-07-30'), survivors: survivors(6) };
}

function finale() {
  return new RunState(marketDay(), 'sidearm', 7);
}

describe('laying out the last stage', () => {
  it('is the longest run in the campaign', () => {
    const seconds = [1, 2, 3, 4, 5, 6].map((n) => stageAt(n).seconds);
    expect(stageAt(7).seconds).toBeGreaterThan(Math.max(...seconds));
  });

  it('puts an ally and a seal in every region', () => {
    const run = finale();
    expect(run.allies).toHaveLength(stageAt(7).allies);
    expect(run.seals).toHaveLength(run.allies.length);
  });

  it('names them off the real market rows', () => {
    const run = finale();
    expect(run.allies.map((a) => a.ticker)).toEqual(['BTC', 'ETH', 'XRP', 'BNB', 'SOL']);
  });

  it('never casts the day’s wreck as its own rescue party', () => {
    // The server excludes it; this pins that nothing downstream puts it back.
    const run = finale();
    for (const ally of run.allies) {
      expect(ally.ticker).not.toBe(run.mission.ticker);
    }
  });

  it('falls back to unnamed holdouts when the market call gave us nothing', () => {
    // A practice day has no survivors. Inventing tickers would be inventing
    // projects, so the stage plays against anonymous ones instead.
    const run = new RunState(practiceMission('2026-07-30'), 'sidearm', 7);
    expect(run.allies).toHaveLength(stageAt(7).allies);
    for (const ally of run.allies) expect(ally.ticker.length).toBeGreaterThan(0);
  });

  it('needs one more ally at each seal', () => {
    const run = finale();
    expect(run.seals.map((s) => s.needs)).toEqual([1, 2, 3, 4, 5]);
  });

  it('puts no seal before the first ally', () => {
    // Otherwise the run opens on a wall nobody could have prepared for.
    const run = finale();
    expect(run.seals[0]!.x).toBeGreaterThan(run.allies[0]!.x);
  });
});

describe('the seals', () => {
  it('stops a player who has recruited nobody', () => {
    const run = finale();
    const seal = blockingSeal(run.seals, run.allies, 0);
    expect(seal).not.toBeNull();
    expect(reachableX(run.seals, run.allies, 0)).toBeLessThan(seal!.x);
  });

  it('opens once the ally it waits for is aboard', () => {
    const run = finale();
    run.allies[0]!.recruited = true;

    const first = run.seals[0]!;
    expect(blockingSeal(run.seals, run.allies, 0)?.id).not.toBe(first.id);
    expect(first.open).toBe(true);
  });

  it('never shuts behind a player who has already passed it', () => {
    // The failure this prevents: being stranded in a region with nothing left
    // to collect and a wall on both sides.
    const run = finale();
    const first = run.seals[0]!;
    const past = first.x + 500;

    expect(blockingSeal(run.seals, run.allies, past)?.id).not.toBe(first.id);
  });

  it('holds the ship rather than letting it through', () => {
    const run = finale();
    const seal = run.seals[0]!;

    run.player.x = seal.x - 60;
    run.player.vx = 900;
    for (let i = 0; i < 30; i++) step(run, 1 / 60, STILL);

    expect(run.player.x).toBeLessThanOrEqual(seal.x);
  });
});

describe('recruiting', () => {
  it('joins on contact and follows from then on', () => {
    const run = finale();
    const ally = run.allies[0]!;

    run.player.x = ally.x;
    run.player.y = ally.y;
    step(run, 1 / 60, STILL);

    expect(ally.recruited).toBe(true);
    expect(recruited(run.allies)).toBe(1);
  });

  it('says which project joined, because the name is the point', () => {
    const run = finale();
    const ally = run.allies[0]!;

    run.player.x = ally.x;
    run.player.y = ally.y;
    step(run, 1 / 60, STILL);

    expect(run.events.some((e) => e.text?.includes(ally.ticker))).toBe(true);
  });

  it('only joins on contact, not from across the level', () => {
    const run = finale();
    const ally = run.allies[0]!;

    run.player.x = ally.x + ALLY_REACH * 6;
    run.player.y = ally.y;
    step(run, 1 / 60, STILL);

    expect(ally.recruited).toBe(false);
  });
});

describe('the ending', () => {
  it('refuses to finish a project short', () => {
    const run = finale();
    run.player.x = run.extractionX + 50;
    run.player.y = run.terrain.groundAt(run.extractionX) - 40;
    step(run, 1 / 60, STILL);

    expect(run.phase).toBe('flying');
  });

  it('finishes once every project is aboard', () => {
    const run = finale();
    for (const ally of run.allies) ally.recruited = true;

    run.player.x = run.extractionX + 50;
    run.player.y = run.terrain.groundAt(run.extractionX) - 40;
    step(run, 1 / 60, STILL);

    expect(run.phase).toBe('extracted');
  });

  it('leaves every other stage unsealed', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const run = new RunState(marketDay(), 'sidearm', n);
      expect(run.allies).toHaveLength(0);
      expect(run.seals).toHaveLength(0);
    }
  });
});
