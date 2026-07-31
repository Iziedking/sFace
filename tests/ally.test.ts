/**
 * Stage seven: gather intel, then answer for the way through.
 *
 * The properties that make this a thinking stage rather than a collectathon:
 * a gate can only be passed by answering it, the answer depends on facts learned
 * out in the level, and a gate never asks about something the player could not
 * yet have reached.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission, type DailyMission, type Survivor } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { earn } from '../src/game/scrip';
import {
  answerGate,
  buyRead,
  READ_COST,
  gateQuestion,
  known,
  ALLY_REACH,
  GATE_ALARM_SECONDS,
} from '../src/game/ally';
import { stageAt } from '../src/data/campaign';
import { polar, solidAt } from '../src/game/rings';
import { spawnBullet, updateBullets } from '../src/game/bullet';
import { PLAYER_RADIUS } from '../src/game/player';
import type { PlayerCommand } from '../src/game/player';

const STILL: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

/**
 * Six real-shaped rows, with the biggest and the strongest deliberately being
 * DIFFERENT projects, so a gate asking one question cannot be passed by
 * answering the other.
 */
function survivors(): Survivor[] {
  return [
    { ticker: 'BTC', name: 'Bitcoin', rank: 1, changePct: -0.2 },
    { ticker: 'ETH', name: 'Ethereum', rank: 2, changePct: 0.3 },
    { ticker: 'BNB', name: 'BNB', rank: 3, changePct: 2.9 },
    { ticker: 'XRP', name: 'XRP', rank: 4, changePct: -0.8 },
    { ticker: 'SOL', name: 'Solana', rank: 5, changePct: 1.4 },
    { ticker: 'TRX', name: 'TRON', rank: 6, changePct: 0.6 },
  ];
}

function marketDay(): DailyMission {
  return { ...practiceMission('2026-07-30'), survivors: survivors() };
}

function finale() {
  return new RunState(marketDay(), 'sidearm', 7);
}

/** Fly to a project and take its intel, the way a player does. */
function learn(run: RunState, index: number): void {
  const ally = run.allies[index]!;
  run.player.x = ally.x;
  run.player.y = ally.y;
  step(run, 1 / 60, STILL);
}

describe('the shape of the last stage', () => {
  it('is the longest run in the campaign', () => {
    const seconds = [1, 2, 3, 4, 5, 6].map((n) => stageAt(n).seconds);
    expect(stageAt(7).seconds).toBeGreaterThan(Math.max(...seconds));
  });

  it('puts a gate after every region but the first', () => {
    // A gate before anything could be learned would be a wall nobody could have
    // prepared for, and a question about one project has no question in it.
    const run = finale();
    expect(run.allies).toHaveLength(stageAt(7).allies);
    expect(run.gates).toHaveLength(run.allies.length - 1);
  });

  it('never asks about a project further in than its own wall', () => {
    /*
     * The rings are numbered inward and the projects are met outermost first, so
     * a gate may only ask about the ones already passed. Asking about something
     * deeper in would be unanswerable by anybody playing it in order, which is
     * not difficulty, it is a bug with a story attached.
     */
    const run = finale();
    const order = new Map(run.allies.map((a, i) => [a.id, i]));
    run.gates.forEach((gate, index) => {
      for (const id of gate.options) {
        expect(order.get(id)!).toBeLessThanOrEqual(index + 1);
      }
    });
  });

  it('builds a ring city, not the grid of stages five and six', () => {
    const run = finale();
    expect(run.rings).not.toBeNull();
    expect(run.city).toBeNull();
    // One wall per gate: the first project is met before any wall.
    expect(run.rings!.rings).toHaveLength(run.gates.length);
  });

  it('gives every wall one gap, wide enough to fly through', () => {
    const run = finale();
    for (const ring of run.rings!.rings) {
      const width = 2 * ring.gapHalf * ring.radius;
      expect(width).toBeGreaterThan(PLAYER_RADIUS * 3);
      expect(ring.locked).toBe(true);
    }
  });

  it('starts outside every wall', () => {
    // Spawning inside one would trap the run before it began.
    const run = finale();
    const c = run.rings!;
    expect(solidAt(c, run.player.x, run.player.y)).toBe(false);
  });

  it('always includes the correct answer among the options', () => {
    const run = finale();
    for (const gate of run.gates) {
      expect(gate.answer).toBeGreaterThanOrEqual(0);
      expect(gate.answer).toBeLessThan(gate.options.length);
    }
  });

  it('marks the right project for the question it asks', () => {
    const run = finale();
    for (const gate of run.gates) {
      const shown = gate.options.map((id) => run.allies.find((a) => a.id === id)!);
      const winner = shown[gate.answer]!;

      if (gate.ask === 'strongest') {
        expect(winner.changePct).toBe(Math.max(...shown.map((a) => a.changePct)));
      } else {
        expect(winner.changePct).toBe(Math.min(...shown.map((a) => a.changePct)));
      }
    }
  });

  it('only asks things that cannot be guessed from general knowledge', () => {
    /*
     * The failure this replaced.
     *
     * A gate used to ask which project was the largest, and anybody who has
     * heard of Bitcoin answers that without having collected a thing. Every
     * question now turns on the day's own moves, which change each morning and
     * are only learnable by going to the project.
     */
    const run = finale();
    for (const gate of run.gates) {
      expect(['strongest', 'weakest']).toContain(gate.ask);
    }
  });

  it('asks a question a person can read', () => {
    const run = finale();
    for (const gate of run.gates) {
      expect(gateQuestion(gate, run.mission.ticker).length).toBeGreaterThan(10);
    }
  });

  it('is deterministic, so a seed is a fair bet', () => {
    const a = finale();
    const b = finale();
    expect(b.gates.map((g) => [g.ask, g.answer, ...g.options])).toEqual(
      a.gates.map((g) => [g.ask, g.answer, ...g.options]),
    );
  });
});

