/**
 * Spending scrip, mid-run.
 *
 * Lives in the simulation rather than in the UI because buying a bomb changes
 * the run: it kills things, it wakes things, it moves the score. A purchase
 * resolved in a click handler would be a second place the game state gets
 * written from, and the first time that diverges from `step()` nobody would
 * know which one was right.
 *
 * So the UI raises intent and this file is the only thing that acts on it,
 * exactly like PlayerCommand for flight.
 */

import {
  BOMB_RADIUS,
  OVERDRIVE_RATE,
  OVERDRIVE_RECOIL,
  OVERDRIVE_SECONDS,
  PATCH_FRACTION,
  consumableById,
  type ConsumableId,
} from '../data/consumables';
import { breach, cellInReach } from './cell';
import { damageEnemy } from './enemy';
import { spend } from './scrip';
import { PLAYER_MAX_HEALTH, type RunState } from './state';

export type BuyResult = 'bought' | 'broke' | 'closed' | 'nothing-to-open';

/**
 * Buy and use in one move.
 *
 * There is no inventory on purpose. Holding a bomb turns the decision into
 * "when do I use the thing I already own", which is a different and much
 * weaker decision than "is this worth the rescue tool I am giving up". Buying
 * IS using.
 */
export function buy(state: RunState, id: ConsumableId): BuyResult {
  if (state.finished || state.phase !== 'flying') return 'closed';

  const item = consumableById(id);

  /*
   * A charge with no cell in reach is refused BEFORE the scrip is taken.
   *
   * Every other item does something wherever it is used, so paying first is
   * fine. This one has a target, and charging someone for a charge that opened
   * nothing is the kind of small theft that makes a player stop trusting the
   * shop. Checked here rather than inside the switch so the money is never
   * touched on the failing path.
   */
  if (id === 'charge' && !cellInReach(state)) return 'nothing-to-open';

  // spend() is the only balance check. Reading the balance here and spending
  // below would be two places for the price to be read, and the second one is
  // where an off-by-one buys something for nothing.
  if (!spend(state.purse, item.cost)) return 'broke';

  switch (id) {
    case 'charge':
      breach(state);
      break;
    case 'bomb':
      detonate(state);
      break;
    case 'patch':
      patch(state);
      break;
    case 'overdrive':
      state.overdriveUntil = state.time + OVERDRIVE_SECONDS;
      state.emit({ kind: 'refill', x: state.player.x, y: state.player.y, text: 'Overdrive' });
      break;
  }

  return 'bought';
}

/**
 * Clear the crowd, then pay for it.
 *
 * The cost is not just scrip: everything within a wide band ahead is woken, so
 * the stretch after the blast arrives already moving instead of switching on as
 * you reach it. A bomb buys the fight you are in by starting the next one.
 */
function detonate(state: RunState): void {
  const { x, y } = state.player;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.x - x;
    const dy = enemy.y - y;
    if (Math.hypot(dx, dy) > BOMB_RADIUS) continue;
    // Routed through damageEnemy rather than setting alive = false, so the
    // kill is scored, the drop is paid and the event is emitted exactly as it
    // would be for a bullet. One death path, not two.
    damageEnemy(state, enemy, 9999);
  }

  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.active) continue;
    if (enemy.x > x && enemy.x < x + BOMB_RADIUS * 2.4) enemy.active = true;
  }

  state.emit({ kind: 'relic', x, y, text: 'Bomb' });
}

function patch(state: RunState): void {
  const player = state.player;
  const before = player.health;
  player.health = Math.min(PLAYER_MAX_HEALTH, player.health + PLAYER_MAX_HEALTH * PATCH_FRACTION);

  state.emit({
    kind: 'refill',
    x: player.x,
    y: player.y,
    text: `+${Math.round(player.health - before)} hull`,
  });
}

/** Fire-rate multiplier in force right now. 1 when overdrive is not running. */
export function fireRateScale(state: RunState): number {
  return state.time < state.overdriveUntil ? OVERDRIVE_RATE : 1;
}

/** Recoil multiplier, which scales with the rate so the trade stays honest. */
export function recoilScale(state: RunState): number {
  return state.time < state.overdriveUntil ? OVERDRIVE_RECOIL : 1;
}
