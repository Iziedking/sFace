/**
 * Contests: many people, several stages, one agreed set of terms.
 *
 * ## Why this is not challenges.ts with a bigger number on it
 *
 * A challenge is two pilots, one stage, one score each. Everything about it
 * assumes that shape, right down to the settlement, which asks "did the
 * opponent beat the creator". A contest has between two and six entrants over
 * up to seven stages, or two clans over the same, and there is no pair to
 * compare. Bolting that onto the existing store would have left every function
 * carrying an "unless it is the new kind" branch, so it lives here and the old
 * one keeps working untouched.
 *
 * ## The rules live in src/data/contests.ts, not here
 *
 * Who may enter, how a score becomes an average, who is winning: all imported
 * from the same module the client renders from. That is deliberate and it is
 * the most important line in this file. These settle for NIM, and a service
 * that computes a winner one way while the screen shows another is not a bug
 * report, it is a dispute about money. One implementation cannot disagree with
 * itself.
 *
 * ## What the service does and does not hold
 *
 * It records terms, entrants and scores, and it says who won. It never holds a
 * stake. Settlement is wallet to wallet against an address on the payer's own
 * screen, exactly as challenges already work, so the worst this store can do
 * when it is wrong is describe a result incorrectly. It cannot lose anybody's
 * money because it never has any.
 */

import { randomUUID } from 'node:crypto';

import {
  MAX_SEATS,
  MAX_STAGE,
  MIN_SEATS,
  anyoneFinished,
  endOfUtcDay,
  expiryFor,
  hasFinished,
  isExpired,
  joinRefusal,
  obligationsOf,
  standings,
  type Contest,
  type ContestEntrant,
  type ContestKind,
  type ContestVisibility,
} from '../src/data/contests';

/**
 * Zero is a real choice, not a missing one.
 *
 * A contest with nothing on it is a free pass: the same seeded stages, the same
 * standings, and nobody has to own NIM to enter. That matters more than it
 * sounds. Requiring a stake would have made every contest a thing you need a
 * funded wallet for, which quietly turns a game into a betting product and
 * shuts out the person who just wants to race a friend.
 *
 * It is also the honest default for a service that holds no escrow. A free
 * contest cannot be welched on, because there is nothing to welch.
 */
export const MIN_STAKE_NIM = 0;
export const MAX_STAKE_NIM = 1000;

/**
 * A clan contest has no seat count worth setting.
 *
 * Who turns up is decided by the roster, not by the host, so the UI does not
 * offer the control. The ceiling is two full clans: a clan holds seven, and a
 * clan contest is one clan against another.
 */
const CLAN_SEATS = 14;

/**
 * Contests die with the day they were pinned to.
 *
 * Every entrant has to fly the same seeded level, and the service only holds
 * one day's mission, so a contest that outlived its date could never be
 * verified again. Two days rather than one, so a contest opened late in the
 * evening survives long enough for the other side to answer it.
 */
const TTL_MS = 48 * 3_600_000;

interface Stored extends Contest {
  /** Which chain it belongs to. Never mixed: test NIM is not a stake. */
  network: string;
  createdAt: number;
}

const contests = new Map<string, Stored>();

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; code: number };

/**
 * Fold the stored shape down to what goes over the wire.
 *
 * `network` and `createdAt` are ours: the client already knows which chain it
 * asked about, and the creation time is only ever used for pruning. Sending
 * them would be publishing bookkeeping as though it were part of the terms.
 */
export function toPublic(stored: Stored): Contest {
  const { network: _network, createdAt: _createdAt, ...rest } = stored;
  return rest;
}

