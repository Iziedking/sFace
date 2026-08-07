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

/**
 * The working behind a signed row, so anybody can check it without trusting us.
 *
 * Published by the service on every daily row a wallet signed for. It was
 * already going out on the wire and simply had no name on this side, so the
 * board could not show it: exposed in the API and invisible in the app, which
 * is the same as not having done it.
 */
import type { Contest, ContestKind, ContestVisibility } from '../data/contests';

export type { Contest } from '../data/contests';

export interface BoardProof {
  publicKey: string;
  signature: string;
  /** The mission the claim was signed against. */
  seed: string;
  stage: number;
}

export interface BoardEntry {
  id: string;
  name: string;
  score: number;
  /** Set when a wallet signed for this row. Null when nobody did. */
  address?: string | null;
  /** The signature over this exact claim. Null on rows nobody signed. */
  proof?: BoardProof | null;
  /**
   * Transaction hash, when this run was written onto the chain.
   *
   * A different and stronger claim than the signature beside it: a signature
   * lives in the service, an anchor is a transaction that outlives it.
   */
  anchor?: string | null;
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
      /*
       * The wallet this pilot has proved, when they have.
       *
       * Not a signature over the total, and the row says so: it opens a wallet
       * on chain rather than a verified mark. Lifetime Face is a sum of dozens
       * of runs and no signature covers it, so this is the strongest honest
       * claim the ladder can make.
       */
      address: typeof row.address === 'string' ? row.address : null,
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
  /**
   * When it stops being answerable, as epoch milliseconds.
   *
   * The same field a contest carries, from the same rules, so a countdown
   * means one thing across the app. See src/data/contests.ts.
   */
  expiresAt: number;
  /** Set once someone has paid. The receipt, such as it is. */
  settlementTx: string | null;
}

/**
 * The sentence a refusal came with, or null.
 *
 * Never throws. A body that is not JSON, or is JSON without an error string, is
 * the same as no explanation, and a failure to read one must not turn a refused
 * request into a crash.
 */
async function readError(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown };
    const said = typeof body.error === 'string' ? body.error.trim() : '';
    return said.length > 0 ? said.slice(0, 200) : null;
  } catch {
    return null;
  }
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
/** What the board says back when a run is posted. */
export interface ScorePosted {
  rank: number;
  profile?: unknown;
  /**
   * Whether THIS run is the one on the board.
   *
   * The board keeps the best run of the day, and anchoring attaches to that
   * row, so a later and worse run has nothing to attach to. Optional because an
   * older service does not send it, and absent has to mean no rather than yes:
   * offering to anchor a run that cannot be anchored spends a fee to find out.
   */
  onBoard?: boolean;
}

