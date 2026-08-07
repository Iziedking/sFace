/**
 * Tips, and the fact that one of them has to travel between two phones.
 *
 * ## Why this store exists at all
 *
 * The money never touches this service. A tip is a transaction from one wallet
 * to another, approved in Nimiq Pay, and the chain is the receipt. Nothing here
 * moves NIM, holds NIM, or can stop NIM moving.
 *
 * What the chain cannot do is tell somebody it happened. Every other
 * notification in this app is derived on the device from state that device
 * already has: a clan request is waiting because the request exists, and it
 * stops waiting because it is gone. A tip is the first thing that happens
 * entirely on somebody else's phone, so it is the first one that needs a place
 * to be left.
 *
 * ## The one that matters more than the successful one
 *
 * A tip aimed at a pilot who never connected a wallet cannot be sent. Today the
 * app hides the button in that case, which is tidy and means the person never
 * finds out they are missing money. So the attempt is recorded too, and the
 * only thing they are told is that somebody tried and what to do about it.
 *
 * The tipper is not named in that case. They have no way to check the claim,
 * and naming somebody who cannot pay them is a taunt rather than information.
 *
 * ## What a record is worth
 *
 * A claim, and it is worded as one everywhere it is shown. The wallet returns a
 * hash and this service has no node to check it against, so a sent tip is
 * exactly as strong as a reported anchor: it points at the wallet and lets the
 * wallet be the proof. That is why nothing here is ever counted into a total or
 * shown as a number beside somebody's name.
 */

import { randomUUID } from 'node:crypto';

/** Whether the money could go anywhere. Decided by the route from the profile. */
export type TipState = 'sent' | 'no-wallet';

export interface TipRecord {
  id: string;
  /** Pilot ids. The room resolves both to names the same way it resolves lines. */
  from: string;
  to: string;
  nim: number;
  state: TipState;
  /** Whatever the wallet handed back, kept for support rather than for display. */
  tx: string | null;
  at: number;
}

interface Stored extends TipRecord {
  network: string;
}

/**
 * The biggest single tip.
 *
 * A tip is a thumbs up with money on it, not a transfer. The wallet enforces
 * the real limit by holding the balance; this only refuses a figure that can
 * only be a mistake or a tampered request, before it reaches a confirm dialog.
 */
export const MAX_TIP_NIM = 1000;

/** Nothing older is worth telling anybody about. */
const TTL_MS = 3 * 24 * 3_600_000;

/**
 * The gap between one pilot tipping the same pilot again.
 *
 * The sent path costs real money and needs no protecting. The refused path
 * costs nothing at all, which makes it the one somebody could use to put a
 * notification in front of a person over and over. Same floor for both, because
 * a second identical tip inside a minute is a double tap either way.
 */
const COOLDOWN_MS = 60_000;

/**
 * Most a single pilot can have waiting.
 *
 * Past this the oldest goes, rather than the newest being refused. This is an
 * inbox, and an inbox that fills up and starts rejecting real tips would have
 * got the trade exactly backwards.
 */
const MAX_WAITING = 30;

const records: Stored[] = [];
const lastTip = new Map<string, number>();

/**
 * When each pilot last looked.
 *
 * A watermark rather than a flag on each record, so marking one read cannot
 * half-fail across a list. It has to survive a restart with the records
 * themselves: a service that came back up and re-announced three days of tips
 * as though they were new would be worse than one that forgot them.
 */
const seen = new Map<string, number>();

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string; code: number };

function pairKey(network: string, from: string, to: string): string {
  return `${network}:${from}:${to}`;
}

function seenKey(network: string, pilotId: string): string {
  return `${network}:${pilotId}`;
}

export function record(input: {
  network: string;
  from: string;
  to: string;
  nim: number;
  state: TipState;
  tx?: string | null;
  now: number;
}): Result<TipRecord> {
  if (input.from === input.to) {
    return { ok: false, reason: 'You cannot tip yourself.', code: 400 };
  }
  if (!Number.isFinite(input.nim) || input.nim <= 0) {
    return { ok: false, reason: 'That is not a real amount.', code: 400 };
  }
  if (input.nim > MAX_TIP_NIM) {
    return { ok: false, reason: `Tips are capped at ${MAX_TIP_NIM} NIM.`, code: 400 };
  }

  const key = pairKey(input.network, input.from, input.to);
  const last = lastTip.get(key) ?? 0;
  if (input.now - last < COOLDOWN_MS) {
    return { ok: false, reason: 'You just tipped them. Give it a minute.', code: 429 };
  }

  const entry: Stored = {
    id: randomUUID(),
    from: input.from,
    to: input.to,
    nim: input.nim,
    state: input.state,
    tx: input.tx ?? null,
    at: input.now,
    network: input.network,
  };

  records.push(entry);
  lastTip.set(key, input.now);
  trim(input.now);
  persist();

  return { ok: true, value: toPublic(entry) };
}

