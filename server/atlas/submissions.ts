import { hashAtlasActions, replayAtlasActions, scoreAtlasSnapshot } from '../../shared/atlas/replay';
import type { AtlasAction, AtlasSnapshot } from '../../shared/atlas/state';
import type { AtlasAssistance, AtlasNetwork, AtlasRole } from '../../shared/atlas/types';
import type { AtlasMissionDefinition } from '../../shared/atlas/world';
import type { AtlasTicketService } from './tickets';

export interface AtlasSubmissionInput {
  runId: string;
  ticketId: string;
  actorId: string;
  walletAddress: string;
  network: AtlasNetwork;
  role: AtlasRole;
  seasonId: string;
  challengeId: string;
  origin: string;
  campaignHash: string;
  curriculumHash: string;
  rulesetHash: string;
  assistance: AtlasAssistance;
  actions: AtlasAction[];
  claimedSnapshot: AtlasSnapshot;
  replayHash: string;
}

export interface AtlasVerifiedRun {
  runId: string;
  actorId: string;
  walletAddress: string;
  role: AtlasRole;
  seasonId: string;
  challengeId: string;
  score: number;
  correct: boolean;
  assistance: AtlasAssistance;
  prizeEligible: boolean;
  replayHash: string;
  verifiedAt: number;
  status: 'verified';
  duplicate?: boolean;
}

export interface AtlasPendingRun {
  status: 'awaiting-verification';
  input: AtlasSubmissionInput;
  fingerprint: string;
}

export interface AtlasSubmissionSnapshot {
  version: 1;
  runs: Array<AtlasVerifiedRun & { fingerprint: string }>;
  pending: AtlasPendingRun[];
}

export interface AtlasSubmissionService {
  submit(input: AtlasSubmissionInput): Promise<AtlasVerifiedRun>;
  stage(input: AtlasSubmissionInput): Promise<AtlasPendingRun>;
  reconcileAwaiting(): Promise<AtlasVerifiedRun[]>;
  get(runId: string): AtlasVerifiedRun | null;
  serialise(): AtlasSubmissionSnapshot;
  restore(raw: unknown): void;
}

export class AtlasSubmissionError extends Error {
  constructor(readonly code: 'invalid' | 'origin' | 'network' | 'ticket' | 'duplicate' | 'assisted', message: string) {
    super(message);
    this.name = 'AtlasSubmissionError';
  }
}

