import type { AtlasStateStore } from './persistence';
import type { AtlasBeaconProjection, AtlasBeaconRead, AtlasBeaconService } from './beacon';
import type { AtlasEchoRead, AtlasEchoService } from './echoes';
import type { AtlasIdentityService } from './identity';
import type { AtlasLeaderboardRow, AtlasLeaderboardService } from './leaderboard';
import type { AtlasSubmissionInput, AtlasSubmissionService, AtlasVerifiedRun } from './submissions';
import type { AtlasTicketRecord, AtlasTicketService } from './tickets';
import type { AtlasRole } from '../../shared/atlas/types';
import { createAtlasCompetitionSummary, type AtlasCompetitionSummary } from './rewards';

export interface AtlasCompetitiveTicketPolicy {
  network: 'testalbatross';
  seasonId: string;
  challengeId: string;
  seed: string;
  campaignHash: string;
  curriculumHash: string;
  rulesetHash: string;
}

export interface AtlasServerTicketRequest {
  actorId: string;
  walletAddress: string;
  role: AtlasRole;
}

export interface AtlasCompetitiveRuntime {
  issueTicket(input: Parameters<AtlasTicketService['issue']>[0]): Promise<AtlasTicketRecord>;
  issueServerTicket(input: AtlasServerTicketRequest): Promise<AtlasTicketRecord>;
  submit(input: AtlasSubmissionInput): Promise<{ run: AtlasVerifiedRun; row: AtlasLeaderboardRow; beacon: AtlasBeaconProjection | null }>;
  leaderboard(seasonId: string, role: AtlasRole): Promise<AtlasLeaderboardRow[]>;
  competition(): Promise<AtlasCompetitionSummary[]>;
  beacon(): Promise<AtlasBeaconRead>;
  echoes(): Promise<AtlasEchoRead>;
  load(): Promise<void>;
}

export function createAtlasCompetitiveRuntime(options: {
  identity: AtlasIdentityService;
  tickets: AtlasTicketService;
  submissions: AtlasSubmissionService;
  leaderboard: AtlasLeaderboardService;
  beacon: AtlasBeaconService;
  echoes: AtlasEchoService;
  stateStore: AtlasStateStore;
  date?: () => string;
  repairUnits?: (run: AtlasVerifiedRun) => number;
  ticketPolicy?: AtlasCompetitiveTicketPolicy;
}): AtlasCompetitiveRuntime {
  const date = options.date ?? (() => new Date().toISOString().slice(0, 10));
  const repairUnits = options.repairUnits ?? ((run) => Math.max(1, Math.floor((run.mastery?.total ?? run.score) / 100)));
  let operations: Promise<void> = Promise.resolve();
  let loaded = false;

  async function persist(): Promise<void> {
    await options.stateStore.save('competitive', {
      version: 1,
      identity: options.identity.serialise(),
      tickets: options.tickets.serialise(),
      submissions: options.submissions.serialise(),
      leaderboard: options.leaderboard.serialise(),
    });
  }

  async function load(): Promise<void> {
    if (loaded) return;
    const state = await options.stateStore.load('competitive', null) as {
      version: 1;
      identity: unknown;
      tickets: unknown;
      submissions: unknown;
      leaderboard: unknown;
    } | null;
    if (state?.version === 1) {
      options.identity.restore(state.identity);
      options.tickets.restore(state.tickets);
      options.submissions.restore(state.submissions);
      options.leaderboard.restore(state.leaderboard);
    }
    loaded = true;
  }

  async function serialise<T>(operation: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    let failure: unknown;
    operations = operations.catch(() => undefined).then(async () => {
      try { result = await operation(); await persist(); } catch (error) { failure = error; }
    });
    await operations;
    if (failure) throw failure;
    return result as T;
  }

  return {
    async issueTicket(input) {
      await load();
      return serialise(() => options.tickets.issue(input));
    },
    async issueServerTicket(input) {
      const ticketPolicy = options.ticketPolicy;
      if (!ticketPolicy) throw new Error('Atlas competitive ticket policy is unavailable.');
      await load();
      return serialise(() => options.tickets.issue({ ...input, ...ticketPolicy }));
    },
    async submit(input) {
      await load();
      return serialise(async () => {
        const run = await options.submissions.submit(input);
        const row = await options.leaderboard.accept({ runId: run.runId, actorId: run.actorId, walletAddress: run.walletAddress, role: run.role, seasonId: run.seasonId, score: run.score, assistance: run.assistance, prizeEligible: run.prizeEligible, replayHash: run.replayHash, mastery: run.mastery });
        const today = date();
        const beacon = run.prizeEligible ? await options.beacon.apply({ date: today, districtId: 'pay-harbor', actorId: run.actorId, walletAddress: run.walletAddress, runId: run.runId, score: row.score, repairUnits: repairUnits(run), verified: true, prizeEligible: run.prizeEligible }) : null;
        if (run.prizeEligible) await options.echoes.record({ date: today, districtId: 'pay-harbor', actorId: run.actorId, walletAddress: run.walletAddress, runId: run.runId, score: row.score, verified: true, prizeEligible: true, action: 'celebrate', observedAt: run.verifiedAt, displayName: 'Atlas pilot', displayNameOptIn: false });
        return { run, row, beacon };
      });
    },
    leaderboard: async (seasonId, role) => { await load(); return options.leaderboard.list(seasonId, role); },
    competition: async () => {
      await load();
      if (!options.ticketPolicy) throw new Error('Atlas competitive ticket policy is unavailable.');
      const rows = (await Promise.all((['explorer', 'builder'] as const).map((role) => options.leaderboard.list(options.ticketPolicy!.seasonId, role)))).flat();
      return (['explorer', 'builder'] as const).map((role) => {
        const best = rows.filter((row) => row.role === role).sort((left, right) => (right.mastery?.total ?? right.score) - (left.mastery?.total ?? left.score))[0];
        return createAtlasCompetitionSummary({ role, bestVerifiedScore: best ? (best.mastery?.total ?? best.score) : null, assistance: best?.assistance ?? 'none', daily: { accepted: false, closed: false, amountLuna: null, payoutVerified: false } });
      });
    },
    beacon: async () => { await load(); return options.beacon.read(); },
    echoes: async () => { await load(); return options.echoes.read(); },
    load,
  };
}
