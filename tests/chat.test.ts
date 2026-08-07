/**
 * The room, and the four ways a shared page can be ruined.
 *
 * It is the only surface in this app that shows what a stranger typed, so the
 * failures here are not about losing data. They are about one person being able
 * to make the page useless for everybody else: flooding it, clearing it with
 * whitespace, reordering it with invisible characters, or posting as somebody
 * they are not.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as board from '../server/leaderboard';
import * as chat from '../server/chat';
import { MAX_MESSAGE, findInvite, tidyMessage } from '../src/data/chat';

const ONE = 'a'.repeat(64);
const TWO = 'b'.repeat(64);

/*
 * Now, rather than a fixed date.
 *
 * Every time here is passed in explicitly except one: restore trims against the
 * wall clock, because at boot that is the only clock there is. A hardcoded day
 * passes until it is more than a day old, and then the restore tests start
 * failing on their own with nothing having changed.
 */
const NOON = Date.now();

function say(pilotId: string, text: string, now = NOON, network = 'main') {
  return chat.say({ network, pilotId, text, now });
}

const DATE = '2026-08-01';

function fly(pilotId: string, score: number, network = 'main') {
  return board.submit({
    deviceId: pilotId,
    name: '@pilot',
    network,
    date: DATE,
    seed: 'seed-one',
    stage: 4,
    score,
    facesExtracted: 3,
    attackersCleared: 11,
    duration: 62.4,
  });
}

beforeEach(() => {
  chat.restore([]);
});

describe('saying something', () => {
  it('keeps it, and hands it back', () => {
    const said = say(ONE, 'MIA has a seat if anybody wants it');
    expect(said.ok).toBe(true);
    expect(said.ok && said.value.text).toBe('MIA has a seat if anybody wants it');

    expect(chat.recent('main', NOON).map((m) => m.text)).toEqual([
      'MIA has a seat if anybody wants it',
    ]);
  });

  it('carries only the id of whoever said it', () => {
    /*
     * The name, picture, clan and wallet are all read from the profile when the
     * room is served. If a message carried them, anybody could post under
     * somebody else's name by asking to, and a tip could be pointed at an
     * address the message supplied itself.
     */
    const said = say(ONE, 'hello');
    // runDate is a pointer, not a fact about the run: it says which day to look
    // up, and the board says what happened. Everything else stays absent.
    expect(said.ok && Object.keys(said.value).sort()).toEqual([
      'at', 'editedAt', 'id', 'pilotId', 'replyTo', 'runDate', 'text',
    ]);
    expect(said.ok && said.value.runDate).toBeNull();
  });

  it('refuses an empty one, however it is dressed up', () => {
    // Forty blank lines is how you clear a room without saying anything.
    expect(say(ONE, '   ').ok).toBe(false);
    expect(say(ONE, '\n\n\n\n').ok).toBe(false);
  });

  it('refuses one longer than the room allows', () => {
    expect(say(ONE, 'x'.repeat(MAX_MESSAGE + 1)).ok).toBe(false);
    expect(say(ONE, 'x'.repeat(MAX_MESSAGE)).ok).toBe(true);
  });
});

