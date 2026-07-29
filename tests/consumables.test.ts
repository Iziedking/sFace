/**
 * Consumables are the one system that can quietly turn a fair bet into a rigged
 * one, so the tests here are about the trades rather than the effects.
 *
 * Two people stake NIM on the same seed. That only means anything if neither
 * of them can buy an advantage the other could not, and if every purchase costs
 * something real. These pin both.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState, PLAYER_MAX_HEALTH } from '../src/game/state';
import { buy, fireRateScale, recoilScale } from '../src/game/consume';
import { CONSUMABLES, OVERDRIVE_RATE, OVERDRIVE_RECOIL } from '../src/data/consumables';
import { earn } from '../src/game/scrip';
import { breach, cellInReach, isCaged, lockUp } from '../src/game/cell';
import { Rng } from '../src/core/rng';

/**
 * Park the player on top of a cell, so a charge has something to open.
 *
 * The charge is the one item with a target, so any test that treats the four
 * items uniformly has to give it one or it is testing the targeting rather
 * than the thing it meant to test.
 */
function withCellInReach(state: RunState): RunState {
  const face = state.faces[0]!;
  face.caged = true;
  state.player.x = face.x;
  state.player.y = face.y;
  return state;
}

function run(): RunState {
  return new RunState(practiceMission('2026-07-29'), 'sidearm', 1);
}

describe('nothing is free', () => {
  it('refuses every purchase on an empty purse', () => {
    for (const item of CONSUMABLES) {
      const state = withCellInReach(run());
      expect(buy(state, item.id)).toBe('broke');
      expect(state.purse.spent).toBe(0);
    }
  });

  it('takes exactly the listed price, once', () => {
    for (const item of CONSUMABLES) {
      const state = withCellInReach(run());
      earn(state.purse, item.cost);
      expect(buy(state, item.id)).toBe('bought');

      // Exactly the listed price leaves the purse. Held is NOT asserted at
      // zero, because a bomb pays the drops of everything it clears straight
      // back in, so it partly funds itself exactly as shooting them would.
      expect(state.purse.spent).toBe(item.cost);
      expect(state.purse.collected - state.purse.spent).toBe(state.purse.held);
      // And cannot be bought again on the change. A charge that just opened
      // the only cell in reach reports the missing target rather than the
      // missing money, which is the more useful of the two truths.
      expect(buy(state, item.id)).toBe(item.id === 'charge' ? 'nothing-to-open' : 'broke');
    }
  });
});

describe('overdrive is a trade, not an upgrade', () => {
  it('raises recoil by the same kind of factor as the fire rate', () => {
    const state = run();
    expect(fireRateScale(state)).toBe(1);
    expect(recoilScale(state)).toBe(1);

    earn(state.purse, 1000);
    expect(buy(state, 'overdrive')).toBe('bought');

    expect(fireRateScale(state)).toBe(OVERDRIVE_RATE);
    expect(recoilScale(state)).toBe(OVERDRIVE_RECOIL);
    // A faster gun that did not push harder would be strictly better than not
    // buying it, which is the exact thing this system is not allowed to be.
    expect(recoilScale(state)).toBeGreaterThan(1);
  });

  it('wears off', () => {
    const state = run();
    earn(state.purse, 1000);
    buy(state, 'overdrive');

    state.time = state.overdriveUntil + 0.01;
    expect(fireRateScale(state)).toBe(1);
    expect(recoilScale(state)).toBe(1);
  });
});

describe('a bomb pays out like any other kill', () => {
  it('scores the attackers it clears and pays their drops', () => {
    const state = run();
    // Put the player on top of the crowd so the blast has something to do.
    const target = state.enemies[0];
    expect(target).toBeDefined();
    state.player.x = target!.x;
    state.player.y = target!.y;

    earn(state.purse, 1000);
    const before = state.attackersCleared;
    const heldBefore = state.purse.held;

    expect(buy(state, 'bomb')).toBe('bought');

    expect(state.attackersCleared).toBeGreaterThan(before);
    // The drops it paid must land in the purse, so a bomb partly funds itself
    // exactly as shooting the same attackers would have.
    expect(state.purse.collected).toBeGreaterThan(heldBefore);
  });
});

