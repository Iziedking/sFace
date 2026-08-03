/**
 * Stage seven: what you know, not what you shot.
 *
 * ## The verb
 *
 * Every other stage is decided by flying, aiming, hiding or driving. This one is
 * decided by paying attention. The way out is sealed into regions and no weapon
 * opens a gate; a gate opens when you can answer what it asks, and you can only
 * answer it if you went and learned something first.
 *
 * So the loop is gather, then apply:
 *
 *   1. Reach a project. It hands you its intel: where it sits by size, and how it
 *      is holding up today. Reaching it is the only way to learn that.
 *   2. The gate at the end of the region asks a question about the projects
 *      behind you, showing only their tickers.
 *   3. Answer it from what you gathered. Right, and the gate opens. Wrong, and it
 *      costs you time and everything nearby wakes up.
 *
 * A player who flew past a project can still reach the gate. They simply cannot
 * answer it, which is the point: the stage is not gated on reflexes, it is gated
 * on having looked.
 *
 * ## Why the numbers are hidden until collected
 *
 * The gate shows four tickers and nothing else. If it printed their figures the
 * question would answer itself and the whole stage would collapse back into
 * flying to a door. Hiding them is what turns the earlier detour into the thing
 * that pays off later.
 *
 * ## How this differs from stage six
 *
 * Stage six is a single read: four real posts in front of you, pick the one that
 * explains today. Everything needed is on screen at the moment you decide.
 *
 * Stage seven is a chain. Nothing needed to answer a gate is on screen when you
 * answer it. It was on screen minutes earlier, somewhere else, and you either
 * went and got it or you did not.
 *
 * ## Nothing here is invented
 *
 * The projects are the largest by market capitalisation on the day you play, off
 * the same market call that picks the day's wreck. The facts asked about are
 * their real rank and their real 24 hour move. There is no model opinion in any
 * of it, and every question has an answer that can be checked against the market.
 *
 * ## Determinism
 *
 * Placement, question type and option order all come from the level stream at
 * construction. Two players on one seed get the same questions in the same
 * regions with the answer in the same slot.
 */

import type { Rng } from '../core/rng';
import type { Survivor } from './mission';
import { ringAt } from './rings';
import { spend } from './scrip';
import type { RunState } from './state';

export interface Ally {
  id: number;
  /** Real ticker, e.g. BTC. */
  ticker: string;
  name: string;
  /** Market cap place on the day, 1 is the largest. */
  rank: number;
  /** Its own 24 hour move, which is often green when the wreck is not. */
  changePct: number;
  x: number;
  y: number;
  /**
   * True once the player has reached it and taken its intel.
   *
   * Named `known` rather than `recruited` on purpose. What you get is not a
   * follower, it is a fact, and every gate downstream is asking whether you
   * bothered to go and learn it.
   */
  known: boolean;
  /** Run time it was reached, so the renderer can play the moment. */
  learnedAt: number;
  /** Position in the follow chain once known. */
  slot: number;
}

/**
 * What a gate can ask about.
 *
 * Both are about TODAY, and that is the whole point. An earlier version asked
 * which project was the largest, which anybody who has heard of Bitcoin answers
 * without collecting anything: it is general knowledge, not intel, and a gate
 * you can pass by already knowing the industry is a gate that does not test
 * whether you went and looked.
 *
 * Both questions here turn on the day's own numbers, which are not knowable from
 * outside the run and change every morning.
 */
export type GateAsk = 'strongest' | 'weakest';

export interface Gate {
  id: number;
  /** Where it stands across the level. */
  x: number;
  /** Ally ids it is asking about, in the order shown. */
  options: number[];
  /** Index into options. Set once at construction. */
  answer: number;
  ask: GateAsk;
  /**
   * Which ring this gate unlocks, innermost first. -1 when the stage has none.
   *
   * On the ring city a gate is not a place, it is a wall: answering it opens the
   * whole circumference rather than one point on it, so `x` is meaningless there
   * and this is what the world reads.
   */
  ring: number;
  open: boolean;
  /** How many times this one was answered wrong. Shown, because it stings. */
  missed: number;
}

/** How close you have to get to take a project's intel. */
export const ALLY_REACH = 46;

/** How far a closed gate holds you back. Wide enough that you cannot clip it. */
export const GATE_HALF_WIDTH = 26;

/** How close you must be for a gate to put its question up. */
export const GATE_REACH = 210;

