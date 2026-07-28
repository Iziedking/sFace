/**
 * Today's contracts.
 *
 * The load-bearing test is the first one. Contracts pay a Face multiplier, so
 * if two people betting NIM on the same seed and stage drew different
 * contracts they would be playing for different money, and the fair bet the
 * whole codebase protects would be gone.
 */

import { describe, expect, it } from 'vitest';

import { contractBonus, contractsFor, metContracts, type ContractContext } from '../src/data/contracts';
import { STAGES } from '../src/data/campaign';

function context(overrides: Partial<ContractContext> = {}): ContractContext {
  return {
    seed: '2026-07-28:beat:-23.60:fng29:xabc',
    ticker: 'BEAT',
    changePct: -23.6,
    fearGreed: 29,
    roster: ['ansem', 'cobie', 'saylor', 'cz_binance', 'vitalikbuterin'],
    topics: ['BEAT dump', 'fear index'],
    stage: 1,
    ...overrides,
  };
}

const perfect = { extracted: 5, caches: 12, relic: true, attackers: 40, survived: true, hull: 1 };
const nothing = { extracted: 0, caches: 0, relic: false, attackers: 0, survived: false, hull: 0 };

describe('the fair bet', () => {
  it('gives every player the same three for a day and a stage', () => {
    const print = (c: ContractContext) =>
      contractsFor(c).map((x) => `${x.id}:${x.label}:${x.bonus}`).join('|');

    for (const stage of STAGES) {
      const a = print(context({ stage: stage.n }));
      const b = print(context({ stage: stage.n }));
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(0);
    }
  });

  it('gives a different three on a different day', () => {
    const monday = contractsFor(context()).map((c) => c.label).join('|');
    const tuesday = contractsFor(context({ seed: '2026-07-29:doge:-11.10:fng40:xdef' }))
      .map((c) => c.label)
      .join('|');
    expect(monday).not.toEqual(tuesday);
  });

  it('gives a different three on a different stage of the same day', () => {
    const seen = new Set(
      STAGES.map((s) => contractsFor(context({ stage: s.n })).map((c) => c.label).join('|')),
    );
    // Not all seven need differ, but a day must not hand out one set seven times.
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('the three', () => {
  it('always offers exactly three, and never the same job twice', () => {
    for (const stage of STAGES) {
      const picked = contractsFor(context({ stage: stage.n }));
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((c) => c.id)).size).toBe(3);
    }
  });

  it('names the real day rather than a generic objective', () => {
    const text = contractsFor(context()).map((c) => `${c.label} ${c.because}`).join(' ');
    expect(/BEAT|29|ansem|cobie|saylor|cz_binance|vitalikbuterin|BEAT dump/.test(text)).toBe(true);
  });

  it('survives an empty roster and no live topics', () => {
    const picked = contractsFor(context({ roster: [], topics: [] }));
    expect(picked).toHaveLength(3);
    for (const c of picked) {
      expect(c.label).not.toContain('undefined');
      expect(c.because).not.toContain('undefined');
    }
  });
});

describe('what they pay', () => {
  it('pays nothing extra for a run that met none of them', () => {
    expect(contractBonus(contractsFor(context()), nothing)).toBe(1);
  });

  it('pays every one a perfect run met', () => {
    const picked = contractsFor(context());
    const met = metContracts(picked, perfect);
    expect(met.length).toBeGreaterThan(0);
    expect(contractBonus(picked, perfect)).toBeCloseTo(
      1 + met.reduce((t, c) => t + c.bonus, 0),
      6,
    );
  });

  /** A ceiling worth knowing: three contracts cannot double a score twice over. */
  it('cannot pay more than the sum of three bonuses', () => {
    for (const stage of STAGES) {
      expect(contractBonus(contractsFor(context({ stage: stage.n })), perfect)).toBeLessThanOrEqual(2);
    }
  });
});

describe('difficulty rides the stage', () => {
  /**
   * The same contract has to ask for more late than early, or a fixed target is
   * trivial on Stage 7 and impossible on Stage 1.
   */
  it('asks for more on a later stage', () => {
    const modest = { extracted: 2, caches: 3, relic: true, attackers: 9, survived: true, hull: 0.45 };

    const early = contractBonus(contractsFor(context({ stage: 1 })), modest);
    const late = contractBonus(contractsFor(context({ stage: 7 })), modest);

    // A run that clears the early bar should not clear the late one by more.
    expect(late).toBeLessThanOrEqual(early + 0.0001);
  });
});