describe('a patch cannot overfill the hull', () => {
  it('clamps at maximum', () => {
    const state = run();
    earn(state.purse, 1000);
    state.player.health = PLAYER_MAX_HEALTH - 1;

    expect(buy(state, 'patch')).toBe('bought');
    expect(state.player.health).toBe(PLAYER_MAX_HEALTH);
  });
});

describe('the shop is shut when the run is', () => {
  it('refuses after the run has finished', () => {
    const state = run();
    earn(state.purse, 1000);
    state.phase = 'died';

    expect(buy(state, 'bomb')).toBe('closed');
    expect(state.purse.spent).toBe(0);
  });
});


/**
 * Cells are the reason a rescue stops being a firefight, so the tests here are
 * about the two things that would quietly ruin that: being able to skip the
 * door, and being charged for a charge that opened nothing.
 */
describe('cells cannot be skipped', () => {
  it('locks nobody up on stage one', () => {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 1);
    expect(state.faces.some(isCaged)).toBe(false);
  });

  it('locks people up later, and never everybody', () => {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 7);
    const caged = state.faces.filter(isCaged).length;

    expect(caged).toBeGreaterThan(0);
    // At least one has to be reachable without spending, or a run can open
    // behind a wall of scrip the player has not earned yet.
    expect(caged).toBeLessThan(state.faces.length);
  });

  it('puts the same people behind doors on one seed', () => {
    const a = new RunState(practiceMission('2026-07-29'), 'sidearm', 5);
    const b = new RunState(practiceMission('2026-07-29'), 'sidearm', 5);

    expect(a.faces.map((f) => f.caged)).toEqual(b.faces.map((f) => f.caged));
  });

  it('draws a fixed number of times whoever it locks up', () => {
    // The shuffle must consume the same number of draws regardless of how it
    // lands, or every later draw shifts and the rest of the level changes.
    const faces = () =>
      Array.from({ length: 5 }, (_, i) => ({ caged: false, id: i })) as never[];

    const one = new Rng('same-seed');
    const two = new Rng('same-seed');
    lockUp(one, faces(), 4);
    lockUp(two, faces(), 4);

    expect(one.next()).toBe(two.next());
  });
});

describe('a charge is never taken for nothing', () => {
  it('refuses and keeps the money when no cell is in reach', () => {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 6);
    // Park somewhere with no cell nearby.
    state.player.x = -10_000;
    state.player.y = -10_000;
    earn(state.purse, 1000);

    expect(buy(state, 'charge')).toBe('nothing-to-open');
    expect(state.purse.spent).toBe(0);
    expect(state.purse.held).toBe(1000);
  });

  it('takes the door off, which does not by itself rescue anyone', () => {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 6);
    const face = state.faces.find(isCaged);
    expect(face).toBeDefined();

    state.player.x = face!.x;
    state.player.y = face!.y;
    expect(cellInReach(state)).toBe(face);

    earn(state.purse, 1000);
    expect(buy(state, 'charge')).toBe('bought');

    expect(face!.caged).toBe(false);
    // Still trapped: the charge is a way in, not a remote rescue button.
    expect(face!.state).toBe('trapped');
    expect(state.cellsOpened).toBe(1);
  });

  it('opens the nearest cell when two are close', () => {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 7);
    const caged = state.faces.filter(isCaged);
    expect(caged.length).toBeGreaterThan(1);

    const near = caged[0]!;
    const far = caged[1]!;
    near.x = 500;
    near.y = 500;
    far.x = 540;
    far.y = 500;
    state.player.x = 500;
    state.player.y = 500;

    expect(breach(state)).toBe(near);
    expect(near.caged).toBe(false);
    expect(far.caged).toBe(true);
  });
});