export async function postScore(
  submission: ScoreSubmission,
): Promise<ApiResult<ScorePosted>> {
  return request<ScorePosted>('/board', {
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
      /*
       * Say what the service said, not what number it said it with.
       *
       * Every refusal here carries a sentence written for the player: which
       * count was above what the level contains, that a signature did not match
       * the run, that a contest is full. All of it was thrown away and replaced
       * with the status code, so a run refused for a specific, stateable reason
       * read as "Service returned 422" and every report of it had to be
       * diagnosed from scratch.
       *
       * The body is JSON with an `error` string on every route that refuses.
       * When it is not, the code is still better than nothing, so that stays as
       * the fallback rather than the default.
       */
      const said = await readError(response);
      return { ok: false, error: said ?? `Service returned ${response.status}.` };
    }

    return { ok: true, value: (await response.json()) as T };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return { ok: false, error: aborted ? 'The service timed out.' : 'The service is unreachable.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bind a wallet to a run already on the board.
 *
 * Separate from postScore because the board only replaces a row on a better
 * score, and because the score route folds every submission into the lifetime
 * profile: re-posting to attach a signature would count the run's Face twice.
 */
export async function signPostedScore(body: {
  deviceId: string;
  date: string;
  seed: string;
  stage: number;
  score: number;
  publicKey: string;
  signature: string;
}): Promise<ApiResult<{ ok: boolean; recorded: boolean; address?: string }>> {
  return request('/board/sign', { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Report a run that was written onto the chain.
 *
 * Sends the serialized transaction, not a hash. The service checks it and
 * computes the hash itself, which is the difference between a receipt and a
 * claim. See server/anchor.ts.
 */
export async function anchorPostedScore(body: {
  deviceId: string;
  date: string;
  seed: string;
  stage: number;
  score: number;
  /** Whatever the wallet handed back. The service decides what it is. */
  receipt: string;
  /** What the client thought it received, for diagnosis only. */
  shape?: string;
}): Promise<ApiResult<{
  ok: boolean;
  recorded: boolean;
  hash?: string;
  strength?: 'verified' | 'reported';
}>> {
  return request('/board/anchor', { method: 'POST', body: JSON.stringify(body) });
}

// Contests -----------------------------------------------------------------

/**
 * The contests anybody may enter.
 *
 * Private ones are never in this list. That is enforced on the service rather
 * than filtered here: a client-side filter over a payload that contained them
 * would be a privacy promise kept by the honesty of the reader.
 */
export async function fetchContests(): Promise<ApiResult<Contest[]>> {
  return request<Contest[]>('/contests');
}

export async function fetchContest(id: string): Promise<ApiResult<Contest>> {
  return request<Contest>(`/contests/${encodeURIComponent(id)}`);
}

export async function createContest(body: {
  deviceId: string;
  name: string;
  avatarUrl: string | null;
  /** Where the host is paid. Required by the service for a staked contest. */
  address: string | null;
  kind: ContestKind;
  stages: number[];
  stakeNim: number;
  seats: number;
  visibility: ContestVisibility;
  /** Minutes it stays open, or null for the rest of the UTC day. */
  openMinutes: number | null;
}): Promise<ApiResult<Contest>> {
  return request<Contest>('/contests', { method: 'POST', body: JSON.stringify(body) });
}

export async function joinContest(
  id: string,
  body: {
    deviceId: string;
    name: string;
    avatarUrl: string | null;
    /** Where they are paid if they win. Required on a staked contest. */
    address: string | null;
  },
): Promise<ApiResult<Contest>> {
  return request<Contest>(`/contests/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Report a settled debt.
 *
 * The hash is recorded, never verified: the service has no Nimiq node. It is
 * published beside the debt so the person owed can check it themselves, which
 * is witnessing rather than enforcement.
 */
export async function reportContestPayment(
  id: string,
  body: { deviceId: string; txHash: string },
): Promise<ApiResult<Contest>> {
  return request<Contest>(`/contests/${encodeURIComponent(id)}/settled`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * The room: recent messages, and who said them.
 *
 * People come alongside rather than being looked up one at a time. A hundred
 * lines from a dozen pilots is a dozen profiles, and asking for each of them
 * separately is the difference between one small payload and a hundred.
 */
export interface ChatPerson {
  name: string;
  avatarUrl: string | null;
  clanTag: string | null;
  lifetimeFace: number;
  /** Only ever an address the service proved from a signature. Null otherwise. */
  address: string | null;
}

/**
 * A run somebody posted into the room.
 *
 * Resolved by the service from the sender's own board row, never carried by the
 * message. That is what makes it worth tipping: the score here is the score the
 * board is ranking, not one that arrived attached to a line of text.
 */
export interface RunCard {
  date: string;
  stage: number;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  rank: number;
  signed: boolean;
  anchor: string | null;
}

export interface ChatMessage {
  id: string;
  pilotId: string;
  text: string;
  at: number;
  /** Set when a run was posted, whether or not the row still resolves. */
  runDate: string | null;
  /** When it was last changed. Shown, never quietly applied. */
  editedAt: number | null;
  /**
   * The message this one answers, when it answers one.
   *
   * Resolved where it is drawn rather than sent expanded: the room already
   * holds every message, so a quote is always the current text under the
   * current name, and never a copy that went stale.
   */
  replyTo: string | null;
  /** Null on an ordinary line, and on a card whose board row has aged out. */
  run: RunCard | null;
}

export interface ChatRoom {
  messages: ChatMessage[];
  people: Record<string, ChatPerson>;
  /**
   * The day of a run of yours that could be posted, or null.
   *
   * Answered by the service from the board, in the same request that fetches
   * the room. A share button offered for a run that is not on the board is one
   * that fails when it is pressed.
   */
  shareableRunDate: string | null;
}

export async function fetchChat(deviceId: string): Promise<ApiResult<ChatRoom>> {
  const query = new URLSearchParams({ deviceId });
  const result = await request<{ messages?: unknown; people?: unknown; you?: unknown }>(
    `/chat?${query}`,
  );
  if (!result.ok) return result;

  const rows = Array.isArray(result.value.messages) ? result.value.messages : [];
  const people = (result.value.people ?? {}) as Record<string, ChatPerson>;

  return {
    ok: true,
    value: {
      // Shape-checked rather than cast. Anything malformed becomes a missing
      // line, never an exception in the middle of a render.
      messages: rows.flatMap((row) => {
        const m = row as Record<string, unknown>;
        if (typeof m.id !== 'string' || typeof m.text !== 'string') return [];
        if (typeof m.pilotId !== 'string') return [];
        return [
          {
            id: m.id,
            pilotId: m.pilotId,
            text: m.text,
            at: numberOf(m.at),
            runDate: typeof m.runDate === 'string' ? m.runDate : null,
            editedAt: typeof m.editedAt === 'number' ? m.editedAt : null,
            replyTo: typeof m.replyTo === 'string' ? m.replyTo : null,
            run: runCardOf(m.run),
          },
        ];
      }),
      people,
      shareableRunDate: shareableOf(result.value.you),
    },
  };
}

function shareableOf(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const date = (raw as { runDate?: unknown }).runDate;
  return typeof date === 'string' ? date : null;
}

/**
 * A run card, checked rather than cast.
 *
 * Anything malformed becomes a line without a card, which is the same thing the
 * room shows for a run whose board row has aged out. A half-drawn card with a
 * tip button under it is the one outcome worth going out of the way to avoid.
 */
function runCardOf(raw: unknown): RunCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.date !== 'string' || typeof r.score !== 'number') return null;

  return {
    date: r.date,
    stage: numberOf(r.stage),
    score: r.score,
    facesExtracted: numberOf(r.facesExtracted),
    attackersCleared: numberOf(r.attackersCleared),
    rank: numberOf(r.rank),
    signed: r.signed === true,
    anchor: typeof r.anchor === 'string' ? r.anchor : null,
  };
}

export async function sendChat(body: {
  deviceId: string;
  text: string;
  /** The day of a run to post alongside it. The service resolves the row. */
  runDate?: string | null;
  /** The message being answered, when this is a reply. */
  replyTo?: string | null;
}): Promise<ApiResult<ChatMessage>> {
  return request<ChatMessage>('/chat', { method: 'POST', body: JSON.stringify(body) });
}

/** Change one of your own, inside the window the service allows. */
export async function editChat(body: {
  id: string;
  deviceId: string;
  text: string;
}): Promise<ApiResult<ChatMessage>> {
  return request<ChatMessage>(`/chat/${encodeURIComponent(body.id)}`, {
    method: 'POST',
    body: JSON.stringify({ deviceId: body.deviceId, text: body.text }),
  });
}

export type TipState = 'sent' | 'no-wallet';

export interface TipRecord {
  id: string;
  from: string;
  to: string;
  nim: number;
  state: TipState;
  at: number;
}

export interface TipInbox {
  tips: TipRecord[];
  /** Names for the senders of tips that were sent. A refused one names nobody. */
  people: Record<string, { name: string; avatarUrl: string | null }>;
}

export async function fetchTips(deviceId: string): Promise<ApiResult<TipInbox>> {
  const query = new URLSearchParams({ deviceId });
  const result = await request<{ tips?: unknown; people?: unknown }>(`/tips?${query}`);
  if (!result.ok) return result;

  const rows = Array.isArray(result.value.tips) ? result.value.tips : [];

  return {
    ok: true,
    value: {
      tips: rows.flatMap((row) => {
        const t = row as Record<string, unknown>;
        if (typeof t.id !== 'string' || typeof t.from !== 'string') return [];
        if (typeof t.to !== 'string' || typeof t.nim !== 'number') return [];
        return [
          {
            id: t.id,
            from: t.from,
            to: t.to,
            nim: t.nim,
            state: t.state === 'no-wallet' ? ('no-wallet' as const) : ('sent' as const),
            at: numberOf(t.at),
          },
        ];
      }),
      people: (result.value.people ?? {}) as TipInbox['people'],
    },
  };
}

/**
 * Tell the service a tip was attempted, so the other phone can hear about it.
 *
 * Deliberately says nothing about whether it worked. The service decides that
 * from its own record of who has proved a wallet, because a client claiming
 * money was sent is not evidence that any was.
 */
export async function reportTip(body: {
  deviceId: string;
  to: string;
  nim: number;
  tx?: string | null;
}): Promise<ApiResult<TipRecord>> {
  return request<TipRecord>('/tips', { method: 'POST', body: JSON.stringify(body) });
}

export async function markTipsSeen(deviceId: string): Promise<ApiResult<unknown>> {
  return request('/tips/seen', { method: 'POST', body: JSON.stringify({ deviceId }) });
}
