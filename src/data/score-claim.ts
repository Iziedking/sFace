/** Fields bound into the wallet signature for a posted score. */
export interface ScoreClaim {
  date: string;
  seed: string;
  stage: number;
  score: number;
}

/**
 * The single canonical score message used by both signer and verifier.
 *
 * Every field that could be swapped for a better result is included so a
 * signature cannot be replayed across dates, missions, stages, or scores.
 */
export function scoreClaimMessage(claim: ScoreClaim): string {
  return `sface:${claim.date}:${claim.seed}:s${claim.stage}:${claim.score}`;
}
