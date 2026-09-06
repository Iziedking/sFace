import { ATLAS_CORE_FIXTURE } from '../../shared/atlas/world';
import { hashAtlasActions, replayAtlasActions } from '../../shared/atlas/replay';
import type { AtlasAction } from '../../shared/atlas/state';
import type { AtlasCompetitiveTicket, AtlasAssistance, AtlasRole } from '../../shared/atlas/types';
import type { AtlasCompetitiveRunInput } from './api';

export interface AtlasCoreRunRequest {
  ticket: AtlasCompetitiveTicket;
  runId: string;
  actorId: string;
  walletAddress: string;
  role: AtlasRole;
  origin: string;
  actions: AtlasAction[];
  assistance?: AtlasAssistance;
}

/**
 * Converts only the named Atlas core mission into a server submission.
 *
 * Daily field expeditions have a different state machine and must not be
 * silently accepted here. The server replays the same core fixture again;
 * this local replay is only for building the exact claimed snapshot and
 * stopping an obviously incomplete submission before it leaves the device.
 */
export async function createAtlasCoreRunSubmission(input: AtlasCoreRunRequest): Promise<AtlasCompetitiveRunInput> {
  if (input.ticket.ticketId.length === 0 || input.runId.length === 0) throw new Error('Atlas core run identity is missing.');
  if (input.actorId !== input.ticket.actorId || input.walletAddress !== input.ticket.walletAddress || input.role !== input.ticket.role) {
    throw new Error('Atlas core run does not match its competitive ticket.');
  }
  const claimedSnapshot = replayAtlasActions(ATLAS_CORE_FIXTURE, input.actions);
  if (claimedSnapshot.phase !== 'completed') throw new Error('Complete the Atlas core objectives before submitting the run.');
  return {
    runId: input.runId,
    ticketId: input.ticket.ticketId,
    actorId: input.actorId,
    walletAddress: input.walletAddress,
    network: 'testalbatross',
    role: input.role,
    seasonId: input.ticket.seasonId,
    challengeId: input.ticket.challengeId,
    origin: input.origin,
    campaignHash: input.ticket.campaignHash,
    curriculumHash: input.ticket.curriculumHash,
    rulesetHash: input.ticket.rulesetHash,
    assistance: input.assistance ?? 'none',
    actions: structuredClone(input.actions),
    claimedSnapshot,
    replayHash: await hashAtlasActions(input.actions),
  };
}