/**
 * What a wrong answer costs.
 *
 * Time and noise, the same currency stage six uses, because a hidden score
 * penalty teaches nothing and this stage is entirely about learning. Longer than
 * stage six's, since a gate can be retried on the spot and a cost you can simply
 * wait out is not a cost.
 */
export const GATE_ALARM_SECONDS = 7;
/** How far a wrong answer carries. */
export const GATE_ALARM_RADIUS = 1_200;
/** Banked per gate solved. Worth more than an attacker, because it is harder. */
export const GATE_SCORE = 500;

/**
 * A fallback cast for days the market call gave us nothing.
 *
 * Deliberately generic. Inventing tickers would be inventing projects, and
 * hardcoding real ones would assert that these are the projects that lasted,
 * which is the judgement the live data exists to make.
 */
const UNNAMED = ['THE HOLDOUTS', 'STILL LISTED', 'NEVER DELISTED', 'THE REMAINDER'];

export function layOutAllies(
  rng: Rng,
  survivors: Survivor[],
  count: number,
  extractionX: number,
  groundAt: (x: number) => number,
  nextId: () => number,
): Ally[] {
  const allies: Ally[] = [];

  /*
   * One per region, spread across the run. Jittered inside its band so the
   * stage does not read as a row of pickups on a grid.
   */
  const band = extractionX / (count + 1);

  for (let i = 0; i < count; i++) {
    const survivor = survivors[i];
    const x = Math.round(band * (i + 1) + rng.range(-band * 0.18, band * 0.18));

    allies.push({
      id: nextId(),
      ticker: survivor?.ticker ?? UNNAMED[i % UNNAMED.length] ?? 'HOLDOUT',
      name: survivor?.name ?? 'Still standing',
      rank: survivor?.rank ?? i + 1,
      changePct: survivor?.changePct ?? 0,
      x,
      y: groundAt(x) - rng.range(120, 260),
      known: false,
      learnedAt: -1,
      slot: 0,
    });
  }

  return allies;
}

/**
 * A gate after each region, asking about the projects behind it.
 *
 * The first gate is skipped. A question about one project has one option and no
 * question in it, and a gate before anything could have been learned would be a
 * wall nobody could have prepared for.
 */
export function layOutGates(
  rng: Rng,
  allies: Ally[],
  extractionX: number,
  nextId: () => number,
): Gate[] {
  const gates: Gate[] = [];
  const band = extractionX / (allies.length + 1);

  /*
   * One gate per wall, and the first wall may only ask about the first project.
   *
   * This used to run from 1 to allies.length, which is one gate per ally rather
   * than one per wall. With five projects and four walls every gate ended up
   * asking about one project too deep: the outermost wall, the very first thing
   * a player meets, asked about a project sealed behind itself. Unanswerable in
   * order, on the first gate, on the finale.
   *
   * Counting from the wall instead. Gate j guards the jth wall from the outside,
   * and may ask about exactly the j + 1 projects that sit outside it.
   */
  const walls = allies.length - 1;

  for (let j = 0; j < walls; j++) {
    /*
     * Only projects the player could already have reached.
     *
     * Asking about one further in would make the gate unanswerable by anybody
     * playing it in order, which is not difficulty, it is a bug with a story
     * attached.
     */
    const behind = allies.slice(0, j + 1);

    // Alternate the two questions so a player cannot learn one answer shape and
    // stop reading, and draw from the stream so the order is fixed per seed.
    const ask: GateAsk = rng.chance(0.5) ? 'strongest' : 'weakest';

    /*
     * Four options, always including the correct one.
     *
     * Shuffled by index so the answer is not learnable as a position. Where
     * fewer than four projects are behind the gate, every one of them is shown
     * and the question is simply narrower.
     */
    const pool = behind.slice(-Math.min(4, behind.length));
    const order = pool.map((_, index) => index);
    for (let j = order.length - 1; j > 0; j--) {
      const k = rng.int(0, j);
      const a = order[j]!;
      const b = order[k]!;
      order[j] = b;
      order[k] = a;
    }

    const options = order.map((index) => pool[index]!);
    const answer = winnerOf(options, ask);

    gates.push({
      id: nextId(),
      x: Math.round(Math.min(extractionX - 200, allies[j]!.x + band * 0.55)),
      /*
       * Gate 0 guards the outermost wall, because that is the first one a player
       * meets. The rings are numbered inward, so the index is flipped.
       *
       * `x` is only read on a level laid out along a line. On the ring city a
       * gate belongs to a wall rather than to a point, and `ring` is what the
       * world reads. See the Gate type.
       */
      ring: walls - 1 - j,
      options: options.map((a) => a.id),
      answer,
      ask,
      open: false,
      missed: 0,
    });
  }

  return gates;
}

