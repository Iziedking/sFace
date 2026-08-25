import { randomBytes } from 'node:crypto';

import { RELAY_TICKET_TTL_MS } from '../../shared/relay/constants';
import { RELAY_RULESET } from '../../shared/relay/ruleset';
import type { RelayStore, RelaySnapshot } from './store';
import type { RelayDailyService } from './daily';

export interface RelayTicketRecord {
  id: string;
  actorId: string;
  missionDate: string;
  ruleset: 'relay-1';
  issuedAt: number;
  expiresAt: number;
  usedByRunId: string | null;
  consumedAt: number | null;
}

export class RelayTicketError extends Error {
  readonly code: 'relay_ticket_unavailable' | 'relay_ticket_actor_mismatch' | 'relay_ticket_expired' | 'relay_ticket_used';

  constructor(code: RelayTicketError['code'], message: string) {
    super(message);
    this.name = 'RelayTicketError';
    this.code = code;
  }
}

export interface RelayTicketService {
  issue(input: { actorId: string; missionDate: string; now?: number }): Promise<RelayTicketRecord>;
  consume(input: { ticketId: string; actorId: string; runId?: string; now?: number }): Promise<RelayTicketRecord>;
  get(ticketId: string): RelayTicketRecord | null;
}

export function createRelayTicketService(options: { store: RelayStore; daily: RelayDailyService; now?: () => Date }): RelayTicketService {
  const now = options.now ?? (() => new Date());
  let snapshot: RelaySnapshot | null = null;
  const ensure = async (): Promise<RelaySnapshot> => {
    if (!snapshot) snapshot = await options.store.load();
    return snapshot;
  };
  const persist = async (kind: string, next: RelaySnapshot): Promise<void> => {
    await options.store.commit(kind, next);
    snapshot = next;
  };

  return {
    async issue(input) {
      const day = options.daily.getDay(input.missionDate);
      if (!day || day.status !== 'open') throw new RelayTicketError('relay_ticket_unavailable', 'Competitive tickets are unavailable for this day.');
      const issuedAt = input.now ?? now().getTime();
      const ticket: RelayTicketRecord = {
        id: randomBytes(16).toString('hex'),
        actorId: input.actorId,
        missionDate: input.missionDate,
        ruleset: RELAY_RULESET.version,
        issuedAt,
        expiresAt: issuedAt + RELAY_TICKET_TTL_MS,
        usedByRunId: null,
        consumedAt: null,
      };
      const current = await ensure();
      const next = structuredClone(current);
      next.tickets[ticket.id] = ticket;
      await persist('ticket.issued', next);
      return ticket;
    },
    async consume(input) {
      const current = await ensure();
      const ticket = current.tickets[input.ticketId] as unknown as RelayTicketRecord | undefined;
      if (!ticket) throw new RelayTicketError('relay_ticket_unavailable', 'Ticket was not found.');
      if (ticket.actorId !== input.actorId) throw new RelayTicketError('relay_ticket_actor_mismatch', 'Ticket belongs to another actor.');
      if (ticket.usedByRunId || ticket.consumedAt !== null) throw new RelayTicketError('relay_ticket_used', 'Ticket has already been consumed.');
      const consumedAt = input.now ?? now().getTime();
      if (consumedAt >= ticket.expiresAt) throw new RelayTicketError('relay_ticket_expired', 'Ticket has expired.');
      const consumed = { ...ticket, usedByRunId: input.runId ?? `consumed-${ticket.id}`, consumedAt };
      const next = structuredClone(current);
      next.tickets[ticket.id] = consumed;
      await persist('ticket.consumed', next);
      return consumed;
    },
    get(ticketId) {
      const value = snapshot?.tickets[ticketId] as unknown as RelayTicketRecord | undefined;
      return value ? structuredClone(value) : null;
    },
  };
}
