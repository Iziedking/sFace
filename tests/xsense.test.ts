/**
 * The X layer's two trust boundaries.
 *
 * `parseBrief` reads JSON written by a language model, and `parseRoster` reads
 * whatever the service put on the wire. Both are cases where the input is
 * plausible-looking and occasionally wrong, which is worse than input that is
 * obviously wrong: a handle with a space in it renders as a broken tag, a
 * roster of four changes the headcount and therefore the level, and an avatar
 * URL pointing anywhere becomes a request the player's device makes.
 *
 * So both are tested the same way as any other boundary: valid input passes,
 * everything else degrades to the committed archetypes, and nothing throws.
 */

import { describe, expect, it } from 'vitest';

import { parseBrief , ROSTER_SIZE } from '../server/xsense';
import { parseRoster, practiceMission, parseMission, TERRAIN_POINTS } from '../src/game/mission';
import { FACES } from '../src/data/faces';
import { RunState } from '../src/game/state';

const GOOD_BRIEF = {
  headline: 'The market is down and everyone has an opinion about why.',
  sentiment: -55,
  topics: ['ETF outflows', 'L2 fees', 'memecoin fatigue'],
  roster: [
    { handle: 'alice', displayName: 'Alice', line: 'Called the top again.', quirk: 'talker', bounty: 400 },
    { handle: 'bob', displayName: 'Bob', line: 'Still long.', quirk: 'heavy', bounty: 300 },
  ],
};

describe('parseBrief', () => {
  it('reads a well formed brief', () => {
    const brief = parseBrief(JSON.stringify(GOOD_BRIEF));
    expect(brief?.headline).toContain('The market is down');
    expect(brief?.sentiment).toBe(-55);
    expect(brief?.roster).toHaveLength(2);
    expect(brief?.roster[0]?.handle).toBe('alice');
  });

  it('survives a model wrapping the JSON in a code fence', () => {
    const fenced = '```json\n' + JSON.stringify(GOOD_BRIEF) + '\n```';
    expect(parseBrief(fenced)?.roster).toHaveLength(2);
  });

  it('returns null for anything that is not JSON', () => {
    expect(parseBrief(null)).toBeNull();
    expect(parseBrief('')).toBeNull();
    expect(parseBrief('I could not find anything on X today, sorry!')).toBeNull();
    expect(parseBrief('[1,2,3]')).toBeNull();
  });

  it('returns null without a headline, since that is the whole point', () => {
    expect(parseBrief(JSON.stringify({ ...GOOD_BRIEF, headline: '   ' }))).toBeNull();
  });

  it('drops handles that are not real X handles', () => {
    const brief = parseBrief(
      JSON.stringify({
        ...GOOD_BRIEF,
        roster: [
          { handle: 'has a space', displayName: 'X', line: 'y', quirk: 'talker', bounty: 300 },
          { handle: 'waytoolongtobeahandle', displayName: 'X', line: 'y', quirk: 'talker', bounty: 300 },
          { handle: 'bad-dash', displayName: 'X', line: 'y', quirk: 'talker', bounty: 300 },
          { handle: '', displayName: 'X', line: 'y', quirk: 'talker', bounty: 300 },
          { handle: 'good_one', displayName: 'X', line: 'y', quirk: 'talker', bounty: 300 },
        ],
      }),
    );

    expect(brief?.roster.map((r) => r.handle)).toEqual(['good_one']);
  });

  it('strips a leading @ and lowercases', () => {
    const brief = parseBrief(
      JSON.stringify({
        ...GOOD_BRIEF,
        roster: [{ handle: '@VitalikButerin', displayName: 'V', line: 'y', quirk: 'talker', bounty: 300 }],
      }),
    );
    expect(brief?.roster[0]?.handle).toBe('vitalikbuterin');
  });

  it('drops duplicate handles, which would double a character in the level', () => {
    const brief = parseBrief(
      JSON.stringify({
        ...GOOD_BRIEF,
        roster: [
          { handle: 'alice', displayName: 'A', line: 'y', quirk: 'talker', bounty: 300 },
          { handle: 'ALICE', displayName: 'A', line: 'y', quirk: 'heavy', bounty: 300 },
        ],
      }),
    );
    expect(brief?.roster).toHaveLength(1);
  });

  it('never returns more than the cast size, however many the model offers', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      handle: `user${i}`,
      displayName: `User ${i}`,
      line: 'y',
      quirk: 'talker',
      bounty: 300,
    }));
    expect(parseBrief(JSON.stringify({ ...GOOD_BRIEF, roster: many }))?.roster).toHaveLength(ROSTER_SIZE);
  });

  it('clamps sentiment and bounty into the ranges the game can use', () => {
    const brief = parseBrief(
      JSON.stringify({
        ...GOOD_BRIEF,
        sentiment: 9999,
        roster: [{ handle: 'a', displayName: 'A', line: 'y', quirk: 'talker', bounty: 99_999 }],
      }),
    );
    expect(brief?.sentiment).toBe(100);
    expect(brief?.roster[0]?.bounty).toBe(800);
  });

  it('falls back to a known quirk when the model invents one', () => {
    const brief = parseBrief(
      JSON.stringify({
        ...GOOD_BRIEF,
        roster: [{ handle: 'a', displayName: 'A', line: 'y', quirk: 'explodes', bounty: 300 }],
      }),
    );
    expect(['heavy', 'talker', 'paranoid', 'skittish', 'mercenary']).toContain(
      brief?.roster[0]?.quirk,
    );
  });

  it('tolerates missing optional fields rather than dropping the entry', () => {
    const brief = parseBrief(
      JSON.stringify({ headline: 'Something happened.', roster: [{ handle: 'a' }] }),
    );
    expect(brief?.roster).toHaveLength(1);
    expect(brief?.roster[0]?.displayName).toBe('@a');
    expect(brief?.topics).toEqual([]);
  });
});