/** Which of these wins the question, on the day's own moves. */
function winnerOf(options: Ally[], ask: GateAsk): number {
  let best = 0;
  for (let i = 1; i < options.length; i++) {
    const a = options[i]!;
    const b = options[best]!;
    const better = ask === 'strongest' ? a.changePct > b.changePct : a.changePct < b.changePct;
    if (better) best = i;
  }
  return best;
}

/** The question, in words, for the panel. */
export function gateQuestion(gate: Gate, wreckTicker: string): string {
  return gate.ask === 'strongest'
    ? `WHICH HELD UP BEST WHILE ${wreckTicker} FELL?`
    : `WHICH ONE WENT DOWN WITH ${wreckTicker}?`;
}

/** How many projects the player has learned about. */
export function known(allies: Ally[]): number {
  return allies.filter((a) => a.known).length;
}

/**
 * The first closed gate ahead of this x.
 *
 * Only gates AHEAD count: one already passed must never spring shut behind
 * somebody, which would strand them in a region with nothing left to do.
 */
export function blockingGate(gates: Gate[], x: number): Gate | null {
  for (const gate of gates) {
    if (gate.open) continue;
    if (gate.x >= x) return gate;
  }
  return null;
}

/**
 * How far right the player may travel.
 *
 * A limit rather than a collision, so the caller can clamp movement smoothly and
 * pressing against a gate reads as leaning on a door instead of snagging on it.
 */
export function reachableX(gates: Gate[], x: number): number {
  const gate = blockingGate(gates, x);
  return gate === null ? Number.POSITIVE_INFINITY : gate.x - GATE_HALF_WIDTH;
}

/**
 * Take a project's intel, and open whatever gate is asking.
 *
 * Called every step. Proximity is the only requirement: there is nothing to
 * press, because the act is going there rather than performing an input.
 */
export function updateAllies(state: RunState): void {
  if (state.allies.length === 0) return;

  const player = state.player;

  for (const ally of state.allies) {
    if (ally.known) continue;
    if (Math.hypot(player.x - ally.x, player.y - ally.y) > ALLY_REACH + 17) continue;

    ally.known = true;
    ally.learnedAt = state.time;
    ally.slot = known(state.allies);

    /*
     * The intel is stated out loud when taken.
     *
     * It is the entire reward for the detour, and a player who reaches a project
     * and is told nothing has no way to know they were supposed to remember
     * something.
     */
    const move = `${ally.changePct >= 0 ? '+' : ''}${ally.changePct.toFixed(1)}%`;
    state.emit({
      kind: 'freed',
      x: ally.x,
      y: ally.y,
      text: `${ally.ticker}: no.${ally.rank}, ${move} today`,
    });
  }

  /*
   * On the ring city a gate belongs to a wall rather than to a point.
   *
   * The question comes up when you are in the band outside its ring, which is
   * the whole approach to that wall, so it is there while you circle looking for
   * the gap rather than only at one spot on it. The wall itself does the
   * blocking, in the movement code, because a ring is not a line across the
   * level.
   */
  const rings = state.rings;
  if (rings) {
    const standing = ringAt(rings, player.x, player.y);
    const gate = state.gates.find((g) => !g.open && g.ring === standing) ?? null;
    state.openGateId = gate?.id ?? null;
    return;
  }

  const gate = blockingGate(state.gates, player.x);
  state.openGateId =
    gate !== null && Math.abs(gate.x - player.x) <= GATE_REACH ? gate.id : null;

  const limit = reachableX(state.gates, player.x);
  if (player.x > limit) {
    player.x = limit;
    if (player.vx > 0) player.vx = 0;
  }
}

/**
 * What a read costs, in the day's own scrip.
 *
 * ## Why this exists
 *
 * A gate can be answered three ways, and all three should be real:
 *
 *   1. You went to the projects and learned their numbers. Free, costs time.
 *   2. You follow crypto closely enough to already know how the majors moved
 *      today. Free, costs nothing, and works without the game doing anything:
 *      the gate shows real tickers and asks about real moves, so somebody who
 *      reads the market answers straight off. That it works at all is quietly
 *      the most interesting thing on this stage.
 *   3. You flew past them and are now standing at a wall you cannot open. This
 *      is what that costs.
 *
 * ## Why scrip and not NIM
 *
 * Scrip is earned inside the run and cannot be bought, which is the rule the
 * whole challenge system rests on: no advantage is purchasable with money, so
 * two people staking on one seed are playing the same game. Selling this for NIM
 * would make the fairest thing in the project the one thing you could buy your
 * way past.
 *
 * Priced above a bomb, because skipping a journey across two rings is worth more
 * than clearing a room, and high enough that it is a decision rather than a
 * habit.
 */