describe('posting a run', () => {
  beforeEach(() => {
    board.prune('2099-01-01');
  });

  it('carries a date and nothing about the run itself', () => {
    /*
     * The whole safety argument for tipping. A message that carried its own
     * score would be a number anybody could type, and the point of putting a
     * run in front of people who might pay for it is that the number is the one
     * the board is ranking. So the line says which day, and the board answers.
     */
    const said = chat.say({ network: 'main', pilotId: ONE, text: '', runDate: DATE, now: NOON });
    expect(said.ok).toBe(true);
    expect(said.ok && Object.keys(said.value).sort()).toEqual([
      'at', 'editedAt', 'id', 'pilotId', 'replyTo', 'runDate', 'text',
    ]);
  });

  it('needs no caption, unlike an ordinary line', () => {
    // Empty is somebody clearing the room with whitespace, except here, where
    // the card is the message and a forced caption would be filler.
    expect(say(ONE, '   ').ok).toBe(false);
    expect(chat.say({ network: 'main', pilotId: ONE, text: '', runDate: DATE, now: NOON }).ok)
      .toBe(true);
  });

  it('takes a caption when there is one', () => {
    const said = chat.say({
      network: 'main', pilotId: ONE, text: 'beat that', runDate: DATE, now: NOON,
    });
    expect(said.ok && said.value.text).toBe('beat that');
    expect(said.ok && said.value.runDate).toBe(DATE);
  });

  it('keeps the run across a restart', () => {
    chat.say({ network: 'main', pilotId: ONE, text: '', runDate: DATE, now: NOON });
    chat.restore(chat.serialise());
    expect(chat.recent('main', NOON)[0]?.runDate).toBe(DATE);
  });
});

describe('what the board answers with', () => {
  beforeEach(() => {
    board.prune('2099-01-01');
  });

  it('gives the row being ranked, under the id that was asked about', () => {
    fly(ONE, 26_632);
    const card = board.runCard('main', DATE, ONE);

    expect(card?.score).toBe(26_632);
    expect(card?.stage).toBe(4);
    expect(card?.rank).toBe(1);
    expect(card?.facesExtracted).toBe(3);
  });

  it('cannot be pointed at somebody else', () => {
    /*
     * The route looks the row up under the id of whoever sent the message, so
     * there is no way to ask for another pilot's run. This is what that
     * guarantee looks like from underneath: ask about a pilot with no row and
     * the answer is nothing, never the best row on the board.
     */
    fly(ONE, 26_632);
    expect(board.runCard('main', DATE, TWO)).toBeNull();
  });

  it('ranks it against everybody else that day', () => {
    fly(ONE, 4_000);
    fly(TWO, 26_632);
    expect(board.runCard('main', DATE, ONE)?.rank).toBe(2);
  });

  it('says nothing for a day the pilot did not fly', () => {
    // The ordinary case at the rollover. A message lives a day and a board is
    // pruned on its own schedule, so a card can outlive the run behind it.
    fly(ONE, 4_000);
    expect(board.runCard('main', '2026-07-31', ONE)).toBeNull();
  });

  it('does not reach across chains', () => {
    fly(ONE, 4_000, 'test');
    expect(board.runCard('main', DATE, ONE)).toBeNull();
    expect(board.runCard('test', DATE, ONE)?.score).toBe(4_000);
  });

  it('reports the two claims a row can carry', () => {
    fly(ONE, 4_000);
    const plain = board.runCard('main', DATE, ONE);
    // Nothing was signed and nothing was written on chain, and the card says so
    // rather than leaving the room to guess at a mark.
    expect(plain?.signed).toBe(false);
    expect(plain?.anchor).toBeNull();
  });
});

describe('answering somebody', () => {
  it('keeps the message it answers', () => {
    const first = say(ONE, 'how do you get past the last gate', NOON);
    const parent = first.ok ? first.value.id : '';

    const reply = chat.say({
      network: 'main', pilotId: TWO, text: 'go wide on the approach', replyTo: parent, now: NOON,
    });

    expect(reply.ok && reply.value.replyTo).toBe(parent);
  });

  it('drops a reference to a message that does not exist', () => {
    /*
     * The reply still gets said. What it cannot do is claim to answer something
     * nobody can see, which would draw as a quote of a message that is not
     * there and leave the reader looking for it.
     */
    const reply = chat.say({
      network: 'main', pilotId: TWO, text: 'agreed', replyTo: 'made-up', now: NOON,
    });

    expect(reply.ok).toBe(true);
    expect(reply.ok && reply.value.replyTo).toBeNull();
  });

  it('cannot answer across chains', () => {
    // Two rooms, and a quote of a message the reader is not in a position to
    // see is the same failure as a quote of one that never existed.
    const there = chat.say({ network: 'test', pilotId: ONE, text: 'on test', now: NOON });
    const id = there.ok ? there.value.id : '';

    const here = chat.say({
      network: 'main', pilotId: TWO, text: 'answering', replyTo: id, now: NOON,
    });
    expect(here.ok && here.value.replyTo).toBeNull();
  });

  it('keeps the reference across a restart', () => {
    const first = say(ONE, 'first', NOON);
    const parent = first.ok ? first.value.id : '';
    chat.say({ network: 'main', pilotId: TWO, text: 'second', replyTo: parent, now: NOON });

    chat.restore(chat.serialise());
    expect(chat.recent('main', NOON)[1]?.replyTo).toBe(parent);
  });
});