describe('parseRoster', () => {
  it('always returns a full cast so the headcount never changes', () => {
    // A level with a different number of people is a different level, and two
    // players betting on the same seed must get the same one.
    expect(parseRoster(undefined)).toHaveLength(FACES.length);
    expect(parseRoster([])).toHaveLength(FACES.length);
    expect(parseRoster('nonsense')).toHaveLength(FACES.length);
    expect(parseRoster([{ handle: 'alice' }])).toHaveLength(FACES.length);
  });

  it('keeps the live entries and tops up from the archetypes', () => {
    const roster = parseRoster([
      { handle: 'alice', displayName: 'Alice', line: 'Called it.', quirk: 'heavy', bounty: 500 },
    ]);

    expect(roster[0]?.handle).toBe('alice');
    expect(roster[0]?.bounty).toBe(500);
    expect(roster).toHaveLength(FACES.length);
  });

  it('refuses avatar URLs that are not X image hosts', () => {
    const roster = parseRoster([
      { handle: 'a', avatarUrl: 'https://evil.example.com/track.png' },
      { handle: 'b', avatarUrl: 'http://pbs.twimg.com/x.jpg' },
      { handle: 'c', avatarUrl: 'javascript:alert(1)' },
      { handle: 'd', avatarUrl: 'https://pbs.twimg.com/profile_images/1/x_400x400.jpg' },
    ]);

    expect(roster[0]?.avatarUrl).toBeNull();
    expect(roster[1]?.avatarUrl).toBeNull();
    expect(roster[2]?.avatarUrl).toBeNull();
    expect(roster[3]?.avatarUrl).toBe('https://pbs.twimg.com/profile_images/1/x_400x400.jpg');
  });
});

describe('the roster reaches the level', () => {
  const base = {
    date: '2026-07-28',
    seed: 'seed',
    ticker: 'BEAT',
    coinName: 'Beat',
    changePct: -20,
    terrain: Array.from({ length: TERRAIN_POINTS }, (_, i) => (i % 40) / 40),
    fearGreed: 29,
    fearLabel: 'Fear',
    difficulty: 4,
    bountyMultiplier: 1.45,
  };

  it('puts the handles from today into the run', () => {
    const mission = parseMission({
      ...base,
      roster: [
        { handle: 'alice', displayName: 'Alice', line: 'Called it.', quirk: 'heavy', bounty: 500 },
        { handle: 'bob', displayName: 'Bob', line: 'Still long.', quirk: 'talker', bounty: 400 },
      ],
      story: { headline: 'It is a bad day.', sentiment: -70, topics: ['a'], live: true },
    });

    const run = new RunState(mission!);
    const handles = run.faces.map((f) => f.handle);

    expect(handles).toContain('alice');
    expect(handles).toContain('bob');
    expect(run.faces).toHaveLength(FACES.length);
    expect(mission!.story?.headline).toBe('It is a bad day.');
  });

  it('still lays out a level when there is no roster at all', () => {
    const run = new RunState(practiceMission('2026-07-28'));
    expect(run.faces).toHaveLength(FACES.length);
    expect(run.faces.every((f) => f.handle.length > 0)).toBe(true);
  });

  it('keeps the level identical for the same roster and different for another', () => {
    const withAlice = parseMission({ ...base, roster: [{ handle: 'alice', quirk: 'heavy' }] });
    const alsoAlice = parseMission({ ...base, roster: [{ handle: 'alice', quirk: 'heavy' }] });
    const withBob = parseMission({ ...base, roster: [{ handle: 'bob', quirk: 'skittish' }] });

    const quirks = (m: typeof withAlice) => new RunState(m!).faces.map((f) => f.quirk).join(',');

    expect(quirks(withAlice)).toEqual(quirks(alsoAlice));
    // A different cast is a different level, which is exactly why the seed
    // carries a roster fingerprint on the server.
    expect(quirks(withAlice)).not.toEqual(quirks(withBob));
  });
});