export const READ_COST = 160;

/**
 * Buy the numbers for the gate in front of you.
 *
 * Only ever reveals the options THIS gate is asking about. Revealing everything
 * would make one purchase end the stage, and the point is to buy your way out of
 * one mistake rather than out of the whole thing.
 */
export function buyRead(state: RunState): 'bought' | 'broke' | 'nothing' | 'none' {
  if (state.openGateId === null) return 'none';

  const gate = state.gates.find((g) => g.id === state.openGateId);
  if (!gate || gate.open) return 'none';

  const unknown = gate.options
    .map((id) => state.allies.find((a) => a.id === id))
    .filter((ally): ally is Ally => ally !== undefined && !ally.known);

  // Nothing to buy. Saying so is better than taking the scrip for no change.
  if (unknown.length === 0) return 'nothing';

  if (!spend(state.purse, READ_COST)) return 'broke';

  for (const ally of unknown) {
    ally.known = true;
    ally.learnedAt = state.time;
    ally.slot = known(state.allies);
  }

  state.emit({
    kind: 'cache',
    x: state.player.x,
    y: state.player.y,
    text: `Read: ${unknown.map((a) => a.ticker).join(', ')}`,
  });

  return 'bought';
}

export type GateResult = 'open' | 'wrong' | 'none';

/**
 * Answer the gate in front of you.
 *
 * Both outcomes close the question, so a wrong answer cannot be brute forced by
 * cycling the other three while standing still. Backing off and coming back is
 * the retry, and the alarm is what makes that cost something.
 */
export function answerGate(state: RunState, choice: number): GateResult {
  if (state.openGateId === null) return 'none';

  const gate = state.gates.find((g) => g.id === state.openGateId);
  if (!gate || gate.open) return 'none';
  if (choice < 0 || choice >= gate.options.length) return 'none';

  state.openGateId = null;

  if (choice === gate.answer) {
    gate.open = true;
    state.gatesOpened++;
    // On the ring city, opening a gate opens the wall itself.
    const ring = state.rings?.rings[gate.ring];
    if (ring) ring.locked = false;
    state.nodeScore += GATE_SCORE;
    state.emit({ kind: 'read', x: gate.x, y: state.player.y, text: 'The way opens' });
    return 'open';
  }

  gate.missed++;
  state.gatesMissed++;
  state.nodeAlarmUntil = state.time + GATE_ALARM_SECONDS;

  /*
   * Wake everything nearby. Both flags are set: notice alone decays before they
   * arrive, and alertUntil alone lets them forget the moment line of sight
   * breaks, which is exactly the escape a wrong answer should not buy.
   */
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    if (Math.abs(enemy.x - gate.x) > GATE_ALARM_RADIUS) continue;
    enemy.active = true;
    enemy.notice = 1;
    enemy.alertUntil = Math.max(enemy.alertUntil, state.time + GATE_ALARM_SECONDS);
  }

  state.emit({ kind: 'misread', x: gate.x, y: state.player.y, text: 'Wrong. It holds.' });
  return 'wrong';
}

/**
 * Known projects trail the ship.
 *
 * Reuses the player's own position trail rather than pathfinding: the chain is
 * already there for the rescue cast, it reads correctly at speed, and one follow
 * behaviour means the two never drift apart in feel. They sit further back than
 * a rescued person, which is what separates who you are saving from who is
 * coming with you.
 */
export function followAllies(state: RunState, dt: number): void {
  if (state.allies.length === 0) return;

  const spring = 1 - Math.exp(-5 * dt);
  const trail = state.trail;

  for (const ally of state.allies) {
    if (!ally.known) continue;

    /*
     * Counted back from the newest point, like the rescue chain.
     *
     * This used to index from the far end of the buffer, which meant an ally
     * sat at whatever the oldest recorded point happened to be rather than a
     * fixed distance behind. Now that the trail is spaced by distance, the two
     * chains are measured the same way and an ally is simply further back.
     */
    const back = Math.min(trail.length - 1, 6 + ally.slot * 3);
    const target = trail[back] ?? state.player;

    ally.x += (target.x - ally.x) * spring;
    ally.y += (target.y - ally.y) * spring;
  }
}
