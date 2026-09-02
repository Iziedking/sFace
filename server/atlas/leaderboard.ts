import type { AtlasAssistance, AtlasRole } from '../../shared/atlas/types';
import type { AtlasMasteryBreakdown } from '../../shared/atlas/mastery';

export interface AtlasLeaderboardRun {
  runId: string;
  actorId: string;
  walletAddress: string;
  role: AtlasRole;
  seasonId: string;
  score: number;
  assistance: AtlasAssistance;
  prizeEligible: boolean;
  replayHash: string;
  mastery?: AtlasMasteryBreakdown;
}

export interface AtlasLeaderboardRow extends AtlasLeaderboardRun {
  rank: number;
}

export interface AtlasLeaderboardService {
  accept(run: AtlasLeaderboardRun): Promise<AtlasLeaderboardRow>;
  list(seasonId: string, role: AtlasRole): Promise<AtlasLeaderboardRow[]>;
}

export class AtlasLeaderboardError extends Error {
  constructor(readonly code: 'invalid' | 'wallet' | 'assisted', message: string) {
    super(message);
    this.name = 'AtlasLeaderboardError';
  }
}

export function createAtlasLeaderboardService(): AtlasLeaderboardService {
  const best = new Map<string, AtlasLeaderboardRun>();
  const actorWallet = new Map<string, string>();
  const walletActor = new Map<string, string>();
  return {
    async accept(run) {
      validate(run);
      if (run.assistance !== 'none' && run.assistance !== 'free-hint' || !run.prizeEligible) throw new AtlasLeaderboardError('assisted', 'Assisted runs cannot enter the prize leaderboard.');
      const actorKey = `${run.seasonId}:${run.actorId}`;
      const walletKey = `${run.seasonId}:${run.walletAddress}`;
      if (actorWallet.has(actorKey) && actorWallet.get(actorKey) !== run.walletAddress) throw new AtlasLeaderboardError('wallet', 'Actor is already bound to another wallet in this season.');
      if (walletActor.has(walletKey) && walletActor.get(walletKey) !== run.actorId) throw new AtlasLeaderboardError('wallet', 'Wallet is already bound to another actor in this season.');
      actorWallet.set(actorKey, run.walletAddress);
      walletActor.set(walletKey, run.actorId);
      const key = `${run.seasonId}:${run.role}:${run.actorId}`;
      const current = best.get(key);
      if (!current || rankScore(run) > rankScore(current) || rankScore(run) === rankScore(current) && run.runId.localeCompare(current.runId) < 0) best.set(key, { ...run });
      const row = (await this.list(run.seasonId, run.role)).find((item) => item.actorId === run.actorId);
      if (!row) throw new AtlasLeaderboardError('invalid', 'Accepted leaderboard run is not readable.');
      return row;
    },
    async list(seasonId, role) {
      const rows = [...best.values()].filter((run) => run.seasonId === seasonId && run.role === role).sort((left, right) => rankScore(right) - rankScore(left) || left.actorId.localeCompare(right.actorId) || left.walletAddress.localeCompare(right.walletAddress));
      let previousScore: number | undefined;
      return rows.map((run, index) => {
        const score = rankScore(run);
        const rank = previousScore === score ? index : index + 1;
        previousScore = score;
        return { ...run, rank };
      });
    },
  };
}

function validate(run: AtlasLeaderboardRun): void {
  if (!run.runId || !run.actorId || !run.walletAddress || !/^[a-f0-9]{64}$/.test(run.replayHash) || !Number.isSafeInteger(run.score) || run.score < 0) throw new AtlasLeaderboardError('invalid', 'Atlas leaderboard run is malformed.');
  if (run.mastery !== undefined && !validMastery(run.mastery)) throw new AtlasLeaderboardError('invalid', 'Atlas leaderboard mastery is malformed.');
}

function rankScore(run: AtlasLeaderboardRun): number {
  return run.mastery?.total ?? run.score;
}

function validMastery(value: AtlasMasteryBreakdown): boolean {
  return [value.knowledge, value.execution, value.safety, value.efficiency, value.total].every((item) => Number.isSafeInteger(item) && item >= 0)
    && value.knowledge <= 4_000 && value.execution <= 3_000 && value.safety <= 1_500 && value.efficiency <= 1_500 && value.total <= 10_000
    && value.total === value.knowledge + value.execution + value.safety + value.efficiency;
}