describe('gathering intel', () => {
  it('learns a project by reaching it, with nothing to press', () => {
    const run = finale();
    learn(run, 0);

    expect(run.allies[0]!.known).toBe(true);
    expect(known(run.allies)).toBe(1);
  });

  it('says what was learned, because that is the whole reward', () => {
    const run = finale();
    const ally = run.allies[0]!;
    learn(run, 0);

    const said = run.events.find((e) => e.text?.includes(ally.ticker))?.text ?? '';
    expect(said).toContain(String(ally.rank));
    expect(said).toContain('%');
  });

  it('does not learn one from across the level', () => {
    const run = finale();
    const ally = run.allies[0]!;
    run.player.x = ally.x + ALLY_REACH * 6;
    run.player.y = ally.y;
    step(run, 1 / 60, STILL);

    expect(ally.known).toBe(false);
  });
});

describe('the gates', () => {
  /** Put the player in the open band outside a given wall. */
  /**
   * A wall whose gate is an actual choice.
   *
   * Gates ask about the projects outside the wall they guard, so the outermost
   * one has a single option: you either met that project or you did not, and
   * there is nothing to pick wrong. Anything testing a wrong answer has to be
   * at a wall further in.
   */
  function ringWithAChoice(run: RunState): number {
    const gate = [...run.gates].sort((a, b) => b.options.length - a.options.length)[0]!;
    return gate.ring;
  }

  function standOutside(run: RunState, ringIndex: number): void {
    const c = run.rings!;
    const ring = c.rings[ringIndex]!;
    const r = ring.radius + ring.thickness + 90;
    // Well away from the gap, so this is the wall rather than the doorway.
    const a = ring.gapAt + Math.PI;
    run.player.x = c.cx + Math.cos(a) * r;
    run.player.y = c.cy + Math.sin(a) * r;
    run.player.vx = 0;
    run.player.vy = 0;
  }

  it('holds the ship at a locked wall', () => {
    // Not shot open, not flown past. This is the stage.
    const run = finale();
    const c = run.rings!;
    const outermost = c.rings.length - 1;
    standOutside(run, outermost);

    const before = polar(c, run.player.x, run.player.y).r;
    // Fly hard at the middle for a second.
    for (let i = 0; i < 60; i++) {
      step(run, 1 / 60, {
        moveX: (c.cx - run.player.x) / 1000,
        moveY: (c.cy - run.player.y) / 1000,
        aimX: null,
        aimY: null,
        firing: false,
      });
    }

    const after = polar(c, run.player.x, run.player.y).r;
    expect(after).toBeGreaterThan(c.rings[outermost]!.radius);
    expect(after).toBeLessThan(before);
  });

  it('puts its question up on the approach to its wall', () => {
    const run = finale();
    standOutside(run, run.rings!.rings.length - 1);
    step(run, 1 / 60, STILL);

    expect(run.openGateId).not.toBeNull();
  });

  it('opens the wall on the right answer', () => {
    const run = finale();
    const outermost = run.rings!.rings.length - 1;
    standOutside(run, outermost);
    step(run, 1 / 60, STILL);

    const gate = run.gates.find((g) => g.id === run.openGateId)!;
    expect(answerGate(run, gate.answer)).toBe('open');

    expect(gate.open).toBe(true);
    expect(run.gatesOpened).toBe(1);
    expect(run.rings!.rings[gate.ring]!.locked).toBe(false);
  });

  it('costs time and noise on a wrong answer, not score', () => {
    const run = finale();
    standOutside(run, ringWithAChoice(run));
    step(run, 1 / 60, STILL);

    const gate = run.gates.find((g) => g.id === run.openGateId)!;
    expect(gate.options.length).toBeGreaterThan(1);
    const before = run.nodeScore;
    expect(answerGate(run, (gate.answer + 1) % gate.options.length)).toBe('wrong');

    expect(run.nodeScore).toBe(before);
    expect(gate.open).toBe(false);
    expect(gate.missed).toBe(1);
    expect(run.rings!.rings[gate.ring]!.locked).toBe(true);
    expect(run.nodeAlarmUntil).toBeCloseTo(run.time + GATE_ALARM_SECONDS, 4);
  });

  it('closes the question either way, so it cannot be brute forced', () => {
    const run = finale();
    standOutside(run, ringWithAChoice(run));
    step(run, 1 / 60, STILL);

    const gate = run.gates.find((g) => g.id === run.openGateId)!;
    answerGate(run, (gate.answer + 1) % gate.options.length);

    expect(run.openGateId).toBeNull();
    expect(answerGate(run, gate.answer)).toBe('none');
  });

  it('can be tried again by coming back to the wall', () => {
    const run = finale();
    // A wall with more than one option, or there is no wrong answer to recover
    // from. See ringWithAChoice.
    standOutside(run, ringWithAChoice(run));
    step(run, 1 / 60, STILL);

    const gate = run.gates.find((g) => g.id === run.openGateId)!;
    answerGate(run, (gate.answer + 1) % gate.options.length);

    step(run, 1 / 60, STILL);
    expect(run.openGateId).toBe(gate.id);
    expect(answerGate(run, gate.answer)).toBe('open');
  });
});

