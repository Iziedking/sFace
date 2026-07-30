/**
 * The client half of the oracle and challenge service.
 *
 * Every call here can fail and none of them are allowed to break the game. The
 * leaderboard being down means you see your score without a rank, not that you
 * see an error screen after a good run. So every function returns a result
 * union rather than throwing, and every caller is expected to have a sentence
 * ready for the failure case.
 *
 * Timeouts are short on purpose. This runs on mobile data inside a WebView, and
 * a fetch with no timeout is a spinner that never ends.
 */

import { networkHeaders } from '../core/network';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const TIMEOUT_MS = 6000;

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface BoardEntry {
  id: string;
  name: string;
  score: number;
  /** Set when a wallet signed for this row. Null when nobody did. */
  address?: string | null;
  avatarUrl?: string | null;
  clanTag?: string | null;
  /** Lifetime Face, so a row can show a rank badge. Daily rows carry it too. */
  lifetimeFace?: number;
}

/** The all-time board is a list of profiles ranked on lifetime Face. */
export async function fetchAllTime(): Promise<ApiResult<BoardEntry[]>> {
  const result = await request<Array<Record<string, unknown>>>('/board/all-time');
  if (!result.ok) return result;

  return {
    ok: true,
    value: result.value.map((row) => ({
      id: String(row.id ?? ''),
      name: typeof row.name === 'string' ? row.name : 'Pilot',
      // All-time ranks on the lifetime total, so that is the number shown.
      score: numberOf(row.lifetimeFace),
      avatarUrl: typeof row.avatarUrl === 'string' ? row.avatarUrl : null,
      clanTag: typeof row.clanTag === 'string' ? row.clanTag : null,
      lifetimeFace: numberOf(row.lifetimeFace),
    })),
  };
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
}

export interface ScoreSubmission {
  deviceId: string;
  name: string;
  date: string;
  seed: string;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  /** Seconds the run lasted. The server uses it as a plausibility check. */
  duration: number;
  /** Folded into the lifetime record alongside the daily board entry. */
  cachesTaken: number;
  relicTaken: boolean;
  extracted: boolean;
  avatarUrl: string | null;
  /** Which campaign stage this was, and whether it met the objective. */
  stage: number;
  stageCleared: boolean;
  /**
   * The wallet's signature over this exact claim, when one was given.
   *
   * No address field, deliberately. The service derives the address from the
   * public key, so there is nowhere for a client to assert an identity it
   * cannot prove.
   */
  publicKey?: string;
  signature?: string;
}

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
  /** Set once someone has paid. The receipt, such as it is. */
  settlementTx: string | null;
}

export function apiConfigured(): boolean {
  return API_BASE.length > 0;
}

export async function fetchBoard(date: string): Promise<ApiResult<BoardEntry[]>> {
  return request<BoardEntry[]>(`/board/${encodeURIComponent(date)}`);
}

/**
 * Post a run. Returns the daily rank and the updated lifetime record.
 *
 * Both come back from the one call on purpose: a rank that disagreed with the
 * profile strip on the same screen would be a bug the player can see, and two
 * calls is exactly how that happens.
 */
export async function postScore(
  submission: ScoreSubmission,
): Promise<ApiResult<{ rank: number; profile?: unknown }>> {
  return request<{ rank: number; profile?: unknown }>('/board', {
    method: 'POST',
    body: JSON.stringify(submission),
  });
}

// Clans --------------------------------------------------------------------

export interface ClanRow {
  tag: string;
  /** Pooled lifetime Face across every member. */
  face: number;
  members: number;
  bestScore: number;
  topPilot: string | null;
  topPilotAvatar: string | null;
}

export interface ClanMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  lifetimeFace: number;
  runs: number;
}

export interface ClanRequest {
  id: string;
  name: string;
  askedAt: number;
}

export interface ClanDetail extends ClanRow {
  place: number;
  roster: ClanMember[];
  ownerId: string | null;
  ownerName: string | null;
  /** Pilots waiting on the owner. Only actionable by the owner. */
  pending: ClanRequest[];
}

export type JoinOutcome =
  | { status: 'founded'; tag: string }
  | { status: 'member'; tag: string }
  | { status: 'requested'; tag: string; ownerName: string | null }
  | { status: 'left' }
  | { status: 'refused'; reason: string };

export interface JoinResponse {
  outcome: JoinOutcome;
  profile: unknown;
  /** Tags this pilot has an outstanding request on. */
  pending: string[];
}

export async function fetchClans(): Promise<ApiResult<ClanRow[]>> {
  return request<ClanRow[]>('/clans');
}