export function createAtlasSubmissionService(options: { tickets: AtlasTicketService; expectedOrigin: string; mission: AtlasMissionDefinition; now?: () => number }): AtlasSubmissionService {
  const now = options.now ?? Date.now;
  const runs = new Map<string, { run: AtlasVerifiedRun; fingerprint: string }>();
  const pending = new Map<string, AtlasPendingRun>();
  return {
    async submit(input) {
      const fingerprint = await fingerprintSubmission(input);
      const existing = runs.get(input.runId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new AtlasSubmissionError('duplicate', 'A different submission already uses this run id.');
        return { ...existing.run, duplicate: true };
      }
      if (!pending.has(input.runId)) await this.stage(input);
      const reconciled = await reconcileRun(input.runId);
      if (!reconciled) throw new AtlasSubmissionError('invalid', 'Atlas awaiting run could not be reconciled.');
      return reconciled;
    },
    async stage(input) {
      const fingerprint = await fingerprintSubmission(input);
      const existing = runs.get(input.runId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new AtlasSubmissionError('duplicate', 'A different submission already uses this run id.');
        return { status: 'awaiting-verification', input: structuredClone(input), fingerprint };
      }
      const held = pending.get(input.runId);
      if (held) {
        if (held.fingerprint !== fingerprint) throw new AtlasSubmissionError('duplicate', 'A different awaiting submission already uses this run id.');
        return structuredClone(held);
      }
      assertSubmissionEnvelope(input, options);
      pending.set(input.runId, { status: 'awaiting-verification', input: structuredClone(input), fingerprint });
      return structuredClone(pending.get(input.runId)!);
    },
    async reconcileAwaiting() {
      const reconciled: AtlasVerifiedRun[] = [];
      for (const runId of [...pending.keys()]) {
        const run = await reconcileRun(runId);
        if (run) reconciled.push(run);
      }
      return reconciled;
    },
    get(runId) {
      const existing = runs.get(runId);
      return existing ? { ...existing.run } : null;
    },
    serialise() {
      return { version: 1, runs: [...runs.values()].map(({ run, fingerprint }) => ({ ...run, fingerprint, duplicate: undefined })), pending: [...pending.values()].map((item) => structuredClone(item)) };
    },
    restore(raw) {
      if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { runs?: unknown }).runs) || !Array.isArray((raw as { pending?: unknown }).pending)) throw new AtlasSubmissionError('invalid', 'Atlas submission snapshot is unsupported.');
      runs.clear();
      pending.clear();
      for (const stored of (raw as AtlasSubmissionSnapshot).runs) {
        if (!stored || typeof stored.runId !== 'string' || stored.status !== 'verified' || !Number.isSafeInteger(stored.score) || !/^[a-f0-9]{64}$/.test(stored.replayHash) || !/^[a-f0-9]{64}$/.test(stored.fingerprint)) continue;
        const { fingerprint, duplicate: _duplicate, ...run } = stored;
        runs.set(run.runId, { run, fingerprint });
      }
      for (const item of (raw as AtlasSubmissionSnapshot).pending) if (item?.status === 'awaiting-verification' && item.input?.runId && /^[a-f0-9]{64}$/.test(item.fingerprint)) pending.set(item.input.runId, structuredClone(item));
    },
  };

  async function reconcileRun(runId: string): Promise<AtlasVerifiedRun | null> {
    const held = pending.get(runId);
    if (!held) return runs.get(runId)?.run ?? null;
    const input = held.input;
    const expectedReplayHash = await hashAtlasActions(input.actions);
    if (expectedReplayHash !== input.replayHash) throw new AtlasSubmissionError('invalid', 'Atlas replay hash does not match canonical actions.');
    const authoritative = replayAtlasActions(options.mission, input.actions);
    if (stableJson(authoritative) !== stableJson(input.claimedSnapshot)) throw new AtlasSubmissionError('invalid', 'Atlas claimed snapshot differs from authoritative replay.');
    await options.tickets.consume({ ticketId: input.ticketId, actorId: input.actorId, walletAddress: input.walletAddress, runId: input.runId, now: now() });
    const run: AtlasVerifiedRun = { runId: input.runId, actorId: input.actorId, walletAddress: input.walletAddress, role: input.role, seasonId: input.seasonId, challengeId: input.challengeId, score: scoreAtlasSnapshot(authoritative), correct: authoritative.phase === 'completed', assistance: input.assistance, prizeEligible: input.assistance === 'none', replayHash: input.replayHash, verifiedAt: now(), status: 'verified' };
    runs.set(input.runId, { run, fingerprint: held.fingerprint });
    pending.delete(input.runId);
    return { ...run };
  }
}

function assertSubmissionEnvelope(input: AtlasSubmissionInput, options: { tickets: AtlasTicketService; expectedOrigin: string }): void {
  if (input.origin !== options.expectedOrigin) throw new AtlasSubmissionError('origin', 'Atlas submission origin is not allowed.');
  if (input.network !== 'testalbatross') throw new AtlasSubmissionError('network', 'Competitive Atlas submissions are disabled on mainnet.');
  if (input.assistance !== 'none' && input.assistance !== 'free-hint') throw new AtlasSubmissionError('assisted', 'Assisted runs cannot enter the competitive board.');
  const ticket = options.tickets.get(input.ticketId);
  const mismatch = ticket ? [ticket.actorId !== input.actorId && 'actor', ticket.walletAddress !== input.walletAddress && 'wallet', ticket.role !== input.role && 'role', ticket.seasonId !== input.seasonId && 'season', ticket.challengeId !== input.challengeId && 'challenge', ticket.campaignHash !== input.campaignHash && 'campaign', ticket.curriculumHash !== input.curriculumHash && 'curriculum', ticket.rulesetHash !== input.rulesetHash && 'ruleset'].filter(Boolean) : ['missing'];
  if (!ticket || mismatch.length > 0) throw new AtlasSubmissionError('ticket', `Atlas submission does not match its one-time ticket (${mismatch.join(',')}).`);
  if (ticket.usedByRunId && ticket.usedByRunId !== input.runId) throw new AtlasSubmissionError('ticket', 'Atlas ticket has already been consumed by another run.');
}

async function fingerprintSubmission(input: AtlasSubmissionInput): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson({ runId: input.runId, ticketId: input.ticketId, actorId: input.actorId, walletAddress: input.walletAddress, network: input.network, role: input.role, seasonId: input.seasonId, challengeId: input.challengeId, origin: input.origin, campaignHash: input.campaignHash, curriculumHash: input.curriculumHash, rulesetHash: input.rulesetHash, assistance: input.assistance, actions: input.actions, claimedSnapshot: input.claimedSnapshot, replayHash: input.replayHash }));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}
