/**
 * The daily leaderboard, keyed by device identifier.
 *
 * On score verification, honestly: a client can lie about its score, and this
 * build does not replay input traces to prove otherwise. What it does instead
 * is proportionate and stated plainly in the README rather than dressed up as
 * security:
 *
 *   - Scores above a ceiling derived from the game's own maximums are refused,
 *     so the board cannot be filled with nonsense.
 *   - The run duration has to be physically possible for the score claimed.
 *   - One entry per device per day, best score kept, so a bot cannot flood it.
 *
 * That is a speed bump, not a lock. Calling it verified would be a lie, and an
 * unverifiable claim on a leaderboard costs less than a false one.
 */

import { STAGES } from '../src/data/campaign';

/**
 * A coarse outer bound, not the real check.
 *
 * verify.ts builds the actual level from the seed and refuses anything that
 * level cannot pay, which is exact and per-seed. This exists only to throw out
 * numbers that are not worth building a level for.
 *
 * It used to be 60,000, which is BELOW what a good stage seven run can legally
 * earn: the per-level ceiling for that stage comes out near 70,000. Its own
 * comment records this exact mistake happening once before, when the ceiling
 * was 30,000 and honest runs were being refused. A static ceiling set near the
 * real maximum will always eventually cross it, so this one is set far above
 * anything reachable and left to do the only job it is good for.
 *
 * Worked out rather than guessed, because the old value was wrong. Every
 * person out, every cache including the relic, every attacker a busy level
 * holds, a full time bonus, and the largest bounty multiplier comes to about
 * 36,000. The ceiling was 30,000, which meant a genuinely excellent run was
 * refused with a 422 and never reached the board at all. It was introduced
 * the moment caches started paying Face and nobody had scored highly enough
 * to trip it yet.
 */
export const SCORE_CEILING = 250_000;

/**
 * The longest stage in the campaign, plus slack for the frame it ends on.
 *
 * Derived, because the hand-written version was wrong and wrong silently. It
 * was 118, from a comment reading "a run is 110 seconds", which was true when
 * stage one was the longest thing in the game. Stages then grew: the finale is
 * a march through five sealed regions and stage six is a reading stage, both
 * far longer than 110. Nothing failed at build time. The zod schema simply
 * refused every long run with a 400 before it ever reached the verifier, so
 * clearing stage six or seven and posting the score became impossible while
 * every test stayed green.
 *
 * Reading it off STAGES means the next clock change carries this with it.
 */
export const MAX_DURATION = Math.max(...STAGES.map((stage) => stage.seconds)) + 8;
const BOARD_LIMIT = 100;


/**
 * Everything a stranger needs to check this row without trusting us.
 *
 * The service verified the signature before the row was accepted, but it only
 * kept the address it derived. That makes the verified mark an assertion: you
 * can see that sFace says a wallet signed, and you have to take sFace's word
 * for it. Keeping the signature itself turns the mark into something anyone can
 * confirm on their own machine, and it stays confirmable if this service is
 * gone.
 *
 * The seed and stage are here because the signed string contains them. Score
 * and date are already on the row and in the route, so these four fields
 * complete the claim: rebuild `sface:<date>:<seed>:s<stage>:<score>`, wrap it in
 * the Nimiq envelope, and check the signature against the public key. See
 * server/attest.ts, and `npm run prove` for a worked example.
 *
 * Public on purpose. A signature is not a secret; publishing one is what makes
 * it worth anything.
 */
export interface Proof {
  publicKey: string;
  signature: string;
  /** The mission the claim was signed against. */
  seed: string;
  stage: number;
}

