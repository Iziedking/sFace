/**
 * What a run actually pays, against what the shop actually costs.
 *
 * Not a rule so much as a tripwire. Prices were tuned by hand against an
 * estimate of a run's take, and an estimate is exactly the kind of thing that
 * silently stops being true when enemy density or cache counts move. If a
 * stage ever stops paying for a single purchase, the shop becomes decoration
 * and the player has a HUD full of things they can never buy.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { isCaged } from '../src/game/cell';
import { CONSUMABLES } from '../src/data/consumables';

const CHEAPEST = Math.min(...CONSUMABLES.map((c) => c.cost));

describe('a run can afford the shop it is shown', () => {
  it('reports the take per stage', () => {
    const rows: string[] = [];

    for (let stage = 1; stage <= 7; stage++) {
      const run = new RunState(practiceMission('2026-07-29'), 'sidearm', stage);
      const fromKills = run.enemies.reduce((a, e) => a + e.drop, 0);
      const fromCaches = run.caches.reduce((a, c) => a + c.scrip, 0);
      const total = fromKills + fromCaches;

      rows.push(
        `stage ${stage}: ${run.enemies.length} enemies=${fromKills} + ${run.caches.length} caches=${fromCaches} => ${total} (caged ${run.faces.filter(isCaged).length})`,
      );

      // Clearing everything must comfortably cover more than one purchase, or
      // the choice the shop is supposed to create never actually happens.
      expect(total).toBeGreaterThan(CHEAPEST * 2);
    }

    console.log(rows.join('\n'));
    console.log('prices:', CONSUMABLES.map((c) => `${c.label} ${c.cost}`).join(', '));
  });
});
