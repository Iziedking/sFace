/**
 * The finale has to actually be gated.
 *
 * Stage seven is built on one rule: no weapon opens a gate, so the only way
 * inward is to have gone and looked at the projects and answered for the wall.
 *
 * That rule did nothing. A locked ring was solid except at its gap, and the gap
 * was walkable, so the whole stage could be spiralled to the core without
 * answering anything. Nothing about playing it would have told you either: you
 * kept finding your way in, which is exactly what the stage looks like when it
 * is working.
 *
 * These pin the rule itself rather than any one wall, because the failure was
 * invisible from the outside and would be again.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { solidAt } from '../src/game/rings';
import { answerGate } from '../src/game/ally';

const MISSION = practiceMission('2026-07-31');

function finale(): RunState {
  return new RunState(MISSION, 'sidearm', 7);
}

/** A point on a ring's circumference, at the given angle. */
function on(state: RunState, ringIndex: number, angle: number) {
  const c = state.rings!;
  const ring = c.rings[ringIndex]!;
  return {
    x: c.cx + Math.cos(angle) * ring.radius,
    y: c.cy + Math.sin(angle) * ring.radius,
  };
}

describe('a locked wall is closed', () => {
  it('has no way through it, including where the gate stands', () => {
    const state = finale();
    const c = state.rings!;

    c.rings.forEach((ring, i) => {
      expect(ring.locked).toBe(true);

      // The gap, which used to be a hole.
      const gap = on(state, i, ring.gapAt);
      expect(solidAt(c, gap.x, gap.y)).toBe(true);

      // And the far side, which always was solid.
      const far = on(state, i, ring.gapAt + Math.PI);
      expect(solidAt(c, far.x, far.y)).toBe(true);
    });
  });

  it('cannot be spiralled through without answering', () => {
    /*
     * The whole bug, stated as a walk.
     *
     * Step outward to inward along every ring's gap angle. With the gaps open
     * this walk never met a wall, which is how the finale was completable with
     * the gates untouched.
     */
    const state = finale();
    const c = state.rings!;

    const blocked = c.rings.filter((ring, i) => {
      const gap = on(state, i, ring.gapAt);
      return solidAt(c, gap.x, gap.y);
    });

    expect(blocked).toHaveLength(c.rings.length);
  });
});

describe('answering opens the wall it was asked for', () => {
  it('opens that ring and leaves the others shut', () => {
    const state = finale();
    const c = state.rings!;
    const outerIndex = c.rings.length - 1;

    const gate = state.gates.find((g) => g.ring === outerIndex);
    expect(gate).toBeDefined();

    // Standing at it, having learned what it asks about.
    state.openGateId = gate!.id;
    for (const id of gate!.options) {
      const ally = state.allies.find((a) => a.id === id);
      if (ally) ally.known = true;
    }

    expect(answerGate(state, gate!.answer)).toBe('open');

    const opened = on(state, outerIndex, c.rings[outerIndex]!.gapAt);
    expect(solidAt(c, opened.x, opened.y)).toBe(false);

    // Every other wall is still a wall.
    for (let i = 0; i < c.rings.length; i++) {
      if (i === outerIndex) continue;
      const gap = on(state, i, c.rings[i]!.gapAt);
      expect(solidAt(c, gap.x, gap.y)).toBe(true);
    }
  });
});

describe('the stage can be finished', () => {
  it('has one gate for every wall', () => {
    // Five rings and four gates once shipped, which left the outermost wall
    // with nothing to open it.
    const state = finale();
    const rings = state.rings!.rings.length;

    expect(state.gates).toHaveLength(rings);
    for (let i = 0; i < rings; i++) {
      expect(state.gates.filter((g) => g.ring === i)).toHaveLength(1);
    }
  });

  it('never asks about a project sealed behind the wall it guards', () => {
    /*
     * The progression this rests on. Each gate may only ask about projects the
     * player could already have reached, or it is unanswerable in order, which
     * is not difficulty, it is a dead end.
     */
    const state = finale();
    const c = state.rings!;

    for (const gate of state.gates) {
      const wall = c.rings[gate.ring]!;

      for (const id of gate.options) {
        const ally = state.allies.find((a) => a.id === id);
        expect(ally).toBeDefined();

        const radius = Math.hypot(ally!.x - c.cx, ally!.y - c.cy);
        // Outside the wall it guards, so reachable before answering it.
        expect(radius).toBeGreaterThan(wall.radius);
      }
    }
  });
});
