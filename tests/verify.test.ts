/**
 * Bounding a claim by the level it claims to have happened on.
 *
 * The old ceiling was a constant: nobody scores above 60,000. The new one is a
 * fact about a specific seed, which is a different class of check. These tests
 * exist to prove the facts are real rather than generous.
 */

import { describe, expect, it } from 'vitest';

import { levelFacts, refuse, type ClaimedRun } from '../server/verify';
import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';

/** parseMission takes the wire shape, so hand it one. */
function payload(stage = 1) {
  const m = practiceMission('2026-07-29');
  const run = new RunState(m, undefined, stage);
  return { wire: JSON.parse(JSON.stringify(m)), run };
}

function claim(over: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    seed: 'x',
    stage: 1,
    score: 100,
    facesExtracted: 0,
    attackersCleared: 0,
    cachesTaken: 0,
    duration: 60,
    extracted: false,
    ...over,
  };
}

describe('the level is the ceiling', () => {
  it('reads real counts off the seed', () => {
    const { wire, run } = payload(1);
    const facts = levelFacts(wire, 1);

    expect(facts).not.toBeNull();
    expect(facts!.enemies).toBe(run.enemies.length);
    expect(facts!.caches).toBe(run.caches.length);
    expect(facts!.faces).toBe(run.faces.length);
    expect(facts!.enemies).toBeGreaterThan(0);
  });

  it('refuses more kills than the level contains', () => {
    const { wire } = payload(1);
    const facts = levelFacts(wire, 1)!;

    expect(refuse(claim({ attackersCleared: facts.enemies }), facts)).toBeNull();
    expect(refuse(claim({ attackersCleared: facts.enemies + 1 }), facts)).toMatch(/Kill count/);
  });

  it('refuses more caches and more rescues than exist', () => {
    const { wire } = payload(1);
    const facts = levelFacts(wire, 1)!;

    expect(refuse(claim({ cachesTaken: facts.caches + 1 }), facts)).toMatch(/Cache count/);
    expect(refuse(claim({ facesExtracted: facts.faces + 1 }), facts)).toMatch(/Rescue count/);
  });

  it('refuses a score the level cannot pay', () => {
    const { wire } = payload(1);
    const facts = levelFacts(wire, 1)!;

    expect(refuse(claim({ score: facts.maxScore }), facts)).toBeNull();
    expect(refuse(claim({ score: facts.maxScore + 1 }), facts)).toMatch(/can pay/);
  });

  it('bounds far tighter than the old fixed ceiling', () => {
    // The whole point: 60,000 was legal on every seed. This must be a real cut.
    const { wire } = payload(1);
    const facts = levelFacts(wire, 1)!;
    expect(facts.maxScore).toBeLessThan(60_000);
  });

  it('refuses a run longer than the stage allows', () => {
    const { wire } = payload(1);
    const facts = levelFacts(wire, 1)!;
    expect(refuse(claim({ duration: facts.seconds + 5 }), facts)).toMatch(/longer than/);
  });

  it('refuses rescues on a run that never extracted', () => {
    const { wire } = payload(1);
    const facts = levelFacts(wire, 1)!;
    expect(refuse(claim({ facesExtracted: 1, extracted: false }), facts)).toMatch(/did not extract/);
    expect(refuse(claim({ facesExtracted: 1, extracted: true }), facts)).toBeNull();
  });

  it('gives a later stage a higher ceiling than stage one', () => {
    const { wire } = payload(1);
    const one = levelFacts(wire, 1)!;
    const seven = levelFacts(wire, 7)!;

    expect(seven.enemies).toBeGreaterThan(one.enemies);
    expect(seven.maxScore).toBeGreaterThan(one.maxScore);
  });

  it('returns null rather than throwing on a malformed payload', () => {
    expect(levelFacts(null, 1)).toBeNull();
    expect(levelFacts({ terrain: 'nope' }, 1)).toBeNull();
  });
});
