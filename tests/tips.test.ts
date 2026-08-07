/**
 * Tips, and the fact that this service never sees the money.
 *
 * Nothing here moves NIM. A tip is a wallet-to-wallet transaction approved in
 * Nimiq Pay, and the chain is the receipt. What this store does is carry the
 * news to a phone that was not there when it happened, which makes the failures
 * a different set from anything else in the app:
 *
 *   - telling somebody about money that never could have reached them,
 *   - forgetting that somebody has already been told,
 *   - and letting the cheapest possible action, a tip that cannot be sent,
 *     become a way to put notifications in front of a person over and over.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as tips from '../server/tips';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);
const THIRD = 'c'.repeat(64);

/*
 * Now, rather than a fixed date. The three day window is measured against the
 * wall clock at restore, so a hardcoded moment ages out and the tests start
 * failing on their own with nothing having changed.
 */
const NOW = Date.now();
const MINUTE = 60_000;

function send(from: string, to: string, nim = 5, at = NOW, state: tips.TipState = 'sent') {
  return tips.record({ network: 'main', from, to, nim, state, now: at });
}

beforeEach(() => {
  tips.restore(null);
});

describe('recording one', () => {
  it('keeps it and hands it back', () => {
    const result = send(ME, THEM, 5);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.nim).toBe(5);

    expect(tips.inbox('main', THEM, NOW).map((t) => t.nim)).toEqual([5]);
  });

  it('puts it in the recipient\'s inbox and nobody else\'s', () => {
    send(ME, THEM);
    expect(tips.inbox('main', ME, NOW)).toHaveLength(0);
    expect(tips.inbox('main', THIRD, NOW)).toHaveLength(0);
  });

  it('refuses tipping yourself', () => {
    // Not a moral point. It would be a notification telling you what you just
    // did, which is the definition of noise.
    expect(send(ME, ME).ok).toBe(false);
  });

  it('refuses an amount that can only be a mistake', () => {
    expect(send(ME, THEM, 0).ok).toBe(false);
    expect(send(ME, THEM, -5).ok).toBe(false);
    expect(send(ME, THEM, tips.MAX_TIP_NIM + 1).ok).toBe(false);
  });
});

describe('the tip that could not be sent', () => {
  it('is recorded, because that is the whole point of it', () => {
    /*
     * Somebody aimed money at a pilot with no wallet. Nothing moved and nothing
     * could have, and if this were dropped that pilot would never learn they
     * are missing tips. The room used to hide the button instead, which was
     * tidy and told nobody anything.
     */
    const result = send(ME, THEM, 5, NOW, 'no-wallet');
    expect(result.ok).toBe(true);
    expect(tips.inbox('main', THEM, NOW)[0]?.state).toBe('no-wallet');
  });

  it('does not name who tried', () => {
    // The reader has no way to check the claim, and naming somebody who cannot
    // pay them is a taunt rather than information.
    send(ME, THEM, 5, NOW, 'no-wallet');
    expect(tips.sendersFor('main', THEM, NOW)).toEqual([]);
  });

  it('names the sender when the tip actually went', () => {
    send(ME, THEM, 5, NOW, 'sent');
    expect(tips.sendersFor('main', THEM, NOW)).toEqual([ME]);
  });
});

describe('one person cannot bury another in notices', () => {
  it('holds a pair to one tip a minute', () => {
    /*
     * The refused path is the one that matters. It costs nothing at all, so
     * without a floor it is a button that puts a notification on somebody's
     * phone as fast as it can be pressed.
     */
    expect(send(ME, THEM, 5, NOW, 'no-wallet').ok).toBe(true);
    expect(send(ME, THEM, 5, NOW + 1_000, 'no-wallet').ok).toBe(false);
    expect(send(ME, THEM, 5, NOW + 2 * MINUTE, 'no-wallet').ok).toBe(true);
  });

  it('does not hold up a different pair', () => {
    // A floor on one pair, not on the room. Two people tipping is the point.
    expect(send(ME, THEM, 5, NOW).ok).toBe(true);
    expect(send(THIRD, THEM, 5, NOW + 1_000).ok).toBe(true);
  });

  it('drops the oldest rather than refusing the newest when one fills up', () => {
    /*
     * An inbox that fills and starts refusing real tips would have the trade
     * exactly backwards: the thing being protected is the reader's attention,
     * not the store.
     */
    for (let i = 0; i < 60; i++) {
      send(`${i}`.padStart(64, '0'), THEM, 1, NOW + i * 2 * MINUTE);
    }

    const waiting = tips.inbox('main', THEM, NOW + 200 * MINUTE);
    expect(waiting.length).toBeLessThanOrEqual(30);
    // Newest first, and the newest is the one that survived.
    expect(waiting[0]?.from).toBe('59'.padStart(64, '0'));
  });
});

