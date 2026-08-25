import { describe, expect, it } from 'vitest';

import { atlasCurriculumSchema, validateAtlasCurriculum } from '../shared/atlas/curriculum';
import { ATLAS_CURRICULUM } from '../shared/atlas/manifest';

describe('NIM Atlas curriculum contract', () => {
  it('ships six sourced districts, one finale, and three launch expeditions', () => {
    const parsed = atlasCurriculumSchema.parse(ATLAS_CURRICULUM);
    expect(parsed.districts).toHaveLength(6);
    expect(parsed.finale.id).toBe('beacon-core');
    expect(parsed.expeditions).toHaveLength(3);
    expect(new Set(parsed.districts.map((district) => district.id)).size).toBe(6);
    expect(parsed.districts.map((district) => district.id)).toEqual([
      'genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city',
    ]);
  });

  it('uses current official sources and allowlisted typed operations for every trial', () => {
    const curriculum = validateAtlasCurriculum(ATLAS_CURRICULUM, new Date('2026-08-25T12:00:00.000Z'));
    const trials = [...curriculum.districts.flatMap((district) => district.trials), ...curriculum.finale.trials];
    expect(trials.length).toBeGreaterThanOrEqual(12);
    for (const trial of trials) {
      expect(trial.source.url).toMatch(/^https:\/\/(www\.)?nimiq\.dev\//);
      expect(trial.source.reviewedAt).toBe('2026-08-25');
      expect(trial.recipe.language).toBe('typescript');
      expect(trial.recipe.code.length).toBeGreaterThan(20);
      expect(trial.operation).not.toMatch(/arbitrary|eval|mainnet/i);
      if (trial.capability === 'testnet-send') {
        expect(trial.enabled).toBe(false);
        expect(trial.ownerGate).toBe(true);
      }
    }
  });

  it('encodes installed and documented provider calls without treating wallet replies as payment proof', () => {
    const recipes = JSON.stringify(ATLAS_CURRICULUM);
    expect(recipes).toContain("init({ timeout: 2500 })");
    expect(recipes).toContain('nimiq.listAccounts()');
    expect(recipes).toContain('nimiq.isConsensusEstablished()');
    expect(recipes).toContain('nimiq.getBlockNumber()');
    expect(recipes).toContain("nimiq.sign('NIM Atlas builder trial')");
    expect(recipes).toContain('A wallet reply is not proof of canonical payment');
  });

  it('rejects stale sources, unknown operations, mainnet sends, and enabled testnet sends', () => {
    const stale = structuredClone(ATLAS_CURRICULUM);
    stale.districts[0]!.trials[0]!.source.reviewedAt = '2025-01-01';
    expect(() => validateAtlasCurriculum(stale, new Date('2026-08-25T12:00:00.000Z'))).toThrow(/stale/i);

    const unknown = structuredClone(ATLAS_CURRICULUM) as unknown as { districts: Array<{ trials: Array<{ operation: string }> }> };
    unknown.districts[0]!.trials[0]!.operation = 'execute-arbitrary-code';
    expect(() => atlasCurriculumSchema.parse(unknown)).toThrow();

    const mainnet = structuredClone(ATLAS_CURRICULUM) as unknown as { districts: Array<{ trials: Array<{ capability: string }> }> };
    mainnet.districts[0]!.trials[0]!.capability = 'mainnet-send';
    expect(() => atlasCurriculumSchema.parse(mainnet)).toThrow();

    const enabledSend = structuredClone(ATLAS_CURRICULUM);
    const sendTrial = enabledSend.districts.flatMap((district) => district.trials).find((trial) => trial.capability === 'testnet-send');
    expect(sendTrial).toBeDefined();
    sendTrial!.enabled = true;
    expect(() => atlasCurriculumSchema.parse(enabledSend)).toThrow(/testnet|disabled|gate/i);
  });
});
