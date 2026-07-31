/**
 * What a number key means, given where you are standing.
 *
 * Four inputs, three jobs. The same 1 to 4 buy a consumable, answer a story
 * panel, or answer a gate, and which one it is depends entirely on what is in
 * front of the player. That decision used to live inline in the update loop,
 * which made it untestable and let it be wrong for a whole stage without
 * anything noticing.
 *
 * ## The bug this was extracted for
 *
 * On the ring city a gate counts as open for the entire band outside its wall,
 * which is most of the stage. While it is open every number key answered it. So
 * a player standing at a cage, reading a prompt that says PRESS 1 TO BLOW THE
 * DOOR, pressed 1 and answered the gate instead. Wrongly, since they were not
 * thinking about the gate. The cage stayed shut and the wall recorded a miss.
 *
 * The game told somebody to press a key that something else had taken.
 *
 * ## The rule
 *
 * A panel you have opened wins outright: you walked up to it and it is asking.
 *
 * A cell you are standing next to beats a gate you are merely near, but only
 * for the charge, which is the one key that opens a cell. Being in reach of a
 * cell is a precise thing, a couple of metres. Being at a gate is a region the
 * size of a district. The precise one wins, and the other three keys still
 * answer the wall, so nothing about answering a gate gets harder.
 */

import type { RunState } from './state';
import { cellInReach } from './cell';

/** The charge is the first consumable and the only one that opens a cell. */
export const CHARGE_SLOT = 0;

export type SlotIntent = 'answer-node' | 'answer-gate' | 'buy';

export function slotIntent(state: RunState, slot: number): SlotIntent {
  if (state.openNodeId !== null) return 'answer-node';

  if (state.openGateId !== null) {
    // The one exception. See the note at the top.
    if (slot === CHARGE_SLOT && cellInReach(state)) return 'buy';
    return 'answer-gate';
  }

  return 'buy';
}