export function create(input: {
  network: string;
  hostId: string;
  hostName: string;
  hostAvatarUrl: string | null;
  hostAddress: string | null;
  hostClanTag: string | null;
  /** Whether the host runs that clan. Only the owner may commit its members. */
  hostOwnsClan: boolean;
  kind: ContestKind;
  stages: number[];
  stakeNim: number;
  seats: number;
  visibility: ContestVisibility;
  date: string;
  seed: string;
  /**
   * How long the host wants it open, in minutes, or null for the rest of the
   * day. Clamped by expiryFor, which also caps it at the UTC rollover.
   */
  openMinutes?: number | null;
  now: number;
}): Result<Stored> {
  const stages = tidyStages(input.stages);
  if (stages.length === 0) {
    return { ok: false, reason: 'Pick at least one stage.', code: 400 };
  }

  if (input.stakeNim < MIN_STAKE_NIM || input.stakeNim > MAX_STAKE_NIM) {
    return {
      ok: false,
      reason: `Stake must be between ${MIN_STAKE_NIM} and ${MAX_STAKE_NIM} NIM.`,
      code: 400,
    };
  }

  /*
   * A clan contest needs a clan behind it.
   *
   * Checked here rather than trusted from the client, because the alternative
   * is a contest that claims to represent a clan the host is not in, and the
   * standings would then credit a roster nobody on it agreed to enter.
   */
  if (input.kind === 'clan' && !input.hostClanTag) {
    return { ok: false, reason: 'Clan contests need a clan.', code: 400 };
  }

  /*
   * Only the owner may put a clan into a contest.
   *
   * Every member's score counts toward the result, so opening one commits
   * people who have not agreed to anything. That is the owner's call, the same
   * as who gets in, and it is checked here rather than in the UI because a
   * greyed button is a suggestion.
   */
  if (input.kind === 'clan' && !input.hostOwnsClan) {
    return { ok: false, reason: 'Only the clan owner can enter the clan in a contest.', code: 403 };
  }

  /*
   * The gauntlet is not built yet.
   *
   * It creates, joins and settles exactly like the others, which is the problem:
   * it would play as an ordinary stage while the card promises hideouts, pickups
   * and a clock nobody outlives. Shipping that is worse than not shipping it,
   * because the disappointment lands after somebody has staked on it.
   *
   * Refused at the door and marked coming soon on the card, until the level
   * itself exists.
   */
  if (input.kind === 'gauntlet') {
    return { ok: false, reason: 'Last one flying is not ready yet.', code: 400 };
  }

  /*
   * A staked contest needs somewhere to pay the winner.
   *
   * There is no escrow, so a settlement is an ordinary transfer between two
   * people, and a winner with no address is a debt that cannot be paid however
   * willing the loser is. Refused at creation rather than discovered at the end,
   * when somebody is holding money with nowhere to send it.
   */
  if (input.stakeNim > 0 && !input.hostAddress) {
    return {
      ok: false,
      reason: 'Connect a wallet to open a staked contest, or make it free.',
      code: 400,
    };
  }

  const seats =
    input.kind === 'clan'
      ? CLAN_SEATS
      : Math.max(MIN_SEATS, Math.min(MAX_SEATS, Math.round(input.seats)));

  const host: ContestEntrant = {
    id: input.hostId,
    name: input.hostName,
    avatarUrl: input.hostAvatarUrl,
    address: input.hostAddress,
    clanTag: input.hostClanTag,
    scores: {},
  };

  const contest: Stored = {
    id: randomUUID(),
    kind: input.kind,
    stages,
    stakeNim: input.stakeNim,
    seats,
    visibility: input.visibility === 'private' ? 'private' : 'open',
    status: 'open',
    date: input.date,
    expiresAt: expiryFor(input.now, input.openMinutes ?? null),
    seed: input.seed,
    hostId: input.hostId,
    hostName: input.hostName,
    hostAvatarUrl: input.hostAvatarUrl,
    clanTag: input.kind === 'clan' ? input.hostClanTag : null,
    // The host is in it. Opening a contest you are not entered in would let
    // somebody set terms they never have to fly.
    entrants: [host],
    paid: {},
    network: input.network,
    createdAt: input.now,
  };

  contests.set(contest.id, contest);
  persist();
  return { ok: true, value: contest };
}

export function get(id: string, network: string): Result<Stored> {
  const contest = contests.get(id);
  if (!contest) return { ok: false, reason: 'No such contest.', code: 404 };

  /*
   * A contest on the other chain is not found rather than refused.
   *
   * Saying "wrong network" would confirm the id exists, and there is no reason
   * for a testnet caller to learn which mainnet contests are running.
   */
  if (contest.network !== network) {
    return { ok: false, reason: 'No such contest.', code: 404 };
  }

  return { ok: true, value: contest };
}

/**
 * Everything anybody may enter, on this chain.
 *
 * Private contests are excluded here rather than filtered by the client. A
 * privacy promise kept by the honesty of the reader is not a promise: the link
 * is the whole access control, and a payload that carried the others would hand
 * them to anyone who opened the network tab.
 */
export function list(network: string, now: number = Date.now()): Contest[] {
  return [...contests.values()]
    .filter((c) => c.network === network)
    .filter((c) => c.visibility === 'open')
    .filter((c) => c.status !== 'settled' && c.status !== 'void')
    // Hidden the moment the clock passes, without waiting for the sweep. A
    // listed contest is one you can still take a seat in.
    .filter((c) => !isExpired(c, now))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublic);
}