describe('the ending', () => {
  it('ends at the core, not at a finish line', () => {
    const run = finale();
    const c = run.rings!;
    for (const ally of run.allies) ally.known = true;
    for (const gate of run.gates) gate.open = true;
    for (const ring of c.rings) ring.locked = false;

    run.player.x = c.cx;
    run.player.y = c.cy;
    step(run, 1 / 60, STILL);

    expect(run.phase).toBe('extracted');
  });

  it('cannot be reached while a wall is still shut', () => {
    // The walls are the enforcement: there is no route to the middle that does
    // not go through every gate, so nothing else has to police it.
    const run = finale();
    const c = run.rings!;
    expect(c.rings.every((r) => r.locked)).toBe(true);
    expect(solidAt(c, c.cx + c.rings[0]!.radius, c.cy)).toBe(true);
  });

  it('leaves every other stage without gates', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const run = new RunState(marketDay(), 'sidearm', n);
      expect(run.allies).toHaveLength(0);
      expect(run.gates).toHaveLength(0);
    }
  });
});

/**
 * Shooting in the ring city.
 *
 * Reported as attackers being able to shoot the player while the player's own
 * rounds did nothing. The ring city had no branch in the bullet bounds check, so
 * it fell through to the chart world's, which is nine hundred and sixty tall
 * against a ring city of nearly six thousand. Every round died on the frame it
 * was fired.
 *
 * The identical bug had already happened once, when the block city was added.
 * These pin the third world so it cannot happen a third time.
 */
