/**
 * Clans.
 *
 * A clan has no store of its own: it is a tag on a profile, and everything
 * about it is folded out of the profiles that carry that tag. So the tests
 * that matter are the ones about that derivation staying honest, in particular
 * that a total is the sum of its members and that leaving actually removes
 * someone's Face from it. A clan whose total kept counting a departed member
 * would be a fabricated number on a board, which is worse than no board.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import * as clans from '../server/clans';
import * as profiles from '../server/profiles';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

/** Give a pilot a record by folding one run into it. */
function pilot(id: string, name: string, score: number): void {
  profiles.record({
    id,
    name,
    avatarUrl: null,
    score,
    rescued: 1,
    caches: 0,
    relics: 0,
    extracted: true,
  });
}

let clock = 1_700_000_000_000;
const at = () => (clock += 1000);

/** Found a clan (tag must be free) and assert it worked. */
function found(id: string, name: string, tag: string): void {
  const outcome = clans.join(id, name, tag, at());
  expect(outcome.status).toBe('founded');
}

/** Ask to join, then have the owner approve, which is the normal path now. */
function letIn(ownerId: string, id: string, name: string, tag: string): void {
  const outcome = clans.join(id, name, tag, at());
  expect(outcome.status).toBe('requested');
  const decided = clans.decide(tag, ownerId, id, true);
  expect(decided.ok).toBe(true);
}

beforeEach(() => {
  // The store is module state shared across this file, so each test starts
  // from a clean one rather than inheriting whatever ran before it. restore
  // replaces the store, so an empty snapshot is an empty store.
  profiles.restore([]);
  clans.restore([]);
  expect(profiles.all()).toHaveLength(0);
});

describe('tags', () => {
  it('accepts two to four letters or digits', () => {
    expect(clans.normaliseTag('FACE')).toBe('FACE');
    expect(clans.normaliseTag('NQ')).toBe('NQ');
    expect(clans.normaliseTag('X99')).toBe('X99');
  });

  /** A person typing " face " has not made a mistake worth an error message. */
  it('corrects case and stray whitespace rather than refusing them', () => {
    expect(clans.normaliseTag('  face ')).toBe('FACE');
    expect(clans.normaliseTag('Nq')).toBe('NQ');
  });

  it('refuses anything that is not a tag', () => {
    expect(clans.normaliseTag('A')).toBeNull();
    expect(clans.normaliseTag('TOOLONG')).toBeNull();
    expect(clans.normaliseTag('AB-C')).toBeNull();
    expect(clans.normaliseTag('  ')).toBeNull();
    expect(clans.normaliseTag('<b>')).toBeNull();
    expect(clans.normaliseTag(null)).toBeNull();
    expect(clans.normaliseTag(42)).toBeNull();
  });
});

describe('the pooled total', () => {
  it('is the sum of its members and nothing else', () => {
    pilot(A, 'Ava', 1_000);
    pilot(B, 'Bo', 2_500);
    pilot(C, 'Cy', 400);

    found(A, 'Ava', 'FACE');
    letIn(A, B, 'Bo', 'FACE');
    found(C, 'Cy', 'NQ');

    const table = clans.table(10);
    expect(table).toHaveLength(2);
    expect(table[0]?.tag).toBe('FACE');
    expect(table[0]?.face).toBe(3_500);
    expect(table[0]?.members).toBe(2);
    expect(table[1]?.face).toBe(400);
  });

  /**
   * The one that would be a lie on a board. Leaving has to take your Face with
   * you, or a clan's number keeps counting people who are not in it.
   */
  it('drops a member the moment they leave', () => {
    pilot(A, 'Ava', 1_000);
    pilot(B, 'Bo', 2_500);
    found(A, 'Ava', 'FACE');
    letIn(A, B, 'Bo', 'FACE');
    expect(clans.table(10)[0]?.face).toBe(3_500);

    clans.join(B, 'Bo', null, at());

    const table = clans.table(10);
    expect(table[0]?.face).toBe(1_000);
    expect(table[0]?.members).toBe(1);
  });

  it('follows a member who moves to another clan', () => {
    pilot(A, 'Ava', 1_000);
    found(A, 'Ava', 'FACE');
    found(A, 'Ava', 'NQ');

    const table = clans.table(10);
    expect(table).toHaveLength(1);
    expect(table[0]?.tag).toBe('NQ');
    expect(table[0]?.face).toBe(1_000);
  });

  it('names the member the clan is actually ranked on', () => {
    pilot(A, 'Ava', 1_000);
    pilot(B, 'Bo', 9_000);
    found(A, 'Ava', 'FACE');
    letIn(A, B, 'Bo', 'FACE');

    expect(clans.table(10)[0]?.topPilot).toBe('Bo');
  });

  it('ranks on pooled Face, biggest first', () => {
    pilot(A, 'Ava', 500);
    pilot(B, 'Bo', 9_000);
    pilot(C, 'Cy', 3_000);
    found(A, 'Ava', 'AA');
    found(B, 'Bo', 'BB');
    found(C, 'Cy', 'CC');

    expect(clans.table(10).map((r) => r.tag)).toEqual(['BB', 'CC', 'AA']);
  });
});

