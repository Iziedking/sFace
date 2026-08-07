/**
 * The room. One place where the people playing this can find each other.
 *
 * ## Why a game like this needs one
 *
 * Everything social here already assumes you know somebody. A clan is joined by
 * tag, a contest is entered by link, a challenge is sent to a friend. That works
 * for people who arrived with friends and leaves everybody else with a
 * leaderboard full of strangers they have no way to reach.
 *
 * So this is deliberately one shared room rather than private messaging. It is
 * the smallest thing that lets somebody say "clan MIA has a seat" or "10 NIM
 * says you cannot beat this" and be heard by whoever is around.
 *
 * ## What it stores, and for how long
 *
 * Recent messages, per chain, in memory, capped. There is no history worth
 * keeping: the level changes every day and a conversation about yesterday's
 * wreck is not worth the disk. Anything older than a day goes, and the newest
 * few hundred are all that is ever held.
 *
 * ## What it deliberately does not do
 *
 * No deletion by the author, no reactions, and no threads. Every one of those is
 * a store of its own and a screen of its own, and none of them is what somebody
 * opening this needs.
 *
 * Editing is allowed, briefly, and never quietly: a message says that it was
 * changed for the rest of its life. It is here for typos and wrong numbers
 * rather than for changing what you said after it has been read, which is why
 * the window is fifteen minutes and why the mark is permanent.
 *
 * A reply is the other exception, and deliberately the cheap version of one: a message
 * points at another message and the room draws what it is answering above it.
 * There is no thread to open, no reply count, and no separate view. In a room
 * where a dozen people are talking at once, being able to say which line you are
 * answering is the difference between a conversation and a wall.
 *
 * ## Identity is not taken on trust
 *
 * A message carries the id of whoever posted it and nothing else. The name, the
 * picture, the clan and the wallet are all read from that pilot's profile when
 * the room is served, so nobody can post under another name by asking to. That
 * is also why a tip goes to an address this service already proved rather than
 * to one attached to a message.
 */

import { randomUUID } from 'node:crypto';

import { EDIT_WINDOW_MS, MAX_MESSAGE, stillEditable, tidyMessage } from '../src/data/chat';

export { EDIT_WINDOW_MS, MAX_MESSAGE };

/**
 * How many messages a room keeps.
 *
 * A room is read from the top and nobody scrolls back through a day of it, so
 * this is a display buffer rather than an archive.
 */
const KEEP = 300;

/** Nothing outlives the day it was said in. The level it was about is gone. */
const TTL_MS = 24 * 3_600_000;

/**
 * The shortest gap between one pilot's messages.
 *
 * Not a punishment, a floor. Without it one bored player can push every other
 * line off the screen, and the room stops being usable for the people it is for.
 */
const COOLDOWN_MS = 2_000;

export interface ChatMessage {
  id: string;
  /** Who said it. Everything shown about them is read from their profile. */
  pilotId: string;
  text: string;
  at: number;
  /**
   * A run this message is showing off, as a date and nothing else.
   *
   * The same rule as the name and the wallet, for the same reason. A message
   * carrying its own score would be a number anybody could type, and the whole
   * point of putting a run in front of people who might tip it is that the
   * number is the one the board is ranking. So the message says which day, the
   * board says what happened, and a pilot can only ever post their own: the row
   * is looked up under the id of whoever sent the message.
   */
  runDate: string | null;
  /**
   * The message this one answers, by id.
   *
   * Kept only when that message actually exists here, so a line cannot claim to
   * answer something nobody can see. What the reply looks like is worked out
   * where it is drawn: the room already holds every message, so resolving the
   * parent on the client means a name change lands on the quote too, and one
   * reply never carries a stale copy of what it is answering.
   */
  replyTo: string | null;
  /**
   * When it was last changed, or null if it never was.
   *
   * Kept and shown rather than quietly applied. A room where a message can
   * change with no trace is a room where nobody can rely on having read
   * anything, and a reply here quotes its parent live rather than keeping a
   * copy, so an edit changes what the answer appears to be answering.
   */
  editedAt: number | null;
}

interface Stored extends ChatMessage {
  network: string;
}

const messages: Stored[] = [];
const lastPost = new Map<string, number>();

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string; code: number };


export function say(input: {
  network: string;
  pilotId: string;
  text: string;
  runDate?: string | null;
  replyTo?: string | null;
  now: number;
}): Result<ChatMessage> {
  const text = tidyMessage(input.text);
  const runDate = input.runDate ?? null;

  /*
   * A run is something to say on its own.
   *
   * Everywhere else an empty message is somebody clearing the room with
   * whitespace, so it is refused. A posted run is not empty: the card is the
   * message, and demanding a caption for it would mean every share came with a
   * line of filler nobody meant to write.
   */
  if (text.length === 0 && !runDate) {
    return { ok: false, reason: 'Say something first.', code: 400 };
  }
  if (text.length > MAX_MESSAGE) {
    return { ok: false, reason: `Keep it under ${MAX_MESSAGE} characters.`, code: 400 };
  }

  const last = lastPost.get(input.pilotId) ?? 0;
  if (input.now - last < COOLDOWN_MS) {
    return { ok: false, reason: 'One at a time. Give it a second.', code: 429 };
  }

  /*
   * A reply has to point at something real, on this chain, that is still here.
   *
   * An id that resolves to nothing would draw as a quote of a message nobody
   * can find, and one pointing across chains would quote a room the reader is
   * not in. Both are refused by dropping the reference rather than the message:
   * what somebody typed still gets said, it simply answers nothing.
   */
  const parent = input.replyTo
    ? (messages.find((m) => m.id === input.replyTo && m.network === input.network) ?? null)
    : null;

  const message: Stored = {
    id: randomUUID(),
    pilotId: input.pilotId,
    text,
    at: input.now,
    runDate,
    replyTo: parent ? parent.id : null,
    editedAt: null,
    network: input.network,
  };

  messages.push(message);
  lastPost.set(input.pilotId, input.now);
  trim(input.now);
  persist();

  return { ok: true, value: toPublic(message) };
}

