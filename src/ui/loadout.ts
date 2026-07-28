/**
 * The rack.
 *
 * One screen, four rows, and every number on them stated out loud. A picker
 * that hides its numbers turns a choice into a guess, and the whole point of
 * these four guns is that the trade is legible: you can read that a scattergun
 * hits harder and reaches a third as far, and decide.
 *
 * Locked rows are shown, not hidden. A rack with two empty slots in it is a
 * reason to fly again; a rack that only ever shows what you already have is a
 * screen that never changes.
 */

import { button, el, mount } from './dom';
import {
  WEAPONS,
  isUnlocked,
  reachOf,
  sustainedDamage,
  type Weapon,
  type WeaponId,
} from '../data/weapons';

export interface LoadoutOptions {
  /** Drives which rows are unlocked. */
  lifetimeFace: number;
  /** What is currently equipped. */
  selected: WeaponId;
  onSelect: (id: WeaponId) => void;
  onBack: () => void;
}

export function renderLoadout(root: HTMLElement, options: LoadoutOptions): void {
  const face = Math.max(0, options.lifetimeFace);

  mount(
    root,
    el(
      'div',
      { class: 'screen' },
      el('p', { class: 'eyebrow', text: 'THE RACK' }),
      el('h1', { text: 'Loadout' }),
      el('p', {
        class: 'quiet',
        // The rule, on the screen where somebody would otherwise assume the
        // opposite. A player who thinks the top gun is the strong one will
        // read a locked row as being kept from them.
        text: 'Unlocked with Face, never bought. None of these is stronger than the sidearm, they are different shapes, so a challenge is still a fair bet whatever either side brings.',
      }),

      el('div', { class: 'rack' }, ...WEAPONS.map((w) => rackRow(w, face, options))),

      el('div', { class: 'actions' }, button('Done', options.onBack, 'ghost')),
    ),
  );
}

function rackRow(weapon: Weapon, face: number, options: LoadoutOptions): HTMLElement {
  const unlocked = isUnlocked(weapon, face);
  const equipped = unlocked && weapon.id === options.selected;

  const classes = ['rack__row'];
  if (!unlocked) classes.push('rack__row--locked');
  if (equipped) classes.push('rack__row--on');

  const node = el(
    'div',
    { class: classes.join(' ') },
    el(
      'div',
      { class: 'rack__head' },
      el('span', { class: 'rack__name', text: weapon.name }),
      el('span', {
        class: 'rack__state',
        text: equipped ? 'EQUIPPED' : unlocked ? '' : `${weapon.unlockAt.toLocaleString()} FACE`,
      }),
    ),

    el('p', { class: 'rack__blurb', text: weapon.blurb }),
    el('p', { class: 'rack__cost', text: weapon.cost }),

    el(
      'div',
      { class: 'rack__numbers' },
      figure('DAMAGE/S', String(sustainedDamage(weapon))),
      figure('REACH', String(reachOf(weapon))),
      figure('ROUNDS', weapon.pellets > 1 ? `${weapon.pellets} × ${weapon.damage}` : String(weapon.damage)),
      figure('KICK', String(weapon.recoil)),
    ),

    unlocked && !equipped
      ? button('Equip', () => options.onSelect(weapon.id), 'ghost')
      : null,

    !unlocked
      ? el('p', {
          class: 'rack__locked',
          text: `${(weapon.unlockAt - face).toLocaleString()} more Face to open this.`,
        })
      : null,
  );

  return node;
}

function figure(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'rack__figure' },
    el('span', { class: 'stat__label', text: label }),
    el('span', { class: 'rack__value', text: value }),
  );
}