export interface Entry {
  id: string;
  name: string;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  at: number;
  /**
   * The Nimiq address that signed for this score, when one did.
   *
   * Derived on the service from the public key that produced a valid
   * signature, never accepted from the client. Null for a row posted without
   * a wallet, which is every row from a plain browser and is fine: the board
   * has always taken unsigned rows and says which is which.
   */
  address?: string | null;
  /**
   * Transaction hash, when this run was written onto the chain.
   *
   * Different in kind from the signature beside it. A signature proves who set
   * a score and lives here; an anchor is a transaction that exists whether or
   * not this service does.
   */
  anchor?: string | null;
  /** The signature itself, so the address above can be checked by anyone. */
  proof?: Proof | null;
  /** The level flown, kept on every row so an unsigned one can still be signed. */
  seed?: string;
  stage?: number;
}

export interface PublicEntry {
  id: string;
  name: string;
  score: number;
  /** Present only on rows a wallet signed for. Shown as a verified mark. */
  address?: string | null;
  /** And the working needed to check that mark. Null on unsigned rows. */
  proof?: Proof | null;
  /**
   * Transaction hash, when the run was written onto the chain.
   *
   * The stronger of the two claims a row can carry: a signature lives in this
   * service, an anchor is a transaction that outlives it.
   */
  anchor?: string | null;
}

export interface SubmitInput {
  deviceId: string;
  name: string;
  date: string;
  /**
   * The level this run was flown on.
   *
   * Stored whether or not a signature arrived, which is the point. A signed row
   * carries them inside its proof; an unsigned one used to carry them nowhere,
   * so nothing could reconstruct the message it would have to sign, and a run
   * could only ever be signed in the session that produced it. Refresh the page
   * and the chance was gone.
   */
  seed: string;
  stage?: number;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  duration: number;
  /** Which chain this was played on. Boards do not mix. */
  network: string;
  /** Verified address, or null. The route verifies; this module only stores. */
  address?: string | null;
  /** The verified signature, kept so the claim outlives this service. */
  proof?: Proof | null;
}

export type SubmitResult =
  | { ok: true; rank: number }
  | { ok: false; reason: string };

/**
 * network and date -> deviceId -> entry
 *
 * ## Why the network is in the key
 *
 * It was not, and the README said it was. Every score landed in one table keyed
 * only by date, so a run played on testnet, where NIM is free and a faucet hands
 * it out, sat on the same board as one played for real. The claim that testnet
 * scores are kept off the mainnet board was simply untrue.
 *
 * Two boards, and a score can only ever be on the one it was played on. That is
 * also what makes testnet worth having: somewhere to learn the game and try a
 * staked challenge without it counting, which is only true if it genuinely does
 * not count.
 */
const boards = new Map<string, Map<string, Entry>>();

/**
 * One board.
 *
 * Network first, so anything iterating keys can group by it, and so a missing
 * network is visible in a dump rather than silently colliding with a date.
 */
function keyOf(network: string, date: string): string {
  return `${network}:${date}`;
}

export function submit(input: SubmitInput): SubmitResult {
  const rejection = implausible(input);
  if (rejection) return { ok: false, reason: rejection };

  const key = keyOf(input.network, input.date);
  const board = boards.get(key) ?? new Map<string, Entry>();
  boards.set(key, board);

  const existing = board.get(input.deviceId);

  // Keep the best run of the day rather than the latest, so a bad run after a
  // good one does not cost someone their rank.
  if (!existing || input.score > existing.score) {
    board.set(input.deviceId, {
      id: input.deviceId,
      name: input.name,
      score: input.score,
      facesExtracted: input.facesExtracted,
      attackersCleared: input.attackersCleared,
      at: Date.now(),
      address: input.address ?? null,
      proof: input.proof ?? null,
      seed: input.seed,
      stage: input.stage ?? 1,
    });
    persist();
  }

  return { ok: true, rank: rankOf(input.network, input.date, input.deviceId) };
}