export function join(input: {
  id: string;
  network: string;
  pilotId: string;
  name: string;
  avatarUrl: string | null;
  address: string | null;
  clanTag: string | null;
  now: number;
}): Result<Stored> {
  const found = get(input.id, input.network);
  if (!found.ok) return found;

  const contest = found.value;

  /*
   * The same refusal the button used, from the same function.
   *
   * The client already checked this to decide whether to grey the button out.
   * Checking again is not redundancy, it is where the rule actually lives: a
   * client can be edited and this cannot.
   */
  const refusal = joinRefusal(
    contest,
    { id: input.pilotId, clanTag: input.clanTag },
    input.now,
  );
  if (refusal) return { ok: false, reason: refusal, code: 409 };

  // Same reason as opening one: if this pilot wins, somebody has to be able to
  // pay them, and nothing here can hold the stake in the meantime.
  if (contest.stakeNim > 0 && !input.address) {
    return {
      ok: false,
      reason: 'Connect a wallet to enter a staked contest.',
      code: 400,
    };
  }

  contest.entrants.push({
    id: input.pilotId,
    name: input.name,
    avatarUrl: input.avatarUrl,
    address: input.address,
    clanTag: input.clanTag,
    scores: {},
  });

  // Full means flying. Nobody else can enter, and the terms are now fixed for
  // everyone who agreed to them.
  if (contest.entrants.length >= contest.seats) contest.status = 'running';

  persist();
  return { ok: true, value: contest };
}

/**
 * Fold a posted score into every contest it counts toward.
 *
 * ## Why this is a side effect of posting rather than its own call
 *
 * A second call would be a second chance to fail. Somebody finishes a stage,
 * the score posts, the contest update times out, and their run is on the board
 * but missing from the contest they staked on. Doing it in the same request
 * makes those two facts arrive together or not at all.
 *
 * ## Why the first score for a stage wins
 *
 * A contest is one attempt at each stage, unlike the daily board which keeps
 * your best. Replacing on a better score would let somebody grind a stage until
 * it beat whatever their opponent posted, which is not a race, and the entrant
 * who went first would be the only one playing fair.
 */
export function recordScore(input: {
  network: string;
  pilotId: string;
  date: string;
  seed: string;
  stage: number;
  score: number;
  now: number;
}): Contest[] {
  let touched = false;
  /*
   * The contests that settled on this score, handed back to the caller.
   *
   * The settlement record on a profile has to be written exactly once per debt,
   * and the only moment that is knowable is the transition into settled. This
   * store deliberately knows nothing about profiles, so it reports the
   * transition and the route does the writing.
   */
  const settled: Contest[] = [];

  for (const contest of contests.values()) {
    if (contest.network !== input.network) continue;
    if (contest.status === 'settled' || contest.status === 'void') continue;
    /*
     * A run that lands after the deadline does not count.
     *
     * The run itself still goes on the daily board; it just does not count
     * toward terms whose window has closed. Without this a player could start a
     * stage a minute before expiry and post it whenever they finished, which
     * makes the deadline advisory for whoever is slowest.
     */
    if (isExpired(contest, input.now)) continue;
    // Same day and same level, or it is not the thing that was agreed.
    if (contest.date !== input.date || contest.seed !== input.seed) continue;
    if (!contest.stages.includes(input.stage)) continue;

    const entrant = contest.entrants.find((e) => e.id === input.pilotId);
    if (!entrant) continue;
    if (typeof entrant.scores[input.stage] === 'number') continue;

    entrant.scores[input.stage] = Math.max(0, Math.round(input.score));
    touched = true;

    if (settleIfDone(contest)) settled.push(toPublic(contest));
  }

  if (touched) persist();
  return settled;
}

/**
 * A contest is over when everybody who can still fly has flown.
 *
 * Deliberately not "when the seats are full and everyone finished": a contest
 * that never filled still ends once its entrants are done, or an abandoned
 * seat would hold a result open forever and the stake with it.
 */
function settleIfDone(contest: Stored): boolean {
  if (contest.entrants.length === 0) return false;
  if (!contest.entrants.every((e) => hasFinished(contest, e))) return false;

  contest.status = 'settled';
  return true;
}

/**
 * Close out everything whose clock has run out.
 *
 * ## Why the deadline is enforced here and not by a timer
 *
 * A contest has to be correct the moment somebody looks at it, and a timer that
 * fires every few hours cannot promise that: between two ticks a card would
 * still say open, still offer a seat, and still accept a run. So this is called
 * on the read paths as well as by housekeeping, and the expiry is applied the
 * first time anybody asks rather than whenever a schedule comes round.
 *
 * ## Settled or void
 *
 * If at least one entrant finished every stage, the contest settles: the field
 * agreed to the terms, the deadline was part of them, and somebody who did not
 * turn up loses the same way somebody who turned up and lost does.
 *
 * If nobody finished, it is void. There is no winner to pay and no fair way to
 * invent one, so no debt is created and the card says the clock beat everyone.
 *
 * Returns the ones that became settled, so the caller can write the debts, the
 * same handoff recordScore uses and for the same reason: this store knows
 * nothing about profiles and should not start now.
 */
