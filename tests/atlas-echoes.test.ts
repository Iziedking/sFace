import { describe, expect, it } from 'vitest';

import { createAtlasEchoRepository, createAtlasEchoService, type AtlasEchoInput } from '../server/atlas/echoes';

const input = (overrides: Partial<AtlasEchoInput> = {}): AtlasEchoInput => ({
  date: '2026-08-26', districtId: 'pay-harbor', actorId: 'actor-1', walletAddress: 'NQSECRET', runId: 'run-1', score: 7_500,
  verified: true, prizeEligible: true, action: 'repair', observedAt: 120_000, displayName: 'Mara', displayNameOptIn: false, ...overrides,
});

describe('NIM Atlas verified community echoes', () => {
  it('requires verified eligible runs and masks identity by default', async () => {
    const service = createAtlasEchoService({ repository: createAtlasEchoRepository(), now: () => 120_000 });
    await expect(service.record(input())).resolves.toMatchObject({ districtId: 'pay-harbor', action: 'repair', displayName: expect.stringMatching(/^Explorer #[a-f0-9]{4}$/) });
    const echo = (await service.read()).echoes[0]!;
    expect(echo).not.toHaveProperty('walletAddress');
    expect(echo).not.toHaveProperty('score');
    expect(echo).not.toHaveProperty('verified');
    await expect(service.record(input({ verified: false, runId: 'unverified' }))).rejects.toThrow(/verified/i);
    await expect(service.record(input({ prizeEligible: false, runId: 'assisted' }))).rejects.toThrow(/eligible/i);
  });

  it('keeps one best echo per actor-wallet day and is order-independent', async () => {
    const first = createAtlasEchoService({ repository: createAtlasEchoRepository(), now: () => 120_000 });
    await first.record(input({ score: 20, runId: 'low', action: 'scan' }));
    await first.record(input({ score: 40, runId: 'high', action: 'install' }));
    await first.record(input({ score: 30, runId: 'middle', action: 'celebrate' }));
    const firstRead = await first.read();
    const second = createAtlasEchoService({ repository: createAtlasEchoRepository(), now: () => 120_000 });
    await second.record(input({ score: 40, runId: 'high', action: 'install' }));
    await second.record(input({ score: 20, runId: 'low', action: 'scan' }));
    expect(await second.read()).toEqual(firstRead);
    expect(firstRead.echoes).toHaveLength(1);
    expect(firstRead.echoes[0]).toMatchObject({ action: 'install', contributionDelta: 40, observedAtBucket: 2 });
  });

  it('supports explicit safe names, deterministic cosmetics, and honest stale or unavailable reads', async () => {
    const repository = createAtlasEchoRepository();
    const service = createAtlasEchoService({ repository, now: () => 120_000 });
    const named = await service.record(input({ displayName: 'Ada Builder', displayNameOptIn: true, action: 'celebrate' }));
    expect(named).toMatchObject({ displayName: 'Ada Builder', cosmeticId: 'pay-harbor-celebrate-mark' });
    await expect(service.record(input({ displayName: '<script>', displayNameOptIn: true, runId: 'unsafe' }))).rejects.toThrow(/name/i);
    expect((await service.read()).status).toBe('live');
    const stale = createAtlasEchoService({ repository, now: () => 120_000 + 10 * 60_000 });
    expect((await stale.read()).status).toBe('stale');
    repository.failReads = true;
    expect(await stale.read()).toEqual({ status: 'unavailable', echoes: [] });
  });

  it('keeps one effect under one hundred concurrent duplicate echo writes', async () => {
    const service = createAtlasEchoService({ repository: createAtlasEchoRepository(), now: () => 120_000 });
    await Promise.all(Array.from({ length: 100 }, (_, index) => service.record(input({ runId: `duplicate-${index}`, score: 10 }))));
    expect((await service.read()).echoes).toHaveLength(1);
  });
});
