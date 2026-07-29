/**
 * What the day's scrip buys, mid-run.
 *
 * ## The rule, before the numbers
 *
 * If a future edit ever makes one of these strictly better than not buying it,
 * the daily challenge stops being a fair bet and this whole feature has to come
 * out. Same rule as weapons.ts, and for the same reason: two people stake NIM
 * on one seed, so every advantage has to be a trade rather than an upgrade.
 *
 * Every item below therefore costs something beyond scrip:
 *
 *   Bomb       clears a crowd, and the noise wakes the next stretch early.
 *   Hull patch buys back health with money that could have bought a way in.
 *   Overdrive  fires faster, and the recoil scales with it, so it moves you.
 *
 * The scrip itself is the shared cost: every purchase is a rescue tool not
 * bought. That is the actual decision the player is making, and it is why the
 * prices sit close together rather than in tiers.
 *
 * ## No menu
 *
 * A run is 110 seconds. A shop you open, browse and close would eat a tenth of
 * it and break the pace of the only thing the game is about. So buying is one
 * keypress or one tap, resolved instantly, with the price on the HUD. If you
 * cannot afford it the press does nothing and says so.
 */

export type ConsumableId = 'charge' | 'bomb' | 'patch' | 'overdrive';

export interface Consumable {
  id: ConsumableId;
  /** Shown on the HUD slot. Short enough to read at speed. */
  label: string;
  /** Scrip. Tuned against a full run's take, not against each other. */
  cost: number;
  /** The trade, in one line, for the how-to-play screen. */
  tradeoff: string;
}

/**
 * Costs are set against what a whole run actually pays out.
 *
 * A complete stage-one run collects roughly 300 to 450 scrip. These are priced
 * so a careful player affords two or three across a run and never all of them,
 * which is what keeps the choice live instead of a checklist.
 */
export const CONSUMABLES: Consumable[] = [
  {
    // First slot, because it is the only one that opens something that is
    // otherwise shut. On a caged day it is not optional, and it should be the
    // first thing the eye lands on.
    id: 'charge',
    label: 'CHARGE',
    cost: 90,
    tradeoff: 'Takes a cell door off. Has to be set standing next to it.',
  },
  {
    id: 'bomb',
    label: 'BOMB',
    cost: 120,
    tradeoff: 'Clears everything near you. The noise wakes the next stretch early.',
  },
  {
    id: 'patch',
    label: 'PATCH',
    cost: 100,
    tradeoff: 'Buys back hull with scrip that could have bought a way through.',
  },
  {
    id: 'overdrive',
    label: 'BOOST',
    cost: 140,
    tradeoff: 'Fires much faster for eight seconds. Recoil scales with it.',
  },
];

export function consumableById(id: ConsumableId): Consumable {
  const found = CONSUMABLES.find((c) => c.id === id);
  // The list is a module constant and the ids are a union, so this cannot
  // happen. Throwing beats returning a silent default that costs nothing.
  if (!found) throw new Error(`Unknown consumable: ${id}`);
  return found;
}

/** Radius a bomb clears, in world units. Generous, because it is expensive. */
export const BOMB_RADIUS = 420;
/** Hull restored by a patch, as a fraction of maximum. */
export const PATCH_FRACTION = 0.45;
/** How long overdrive lasts, and how much it multiplies the fire rate. */
export const OVERDRIVE_SECONDS = 8;
export const OVERDRIVE_RATE = 2.2;
/** Recoil scales with the rate, so a faster gun genuinely pushes you harder. */
export const OVERDRIVE_RECOIL = 1.6;