export async function fetchClan(tag: string): Promise<ApiResult<ClanDetail>> {
  return request<ClanDetail>(`/clans/${encodeURIComponent(tag)}`);
}

/**
 * Found a clan, ask to join one, or leave.
 *
 * All three are one call because from the service's side they are one write.
 * The outcome says which of them actually happened, and it matters: founding
 * puts you in immediately, asking does not.
 */
export async function joinClan(body: {
  deviceId: string;
  name: string;
  tag: string | null;
}): Promise<ApiResult<JoinResponse>> {
  return request<JoinResponse>('/clans/join', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** The owner lets someone in or turns them away. The service checks who asked. */
export async function decideClanRequest(
  tag: string,
  body: { deviceId: string; memberId: string; approve: boolean },
): Promise<ApiResult<ClanDetail>> {
  return request<ClanDetail>(`/clans/${encodeURIComponent(tag)}/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// CT Signals ---------------------------------------------------------------

export interface Engager {
  handle: string;
  touches: number;
  followers: number;
  clanTag: string | null;
  playing: boolean;
}

export interface Signals {
  handle: string;
  reach: number;
  touches: number;
  top: Engager[];
  clans: Array<{ tag: string; among: number }>;
  depth: 'glance' | 'full';
  moreAtFull: number;
  priceNim: number;
  /** Where a deep read is paid to. Null means it is simply free here. */
  treasury: string | null;
  unlocked: boolean;
}

export async function fetchSignals(
  handle: string,
  deviceId: string,
  depth: 'glance' | 'full',
): Promise<ApiResult<Signals>> {
  const query = new URLSearchParams({ deviceId, depth });
  return request<Signals>(`/signals/${encodeURIComponent(handle)}?${query.toString()}`);
}

/** Report the payment. Reported, not verified: see the README. */
export async function unlockSignals(body: {
  deviceId: string;
  serializedTx: string;
}): Promise<ApiResult<{ unlocked: boolean }>> {
  return request<{ unlocked: boolean }>('/signals/unlock', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface GhostRecord {
  id: string;
  name: string;
  score: number;
  facesExtracted: number;
  /** Base64 position trace. Decoded by src/game/ghost.ts, which validates it. */
  trace: string;
}

/**
 * The best recorded runs on this seed, to fly beside. Excludes the caller,
 * since flying next to a replay of yourself is a strange experience.
 */
export async function fetchGhosts(
  seed: string,
  deviceId: string | null,
  limit = 4,
): Promise<ApiResult<GhostRecord[]>> {
  const query = new URLSearchParams({ seed, limit: String(limit) });
  if (deviceId) query.set('exclude', deviceId);
  return request<GhostRecord[]>(`/ghosts?${query.toString()}`);
}

export async function postGhost(body: {
  deviceId: string;
  name: string;
  seed: string;
  score: number;
  facesExtracted: number;
  trace: string;
}): Promise<ApiResult<{ stored: boolean }>> {
  return request<{ stored: boolean }>('/ghosts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createChallenge(body: {
  deviceId: string;
  name: string;
  address: string | null;
  date: string;
  seed: string;
  stakeNim: number;
  score: number;
}): Promise<ApiResult<Challenge>> {
  return request<Challenge>('/challenges', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchChallenge(id: string): Promise<ApiResult<Challenge>> {
  return request<Challenge>(`/challenges/${encodeURIComponent(id)}`);
}

export async function acceptChallenge(
  id: string,
  body: {
    deviceId: string;
    name: string;
    address: string | null;
    score: number;
    /** The seed we actually played. The server refuses a mismatch. */
    seed: string;
  },
): Promise<ApiResult<Challenge>> {
  return request<Challenge>(`/challenges/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Record that the stake was paid. The serialized transaction is the receipt.
 *
 * This is a claim by the payer, not proof: the server has no Nimiq node to
 * verify against in this build. It is stored and displayed as "reported", and
 * the README says so. Calling it verified when it is not would be worse than
 * not having it.
 */
export async function reportSettlement(
  id: string,
  body: { deviceId: string; serializedTx: string },
): Promise<ApiResult<Challenge>> {
  return request<Challenge>(`/challenges/${encodeURIComponent(id)}/settled`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  if (!API_BASE) {
    return { ok: false, error: 'No service configured.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        // Every call carries the network, so the service never has to guess
        // whether a request is a rehearsal or the real thing. See core/network.
        ...networkHeaders(),
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      return { ok: false, error: `Service returned ${response.status}.` };
    }

    return { ok: true, value: (await response.json()) as T };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return { ok: false, error: aborted ? 'The service timed out.' : 'The service is unreachable.' };
  } finally {
    clearTimeout(timer);
  }
}
