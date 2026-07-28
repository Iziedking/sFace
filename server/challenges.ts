/**
 * Challenge records.
 *
 * This service coordinates and the chain settles. It stores who challenged
 * whom, on which seed, for how much, and what each of them scored. It never
 * holds a stake, never has a key, and cannot move anyone's money. That is the
 * design, not a limitation of the sprint.
 *
 * The state machine is small and one-directional:
 *
 *   open -> resolved -> settled
 *
 * A challenge only resolves once, by the first opponent to accept it, and it
 * only settles once. Both transitions are guarded on the current status rather
 * than on the caller's word for it, so a replayed request cannot re-resolve a
 * challenge or overwrite a settlement with a second one.
 */

import { randomUUID } from 'node:crypto';

export const MIN_STAKE_NIM = 1;
export const MAX_STAKE_NIM = 1000;
/** Challenges are for today's mission. A stale one cannot be played fairly. */
const TTL_MS = 48 * 3_600_000;

export type ChallengeStatus = 'open' | 'resolved' | 'settled';

export interface Challenge {
  id: string;
  date: string;
  seed: string;
  stakeNim: number;
  creatorId: string;
  creatorName: string;
  creatorAddress: string | null;
  creatorScore: number;
  opponentId: string | null;
  opponentName: string | null;
  opponentAddress: string | null;
  opponentScore: number | null;
  status: ChallengeStatus;
  settlementTx: string | null;
  createdAt: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string; code: number };

const challenges = new Map<string, Challenge>();

export function create(input: {
  deviceId: string;
  name: string;
  address: string | null;
  date: string;
  seed: string;
  stakeNim: number;
  score: number;
}): Result<Challenge> {
  if (input.stakeNim < MIN_STAKE_NIM || input.stakeNim > MAX_STAKE_NIM) {
    return { ok: false, reason: `Stake must be between ${MIN_STAKE_NIM} and ${MAX_STAKE_NIM} NIM.`, code: 400 };
  }

  const challenge: Challenge = {
    id: randomUUID(),
    date: input.date,
    seed: input.seed,
    stakeNim: input.stakeNim,
    creatorId: input.deviceId,
    creatorName: input.name,
    creatorAddress: input.address,
    creatorScore: input.score,
    opponentId: null,
    opponentName: null,
    opponentAddress: null,
    opponentScore: null,
    status: 'open',
    settlementTx: null,
    createdAt: Date.now(),
  };

  challenges.set(challenge.id, challenge);
  persist();
  return { ok: true, value: challenge };
}

export function get(id: string): Result<Challenge> {
  const challenge = challenges.get(id);
  if (!challenge) return { ok: false, reason: 'No such challenge.', code: 404 };
  if (Date.now() - challenge.createdAt > TTL_MS) {
    return { ok: false, reason: 'That challenge has expired.', code: 410 };
  }
  return { ok: true, value: challenge };
}

export function accept(
  id: string,
  input: {
    deviceId: string;
    name: string;
    address: string | null;
    score: number;
    /** The seed the opponent actually played. */
    seed: string;
  },
): Result<Challenge> {
  const found = get(id);
  if (!found.ok) return found;

  const challenge = found.value;

  // The whole bet rests on both players having run the same level. If the
  // opponent played a different seed, the scores are not comparable and this
  // must not resolve. Checked here and not only in the client, because the
  // client is the side with a reason to skip it.
  if (input.seed !== challenge.seed) {
    return { ok: false, reason: 'That score was set on a different mission.', code: 409 };
  }

  // You cannot take your own bet, and a resolved challenge is closed to
  // everyone. Both are checked here rather than trusted from the client,
  // because the client is the party with the incentive to skip the check.
  if (challenge.creatorId === input.deviceId) {
    return { ok: false, reason: 'That is your own challenge.', code: 409 };
  }
  if (challenge.status !== 'open') {
    return { ok: false, reason: 'That challenge has already been taken.', code: 409 };
  }

  challenge.opponentId = input.deviceId;
  challenge.opponentName = input.name;
  challenge.opponentAddress = input.address;
  challenge.opponentScore = input.score;
  challenge.status = 'resolved';

  persist();
  return { ok: true, value: challenge };
}

/**
 * Record a reported settlement.
 *
 * This is the payer's claim that they sent the stake. There is no node here to
 * check it against, so it is stored and displayed as reported, never as
 * verified, and only the losing side may report it.
 */
export function reportSettlement(
  id: string,
  input: { deviceId: string; serializedTx: string },
): Result<Challenge> {
  const found = get(id);
  if (!found.ok) return found;

  const challenge = found.value;

  if (challenge.status === 'settled') {
    return { ok: false, reason: 'That challenge is already settled.', code: 409 };
  }
  if (challenge.status !== 'resolved') {
    return { ok: false, reason: 'That challenge has not resolved yet.', code: 409 };
  }

  const loserId = loserOf(challenge);
  if (loserId !== input.deviceId) {
    return { ok: false, reason: 'Only the losing side settles.', code: 403 };
  }

  challenge.settlementTx = input.serializedTx;
  challenge.status = 'settled';

  persist();
  return { ok: true, value: challenge };
}

function loserOf(challenge: Challenge): string | null {
  if (challenge.opponentScore === null || challenge.opponentId === null) return null;
  return challenge.opponentScore < challenge.creatorScore
    ? challenge.opponentId
    : challenge.creatorId;
}

/** Strip nothing. Everything in a challenge is already public by design. */
export function toPublic(challenge: Challenge): Omit<Challenge, 'createdAt'> {
  const { createdAt: _createdAt, ...rest } = challenge;
  return rest;
}

// Persistence -------------------------------------------------------------

export function serialise(): unknown {
  return [...challenges.values()];
}

export function restore(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const challenge of raw as Challenge[]) {
    if (challenge && typeof challenge.id === 'string') {
      challenges.set(challenge.id, challenge);
    }
  }
}

export function prune(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, challenge] of challenges) {
    if (challenge.createdAt < cutoff) challenges.delete(id);
  }
}

let persist: () => void = () => {};

export function onChange(handler: () => void): void {
  persist = handler;
}
