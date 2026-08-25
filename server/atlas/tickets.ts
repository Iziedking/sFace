import { randomBytes } from 'node:crypto';

import type { AtlasCompetitiveTicket, AtlasRole } from '../../shared/atlas/types';
import type { AtlasIdentityService } from './identity';

const TICKET_TTL_MS = 10 * 60 * 1_000;

export interface AtlasTicketRecord extends AtlasCompetitiveTicket {
  issuedAt: number;
  usedByRunId: string | null;
  consumedAt: number | null;
}

export interface AtlasTicketService {
  issue(input: { actorId: string; walletAddress: string; network: 'testalbatross' | 'mainalbatross'; role: AtlasRole; seasonId: string; challengeId: string; seed: string; campaignHash: string; curriculumHash: string; rulesetHash: string; now?: number }): Promise<AtlasTicketRecord>;
  consume(input: { ticketId: string; actorId: string; walletAddress: string; runId: string; now?: number }): Promise<AtlasTicketRecord>;
  get(ticketId: string): AtlasTicketRecord | null;
}

export class AtlasTicketError extends Error {
  constructor(readonly code: 'unavailable' | 'mismatch' | 'expired' | 'used', message: string) {
    super(message);
    this.name = 'AtlasTicketError';
  }
}

export function createAtlasTicketService(options: { identity: AtlasIdentityService; now?: () => number }): AtlasTicketService {
  const now = options.now ?? Date.now;
  const tickets = new Map<string, AtlasTicketRecord>();
  return {
    async issue(input) {
      if (input.network !== 'testalbatross') throw new AtlasTicketError('unavailable', 'Competitive Atlas tickets are disabled on mainnet.');
      const binding = options.identity.getBinding(input.actorId, input.seasonId);
      if (!binding || binding.address !== input.walletAddress || binding.network !== input.network) throw new AtlasTicketError('mismatch', 'Atlas actor and wallet binding does not match the ticket request.');
      for (const hash of [input.campaignHash, input.curriculumHash, input.rulesetHash]) if (!/^[a-f0-9]{64}$/.test(hash)) throw new AtlasTicketError('unavailable', 'Atlas ticket content hash is invalid.');
      if (!/^[a-z0-9-]{1,80}$/.test(input.seasonId) || !/^[a-z0-9-]{1,80}$/.test(input.challengeId) || !/^[a-zA-Z0-9:_-]{1,128}$/.test(input.seed)) throw new AtlasTicketError('unavailable', 'Atlas ticket fields are malformed.');
      const issuedAt = input.now ?? now();
      const ticket: AtlasTicketRecord = { ticketId: randomBytes(16).toString('hex'), actorId: input.actorId, walletAddress: binding.address, role: input.role, seasonId: input.seasonId, challengeId: input.challengeId, seed: input.seed, campaignHash: input.campaignHash, curriculumHash: input.curriculumHash, rulesetHash: input.rulesetHash, expiresAt: issuedAt + TICKET_TTL_MS, issuedAt, usedByRunId: null, consumedAt: null };
      tickets.set(ticket.ticketId, ticket);
      return structuredClone(ticket);
    },
    async consume(input) {
      const ticket = tickets.get(input.ticketId);
      if (!ticket) throw new AtlasTicketError('unavailable', 'Atlas ticket was not found.');
      if (ticket.actorId !== input.actorId || ticket.walletAddress !== input.walletAddress) throw new AtlasTicketError('mismatch', 'Atlas ticket does not belong to this actor and wallet.');
      if (ticket.usedByRunId === input.runId) return structuredClone(ticket);
      if (ticket.usedByRunId || ticket.consumedAt !== null) throw new AtlasTicketError('used', 'Atlas ticket has already been consumed.');
      const consumedAt = input.now ?? now();
      if (consumedAt >= ticket.expiresAt) throw new AtlasTicketError('expired', 'Atlas ticket has expired.');
      const consumed = { ...ticket, usedByRunId: input.runId, consumedAt };
      tickets.set(ticket.ticketId, consumed);
      return structuredClone(consumed);
    },
    get(ticketId) {
      const ticket = tickets.get(ticketId);
      return ticket ? structuredClone(ticket) : null;
    },
  };
}
