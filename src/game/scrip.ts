/**
 * Scrip: the day's token, as the money you spend inside the run.
 *
 * The worst performer in the top 100 becomes the level. It should also become
 * the currency, because the thing that destroyed everybody's day is exactly the
 * thing you would be scavenging to survive it. On a PUMP day you collect PUMP.
 *
 * ## Why it is a second currency, when a second currency is usually a mistake
 *
 * Two currencies are only ever justified when they have two clearly different
 * jobs, and these do:
 *
 *   Face    permanent, earned across every run, unlocks weapons and rank.
 *   scrip   tactical, earned and spent inside one run, gone when it ends.
 *
 * Scrip expires with the day, exactly like the level does. That is not a
 * limitation, it is the point: nothing hoards, nothing compounds, and there is
 * no drift toward a player who has been grinding since launch being
 * structurally better equipped than one who started today. Tomorrow the ticker
 * changes and everybody is level again.
 *
 * ## The rule that cannot be broken
 *
 * Scrip is earned from seeded drops and NOTHING ELSE. It is never bought, never
 * granted, never carried in, never awarded from a profile. Two players on the
 * same seed find the same scrip in the same places, so a challenge stays a fair
 * bet between two people who had identical opportunities.
 *
 * The moment NIM can buy scrip, every challenge in this game becomes a lie and
 * this whole system has to come out. There is no partial version of that rule.
 */

import type { Rng } from '../core/rng';

/** Denomination shown in the HUD. Display only; the amount is what matters. */
export interface ScripPurse {
  /** The day's ticker, e.g. "PUMP". */
  ticker: string;
  /** Held right now, after everything spent. */
  held: number;
  /** Everything ever picked up this run. Shown on the results screen. */
  collected: number;
  /** Everything spent this run. collected - spent === held, always. */
  spent: number;
}

export function openPurse(ticker: string): ScripPurse {
  return { ticker, held: 0, collected: 0, spent: 0 };
}

/**
 * What a cleared attacker drops.
 *
 * Drawn from the LEVEL stream at construction rather than rolled when the
 * attacker dies, because a roll at death time is consumed in an order that
 * depends on which attacker the player happened to kill first. That is exactly
 * the divergence the two-stream rule exists to prevent: two players on one seed
 * would end the run with different money.
 *
 * So every attacker carries its drop from the moment the level is laid out. It
 * is a property of the level, not of the fight.
 */
export function rollDrop(rng: Rng, difficulty: number): number {
  /*
   * Halved from the first pass.
   *
   * Clearing all of stage one used to pay 624 against a shop whose dearest
   * item is 140, so a thorough player could buy everything and the choice the
   * shop exists to create never happened. Around 300 means two purchases, or
   * three if you take risks for the caches, and a fourth is never on the table.
   */
  const base = 3 + difficulty;
  return base + rng.int(0, 3);
}

/** What a cache is worth in scrip, on top of the Face it already carries. */
export function cacheScrip(rng: Rng, difficulty: number): number {
  const base = 11 + difficulty * 3;
  return base + rng.int(0, 6);
}

export function earn(purse: ScripPurse, amount: number): void {
  if (amount <= 0) return;
  purse.held += amount;
  purse.collected += amount;
}

/**
 * Try to spend. Returns false and changes nothing when it cannot be afforded.
 *
 * Callers must branch on the result rather than checking the balance first and
 * spending after: a check-then-act pair is two places for the price to be read,
 * and the second one is where an off-by-one buys something for free.
 */
export function spend(purse: ScripPurse, amount: number): boolean {
  if (amount <= 0) return false;
  if (purse.held < amount) return false;
  purse.held -= amount;
  purse.spent += amount;
  return true;
}
