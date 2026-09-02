import { describe, expect, it } from 'vitest';

import { createAtlasBeaconRepository, createAtlasBeaconService, type AtlasBeaconContribution } from '../server/atlas/beacon';

const contribution = (overrides: Partial<AtlasBeaconContribution> = {}): AtlasBeaconContribution => ({
  date: '2026-08-25', districtId: 'light-forest', actorId: 'actor-1', walletAddress: 'NQ1', runId: 'run-1', score: 100, repairUnits: 10, verified: true, prizeEligible: true, ...overrides,
});

describe('NIM Atlas Network Beacon', () => {
  it('projects only verified best daily deltas and deduplicates actor-wallet contributions', async () => {
    const service = createAtlasBeaconService({ repository: createAtlasBeaconRepository(), now: () => 1_000 });
    await expect(service.apply(contribution())).resolves.toMatchObject({ projectionVersion: 1, systems: expect.arrayContaining([expect.objectContaining({ districtId: 'light-forest', repairTotal: 10 })]), verifiedContributorCount: 1 });
    await expect(service.apply(contribution({ score: 90, repairUnits: 40, runId: 'lower-score' }))).resolves.toMatchObject({ projectionVersion: 1, systems: expect.arrayContaining([expect.objectContaining({ districtId: 'light-forest', repairTotal: 10 })]), verifiedContributorCount: 1 });
    await expect(service.apply(contribution({ score: 120, repairUnits: 14, runId: 'best-run' }))).resolves.toMatchObject({ projectionVersion: 2, systems: expect.arrayContaining([expect.objectContaining({ districtId: 'light-forest', repairTotal: 14 })]), verifiedContributorCount: 1 });
    await expect(service.apply(contribution({ score: 130, repairUnits: 20, verified: false, runId: 'unverified' }))).rejects.toThrow(/verified/i);
  });

  it('is idempotent and order-independent while preserving monuments separately', async () => {
    const first = createAtlasBeaconService({ repository: createAtlasBeaconRepository(), now: () => 2_000 });
    await first.apply(contribution({ actorId: 'a', walletAddress: 'NQA', runId: 'a-run', score: 20, repairUnits: 2 }));
    await first.apply(contribution({ districtId: 'builder-city', actorId: 'b', walletAddress: 'NQB', runId: 'b-run', score: 40, repairUnits: 5 }));
    await first.preserveMonument({ seasonId: 'season-1', monumentId: 'lantern-market' });
    const firstSnapshot = await first.read();

    const second = createAtlasBeaconService({ repository: createAtlasBeaconRepository(), now: () => 2_000 });
    await second.apply(contribution({ districtId: 'builder-city', actorId: 'b', walletAddress: 'NQB', runId: 'b-run', score: 40, repairUnits: 5 }));
    await second.apply(contribution({ actorId: 'a', walletAddress: 'NQA', runId: 'a-run', score: 20, repairUnits: 2 }));
    await second.preserveMonument({ seasonId: 'season-1', monumentId: 'lantern-market' });
    expect(await second.read()).toEqual(firstSnapshot);
    expect(firstSnapshot.monuments).toEqual([{ seasonId: 'season-1', monumentId: 'lantern-market' }]);
  });

  it('reports honest live, stale, and unavailable states', async () => {
    const repository = createAtlasBeaconRepository();
    const service = createAtlasBeaconService({ repository, now: () => 10_000 });
    expect(await service.read()).toMatchObject({ status: 'live' });
    await service.apply(contribution({ score: 1, repairUnits: 1 }));
    const stale = createAtlasBeaconService({ repository, now: () => 10_000 + 10 * 60_000 });
    expect(await stale.read()).toMatchObject({ status: 'stale' });
    repository.failReads = true;
    expect(await stale.read()).toMatchObject({ status: 'unavailable', snapshot: null });
  });

  it('keeps verified echo descriptors separate from Beacon gameplay progress', async () => {
    const service = createAtlasBeaconService({ repository: createAtlasBeaconRepository(), now: () => 1_000 });
    await service.appendEcho({ id: 'echo-1', districtId: 'pay-harbor', action: 'repair', cosmeticId: 'pay-harbor-repair-mark', displayName: 'Explorer #abcd', contributionDelta: 4, observedAtBucket: 1 });
    const projection = await service.read();
    expect(projection).toMatchObject({ echoes: [{ id: 'echo-1', contributionDelta: 4 }] });
    expect(projection.systems.every((system) => system.repairTotal === 0)).toBe(true);
  });
});
