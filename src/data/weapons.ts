/**
 * Guns, and the one rule that decides what they are allowed to be.
 *
 * ## Face, never NIM
 *
 * A weapon you can buy makes a NIM challenge unfair, and the challenge is the
 * part of this game that touches somebody's money. So nothing here is for sale.
 * Every one of these is unlocked with lifetime Face, which is to say by playing,
 * and the only thing money can do in sFace is back your own run against someone
 * else's.
 *
 * ## Sidegrades, not upgrades
 *
 * This is the harder half of the rule, and it is the reason the numbers below
 * look the way they do. Two players on the same seed have to be playing the
 * same game or the bet is a lie, so a tier four pilot cannot be allowed to
 * bring more damage than a tier one. What they bring instead is a different
 * shape:
 *
 *   Sidearm     Reach and balance. Nothing to complain about, which is exactly
 *               what a default should be.
 *   Scattergun  Wrecks anything close and cannot touch anything far away.
 *   Lance       Two enemies on a line die together. Miss and you wait.
 *   Stream      Highest sustained output and the least punch per round, so it
 *               rewards holding a target rather than picking one.
 *
 * Sustained damage lands between eighty and a hundred and ten for all four, and
 * every one of them buys its advantage with a matching cost. Unlocking one is
 * a new way to fly, never a stronger one. If a future edit makes one of these
 * strictly better than the sidearm, the daily challenge stops being a fair bet
 * and the whole feature has to come out.
 *
 * The thresholds line up with the rank ladder in story.ts on purpose. Rank is
 * still a record rather than a power; it is simply also the thing that decides
 * when a new shape shows up in the rack.
 */

export type WeaponId = 'sidearm' | 'scatter' | 'lance' | 'stream';

export interface Weapon {
  id: WeaponId;
  name: string;
  /** What it is good at. */
  blurb: string;
  /** What it gives up. Stated out loud, because a cost you cannot see is a trap. */
  cost: string;
  /** Lifetime Face needed. Zero for the one everybody starts with. */
  unlockAt: number;

  /** Seconds between pulls. */
  interval: number;
  /** Damage per round, not per pull. */
  damage: number;
  speed: number;
  /** Seconds a round lives. Range is this times speed. */
  life: number;
  /** Rounds per pull. */
  pellets: number;
  /** Half-angle of the fan, in radians. Zero for a single round. */
  spread: number;
  /** Extra enemies a round passes through before it stops. */
  pierce: number;
  /** Backwards kick per pull. Part of the feel and part of the cost. */
  recoil: number;
}

export const WEAPONS: readonly Weapon[] = [
  {
    id: 'sidearm',
    name: 'Sidearm',
    blurb: 'Even handed, and it reaches further than anything else here.',
    cost: 'Best at nothing in particular.',
    unlockAt: 0,
    interval: 0.125,
    damage: 12,
    speed: 760,
    life: 1.1,
    pellets: 1,
    spread: 0,
    pierce: 0,
    recoil: 26,
  },
  {
    id: 'scatter',
    name: 'Scattergun',
    blurb: 'Three pellets. Clears a diver off you in one pull.',
    cost: 'A third of the reach. Useless across a valley.',
    unlockAt: 5_000,
    interval: 0.26,
    damage: 9,
    speed: 620,
    life: 0.42,
    pellets: 3,
    spread: 0.16,
    pierce: 0,
    recoil: 34,
  },
  {
    id: 'lance',
    name: 'Lance',
    blurb: 'One heavy round that goes through two. Reaches the far ridge.',
    cost: 'Slow, and it shoves you backwards every time.',
    unlockAt: 20_000,
    interval: 0.42,
    damage: 34,
    speed: 1_000,
    life: 1.5,
    pellets: 1,
    spread: 0,
    pierce: 1,
    recoil: 62,
  },
  {
    id: 'stream',
    name: 'Stream',
    blurb: 'Never stops. Barely any kick, so your aim stays where you put it.',
    cost: 'Five damage a round. You have to stay on target.',
    unlockAt: 50_000,
    interval: 0.055,
    damage: 5,
    speed: 640,
    life: 0.75,
    pellets: 1,
    spread: 0,
    pierce: 0,
    recoil: 6,
  },
];

export const DEFAULT_WEAPON: WeaponId = 'sidearm';

export function weaponById(id: WeaponId | string | null | undefined): Weapon {
  return WEAPONS.find((w) => w.id === id) ?? (WEAPONS[0] as Weapon);
}

export function isUnlocked(weapon: Weapon, lifetimeFace: number): boolean {
  return Math.max(0, lifetimeFace) >= weapon.unlockAt;
}

/** Everything a pilot may currently fly with, in rack order. */
export function unlockedWeapons(lifetimeFace: number): Weapon[] {
  return WEAPONS.filter((w) => isUnlocked(w, lifetimeFace));
}

/** Effective range in world units, for the picker. */
export function reachOf(weapon: Weapon): number {
  return Math.round(weapon.speed * weapon.life);
}

/** Damage a second with every round landing. Shown so the trade is checkable. */
export function sustainedDamage(weapon: Weapon): number {
  return Math.round((weapon.damage * weapon.pellets) / weapon.interval);
}

/**
 * The next thing to unlock, and how far away it is. Null once the rack is full.
 *
 * This exists so the picker can end on something to aim at rather than on an
 * empty row, which is the difference between a locked item reading as a target
 * and reading as a wall.
 */
export function nextUnlock(lifetimeFace: number): { weapon: Weapon; remaining: number } | null {
  const face = Math.max(0, lifetimeFace);
  const locked = WEAPONS.filter((w) => w.unlockAt > face).sort((a, b) => a.unlockAt - b.unlockAt);
  const weapon = locked[0];
  return weapon ? { weapon, remaining: weapon.unlockAt - face } : null;
}