/** What is waiting for one pilot: newest first, and only what they have not seen. */
export function inbox(network: string, pilotId: string, now: number = Date.now()): TipRecord[] {
  const watermark = seen.get(seenKey(network, pilotId)) ?? 0;

  return records
    .filter((r) => r.network === network && r.to === pilotId)
    .filter((r) => now - r.at <= TTL_MS && r.at > watermark)
    .sort((a, b) => b.at - a.at)
    .map(toPublic);
}

/**
 * Everyone whose name an inbox needs, so the caller can resolve them in one go.
 *
 * Only the senders of tips that were actually sent. A refused one deliberately
 * does not name anybody, and handing the name over anyway would put it on the
 * wire for anybody reading the response.
 */
export function sendersFor(
  network: string,
  pilotId: string,
  now: number = Date.now(),
): string[] {
  const out = new Set<string>();
  for (const tip of inbox(network, pilotId, now)) {
    if (tip.state === 'sent') out.add(tip.from);
  }
  return [...out];
}

/** Mark everything up to now as read for one pilot. */
export function markSeen(network: string, pilotId: string, now: number = Date.now()): void {
  seen.set(seenKey(network, pilotId), now);
  persist();
}

function toPublic(entry: Stored): TipRecord {
  const { network: _network, ...rest } = entry;
  return rest;
}

function trim(now: number): void {
  for (let i = records.length - 1; i >= 0; i--) {
    if (now - records[i]!.at > TTL_MS) records.splice(i, 1);
  }

  // Per recipient, because one popular pilot must not push another pilot's
  // tips out of a shared budget.
  for (const to of new Set(records.map((r) => r.to))) {
    const theirs = records.filter((r) => r.to === to);
    if (theirs.length <= MAX_WAITING) continue;

    const drop = new Set(theirs.slice(0, theirs.length - MAX_WAITING).map((r) => r.id));
    for (let i = records.length - 1; i >= 0; i--) {
      if (drop.has(records[i]!.id)) records.splice(i, 1);
    }
  }

  // Watermarks for pilots with nothing left are just a growing map.
  if (records.length === 0) seen.clear();
}

export function prune(now: number = Date.now()): void {
  const before = records.length;
  trim(now);
  if (records.length !== before) persist();
}

export function count(): number {
  return records.length;
}

export function serialise(): unknown {
  // Copies, not the live rows. Handing out the real array means anything that
  // clears the store also empties a snapshot somebody is still holding.
  return {
    records: records.map((entry) => ({ ...entry })),
    seen: [...seen.entries()].map(([key, at]) => ({ key, at })),
  };
}

export function restore(raw: unknown): void {
  records.length = 0;
  lastTip.clear();
  seen.clear();

  if (!raw || typeof raw !== 'object') return;
  const shape = raw as { records?: unknown; seen?: unknown };

  if (Array.isArray(shape.records)) {
    for (const item of shape.records as Stored[]) {
      if (!item || typeof item.id !== 'string') continue;
      if (typeof item.from !== 'string' || typeof item.to !== 'string') continue;
      if (typeof item.nim !== 'number' || !Number.isFinite(item.nim)) continue;

      records.push({
        id: item.id,
        from: item.from,
        to: item.to,
        nim: item.nim,
        state: item.state === 'no-wallet' ? 'no-wallet' : 'sent',
        tx: typeof item.tx === 'string' ? item.tx : null,
        at: typeof item.at === 'number' ? item.at : 0,
        network: typeof item.network === 'string' ? item.network : 'main',
      });
    }
  }

  /*
   * The watermarks come back with them.
   *
   * Dropping these would be the loudest possible failure: every pilot would be
   * told again about every tip of the last three days, every time the service
   * restarted. Read before trim, so a watermark whose records have all aged out
   * still gets cleared by the same rule everything else does.
   */
  if (Array.isArray(shape.seen)) {
    for (const item of shape.seen as Array<{ key?: unknown; at?: unknown }>) {
      if (typeof item?.key !== 'string' || typeof item.at !== 'number') continue;
      seen.set(item.key, item.at);
    }
  }

  trim(Date.now());
}

let persist: () => void = () => {};

export function onChange(handler: () => void): void {
  persist = handler;
}