describe('being told once', () => {
  it('empties the inbox when it is marked seen', () => {
    send(ME, THEM, 5, NOW);
    expect(tips.inbox('main', THEM, NOW)).toHaveLength(1);

    tips.markSeen('main', THEM, NOW);
    expect(tips.inbox('main', THEM, NOW)).toHaveLength(0);
  });

  it('still shows one that landed after the last look', () => {
    send(ME, THEM, 5, NOW);
    tips.markSeen('main', THEM, NOW);

    send(THIRD, THEM, 5, NOW + MINUTE);
    expect(tips.inbox('main', THEM, NOW + MINUTE)).toHaveLength(1);
  });

  it('marks one pilot without marking anybody else', () => {
    send(ME, THEM, 5, NOW);
    send(ME, THIRD, 5, NOW);

    tips.markSeen('main', THEM, NOW);
    expect(tips.inbox('main', THIRD, NOW)).toHaveLength(1);
  });
});

describe('the room is per chain here too', () => {
  it('never mixes them', () => {
    // Test NIM comes out of a faucet, so a testnet tip is not a tip.
    tips.record({ network: 'test', from: ME, to: THEM, nim: 5, state: 'sent', now: NOW });
    expect(tips.inbox('main', THEM, NOW)).toHaveLength(0);
    expect(tips.inbox('test', THEM, NOW)).toHaveLength(1);
  });

  it('keeps the cooldown per chain as well', () => {
    expect(send(ME, THEM, 5, NOW).ok).toBe(true);
    const other = tips.record({
      network: 'test', from: ME, to: THEM, nim: 5, state: 'sent', now: NOW + 1_000,
    });
    expect(other.ok).toBe(true);
  });
});

describe('surviving a restart', () => {
  it('comes back with what was waiting', () => {
    send(ME, THEM, 5, NOW);
    const saved = tips.serialise();

    tips.restore(null);
    expect(tips.count()).toBe(0);

    tips.restore(saved);
    expect(tips.inbox('main', THEM, NOW).map((t) => t.nim)).toEqual([5]);
  });

  it('does not announce three days of tips again', () => {
    /*
     * The loudest possible failure in this file. Drop the watermarks and every
     * pilot is told about every tip of the last three days, every time the
     * service restarts, with the wallet showing nothing new arriving.
     */
    send(ME, THEM, 5, NOW);
    tips.markSeen('main', THEM, NOW);

    tips.restore(tips.serialise());
    expect(tips.inbox('main', THEM, NOW)).toHaveLength(0);
  });

  it('replaces rather than merges', () => {
    send(ME, THEM, 5, NOW);
    const saved = tips.serialise();

    tips.restore(saved);
    tips.restore(saved);
    expect(tips.count()).toBe(1);
  });

  it('clears the cooldown with everything else', () => {
    // It is in-memory rate limiting rather than state worth keeping, and
    // leaving it behind means a restore does not actually reset the store.
    send(ME, THEM, 5, NOW);
    tips.restore(null);
    expect(send(ME, THEM, 5, NOW + 1_000).ok).toBe(true);
  });

  it('ignores rows written by something that was not this', () => {
    tips.restore({ records: [{ id: 'x' }, null, { id: 'y', from: ME }], seen: 'nonsense' });
    expect(tips.count()).toBe(0);
  });
});

describe('nothing waits forever', () => {
  it('forgets what nobody looked at for three days', () => {
    send(ME, THEM, 5, NOW);
    expect(tips.inbox('main', THEM, NOW + 4 * 24 * 3_600_000)).toHaveLength(0);
  });

  it('prunes it out of the store, not only out of the view', () => {
    send(ME, THEM, 5, NOW);
    tips.prune(NOW + 4 * 24 * 3_600_000);
    expect(tips.count()).toBe(0);
  });
});