describe('changing something you said', () => {
  it('changes it, and says that it changed', () => {
    const first = say(ONE, 'go wid on the approach', NOON);
    const id = first.ok ? first.value.id : '';

    const fixed = chat.edit({
      network: 'main', pilotId: ONE, id, text: 'go wide on the approach', now: NOON + 1000,
    });

    expect(fixed.ok && fixed.value.text).toBe('go wide on the approach');
    // Marked for the rest of its life. A message that can change without a
    // trace is one nobody can rely on having read.
    expect(fixed.ok && fixed.value.editedAt).toBe(NOON + 1000);
  });

  it('refuses one that belongs to somebody else', () => {
    /*
     * Ownership is read off the stored message, which is this service's own
     * record of who said what. Nothing about it is taken from the request.
     */
    const first = say(ONE, 'mine', NOON);
    const id = first.ok ? first.value.id : '';

    const theft = chat.edit({
      network: 'main', pilotId: TWO, id, text: 'not any more', now: NOON + 1000,
    });

    expect(theft.ok).toBe(false);
    expect(!theft.ok && theft.code).toBe(403);
    expect(chat.recent('main', NOON)[0]?.text).toBe('mine');
  });

  it('refuses one whose window has closed', () => {
    // Editing is for typos, not for changing what you said after it has been
    // read and answered.
    const first = say(ONE, 'typo', NOON);
    const id = first.ok ? first.value.id : '';

    const late = chat.edit({
      network: 'main', pilotId: ONE, id, text: 'rewritten', now: NOON + 20 * 60_000,
    });
    expect(late.ok).toBe(false);
  });

  it('refuses one that is not there', () => {
    const missing = chat.edit({
      network: 'main', pilotId: ONE, id: 'made-up', text: 'hello', now: NOON,
    });
    expect(!missing.ok && missing.code).toBe(404);
  });

  it('cannot reach across chains', () => {
    const there = chat.say({ network: 'test', pilotId: ONE, text: 'on test', now: NOON });
    const id = there.ok ? there.value.id : '';

    const here = chat.edit({
      network: 'main', pilotId: ONE, id, text: 'reached', now: NOON + 1000,
    });
    expect(here.ok).toBe(false);
  });

  it('cannot be used to empty a message', () => {
    // Deleting by stealth. There is no delete in this room, and an edit that
    // leaves a blank line is one.
    const first = say(ONE, 'said', NOON);
    const id = first.ok ? first.value.id : '';

    expect(chat.edit({ network: 'main', pilotId: ONE, id, text: '   ', now: NOON + 1 }).ok)
      .toBe(false);
  });

  it('leaves a run posted with no caption editable', () => {
    // The card is the message there, so empty is not empty.
    const posted = chat.say({
      network: 'main', pilotId: ONE, text: '', runDate: DATE, now: NOON,
    });
    const id = posted.ok ? posted.value.id : '';

    expect(chat.edit({ network: 'main', pilotId: ONE, id, text: 'beat that', now: NOON + 1 }).ok)
      .toBe(true);
  });

  it('does not move it in the room', () => {
    /*
     * The order is the conversation. An edit that moved a message to the bottom
     * would be a way to push your own line back up in front of everybody, which
     * is exactly what the posting cooldown exists to prevent.
     */
    const first = say(ONE, 'first', NOON);
    say(TWO, 'second', NOON + 1000);
    const id = first.ok ? first.value.id : '';

    chat.edit({ network: 'main', pilotId: ONE, id, text: 'first, fixed', now: NOON + 2000 });
    expect(chat.recent('main', NOON + 3000).map((m) => m.text)).toEqual(['first, fixed', 'second']);
  });

  it('cleans an edit the same way it cleans a message', () => {
    const first = say(ONE, 'clean', NOON);
    const id = first.ok ? first.value.id : '';

    const dirty = chat.edit({
      network: 'main', pilotId: ONE, id, text: 'still‮clean', now: NOON + 1,
    });
    expect(dirty.ok && dirty.value.text).toBe('stillclean');
  });

  it('keeps the mark across a restart', () => {
    const first = say(ONE, 'before', NOON);
    const id = first.ok ? first.value.id : '';
    chat.edit({ network: 'main', pilotId: ONE, id, text: 'after', now: NOON + 1000 });

    chat.restore(chat.serialise());
    const kept = chat.recent('main', NOON)[0];
    expect(kept?.text).toBe('after');
    expect(kept?.editedAt).toBe(NOON + 1000);
  });
});