describe('the door', () => {
  /**
   * The load-bearing one. A clan with an open door is a hashtag, not a group:
   * you cannot run it, you cannot say who is in it, and a tag somebody built up
   * can be walked into by anyone who read it off the board.
   */
  it('does not let anyone into a clan that already has an owner', () => {
    pilot(A, 'Ava', 5_000);
    pilot(B, 'Bo', 1_000);
    found(A, 'Ava', 'FACE');

    const outcome = clans.join(B, 'Bo', 'FACE', at());
    expect(outcome.status).toBe('requested');

    // Not a member, and their Face is not in the total.
    expect(profiles.get(B)?.clanTag).toBeNull();
    expect(clans.table(10)[0]?.face).toBe(5_000);
    expect(clans.table(10)[0]?.members).toBe(1);
  });

  it('lets them in only once the owner says so', () => {
    pilot(A, 'Ava', 5_000);
    pilot(B, 'Bo', 1_000);
    found(A, 'Ava', 'FACE');
    clans.join(B, 'Bo', 'FACE', at());

    expect(clans.detail('FACE')?.pending.map((p) => p.id)).toEqual([B]);

    expect(clans.decide('FACE', A, B, true).ok).toBe(true);
    expect(profiles.get(B)?.clanTag).toBe('FACE');
    expect(clans.table(10)[0]?.face).toBe(6_000);
    expect(clans.detail('FACE')?.pending).toHaveLength(0);
  });

  it('drops the request when the owner turns them away', () => {
    pilot(A, 'Ava', 5_000);
    pilot(B, 'Bo', 1_000);
    found(A, 'Ava', 'FACE');
    clans.join(B, 'Bo', 'FACE', at());

    expect(clans.decide('FACE', A, B, false).ok).toBe(true);
    expect(profiles.get(B)?.clanTag).toBeNull();
    expect(clans.detail('FACE')?.pending).toHaveLength(0);
  });

  /** Only the owner. A member deciding for the clan is the whole hole. */
  it('refuses a decision from anyone but the owner', () => {
    pilot(A, 'Ava', 5_000);
    pilot(B, 'Bo', 1_000);
    pilot(C, 'Cy', 100);
    found(A, 'Ava', 'FACE');
    letIn(A, B, 'Bo', 'FACE');
    clans.join(C, 'Cy', 'FACE', at());

    const result = clans.decide('FACE', B, C, true);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe(403);
    expect(profiles.get(C)?.clanTag).toBeNull();
  });

  it('does not stack duplicate requests from the same pilot', () => {
    found(A, 'Ava', 'FACE');
    clans.join(B, 'Bo', 'FACE', at());
    clans.join(B, 'Bo', 'FACE', at());

    expect(clans.detail('FACE')?.pending).toHaveLength(1);
    expect(clans.pendingFor(B)).toEqual(['FACE']);
  });

  it('withdraws the request when the asker leaves', () => {
    found(A, 'Ava', 'FACE');
    clans.join(B, 'Bo', 'FACE', at());
    clans.join(B, 'Bo', null, at());

    expect(clans.detail('FACE')?.pending).toHaveLength(0);
    expect(clans.pendingFor(B)).toEqual([]);
  });

  /**
   * A clan does not evaporate when its owner quits. Everyone else's pooled Face
   * is in it and none of them did anything, so the keys pass to whoever has
   * been in it longest.
   */
  it('hands ownership on when the owner leaves', () => {
    pilot(A, 'Ava', 5_000);
    pilot(B, 'Bo', 1_000);
    found(A, 'Ava', 'FACE');
    letIn(A, B, 'Bo', 'FACE');

    clans.join(A, 'Ava', null, at());

    expect(clans.detail('FACE')?.ownerId).toBe(B);
    expect(clans.table(10)[0]?.face).toBe(1_000);
  });

  it('removes a clan only once the last member has gone', () => {
    pilot(A, 'Ava', 5_000);
    found(A, 'Ava', 'FACE');
    clans.join(A, 'Ava', null, at());

    expect(clans.detail('FACE')).toBeNull();
  });
});

describe('joining', () => {
  /**
   * Somebody opens an invite link before they have ever finished a run. If that
   * were refused the invite would look broken to the exact person it was meant
   * to bring in.
   */
  it('works before a pilot has posted a single run', () => {
    const outcome = clans.join(D, 'New', 'FACE', at());
    expect(outcome.status).toBe('founded');
    expect(profiles.get(D)?.clanTag).toBe('FACE');
    expect(profiles.get(D)?.runs).toBe(0);

    const table = clans.table(10);
    expect(table[0]?.members).toBe(1);
    expect(table[0]?.face).toBe(0);
  });

  it('reports where a clan sits and who is in it', () => {
    pilot(A, 'Ava', 500);
    pilot(B, 'Bo', 9_000);
    found(A, 'Ava', 'AA');
    found(B, 'Bo', 'BB');

    const detail = clans.detail('AA');
    expect(detail?.place).toBe(2);
    expect(detail?.roster.map((m) => m.name)).toEqual(['Ava']);
  });

  it('has nothing to report for a tag nobody has taken', () => {
    expect(clans.detail('ZZ')).toBeNull();
  });

  /** A clan tag survives a restart, because it lives on the profile snapshot. */
  it('survives a snapshot round trip', () => {
    pilot(A, 'Ava', 1_000);
    found(A, 'Ava', 'FACE');

    const members = JSON.parse(JSON.stringify(profiles.serialise()));
    const owners = JSON.parse(JSON.stringify(clans.serialise()));
    profiles.restore([]);
    clans.restore([]);
    expect(clans.table(10)).toHaveLength(0);

    profiles.restore(members);
    clans.restore(owners);
    expect(clans.table(10)[0]?.tag).toBe('FACE');
    expect(clans.table(10)[0]?.face).toBe(1_000);
    // Ownership has to survive too, or every restart hands every clan back to
    // whoever asks next.
    expect(clans.detail('FACE')?.ownerId).toBe(A);
  });
});
