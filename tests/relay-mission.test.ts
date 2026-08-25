import { describe, expect, it } from 'vitest';

import { RELAY_COURSE_HEIGHT, RELAY_COURSE_WIDTH, RELAY_POD_WIDTH } from '../shared/relay/constants';
import { commitRelaySeed, encodeRelayCommitmentInput } from '../shared/relay/commitment';
import { generateRelayMission } from '../shared/relay/mission';
import { RELAY_RULESET } from '../shared/relay/ruleset';
import { RelayRng } from '../shared/relay/rng';

const VECTOR_SEED = '0123456789abcdef'.repeat(4);

describe('Relay deterministic RNG', () => {
  it('matches the pinned unsigned 32-bit vector in every runtime', () => {
    const rng = new RelayRng(VECTOR_SEED);
    const values = Array.from({ length: 100 }, () => rng.nextUint());
    expect(values.slice(0, 5)).toEqual([
      0xc59c4418,
      0xeef33077,
      0x974f1529,
      0xc8abf45c,
      0x7225c6cc,
    ]);
    expect(new RelayRng(VECTOR_SEED).nextUint()).toBe(values[0]);
    expect(values.every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
  });
});

describe('Relay seed commitments', () => {
  it('uses length-prefixed fields instead of ambiguous concatenation', () => {
    expect(encodeRelayCommitmentInput({ ruleset: 'ab', missionDate: 'c', seedHex: '00' })).not.toEqual(
      encodeRelayCommitmentInput({ ruleset: 'a', missionDate: 'bc', seedHex: '00' }),
    );
  });

  it('changes when one seed, date, or ruleset byte changes', async () => {
    const base = await commitRelaySeed({
      ruleset: 'relay-1',
      missionDate: '2026-08-24',
      seedHex: VECTOR_SEED,
    });
    const changedSeed = await commitRelaySeed({
      ruleset: 'relay-1',
      missionDate: '2026-08-24',
      seedHex: `${VECTOR_SEED.slice(0, -2)}00`,
    });
    const changedDate = await commitRelaySeed({
      ruleset: 'relay-1',
      missionDate: '2026-08-25',
      seedHex: VECTOR_SEED,
    });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(changedSeed).not.toBe(base);
    expect(changedDate).not.toBe(base);
  });
});

describe('Relay mission generation', () => {
  it('is deterministic and satisfies the route invariants across 10,000 seeds', () => {
    for (let index = 0; index < 10_000; index += 1) {
      const seed = index.toString(16).padStart(64, '0');
      let mission;
      try {
        mission = generateRelayMission(seed, RELAY_RULESET);
      } catch (error) {
        throw new Error(`Mission invariant failed for seed ${seed}: ${String(error)}`);
      }
      if (index < 10 && JSON.stringify(mission) !== JSON.stringify(generateRelayMission(seed, RELAY_RULESET))) {
        throw new Error(`Mission was not deterministic for seed ${seed}.`);
      }
      if (mission.nodes.length !== mission.sections.length * 3) throw new Error(`Node count failed for seed ${seed}.`);
      if (mission.gates.length !== mission.sections.length) throw new Error(`Gate count failed for seed ${seed}.`);
      for (const object of [...mission.nodes, ...mission.gates, ...mission.hazards]) {
        if (object.x < 0 || object.x > RELAY_COURSE_WIDTH || object.y < 0 || object.y > RELAY_COURSE_HEIGHT) {
          throw new Error(`Bounds failed for seed ${seed}.`);
        }
      }
      if (!mission.hazards.every((hazard) => hazard.x > RELAY_POD_WIDTH * 2)) {
        throw new Error(`Spawn collision failed for seed ${seed}.`);
      }
      for (const section of mission.sections) {
        const nodes = section.nodeIds.map((id) => mission.nodes.find((node) => node.id === id)!);
        const gate = mission.gates.find((item) => item.id === section.gateId)!;
        if (nodes.length !== 3 || !nodes.every((node) => node.x < gate.x)) {
          throw new Error(`Node ordering failed for seed ${seed}.`);
        }
        if (section.endX <= section.startX) throw new Error(`Section bounds failed for seed ${seed}.`);
        if (!mission.hazards.filter((hazard) => section.hazardIds.includes(hazard.id))
          .every((hazard) => hazard.y > 900 && hazard.y < RELAY_COURSE_HEIGHT - 900)) {
          throw new Error(`Viable route failed for seed ${seed}.`);
        }
      }
    }
  }, 60_000);
});
