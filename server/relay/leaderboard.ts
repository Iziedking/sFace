export interface RelayLeaderboardRun {
  id: string;
  actorId: string;
  missionDate: string;
  walletAddress: string;
  result: { score: number; bankedNodes: number; bestChain: number; damageTaken: number; integrityRemaining: number };
}

export interface RelayLeaderboardRow {
  rank: number;
  runId: string;
  actorId: string;
  wallet: string;
  score: number;
  bankedNodes: number;
  bestChain: number;
  damageTaken: number;
  integrityRemaining: number;
}

export interface RelayLeaderboardService {
  daily(missionDate: string): Promise<RelayLeaderboardRow[]>;
}

export function maskRelayAddress(address: string): string {
  const compact = address.replace(/\s+/g, '');
  if (compact.length < 8) return 'unknown';
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

export function createRelayLeaderboardService(options: { runs: () => Promise<RelayLeaderboardRun[] | readonly RelayLeaderboardRun[]> }): RelayLeaderboardService {
  return {
    async daily(missionDate) {
      const runs = (await options.runs()).filter((run) => run.missionDate === missionDate);
      const bestByActor = new Map<string, RelayLeaderboardRun>();
      for (const run of runs) {
        const current = bestByActor.get(run.actorId);
        if (!current || compareRuns(run, current) < 0) bestByActor.set(run.actorId, run);
      }
      const ordered = [...bestByActor.values()].sort(compareRuns);
      return ordered.map((run, index) => {
        const previous = ordered[index - 1];
        const rank = previous && compareRuns(run, previous) === 0 ? index : index + 1;
        return {
          rank,
          runId: run.id,
          actorId: run.actorId,
          wallet: maskRelayAddress(run.walletAddress),
          score: run.result.score,
          bankedNodes: run.result.bankedNodes,
          bestChain: run.result.bestChain,
          damageTaken: run.result.damageTaken,
          integrityRemaining: run.result.integrityRemaining,
        };
      });
    },
  };
}

function compareRuns(left: RelayLeaderboardRun, right: RelayLeaderboardRun): number {
  return right.result.score - left.result.score
    || right.result.bankedNodes - left.result.bankedNodes
    || right.result.bestChain - left.result.bestChain
    || left.result.damageTaken - right.result.damageTaken
    || right.result.integrityRemaining - left.result.integrityRemaining;
}
