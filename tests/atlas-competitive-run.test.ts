import { describe, expect, it } from 'vitest';

import { createAtlasCoreRunSubmission } from '../src/atlas/competitive-run';
import { ATLAS_CORE_FIXTURE } from '../shared/atlas/world';
import type { AtlasAction } from '../shared/atlas/state';
import type { AtlasCompetitiveTicket } from '../shared/atlas/types';

const ticket: AtlasCompetitiveTicket = {
  ticketId: 'a'.repeat(32),
  actorId: 'actor-1',
  walletAddress: 'NQWALLET',
  role: 'explorer',
  seasonId: 'season-1',
  challengeId: 'expedition-1',
  seed: 'seed-1',
  campaignHash: 'a'.repeat(64),
  curriculumHash: 'b'.repeat(64),
  rulesetHash: 'c'.repeat(64),
  expiresAt: 2_000,
};

function completedActions(): AtlasAction[] {
  return [
    { moveX: 127, moveY: 0, tool: 'shield-pulse', interact: false },
    ...Array.from({ length: 7 }, () => ({ moveX: 127, moveY: 0, tool: 'none' as const, interact: false })),
    { moveX: 127, moveY: 0, tool: 'scanner', interact: false },
    { moveX: 127, moveY: 0, tool: 'relay-tether', interact: false },
    ...Array.from({ length: 5 }, () => ({ moveX: 127, moveY: 0, tool: 'none' as const, interact: false })),
    { moveX: 0, moveY: 0, tool: 'none', interact: true },
    ...Array.from({ length: 5 }, () => ({ moveX: 127, moveY: 0, tool: 'none' as const, interact: false })),
    { moveX: 0, moveY: 0, tool: 'none', interact: true },
  ];
}

describe('Atlas core-run adapter', () => {
  it('creates a server-shaped submission from the same deterministic mission', async () => {
    const actions = completedActions();
    const submission = await createAtlasCoreRunSubmission({ ticket, runId: 'run-1', actorId: 'actor-1', walletAddress: 'NQWALLET', role: 'explorer', origin: 'https://sface.test', actions });
    expect(submission).toMatchObject({ ticketId: ticket.ticketId, seasonId: 'season-1', challengeId: 'expedition-1', network: 'testalbatross', claimedSnapshot: { phase: 'completed' }, assistance: 'none' });
    expect(submission.actions).toEqual(actions);
    expect(submission.replayHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses incomplete play, ticket substitution, and never maps the daily expedition', async () => {
    await expect(createAtlasCoreRunSubmission({ ticket, runId: 'run-incomplete', actorId: 'actor-1', walletAddress: 'NQWALLET', role: 'explorer', origin: 'https://sface.test', actions: [{ moveX: 0, moveY: 0, tool: 'none', interact: false }] })).rejects.toThrow(/objectives/i);
    await expect(createAtlasCoreRunSubmission({ ticket, runId: 'run-stolen', actorId: 'actor-2', walletAddress: 'NQWALLET', role: 'explorer', origin: 'https://sface.test', actions: completedActions() })).rejects.toThrow(/ticket/i);
    expect(ATLAS_CORE_FIXTURE.id).toBe('core-fixture');
  });
});