/**
 * Bind a wallet to a row that was already posted, without counting it twice.
 *
 * ## Why this is not just another submit
 *
 * `submit` replaces only on a strictly better score, so re-posting the same run
 * with a signature attached would be silently ignored and the row would stay
 * unsigned. Worse, the score route folds every submission into the lifetime
 * profile, so a re-post would add the run's Face a second time. Somebody
 * signing their best run of the day would be rewarded with double the total,
 * which is a cheat anybody could find by accident.
 *
 * So this does exactly one thing: attach proof to a row that already exists.
 * No score is written, no profile is touched, and nothing about the ranking
 * moves.
 *
 * ## What it refuses
 *
 * The claim is verified before this is called and the address is derived from
 * the key that signed, so the only checks left are about which row it belongs
 * to. The score has to match the row exactly, or a signature over a smaller
 * run could be used to decorate a bigger one. And a row that is already signed
 * is left alone, so a second wallet cannot overwrite the first one's claim.
 */
export function attachProof(input: {
  network: string;
  date: string;
  deviceId: string;
  score: number;
  address: string;
  proof: Proof;
}): { ok: true } | { ok: false; reason: string } {
  const board = boards.get(keyOf(input.network, input.date));
  const entry = board?.get(input.deviceId);

  if (!entry) return { ok: false, reason: 'No run of yours on that board.' };
  if (entry.score !== input.score) {
    return { ok: false, reason: 'That signature is for a different run.' };
  }
  if (entry.proof) return { ok: true };

  entry.address = input.address;
  entry.proof = input.proof;
  persist();
  return { ok: true };
}

/**
 * Record that this run was written onto the chain.
 *
 * The verification already happened: by the time this is called the service has
 * parsed the transaction, checked its signature, its recipient, its data and
 * its chain, and computed the hash itself. This only writes down what was
 * proved, which is why it takes a hash rather than a serialized transaction.
 *
 * Once set it is never replaced. A second anchor for the same run is somebody
 * paying a fee twice; the first one is already permanent and overwriting it
 * would quietly discard the record the player is pointing at.
 */
export function attachAnchor(input: {
  network: string;
  date: string;
  deviceId: string;
  score: number;
  hash: string;
  address: string;
}): { ok: true; already: boolean } | { ok: false; reason: string } {
  const board = boards.get(keyOf(input.network, input.date));
  const entry = board?.get(input.deviceId);

  if (!entry) return { ok: false, reason: 'No run of yours on that board.' };
  if (entry.score !== input.score) {
    return { ok: false, reason: 'That transaction is for a different run.' };
  }
  if (entry.anchor) return { ok: true, already: true };

  entry.anchor = input.hash;
  // The sender proved a wallet as surely as a signature does, so a run that was
  // anchored but never signed still shows who set it.
  entry.address = entry.address ?? input.address;
  persist();
  return { ok: true, already: false };
}

export interface UnsignedRun {
  date: string;
  seed: string;
  stage: number;
  score: number;
}

/**
 * This pilot's rows that nobody signed, newest first.
 *
 * ## Why the board is the right place to ask
 *
 * A run is signed against the exact date, seed, stage and score, and the board
 * already holds the authoritative copy of all four: it is the row that would be
 * marked, so it is the row that decides whether marking is still outstanding.
 * Deriving this anywhere else would mean a second opinion about what a player
 * scored, which is the thing this file exists to be the only source of.
 *
 * Naturally short. The board keeps one row per pilot per day and prunes old
 * days, so this is at most a handful of entries and usually one or none.
 *
 * A row with no seed predates seeds being stored and is skipped rather than
 * offered: there is no way to rebuild the message it would sign, so a button
 * for it would be a button that cannot work.
 */
export function unsignedFor(network: string, deviceId: string): UnsignedRun[] {
  const out: UnsignedRun[] = [];

  for (const [key, board] of boards) {
    if (!key.startsWith(`${network}:`)) continue;

    const entry = board.get(deviceId);
    if (!entry || entry.proof) continue;
    if (typeof entry.seed !== 'string' || entry.seed.length === 0) continue;

    out.push({
      date: key.slice(network.length + 1),
      seed: entry.seed,
      stage: entry.stage ?? 1,
      score: entry.score,
    });
  }

  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function top(network: string, date: string, limit = BOARD_LIMIT): PublicEntry[] {
  return sorted(network, date)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      score: entry.score,
      address: entry.address ?? null,
      proof: entry.proof ?? null,
      anchor: entry.anchor ?? null,
    }));
}