export function expireDue(now: number): Contest[] {
  const settled: Contest[] = [];
  let touched = false;

  for (const contest of contests.values()) {
    if (contest.status === 'settled' || contest.status === 'void') continue;
    if (!isExpired(contest, now)) continue;

    touched = true;
    if (anyoneFinished(contest)) {
      contest.status = 'settled';
      settled.push(toPublic(contest));
    } else {
      contest.status = 'void';
    }
  }

  if (touched) persist();
  return settled;
}

/**
 * Record that somebody paid what they owed.
 *
 * ## What this does and does not check
 *
 * It records a transaction hash the payer reported. It does not read the chain,
 * because this service has no node and never has: the same limitation the
 * challenge settlement already documents. So a determined liar can report a
 * hash for a payment they never made.
 *
 * That is survivable, and worth being plain about rather than pretending
 * otherwise. The hash is published beside the debt, so the person who is owed
 * can check it themselves in one tap, and a false one is a lie with a permanent
 * receipt attached to a named account. What the service is doing here is
 * witnessing, not enforcing, and the UI says exactly that.
 */
export function markPaid(input: {
  id: string;
  network: string;
  pilotId: string;
  txHash: string;
}): Result<Stored> {
  const found = get(input.id, input.network);
  if (!found.ok) return found;

  const contest = found.value;
  if (contest.status !== 'settled') {
    return { ok: false, reason: 'That contest has not finished.', code: 409 };
  }

  const owed = obligationsOf(contest).find((o) => o.fromId === input.pilotId);
  if (!owed) return { ok: false, reason: 'You do not owe anything on this one.', code: 409 };

  contest.paid = { ...(contest.paid ?? {}), [input.pilotId]: input.txHash };
  persist();
  return { ok: true, value: contest };
}

/** Everything still outstanding, for the reminder on a profile. */
export function debtsFor(pilotId: string, network: string): Contest[] {
  return [...contests.values()]
    .filter((c) => c.network === network && c.status === 'settled')
    .filter((c) => obligationsOf(c).some((o) => o.fromId === pilotId && !o.txHash))
    .map(toPublic);
}

/** Who won, or null while it is still being flown. */
export function winnerOf(contest: Contest): ContestEntrant | null {
  if (contest.status !== 'settled') return null;

  // Only a completed run can win. A settled contest always has one, but this
  // is the function every screen asks, and a null average at the top would mean
  // an expiry settled something it should have voided.
  const top = standings(contest)[0];
  return top && top.average !== null ? top.entrant : null;
}

/**
 * Drop contests whose day has passed.
 *
 * They cannot be verified once the service has moved to a new mission, so
 * keeping them would mean showing a contest nobody can finish.
 */
export function prune(now: number): void {
  let dropped = false;
  for (const [id, contest] of contests) {
    if (now - contest.createdAt > TTL_MS) {
      contests.delete(id);
      dropped = true;
    }
  }
  if (dropped) persist();
}

export function count(): number {
  return contests.size;
}

/** Ascending, unique, and inside the campaign. */
function tidyStages(raw: number[]): number[] {
  const seen = new Set<number>();
  for (const n of raw) {
    const stage = Math.round(n);
    if (stage >= 1 && stage <= MAX_STAGE) seen.add(stage);
  }
  return [...seen].sort((a, b) => a - b);
}

// Persistence -------------------------------------------------------------

export function serialise(): unknown {
  return [...contests.values()];
}

export function restore(raw: unknown): void {
  if (!Array.isArray(raw)) return;

  // Replace rather than merge, so restoring twice leaves the same result as
  // restoring once. The board store had this wrong and a dropped row survived.
  contests.clear();

  for (const item of raw as Stored[]) {
    if (!item || typeof item.id !== 'string') continue;
    if (!Array.isArray(item.entrants) || !Array.isArray(item.stages)) continue;

    const createdAt = typeof item.createdAt === 'number' ? item.createdAt : 0;

    contests.set(item.id, {
      ...item,
      network: typeof item.network === 'string' ? item.network : 'main',
      createdAt,
      /*
       * Rows written before deadlines existed get the one they would have had.
       *
       * Left undefined, every comparison against the clock is false, so an old
       * contest would never expire: permanently listed, permanently joinable,
       * on a level that stopped existing days ago. The end of the day it was
       * opened is the rule it was already living under, since a contest has
       * never been playable past its own mission.
       */
      expiresAt:
        typeof item.expiresAt === 'number' ? item.expiresAt : endOfUtcDay(createdAt),
    });
  }
}

let persist: () => void = () => {};

export function onChange(handler: () => void): void {
  persist = handler;
}
