import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseRelayConfig } from '../server/relay/config';
import { createRelayDailyService } from '../server/relay/daily';
import { createRelayStore } from '../server/relay/store';
import { createRelayTicketService } from '../server/relay/tickets';
import { commitRelaySeed } from '../shared/relay/commitment';
import { RELAY_RULESET } from '../shared/relay/ruleset';

const directories: string[] = [];

async function services(now = new Date('2026-08-24T12:00:00.000Z')) {
  const directory = await mkdtemp(join(tmpdir(), 'sface-relay-daily-'));
  directories.push(directory);
  const store = createRelayStore({ dataDirectory: directory });
  const daily = createRelayDailyService({ store, now: () => now });
  const tickets = createRelayTicketService({ store, daily, now: () => now });
  await store.load();
  return { store, daily, tickets };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Relay daily seed lifecycle', () => {
  it('disables rewards honestly when treasury or RPC configuration is missing', () => {
    const config = parseRelayConfig({ RELAY_ENABLED: 'true', RELAY_COMPETITIVE_ENABLED: 'true', RELAY_REWARDS_ENABLED: 'true', RELAY_SEASON_ID: 'season-0', RELAY_NIMIQ_NETWORK: 'test' });
    expect(config.rewardsEnabled).toBe(false);
    expect(config.rewardsDisabledReason).toBe('missing_reward_configuration');
    expect(config.practiceEnabled).toBe(true);
  });

  it('moves a prepared day through committed, open, closed, and finalized exactly once', async () => {
    const { daily } = await services();
    const prepared = await daily.prepare('2026-08-24');
    expect(prepared.status).toBe('prepared');
    expect(prepared.seedHex).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.seedCommitment).toMatch(/^[0-9a-f]{64}$/);

    const committed = await daily.commit('2026-08-24');
    expect(committed.status).toBe('committed');
    expect(daily.publicDay('2026-08-24')?.seedHex).toBeUndefined();

    const opened = await daily.open('2026-08-24');
    expect(opened.status).toBe('open');
    expect(opened.seedHex).toBe(prepared.seedHex);
    expect(await commitRelaySeed({ ruleset: RELAY_RULESET.version, missionDate: opened.date, seedHex: opened.seedHex })).toBe(opened.seedCommitment);
    await expect(daily.open('2026-08-24')).rejects.toMatchObject({ code: 'relay_day_transition_invalid' });

    expect((await daily.close('2026-08-24')).status).toBe('closed');
    expect((await daily.finalize('2026-08-24')).status).toBe('finalized');
  });

  it('issues actor-bound ten-minute tickets and consumes them once', async () => {
    const { daily, tickets } = await services();
    await daily.prepare('2026-08-24');
    await daily.commit('2026-08-24');
    await daily.open('2026-08-24');
    const ticket = await tickets.issue({ actorId: 'actor-1', missionDate: '2026-08-24' });
    expect(ticket.expiresAt - ticket.issuedAt).toBe(10 * 60 * 1_000);
    expect(ticket.ruleset).toBe(RELAY_RULESET.version);

    await expect(tickets.consume({ ticketId: ticket.id, actorId: 'actor-2' })).rejects.toMatchObject({ code: 'relay_ticket_actor_mismatch' });
    await expect(tickets.consume({ ticketId: ticket.id, actorId: 'actor-1' })).resolves.toMatchObject({ consumedAt: new Date('2026-08-24T12:00:00.000Z').getTime() });
    await expect(tickets.consume({ ticketId: ticket.id, actorId: 'actor-1' })).rejects.toMatchObject({ code: 'relay_ticket_used' });
  });

  it('refuses expired tickets before they can be consumed', async () => {
    const start = new Date('2026-08-24T12:00:00.000Z');
    const { store, daily, tickets } = await services(start);
    await daily.prepare('2026-08-24');
    await daily.commit('2026-08-24');
    await daily.open('2026-08-24');
    const ticket = await tickets.issue({ actorId: 'actor-1', missionDate: '2026-08-24' });
    const expired = createRelayTicketService({ store, daily, now: () => new Date(ticket.expiresAt + 1) });
    await expect(expired.consume({ ticketId: ticket.id, actorId: 'actor-1' })).rejects.toMatchObject({ code: 'relay_ticket_expired' });
  });
});
