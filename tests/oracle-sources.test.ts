/**
 * The Dispatch always reads the market, not only the argument.
 *
 * The roster is whoever crypto X argued about that day, which is the right
 * source for the people in the wreck and the wrong one for the state of the
 * market. On a quiet day the argument is about a launch and the Dispatch comes
 * back with nothing about crypto having a bad year, which is the premise of the
 * whole game.
 *
 * So a short standing list is read alongside it. These pin that the merge does
 * not waste calls or drop anybody.
 */

import { describe, expect, it } from 'vitest';

import { ALWAYS_READ, readList } from '../server/oracle';

describe('who the Dispatch reads', () => {
  it('adds the standing accounts to the day roster', () => {
    const list = readList(['alice', 'bob']);

    expect(list).toContain('alice');
    expect(list).toContain('bob');
    for (const handle of ALWAYS_READ) expect(list).toContain(handle);
  });

  it('reads them even when the day gave us nobody', () => {
    // A failed or empty X read must still leave something to rank.
    expect(readList([])).toEqual([...ALWAYS_READ]);
  });

  it('does not spend a call twice on the same handle', () => {
    // Every handle is a request against a metered quota.
    const list = readList(['WatcherGuru', 'alice']);

    expect(list.filter((h) => h.toLowerCase() === 'watcherguru')).toHaveLength(1);
    expect(list).toHaveLength(2);
  });

  it('treats a handle as the same however it was written', () => {
    const list = readList(['@watcherguru', 'WATCHERGURU', '  alice  ']);

    expect(list.filter((h) => h.toLowerCase() === 'watcherguru')).toHaveLength(1);
    expect(list).toContain('alice');
  });

  it('keeps the day roster first', () => {
    // The people the day was about are the point. The standing list is backfill.
    expect(readList(['alice'])[0]).toBe('alice');
  });

  it('drops empty entries rather than requesting them', () => {
    expect(readList(['', '@', 'alice'])).not.toContain('');
  });
});
