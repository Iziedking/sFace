/**
 * Which gun the pilot picked, remembered between sessions.
 *
 * The choice is stored raw and resolved against lifetime Face at the moment a
 * run starts, rather than being clamped on the way in. That ordering matters
 * more than it looks:
 *
 * The record arrives from the service a moment after boot, so at the instant
 * this file is first read the pilot's lifetime Face is whatever the local
 * mirror says, which on a cold start is nothing. Clamping and writing back
 * there would quietly overwrite a legitimate choice with the sidearm and the
 * pilot would find their rack reset for no reason they could see. Storing the
 * intent and checking it later costs one function call and cannot do that.
 *
 * Resolution still refuses anything unearned, so nothing is trusted here. It is
 * simply refused at the point the answer is actually known.
 */

import {
  DEFAULT_WEAPON,
  isUnlocked,
  weaponById,
  type Weapon,
  type WeaponId,
} from '../data/weapons';

const STORAGE_KEY = 'sface.weapon';

let chosen: WeaponId | null = null;

/** What the pilot last picked, earned or not. */
export function chosenWeapon(): WeaponId {
  if (chosen) return chosen;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    chosen = raw ? weaponById(raw).id : DEFAULT_WEAPON;
  } catch {
    // Private mode, or no storage at all. The pick lasts the session.
    chosen = DEFAULT_WEAPON;
  }
  return chosen;
}

export function chooseWeapon(id: WeaponId): void {
  chosen = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Held in memory for this session, which is the same outcome until the
    // browser is closed.
  }
}

/** The gun a run actually gets, with anything unearned refused. */
export function resolveWeapon(lifetimeFace: number): Weapon {
  const weapon = weaponById(chosenWeapon());
  return isUnlocked(weapon, lifetimeFace) ? weapon : weaponById(DEFAULT_WEAPON);
}
