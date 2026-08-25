import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { commitRelaySeed } from '../shared/relay/commitment';
import { generateRelayMission } from '../shared/relay/mission';
import { replayRelayTrace } from '../shared/relay/replay';
import { RELAY_RULESET } from '../shared/relay/ruleset';
import { allocateRelayPeriodRewards } from '../shared/relay/rewards';
import type { RelayTrace } from '../shared/relay/types';
import { RelayVerifier } from '../server/relay/verifier';
import { createRelayChainStub, createRelayPayoutService } from '../server/relay/payouts';
import { createRelayStore } from '../server/relay/store';

export async function buildRelayProof(): Promise<Record<string, unknown>> {
  const missionDate = '2026-08-24';
  const seedHex = '01'.repeat(32);
  const seedCommitment = await commitRelaySeed({ ruleset: RELAY_RULESET.version, missionDate, seedHex });
  const mission = { ...generateRelayMission(seedHex, RELAY_RULESET), missionDate, seedCommitment };
  const trace: RelayTrace = { version: 1, ruleset: RELAY_RULESET.version, missionDate, seedCommitment, ticketId: 'proof-ticket', segments: [{ startTick: 0, tickCount: 1_350, steerX: 0, flags: 0 }] };
  const verifier = new RelayVerifier();
  const verified = await verifier.verify({ actorId: 'proof-actor', mission, trace, ruleset: RELAY_RULESET });
  if (!verified.ok) throw new Error('Golden replay proof failed.');
  const forged = await new RelayVerifier().verify({ actorId: 'proof-actor', mission, trace, ruleset: RELAY_RULESET, claimedResult: { ...verified.result, score: verified.result.score + 1 } });

  const runs = ['wallet-a', 'wallet-b', 'wallet-c'].flatMap((walletAddress, walletIndex) => Array.from({ length: 4 }, (_, dayIndex) => ({ walletAddress, actorId: `${walletAddress}-actor`, missionDate: `2026-08-${24 + dayIndex}`, score: 300 - walletIndex * 10, bankedNodes: 3, bestChain: 3, damageTaken: 0, integrityRemaining: 3 })));
  const rewards = allocateRelayPeriodRewards('week-1', runs);
  const rewardConserved = rewards.poolLuna === rewards.obligationsLuna + rewards.remainderLuna;

  const directory = await mkdtemp(joinPath(tmpdir(), 'sface-relay-proof-'));
  try {
    const payout = createRelayPayoutService({ store: createRelayStore({ dataDirectory: directory }), chain: createRelayChainStub({ network: 'test', confirmations: 10, sender: 'NQtreasury', recipient: 'NQwinner', valueLuna: 1, success: true, canonical: true }), treasuryAddress: 'NQtreasury', minConfirmations: 10, network: 'test' });
    await payout.create({ id: 'proof-payout', period: 'week-1', walletAddress: 'NQwinner', amountLuna: 1 });
    await payout.approve('proof-payout');
    await payout.recordSubmitted('proof-payout', 'proof-hash');
    const verifiedPayout = await payout.reconcile('proof-payout');
    return { seedCommitmentMatch: seedCommitment === mission.seedCommitment, goldenReplay: { score: verified.result.score, completedTicks: verified.result.completedTicks }, forgedReplayRefused: !forged.ok, rewardConservation: { poolLuna: rewards.poolLuna, obligationsLuna: rewards.obligationsLuna, remainderLuna: rewards.remainderLuna, conserved: rewardConserved }, payoutVerification: verifiedPayout.status };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function joinPath(left: string, right: string): string { return resolve(left, right); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await buildRelayProof(), null, 2));
}