export function rankOf(network: string, date: string, deviceId: string): number {
  const index = sorted(network, date).findIndex((entry) => entry.id === deviceId);
  return index === -1 ? 0 : index + 1;
}

function sorted(network: string, date: string): Entry[] {
  const board = boards.get(keyOf(network, date));
  if (!board) return [];
  // Ties break on who got there first. Arbitrary, but stable, and a board that
  // reorders on refresh looks broken.
  return [...board.values()].sort((a, b) => b.score - a.score || a.at - b.at);
}

/** Cheap sanity checks. Not proof, and not presented as proof. */
function implausible(input: SubmitInput): string | null {
  if (input.score < 0 || !Number.isFinite(input.score)) return 'Score is not a number.';
  if (input.score > SCORE_CEILING) return 'Score is above the possible maximum.';
  if (input.duration <= 0 || input.duration > MAX_DURATION) return 'Run duration is impossible.';
  // Bounded by the day's cast rather than a five that outlived it.
  if (input.facesExtracted < 0 || input.facesExtracted > 12) return 'Face count is impossible.';
  if (input.attackersCleared < 0 || input.attackersCleared > 200) {
    return 'Kill count is impossible.';
  }
  // Nobody clears the level in under ten seconds, and a score claimed against
  // one is the cheapest possible forgery.
  if (input.duration < 10 && input.score > 2000) return 'Score is too high for that duration.';
  return null;
}

// Persistence -------------------------------------------------------------

export function serialise(): unknown {
  return [...boards.entries()].map(([key, board]) => [key, [...board.values()]]);
}

export function restore(raw: unknown): void {
  if (!Array.isArray(raw)) return;

  /*
   * Replace rather than merge, which is what the other stores already do.
   *
   * A snapshot is a statement about the whole store, not an addition to it, so
   * restoring twice has to leave the same result as restoring once. This used
   * to merge, which meant a board dropped from the snapshot would survive any
   * second restore and reappear as rows nobody can account for. At boot the map
   * is empty and this clear is a no-op.
   */
  boards.clear();

  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [rawKey, entries] = pair as [unknown, unknown];
    if (typeof rawKey !== 'string' || !Array.isArray(entries)) continue;

    /*
     * Anything saved before the boards were split is a mainnet board.
     *
     * The old key was the date alone. Loading one of those as-is would make a
     * board nobody can reach, because every read now asks for a network, and
     * the live site has real scores in that shape. A key with no colon is from
     * before the split and everything before the split was mainnet.
     */
    const key = rawKey.includes(':') ? rawKey : keyOf('main', rawKey);

    const board = new Map<string, Entry>();
    for (const entry of entries as Entry[]) {
      if (entry && typeof entry.id === 'string' && typeof entry.score === 'number') {
        board.set(entry.id, entry);
      }
    }
    boards.set(key, board);
  }
}

/** Drop boards older than a week. This service is not an archive. */
export function prune(today: string): void {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000;

  for (const key of boards.keys()) {
    /*
     * The date is the back half of the key now.
     *
     * This used to parse the whole key as a date, which quietly stopped working
     * the moment the network went in front of it: Date.parse returns NaN, every
     * comparison against NaN is false, and nothing is ever pruned. A store that
     * grows forever and never errors is the kind of bug that is found months
     * later by a memory graph.
     */
    const date = key.slice(key.indexOf(':') + 1);
    if (Date.parse(`${date}T00:00:00Z`) < cutoff) boards.delete(key);
  }
}

let persist: () => void = () => {};

/** Wired from index.ts so this module does not import the snapshot shape. */
export function onChange(handler: () => void): void {
  persist = handler;
}