describe('rounds in the ring city', () => {
  it('lets a fired round actually travel', () => {
    const run = finale();
    const c = run.rings!;

    // Out in the open, well away from any wall.
    const ring = c.rings[c.rings.length - 1]!;
    run.player.x = c.cx;
    run.player.y = c.cy - (ring.radius + ring.thickness + 200);

    spawnBullet(run, {
      x: run.player.x,
      y: run.player.y,
      vx: 600,
      vy: 0,
      life: 1.5,
      damage: 10,
      friendly: true,
      pierce: 0,
    });

    updateBullets(run, 1 / 60);

    expect(run.bullets).toHaveLength(1);
    expect(run.bullets[0]!.x).toBeGreaterThan(run.player.x);
  });

  it('stops a round at a locked wall, so cover is cover', () => {
    const run = finale();
    const c = run.rings!;
    const ring = c.rings[c.rings.length - 1]!;

    // Sitting inside the wall itself, away from the gap.
    const a = ring.gapAt + Math.PI;
    spawnBullet(run, {
      x: c.cx + Math.cos(a) * ring.radius,
      y: c.cy + Math.sin(a) * ring.radius,
      vx: 10,
      vy: 0,
      life: 1.5,
      damage: 10,
      friendly: true,
      pierce: 0,
    });

    updateBullets(run, 1 / 60);
    expect(run.bullets).toHaveLength(0);
  });

  it('stops a round at the gap of a wall still locked', () => {
    /*
     * The gap used to let rounds through, on the reasoning that the one way in
     * should not also be the one place you cannot shoot. That reasoning came
     * from a version where the gap was a hole you could walk through, and it
     * was that hole which let the whole stage be finished without answering a
     * single gate.
     *
     * A locked wall is now closed all the way round, so there is no way in to
     * be shooting through. The gap is where the gate stands, not an opening.
     */
    const run = finale();
    const c = run.rings!;
    const ring = c.rings[c.rings.length - 1]!;

    spawnBullet(run, {
      x: c.cx + Math.cos(ring.gapAt) * ring.radius,
      y: c.cy + Math.sin(ring.gapAt) * ring.radius,
      vx: 10,
      vy: 0,
      life: 1.5,
      damage: 10,
      friendly: true,
      pierce: 0,
    });

    updateBullets(run, 1 / 60);
    expect(run.bullets).toHaveLength(0);
  });

  it('lets a round through once the wall has been answered', () => {
    // And then everywhere on it, not only at the gap. A wall with nothing left
    // to ask is not a wall.
    const run = finale();
    const c = run.rings!;
    const ring = c.rings[c.rings.length - 1]!;
    ring.locked = false;

    for (const angle of [ring.gapAt, ring.gapAt + Math.PI]) {
      run.bullets.length = 0;
      spawnBullet(run, {
        x: c.cx + Math.cos(angle) * ring.radius,
        y: c.cy + Math.sin(angle) * ring.radius,
        vx: 10,
        vy: 0,
        life: 1.5,
        damage: 10,
        friendly: true,
        pierce: 0,
      });

      updateBullets(run, 1 / 60);
      expect(run.bullets).toHaveLength(1);
    }
  });
});

/**
 * Buying your way out of a wall you cannot answer.
 *
 * A gate can be passed three ways: go and learn the numbers, already know them
 * because you follow the market, or pay for them. The third is what these cover.
 * The second needs no code at all, which is the point of asking about real
 * tickers and real moves.
 */
describe('reading what you skipped', () => {
  function atGate(run: RunState) {
    const c = run.rings!;
    const ring = c.rings[c.rings.length - 1]!;
    const a = ring.gapAt + Math.PI;
    run.player.x = c.cx + Math.cos(a) * (ring.radius + ring.thickness + 90);
    run.player.y = c.cy + Math.sin(a) * (ring.radius + ring.thickness + 90);
    step(run, 1 / 60, STILL);
    return run.gates.find((g) => g.id === run.openGateId)!;
  }

  it('reveals the options you never went to, for scrip', () => {
    const run = finale();
    const gate = atGate(run);
    earn(run.purse, READ_COST);

    expect(buyRead(run)).toBe('bought');

    for (const id of gate.options) {
      expect(run.allies.find((a) => a.id === id)!.known).toBe(true);
    }
  });

  it('charges for it', () => {
    const run = finale();
    atGate(run);
    earn(run.purse, READ_COST + 40);

    buyRead(run);
    expect(run.purse.held).toBe(40);
  });

  it('refuses when the purse is short, and takes nothing', () => {
    const run = finale();
    const gate = atGate(run);
    earn(run.purse, READ_COST - 1);

    expect(buyRead(run)).toBe('broke');
    expect(run.purse.held).toBe(READ_COST - 1);
    expect(run.allies.find((a) => a.id === gate.options[0])!.known).toBe(false);
  });

  it('will not sell you what you already know', () => {
    const run = finale();
    const gate = atGate(run);
    for (const id of gate.options) {
      run.allies.find((a) => a.id === id)!.known = true;
    }
    earn(run.purse, READ_COST);

    expect(buyRead(run)).toBe('nothing');
    expect(run.purse.held).toBe(READ_COST);
  });

  it('only reveals the gate in front of you', () => {
    // One purchase must not end the stage. It buys you out of one mistake.
    const run = finale();
    const gate = atGate(run);
    earn(run.purse, READ_COST);
    buyRead(run);

    const untouched = run.allies.filter(
      (a) => !gate.options.includes(a.id) && !a.known,
    );
    expect(untouched.length).toBeGreaterThan(0);
  });

  it('does nothing away from a gate', () => {
    const run = finale();
    earn(run.purse, READ_COST);
    expect(buyRead(run)).toBe('none');
    expect(run.purse.held).toBe(READ_COST);
  });

  it('cannot be bought with money, only earned in the run', () => {
    /*
     * The rule the challenge system rests on. Scrip is earned inside a run and
     * has no purchase path, so two people staking on one seed have the same
     * access to this. Selling it for NIM would make the fairest thing in the
     * project the one thing you could buy past.
     */
    expect(READ_COST).toBeGreaterThan(0);
    const run = finale();
    expect(run.purse.held).toBe(0);
  });
});
