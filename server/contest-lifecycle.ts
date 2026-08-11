import * as contestRules from '../src/data/contests';
import * as contests from './contests';
import type { NetworkId } from './network';
import * as profiles from './profiles';

/** Expire contest clocks and persist any resulting settlement debt. */
export function sweepContests(network: NetworkId, now = Date.now()): void {
  for (const contest of contests.expireDue(now)) {
    for (const owed of contestRules.obligationsOf(contest)) {
      const who = contest.entrants.find((entrant) => entrant.id === owed.fromId);
      profiles.recordDebt(owed.fromId, who?.name ?? 'Pilot', network);
    }
  }
}