describe('links somebody pasted', () => {
  const ORIGIN = 'https://sface.site';

  it('finds a contest invite on our own origin', () => {
    expect(findInvite('take a seat https://sface.site/?contest=abc123', ORIGIN)).toEqual({
      kind: 'contest',
      id: 'abc123',
    });
  });

  it('finds a challenge, and the routed forms of both', () => {
    expect(findInvite('https://sface.site/?c=xyz', ORIGIN)?.kind).toBe('challenge');
    expect(findInvite('https://sface.site/contest/abc', ORIGIN)).toEqual({
      kind: 'contest',
      id: 'abc',
    });
  });

  it('refuses a host that merely contains ours', () => {
    /*
     * The one that matters. This is a room full of strangers, and the check is
     * a parsed origin rather than a substring for exactly this: the text below
     * contains our host and is not our host.
     */
    expect(findInvite('https://evil.example/?x=sface.site&contest=abc', ORIGIN)).toBeNull();
    expect(findInvite('https://sface.site.evil.example/?contest=abc', ORIGIN)).toBeNull();
  });

  it('makes nothing else tappable, however useful it looks', () => {
    // No link in a message is ever turned into a link. Not one.
    expect(findInvite('https://nimiq.com', ORIGIN)).toBeNull();
    expect(findInvite('read this https://example.com/good-thread', ORIGIN)).toBeNull();
  });

  it('is not fooled by text that is not a url', () => {
    expect(findInvite('contest=abc123', ORIGIN)).toBeNull();
    expect(findInvite('sface.site/?contest=abc', ORIGIN)).toBeNull();
    expect(findInvite('', ORIGIN)).toBeNull();
  });

  it('finds nothing when the app does not know its own origin', () => {
    // Server-rendered or a broken build. Guessing an origin here would be
    // guessing which links are safe.
    expect(findInvite('https://sface.site/?contest=abc', '')).toBeNull();
  });
});

describe('one person cannot take the room', () => {
  it('holds them to one message at a time', () => {
    expect(say(ONE, 'first', NOON).ok).toBe(true);
    expect(say(ONE, 'second', NOON + 100).ok).toBe(false);
    expect(say(ONE, 'later', NOON + 5_000).ok).toBe(true);
  });

  it('does not hold anybody else up', () => {
    // A floor on one pilot, not on the room. Two people talking is the point.
    expect(say(ONE, 'first', NOON).ok).toBe(true);
    expect(say(TWO, 'also first', NOON + 100).ok).toBe(true);
  });
});

