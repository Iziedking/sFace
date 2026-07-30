/**
 * Stage seven: the projects that outlasted everything, and the doors they open.
 *
 * ## What the last stage is for
 *
 * Every stage before this one is a rescue from a single bad day. This one is the
 * reason the rescues mattered. The season did not end on its own, and getting it
 * back means crossing the whole wreck with the only things that never went away:
 * the projects still standing at the top after every cycle that buried something
 * else.
 *
 * So the run is a march rather than a lap. It is the longest stage in the game
 * and it is sealed into regions, and you do not get through a seal by shooting
 * it. You get through it by having found whoever knows the way.
 *
 * ## The loop
 *
 * Each region holds one ally and ends in a seal.
 *
 *   1. Find the ally. They are a real project, named and ranked off the same
 *      market call that picks the day's wreck.
 *   2. Reach them and they join. From then on they follow you and shoot back.
 *   3. Their read on the day is what opens the seal at the end of the region.
 *
 * Miss one and the seal ahead does not move, so the stage is not survivable by
 * rushing. It has to be walked.
 *
 * ## Where the names come from, and what they are allowed to say
 *
 * The allies are the top projects by market cap on the day you play, taken from
 * the market rows the mission already carries. Not a hand-picked list of what
 * anybody thinks deserves to be there, and never a model's opinion.
 *
 * What each one contributes is equally constrained: its rank and its own 24 hour
 * move, both real numbers from that same source. On a day the wreck is down
 * sixteen per cent and the largest project is up two, the game is showing you a
 * true thing about the market rather than a line somebody wrote.
 *
 * ## Determinism
 *
 * Positions and pairings come from the level stream at construction. Two players
 * on one seed meet the same allies in the same places behind the same seals.
 */

import type { Rng } from '../core/rng';
import type { Survivor } from './mission';
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
  recruited: boolean;
  /** Run time it joined, so the renderer can play the moment. */
  joinedAt: number;
  /** Position in the follow chain once recruited. */
  slot: number;
}

export interface Seal {
  id: number;
  /** Where it stands across the level. */
  x: number;
  /** How many allies must be with you to pass. */
  needs: number;
  open: boolean;
}

/** How close you have to get for a project to join you. */
export const ALLY_REACH = 46;

/** How far a closed seal pushes you back. Wide enough that you cannot clip it. */
export const SEAL_HALF_WIDTH = 26;

/**
 * A fallback cast for the days the market call gave us nothing.
 *
 * Deliberately generic. Putting invented tickers here would be inventing
 * projects, and putting a hardcoded list of real ones would be asserting that
 * these are the projects that lasted, which is the judgement the live data is
 * there to make. On a fallback day the stage is played against unnamed holdouts
 * rather than against a claim nobody checked.
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
   * Spread across the run rather than clustered.
   *
   * Each one sits in its own region, a little before the seal it opens, so the
   * order you meet them in is the order the seals need them. Jittered inside
   * that band so the stage does not read as a row of pickups on a grid.
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
      // Above the chart, where a rescue can reach without touching the ground.
      y: groundAt(x) - rng.range(120, 260),
      recruited: false,
      joinedAt: -1,
      slot: 0,
    });
  }

  return allies;
}

/**
 * One seal after each ally, and none before the first.
 *
 * A seal at the very start would refuse a player who has had no chance to meet
 * anybody, which reads as the stage being broken rather than as being locked.
 */
export function layOutSeals(allies: Ally[], extractionX: number, nextId: () => number): Seal[] {
  return allies.map((ally, index) => ({
    id: nextId(),
    // Between this ally and the next, so it is passed with them in tow.
    x: Math.round(Math.min(extractionX - 200, ally.x + (extractionX / (allies.length + 1)) * 0.55)),
    needs: index + 1,
    open: false,
  }));
}

/** How many allies are currently with the player. */
export function recruited(allies: Ally[]): number {
  return allies.filter((a) => a.recruited).length;
}

/**
 * The first seal ahead of this x that will not let the player through.
 *
 * Returns null when the way is clear. Only seals AHEAD count: one already
 * crossed must never spring shut behind somebody, which would strand them in a
 * region with nothing to collect.
 */
export function blockingSeal(seals: Seal[], allies: Ally[], x: number): Seal | null {
  const have = recruited(allies);

  for (const seal of seals) {
    if (seal.open) continue;
    if (have >= seal.needs) {
      seal.open = true;
      continue;
    }
    if (seal.x >= x) return seal;
  }

  return null;
}

/**
 * How far right the player may travel, given what they are carrying.
 *
 * Positive infinity when nothing blocks them. Expressed as a limit rather than
 * as a collision so the caller can clamp movement smoothly, which reads as
 * pressing against something rather than as being snagged on it.
 */
export function reachableX(seals: Seal[], allies: Ally[], x: number): number {
  const seal = blockingSeal(seals, allies, x);
  return seal === null ? Number.POSITIVE_INFINITY : seal.x - SEAL_HALF_WIDTH;
}

/**
 * Recruited projects trail the ship, the way freed people do.
 *
 * Reuses the player's own position trail rather than pathfinding: the chain is
 * already there for the rescue cast, it reads correctly at speed, and one
 * follow behaviour means the two never drift apart in feel.
 *
 * They sit further back than a rescued person. The cast is who you are saving
 * and belongs close; these are who is coming with you, and the gap is what
 * separates the two at a glance.
 */
export function followAllies(state: RunState, dt: number): void {
  if (state.allies.length === 0) return;

  const spring = 1 - Math.exp(-5 * dt);
  const trail = state.trail;

  for (const ally of state.allies) {
    if (!ally.recruited) continue;

    // Deeper into the trail for each one, so they string out in join order.
    const back = Math.min(trail.length - 1, 12 + ally.slot * 9);
    const target = trail[trail.length - 1 - back] ?? state.player;

    ally.x += (target.x - ally.x) * spring;
    ally.y += (target.y - ally.y) * spring;
  }
}
