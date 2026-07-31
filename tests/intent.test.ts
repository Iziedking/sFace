/**
 * What a number key does, given where you are standing.
 *
 * Four inputs, three jobs, decided by context. That decision was inline in the
 * update loop, which made it untestable, and it was wrong for a whole stage
 * without anything catching it.
 *
 * On the ring city a gate counts as open for the entire band outside its wall,
 * which is most of the stage, and while it was open every number key answered
 * it. So somebody standing at a cage, reading PRESS 1 TO BLOW THE DOOR, pressed
 * 1 and answered the gate instead. The cage stayed shut and the wall recorded a
 * miss. The game named a key that something else had taken.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { slotIntent, CHARGE_SLOT } from '../src/game/intent';
import { BREACH_REACH } from '../src/game/cell';

const MISSION = practiceMission('2026-07-31');

function finale(): RunState {
  return new RunState(MISSION, 'sidearm', 7);
}

/** Put the player next to a caged face, close enough to breach it. */
function standAtCell(state: RunState): boolean {
  const caged = state.faces.find((f) => f.caged);
  if (!caged) return false;
  state.player.x = caged.x;
  state.player.y = caged.y;
  return true;
}

describe('with nothing in front of you', () => {
  it('buys', () => {
    const state = finale();
    for (const slot of [0, 1, 2, 3]) {
      expect(slotIntent(state, slot)).toBe('buy');
    }
  });
});

describe('at a story panel', () => {
  it('answers the panel with every key', () => {
    // You walked up to it and it is asking. Nothing else is competing.
    const state = new RunState(MISSION, 'sidearm', 6);
    state.openNodeId = 1;

    for (const slot of [0, 1, 2, 3]) {
      expect(slotIntent(state, slot)).toBe('answer-node');
    }
  });
});

describe('at a gate', () => {
  it('answers the gate with every key when no cell is in reach', () => {
    const state = finale();
    state.openGateId = state.gates[0]!.id;

    for (const slot of [0, 1, 2, 3]) {
      expect(slotIntent(state, slot)).toBe('answer-gate');
    }
  });

  it('gives the charge back to a cell you are standing at', () => {
    /*
     * The reported bug, as an assertion.
     *
     * A cell in reach is a couple of metres. A gate being open is a region the
     * size of a district. The precise one wins, or the prompt is a lie.
     */
    const state = finale();
    state.openGateId = state.gates[0]!.id;

    if (!standAtCell(state)) return;

    expect(slotIntent(state, CHARGE_SLOT)).toBe('buy');
  });

  it('still answers the gate with the other three keys at a cell', () => {
    // Only the charge is taken back. Answering a wall does not get harder for
    // having walked past a cage.
    const state = finale();
    state.openGateId = state.gates[0]!.id;

    if (!standAtCell(state)) return;

    for (const slot of [1, 2, 3]) {
      expect(slotIntent(state, slot)).toBe('answer-gate');
    }
  });

  it('goes back to the gate once you step away from the cell', () => {
    const state = finale();
    state.openGateId = state.gates[0]!.id;

    if (!standAtCell(state)) return;
    expect(slotIntent(state, CHARGE_SLOT)).toBe('buy');

    state.player.x += BREACH_REACH * 6;
    expect(slotIntent(state, CHARGE_SLOT)).toBe('answer-gate');
  });
});

describe('a panel outranks a gate', () => {
  it('answers the panel even with a gate open and a cell in reach', () => {
    // A panel is the most deliberate thing on screen: it only opens because you
    // went to it and it is waiting on an answer.
    const state = finale();
    state.openGateId = state.gates[0]!.id;
    state.openNodeId = 1;
    standAtCell(state);

    expect(slotIntent(state, CHARGE_SLOT)).toBe('answer-node');
  });
});
