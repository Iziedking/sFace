import { describe, expect, it, vi } from 'vitest';

import { createAtlasCoreRunController } from '../src/atlas/app/core-run-controller';
import type { AtlasApiClient, AtlasCompetitiveRunResult } from '../src/atlas/api';
import type { AtlasAction } from '../shared/atlas/state';
import type { AtlasCompetitiveTicket } from '../shared/atlas/types';

const ticket: AtlasCompetitiveTicket = {
  ticketId: 'a'.repeat(32), actorId: 'actor-1', walletAddress: 'NQWALLET', role: 'explorer', seasonId: 'season-1', challengeId: 'expedition-1', seed: 'seed-1', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64), expiresAt: 2_000,
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

function verifiedResponse(): { ok: true; value: AtlasCompetitiveRunResult } {
  return { ok: true, value: { run: { runId: 'run-1', actorId: 'actor-1', walletAddress: 'NQWALLET', role: 'explorer', seasonId: 'season-1', challengeId: 'expedition-1', score: 535, correct: true, assistance: 'none', prizeEligible: true, replayHash: 'c'.repeat(64), verifiedAt: 1_000, status: 'verified' }, row: { runId: 'run-1', actorId: 'actor-1', walletAddress: 'NQWALLET', role: 'explorer', seasonId: 'season-1', score: 535, rank: 1, assistance: 'none', prizeEligible: true, replayHash: 'c'.repeat(64) }, beacon: null } };
}

describe('Atlas core-run controller', () => {
  it('records actual play and submits only after local completion', async () => {
    const submitCoreRun: AtlasApiClient['submitCoreRun'] = vi.fn(async (input) => {
      expect(input.actions).toHaveLength(22);
      return verifiedResponse();
    });
    const controller = createAtlasCoreRunController({ api: { submitCoreRun } });
    for (const action of completedActions()) controller.step(action);
    expect(controller.state()).toMatchObject({ phase: 'completed', submission: 'local', actions: 22 });
    await expect(controller.submit({ ticket, runId: 'run-1', actorId: 'actor-1', walletAddress: 'NQWALLET', role: 'explorer', origin: 'https://sface.test' })).resolves.toMatchObject({ submission: 'verified', score: 535 });
    expect(submitCoreRun).toHaveBeenCalledOnce();
  });

  it('keeps a completed local run honest when the service is offline and blocks incomplete submission', async () => {
    const submitCoreRun = vi.fn(async () => ({ ok: false as const, error: 'Atlas service is unavailable.' }));
    const controller = createAtlasCoreRunController({ api: { submitCoreRun } });
    await expect(controller.submit({ ticket, runId: 'run-1', actorId: 'actor-1', walletAddress: 'NQWALLET', role: 'explorer', origin: 'https://sface.test' })).resolves.toMatchObject({ phase: 'running', submission: 'rejected' });
    expect(submitCoreRun).not.toHaveBeenCalled();
    for (const action of completedActions()) controller.step(action);
    await expect(controller.submit({ ticket, runId: 'run-1', actorId: 'actor-1', walletAddress: 'NQWALLET', role: 'explorer', origin: 'https://sface.test' })).resolves.toMatchObject({ phase: 'completed', submission: 'offline', notice: 'Atlas service is unavailable.' });
  });
});
