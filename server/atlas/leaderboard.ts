import type { AtlasAssistance, AtlasRole } from '../../shared/atlas/types';

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
      if (!current || run.score > current.score || run.score === current.score && run.runId.localeCompare(current.runId) < 0) best.set(key, { ...run });
      const row = (await this.list(run.seasonId, run.role)).find((item) => item.actorId === run.actorId);
      if (!row) throw new AtlasLeaderboardError('invalid', 'Accepted leaderboard run is not readable.');
      return row;
    },
    async list(seasonId, role) {
      const rows = [...best.values()].filter((run) => run.seasonId === seasonId && run.role === role).sort((left, right) => right.score - left.score || left.actorId.localeCompare(right.actorId) || left.walletAddress.localeCompare(right.walletAddress));
      let previousScore: number | undefined;
      return rows.map((run, index) => {
        const rank = previousScore === run.score ? index : index + 1;
        previousScore = run.score;
        return { ...run, rank };
      });
    },
  };
}

function validate(run: AtlasLeaderboardRun): void {
  if (!run.runId || !run.actorId || !run.walletAddress || !/^[a-f0-9]{64}$/.test(run.replayHash) || !Number.isSafeInteger(run.score) || run.score < 0) throw new AtlasLeaderboardError('invalid', 'Atlas leaderboard run is malformed.');
}
