import { describe, expect, it } from 'vitest';

import { closeAtlasDailyPool, type AtlasTrackRewardAllocation } from '../shared/atlas/rewards';
import { createAtlasRewardLedger } from '../server/atlas/rewards';

describe('NIM Atlas append-only reward ledger', () => {
  it('keeps daily obligations, dust, and empty-day funds distinct from payment', () => {
    const ledger = createAtlasRewardLedger();
    ledger.appendDailyClose('2026-08-25', closeAtlasDailyPool(3));
    ledger.appendDailyClose('2026-08-26', closeAtlasDailyPool(0));

    expect(ledger.summary()).toEqual({
      dailyObligationsLuna: 79_999_998,
      rolloverToFinaleLuna: 80_000_002,
      weeklyObligationsLuna: 0,
      finaleObligationsLuna: 0,
      paidLuna: 0,
    });
    expect(ledger.entries().map((entry) => entry.kind)).toEqual(['daily-close', 'daily-close']);
  });

  it('aggregates weekly obligations without claiming they were paid', () => {
    const ledger = createAtlasRewardLedger();
    const allocation: AtlasTrackRewardAllocation = {
      period: 'week-1',
      role: 'explorer',
      poolLuna: 600_000_000,
      rewards: [{ rank: 1, actorId: 'local-actor', walletAddress: 'NQLOCAL', amountLuna: 300_000_000 }],
      obligationsLuna: 300_000_000,
      remainderLuna: 300_000_000,
    };
    ledger.appendTrackAllocation(allocation);

    expect(ledger.summary()).toEqual({
      dailyObligationsLuna: 0,
      rolloverToFinaleLuna: 300_000_000,
      weeklyObligationsLuna: 300_000_000,
      finaleObligationsLuna: 0,
      paidLuna: 0,
    });
    expect(ledger.entries()[0]).toMatchObject({ kind: 'track-allocation', status: 'pending-close', period: 'week-1' });
  });
});