describe('what a message cannot smuggle in', () => {
  it('strips characters that reorder the line around them', () => {
    /*
     * The bidirectional overrides. They are invisible and they rearrange the
     * text either side, so a message can make somebody else's line read
     * backwards. This is the only screen that shows stranger input, so they go.
     */
    const said = say(ONE, 'safe ‮reversed‬ text');
    expect(said.ok && said.value.text).toBe('safe reversed text');
  });

  it('turns control characters into spaces rather than dropping them', () => {
    // A space, so words either side of one do not run together into a new word.
    expect(tidyMessage('one two')).toBe('one two');
    expect(tidyMessage('onetwo')).toBe('one two');
  });

  it('collapses any run of whitespace', () => {
    expect(tidyMessage('lots\n\n\n   of\t\tspace')).toBe('lots of space');
  });

  it('leaves ordinary text completely alone', () => {
    // Including the punctuation a stake or a clan tag would use.
    const line = '5 NIM says you cannot beat 26,632 — MIA, stages 1 to 3?';
    expect(tidyMessage(line)).toBe(line);
  });
});

describe('the room is per chain', () => {
  it('never mixes them', () => {
    // Test NIM is not real money and a testnet room is not the real room.
    say(ONE, 'on main', NOON, 'main');
    say(TWO, 'on test', NOON, 'test');

    expect(chat.recent('main', NOON).map((m) => m.text)).toEqual(['on main']);
    expect(chat.recent('test', NOON).map((m) => m.text)).toEqual(['on test']);
  });
});

describe('nothing outlives its day', () => {
  it('drops what is older than a day', () => {
    // The level it was about is gone, and so is the conversation.
    say(ONE, 'yesterday', NOON);
    const tomorrow = NOON + 25 * 3_600_000;

    expect(chat.recent('main', tomorrow)).toHaveLength(0);
  });

  it('keeps the room bounded however much is said', () => {
    for (let i = 0; i < 400; i++) {
      say(`${i}`.padStart(64, '0'), `line ${i}`, NOON + i * 10_000);
    }

    // A display buffer, not an archive: nobody scrolls back through a day.
    expect(chat.count()).toBeLessThanOrEqual(300);
    // And the newest survive, not the oldest.
    const kept = chat.recent('main', NOON + 400 * 10_000);
    expect(kept[kept.length - 1]?.text).toBe('line 399');
  });
});

describe('who is in the room', () => {
  it('lists everyone who has spoken, once each', () => {
    say(ONE, 'first', NOON);
    say(ONE, 'again', NOON + 5_000);
    say(TWO, 'hello', NOON + 6_000);

    expect(chat.speakers('main', NOON + 6_000).sort()).toEqual([ONE, TWO].sort());
  });

  it('forgets somebody whose messages have aged out', () => {
    say(ONE, 'yesterday', NOON);
    expect(chat.speakers('main', NOON + 25 * 3_600_000)).toEqual([]);
  });
});

describe('surviving a restart', () => {
  it('comes back with what was said', () => {
    say(ONE, 'still here', NOON);
    const saved = chat.serialise();

    chat.restore([]);
    expect(chat.count()).toBe(0);

    chat.restore(saved);
    expect(chat.recent('main', NOON).map((m) => m.text)).toEqual(['still here']);
  });

  it('replaces rather than merges', () => {
    // Restoring twice must leave the same result as restoring once. The board
    // store had this wrong and a deliberately dropped row came back.
    say(ONE, 'one', NOON);
    const saved = chat.serialise();

    chat.restore(saved);
    chat.restore(saved);
    expect(chat.count()).toBe(1);
  });

  it('cleans anything that was written before the rules were', () => {
    chat.restore([
      { id: 'x', pilotId: ONE, text: 'dirty‮text', at: NOON, network: 'main' },
    ]);
    expect(chat.recent('main', NOON)[0]?.text).toBe('dirtytext');
  });
});
