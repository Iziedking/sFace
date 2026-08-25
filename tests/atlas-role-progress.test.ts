import { describe, expect, it } from 'vitest';

import {
  addAtlasAssistance,
  createAtlasPlayerProgress,
  isAtlasPrizeEligible,
  migrateAtlasPlayerProgress,
  pinAtlasCompetitiveTicket,
  switchAtlasRole,
} from '../shared/atlas/roles';

describe('NIM Atlas player model', () => {
  it('starts as an Explorer and keeps prize eligibility without assistance', () => {
    const progress = createAtlasPlayerProgress();
    expect(progress.activeRole).toBe('explorer');
    expect(progress.mastery).toBe(0);
    expect(isAtlasPrizeEligible(progress)).toBe(true);
  });

  it('switches roles without losing shared adventure or Knowledge progress', () => {
    const progress = createAtlasPlayerProgress();
    progress.completedAdventureIds.push('last-lantern');
    progress.knowledgeFragmentIds.push('confirm');
    const builder = switchAtlasRole(progress, 'builder');
    expect(builder.activeRole).toBe('builder');
    expect(builder.completedAdventureIds).toEqual(['last-lantern']);
    expect(builder.knowledgeFragmentIds).toEqual(['confirm']);
  });

  it('records assistance provenance and removes prize eligibility for assisted runs', () => {
    const assisted = addAtlasAssistance(createAtlasPlayerProgress(), 'purchased-hint');
    expect(assisted.assistance).toEqual(['purchased-hint']);
    expect(isAtlasPrizeEligible(assisted)).toBe(false);
  });

  it('migrates the v1 reader shape without losing districts or trials', () => {
    const migrated = migrateAtlasPlayerProgress({ version: 1, completedDistricts: ['genesis-garden'], completedTrials: ['luna-lens'] });
    expect(migrated).toMatchObject({ version: 2, completedAdventureIds: ['genesis-garden'], completedTrialIds: ['luna-lens'] });
  });

  it('rejects unknown versions instead of guessing', () => {
    expect(() => migrateAtlasPlayerProgress({ version: 99 })).toThrow(/version/i);
  });

  it('pins competitive tickets to the complete content hash set', () => {
    const ticket = pinAtlasCompetitiveTicket({
      ticketId: 'ticket-1', actorId: 'actor-1', walletAddress: 'NQ00', role: 'explorer', seasonId: 'season-1',
      challengeId: 'daily-1', seed: 'seed-1', expiresAt: 1_000,
    }, { campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64) });
    expect(ticket.campaignHash).toBe('a'.repeat(64));
    expect(ticket.curriculumHash).toBe('b'.repeat(64));
    expect(ticket.rulesetHash).toBe('c'.repeat(64));
  });
});
