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

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const TIMEOUT_MS = 6000;

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface BoardEntry {
  id: string;
  name: string;
  score: number;
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

export async function postScore(submission: ScoreSubmission): Promise<ApiResult<{ rank: number }>> {
  return request<{ rank: number }>('/board', {
    method: 'POST',
    body: JSON.stringify(submission),
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