/**
 * Change something already said.
 *
 * Only your own, only for a short while, and never silently. Everything here is
 * a refusal with a sentence on it rather than a boolean, because each one is
 * something the person who pressed edit has to be told.
 *
 * Ownership is checked against the id on the stored message, which is this
 * service's own record of who said what. A client asking to edit is not asked
 * whose message it is.
 */
export function edit(input: {
  network: string;
  pilotId: string;
  id: string;
  text: string;
  now: number;
}): Result<ChatMessage> {
  const message = messages.find((m) => m.id === input.id && m.network === input.network);
  if (!message) {
    return { ok: false, reason: 'That message is no longer here.', code: 404 };
  }
  if (message.pilotId !== input.pilotId) {
    return { ok: false, reason: 'That is not yours to edit.', code: 403 };
  }
  if (!stillEditable(message.at, input.now)) {
    return { ok: false, reason: 'Too late to edit that one.', code: 400 };
  }

  const text = tidyMessage(input.text);
  // The same rule as saying something: empty is only allowed where a run is
  // carrying the message, and editing cannot be a way to delete by stealth.
  if (text.length === 0 && !message.runDate) {
    return { ok: false, reason: 'A message cannot be emptied.', code: 400 };
  }
  if (text.length > MAX_MESSAGE) {
    return { ok: false, reason: `Keep it under ${MAX_MESSAGE} characters.`, code: 400 };
  }

  /*
   * No cooldown, and no change to `at`.
   *
   * The cooldown is there to stop one person filling the room, and an edit adds
   * no line to it. Moving `at` would be worse than pointless: it would reorder
   * the conversation around a correction and let an edit push a message back to
   * the bottom, which is exactly the thing the cooldown exists to prevent.
   */
  if (text === message.text) return { ok: true, value: toPublic(message) };

  message.text = text;
  message.editedAt = input.now;
  persist();

  return { ok: true, value: toPublic(message) };
}

/** Oldest first, which is how a room reads. */
export function recent(network: string, now: number = Date.now()): ChatMessage[] {
  return messages
    .filter((m) => m.network === network && now - m.at <= TTL_MS)
    .slice(-KEEP)
    .map(toPublic);
}

/** Everyone who has spoken lately, so the room can show who is around. */
export function speakers(network: string, now: number = Date.now()): string[] {
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.network !== network) continue;
    if (now - message.at > TTL_MS) continue;
    seen.add(message.pilotId);
  }
  return [...seen];
}

function toPublic(message: Stored): ChatMessage {
  const { network: _network, ...rest } = message;
  return rest;
}

/** Drop what is too old or too far back, keeping the store bounded. */
function trim(now: number): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (now - messages[i]!.at > TTL_MS) messages.splice(i, 1);
  }

  // Per chain, so a busy mainnet cannot push testnet out of its own room.
  for (const network of new Set(messages.map((m) => m.network))) {
    const mine = messages.filter((m) => m.network === network);
    if (mine.length <= KEEP) continue;

    const drop = new Set(mine.slice(0, mine.length - KEEP).map((m) => m.id));
    for (let i = messages.length - 1; i >= 0; i--) {
      if (drop.has(messages[i]!.id)) messages.splice(i, 1);
    }
  }
}

export function prune(now: number = Date.now()): void {
  const before = messages.length;
  trim(now);
  if (messages.length !== before) persist();
}

export function count(): number {
  return messages.length;
}

export function serialise(): unknown {
  /*
   * A copy, not the live array.
   *
   * Handing out the real one means anything that clears the store also empties
   * the snapshot somebody is still holding. It happens to be harmless in the
   * app, where the result goes straight into JSON, and it is exactly the kind
   * of aliasing that turns a restore into a wipe the first time the order
   * changes. Every other store here copies.
   */
  return messages.map((message) => ({ ...message }));
}

export function restore(raw: unknown): void {
  if (!Array.isArray(raw)) return;

  // Replace rather than merge, so restoring twice leaves the same result as
  // restoring once. The board store had this wrong and a dropped row survived.
  messages.length = 0;

  /*
   * The cooldown goes with them.
   *
   * It is in-memory rate limiting rather than state worth keeping, and leaving
   * it behind meant a restore did not actually reset the store: whoever spoke
   * last stayed muted afterwards, against a room that no longer had their
   * message in it.
   */
  lastPost.clear();

  for (const item of raw as Stored[]) {
    if (!item || typeof item.id !== 'string' || typeof item.text !== 'string') continue;
    if (typeof item.pilotId !== 'string') continue;

    messages.push({
      id: item.id,
      pilotId: item.pilotId,
      text: tidyMessage(item.text).slice(0, MAX_MESSAGE),
      at: typeof item.at === 'number' ? item.at : 0,
      runDate: typeof item.runDate === 'string' ? item.runDate : null,
      replyTo: typeof item.replyTo === 'string' ? item.replyTo : null,
      editedAt: typeof item.editedAt === 'number' ? item.editedAt : null,
      network: typeof item.network === 'string' ? item.network : 'main',
    });
  }

  trim(Date.now());
}

let persist: () => void = () => {};

export function onChange(handler: () => void): void {
  persist = handler;
}
