import { describe, expect, it } from 'vitest';

import { ATLAS_FIRST_SEASON_ALLOCATION_LUNA, ATLAS_LANTERN_PRICE_LUNA, ATLAS_LUNAS_PER_NIM } from '../shared/atlas/economy';
import { LAST_LANTERN } from '../shared/atlas/adventures/last-lantern';
import { ATLAS_LAUNCH_ALLOCATION } from '../shared/atlas/rewards';

describe('NIM Atlas economy contract', () => {
  it('uses the agreed 0.1 NIM payment in integer Lunas', () => {
    expect(ATLAS_LUNAS_PER_NIM).toBe(100_000);
    expect(ATLAS_LANTERN_PRICE_LUNA).toBe(10_000);
    expect(LAST_LANTERN.priceLuna).toBe(10_000);
  });

  it('keeps the approved first season allocation exact', () => {
    expect(ATLAS_FIRST_SEASON_ALLOCATION_LUNA).toBe(5_000_000_000);
    expect(ATLAS_LAUNCH_ALLOCATION.totalLuna).toBe(ATLAS_FIRST_SEASON_ALLOCATION_LUNA);
  });
});
