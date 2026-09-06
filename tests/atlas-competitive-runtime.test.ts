import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKey, PublicKey, Signature } from '@nimiq/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createAtlasBeaconRepository, createAtlasBeaconService } from '../server/atlas/beacon';
import { createAtlasCompetitiveRuntime } from '../server/atlas/competitive';
import { createAtlasEchoRepository, createAtlasEchoService } from '../server/atlas/echoes';
import { createAtlasIdentityService, canonicalAtlasWalletBindingMessage } from '../server/atlas/identity';
import { createAtlasJsonRepository, createAtlasStateStore } from '../server/atlas/persistence';
import { createAtlasLeaderboardService } from '../server/atlas/leaderboard';
import { createAtlasSubmissionService, type AtlasSubmissionInput } from '../server/atlas/submissions';
import { createAtlasTicketService } from '../server/atlas/tickets';
import { encodeSignedMessage } from '../server/attest';
import { PlayerAuth } from '../server/player-auth';
import { ATLAS_CORE_FIXTURE } from '../shared/atlas/world';
import { hashAtlasActions, replayAtlasActions } from '../shared/atlas/replay';
import { getOrCreateCredential, MemoryPlayerCredentialStore } from '../src/net/player-credential';
import type { AtlasAction } from '../shared/atlas/state';

describe('NIM Atlas competitive runtime', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('persists a verified run, leaderboard row, and world projections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-runtime-'));
    directories.push(directory);
    const stateStore = createAtlasStateStore(createAtlasJsonRepository({ directory }));
    const auth = new PlayerAuth();
    const credential = await getOrCreateCredential(new MemoryPlayerCredentialStore());
    const registered = await auth.register({ publicKeyJwk: credential.publicKeyJwk, now: 1_000 });
    if (!registered.ok) throw new Error('Atlas actor fixture did not register.');
    const walletPrivate = PrivateKey.generate();
    const walletPublic = PublicKey.derive(walletPrivate);
    const walletAddress = walletPublic.toAddress().toUserFriendlyAddress();
    const identity = createAtlasIdentityService({ auth, domain: 'https://local.sface.test', now: () => 1_000 });
    const challenge = identity.issueWalletChallenge({ actorId: registered.value.playerId, seasonId: 'season-1', address: walletAddress, network: 'testalbatross' });
    await identity.bindWallet({ challenge, publicKey: walletPublic.toHex(), signature: Signature.create(walletPrivate, walletPublic, encodeSignedMessage(canonicalAtlasWalletBindingMessage(challenge))).toHex() });
    const tickets = createAtlasTicketService({ identity, now: () => 1_000 });
    const submissions = createAtlasSubmissionService({ tickets, expectedOrigin: 'https://local.sface.test', mission: ATLAS_CORE_FIXTURE, now: () => 1_000 });
    const leaderboard = createAtlasLeaderboardService();
    const beacon = createAtlasBeaconService({ repository: createAtlasBeaconRepository({ stateStore }), now: () => 1_000 });
    const echoes = createAtlasEchoService({ repository: createAtlasEchoRepository({ stateStore }), now: () => 1_000 });
    const runtime = createAtlasCompetitiveRuntime({ identity, tickets, submissions, leaderboard, beacon, echoes, stateStore, date: () => '2026-09-06', repairUnits: () => 4, ticketPolicy: { network: 'testalbatross', seasonId: 'season-1', challengeId: 'expedition-1', seed: 'seed-1', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64) } });
    const ticket = await runtime.issueServerTicket({ actorId: registered.value.playerId, walletAddress, role: 'explorer' });
    const actions: AtlasAction[] = [{ moveX: 0, moveY: 0, tool: 'none', interact: false }];
    const input: AtlasSubmissionInput = { runId: `run-${ticket.ticketId}`, ticketId: ticket.ticketId, actorId: registered.value.playerId, walletAddress, network: 'testalbatross', role: 'explorer', seasonId: 'season-1', challengeId: 'expedition-1', origin: 'https://local.sface.test', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64), assistance: 'none', actions, claimedSnapshot: replayAtlasActions(ATLAS_CORE_FIXTURE, actions), replayHash: await hashAtlasActions(actions) };
    await expect(runtime.submit(input)).resolves.toMatchObject({ run: { status: 'verified' }, row: { rank: 1 }, beacon: { systems: expect.arrayContaining([expect.objectContaining({ districtId: 'pay-harbor', repairTotal: 4 })]) } });
    await expect(runtime.leaderboard('season-1', 'explorer')).resolves.toMatchObject([{ actorId: registered.value.playerId, rank: 1 }]);
    await expect(runtime.competition()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'explorer', bestVerifiedScore: expect.any(Number), eligibility: 'eligible' }),
      expect.objectContaining({ role: 'builder', bestVerifiedScore: null, eligibility: 'not-verified' }),
    ]));

    const restoredStateStore = createAtlasStateStore(createAtlasJsonRepository({ directory }));
    const restoredIdentity = createAtlasIdentityService({ auth, domain: 'https://local.sface.test', now: () => 1_000 });
    const restoredTickets = createAtlasTicketService({ identity: restoredIdentity, now: () => 1_000 });
    const restoredSubmissions = createAtlasSubmissionService({ tickets: restoredTickets, expectedOrigin: 'https://local.sface.test', mission: ATLAS_CORE_FIXTURE, now: () => 1_000 });
    const restoredLeaderboard = createAtlasLeaderboardService();
    const restoredBeacon = createAtlasBeaconService({ repository: createAtlasBeaconRepository({ stateStore: restoredStateStore }), now: () => 1_000 });
    const restoredEchoes = createAtlasEchoService({ repository: createAtlasEchoRepository({ stateStore: restoredStateStore }), now: () => 1_000 });
    const restoredRuntime = createAtlasCompetitiveRuntime({ identity: restoredIdentity, tickets: restoredTickets, submissions: restoredSubmissions, leaderboard: restoredLeaderboard, beacon: restoredBeacon, echoes: restoredEchoes, stateStore: restoredStateStore, ticketPolicy: { network: 'testalbatross', seasonId: 'season-1', challengeId: 'expedition-1', seed: 'seed-1', campaignHash: 'a'.repeat(64), curriculumHash: 'b'.repeat(64), rulesetHash: 'c'.repeat(64) } });
    await restoredRuntime.load();
    await expect(restoredRuntime.leaderboard('season-1', 'explorer')).resolves.toMatchObject([{ actorId: registered.value.playerId, rank: 1 }]);
  });
});
