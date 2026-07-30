/**
 * Stage six: the read.
 *
 * The things worth pinning here are the honesty rules and the cost model. Every
 * option has to be a post that genuinely exists with a link on it, the same seed
 * has to ask the same questions in the same order, and a wrong answer has to
 * cost time and noise rather than a hidden number.
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { RunState } from '../src/game/state';
import {
  ALARM_RADIUS,
  ALARM_SECONDS,
  NODE_REACH,
  NODE_SCORE,
  OPTIONS_PER_NODE,
  answerNode,
  layOutNodes,
  updateNodes,
} from '../src/game/node';
import { practiceMission, type DailyMission, type DispatchPost } from '../src/game/mission';
import { step } from '../src/game/update';
import type { PlayerCommand } from '../src/game/player';

const STILL: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function posts(count: number): DispatchPost[] {
  return Array.from({ length: count }, (_, i) => ({
    handle: `writer${i}`,
    summary: `post number ${i}`,
    why: 'because',
    kind: 'receipt' as const,
    url: `https://x.com/writer${i}/status/${1000 + i}`,
  }));
}

/**
 * A day that gave us a real read.
 *
 * A practice mission carries no story, which is a genuine state the game has to
 * survive and is covered on its own below. Every case about answering needs a
 * day that produced sourced posts, so one is attached here rather than left to
 * whatever the fallback happens to contain.
 */
function readableDay(): DailyMission {
  const mission = practiceMission('2026-07-29');
  return {
    ...mission,
    story: {
      headline: 'Something happened',
      sentiment: -30,
      topics: ['a', 'b'],
      live: true,
      posts: posts(9),
      threads: [],
    },
  };
}

function lay(count: number, wanted: number, seed = 'seed') {
  const rng = new Rng(seed);
  let id = 1;
  return layOutNodes(rng, posts(count), wanted, () => ({ x: 100, y: 100 }), () => id++);
}

describe('laying out reads', () => {
  it('gives every node four options', () => {
    const nodes = lay(9, 4);
    expect(nodes).toHaveLength(4);
    for (const node of nodes) expect(node.options).toHaveLength(OPTIONS_PER_NODE);
  });

  it('never repeats a post inside one node', () => {
    for (const node of lay(9, 6)) {
      const handles = new Set(node.options.map((o) => o.post.handle));
      expect(handles.size).toBe(OPTIONS_PER_NODE);
    }
  });

  it('only ever offers a post that carries a link', () => {
    // The rule the whole stage is built around. A generated option with no
    // source would be a statement attributed to a real account that they never
    // made, which is the one thing this game must never render.
    for (const node of lay(9, 4)) {
      for (const option of node.options) {
        expect(option.post.url).toMatch(/^https:\/\/x\.com\//);
      }
    }
  });

  it('marks the strongest of the four as the answer', () => {
    for (const node of lay(9, 6)) {
      const best = Math.min(...node.options.map((o) => o.rank));
      expect(node.options[node.answer]!.rank).toBe(best);
    }
  });

  it('does not always put the answer in the same slot', () => {
    const slots = new Set(lay(12, 12).map((node) => node.answer));
    expect(slots.size).toBeGreaterThan(1);
  });

  it('asks the same questions in the same order on one seed', () => {
    const a = lay(9, 4, 'same');
    const b = lay(9, 4, 'same');
    expect(b.map((n) => n.options.map((o) => o.post.handle))).toEqual(
      a.map((n) => n.options.map((o) => o.post.handle)),
    );
    expect(b.map((n) => n.answer)).toEqual(a.map((n) => n.answer));
  });

  it('builds nothing rather than inventing options on a quiet day', () => {
    expect(lay(3, 4)).toHaveLength(0);
  });

  it('gives every node a different answer', () => {
    // The failure this replaced: four posts drawn at random per node out of a
    // pool of six meant the day's strongest read was in most of them, so every
    // panel had the same answer and the stage was free after the first one.
    const answers = lay(9, 4).map((node) => node.options[node.answer]!.post.handle);
    expect(new Set(answers).size).toBe(answers.length);
  });

  it('never shows a stronger read than the answer', () => {
    for (const node of lay(9, 4)) {
      const best = Math.min(...node.options.map((o) => o.rank));
      expect(node.options[node.answer]!.rank).toBe(best);
    }
  });

  it('builds fewer nodes than asked for rather than repeating a question', () => {
    // Six posts is a normal live day. Four options each, all distractors ranked
    // below the answer, leaves three buildable panels.
    expect(lay(6, 4)).toHaveLength(3);
  });
});

describe('answering', () => {
  function stageSix() {
    const state = new RunState(readableDay(), undefined, 6);
    // Every case below depends on the day having produced nodes. Assert it once
    // here rather than guarding each test, so a regression that stops building
    // them fails loudly instead of turning eight tests into silent passes.
    expect(state.nodes.length).toBeGreaterThan(0);
    return state;
  }

  it('flips the node and banks the score on a right read', () => {
    const state = stageSix();

    const node = state.nodes[0]!;
    state.openNodeId = node.id;

    expect(answerNode(state, node.answer)).toBe('captured');
    expect(node.captured).toBe(true);
    expect(state.nodesCaptured).toBe(1);
    expect(state.nodeScore).toBe(NODE_SCORE);
  });

  it('costs time and noise on a wrong read, not score', () => {
    const state = stageSix();

    const node = state.nodes[0]!;
    state.openNodeId = node.id;
    const before = state.nodeScore;

    const wrong = (node.answer + 1) % node.options.length;
    expect(answerNode(state, wrong)).toBe('wrong');

    // Nothing is taken away. The punishment is the street, not the scoreboard.
    expect(state.nodeScore).toBe(before);
    expect(node.captured).toBe(false);
    expect(node.missed).toBe(1);
    expect(state.nodeAlarmUntil).toBeCloseTo(state.time + ALARM_SECONDS, 5);
  });

  it('wakes attackers near the node and leaves distant ones alone', () => {
    const state = stageSix();
    expect(state.enemies.length).toBeGreaterThan(1);

    const node = state.nodes[0]!;

    const near = state.enemies[0]!;
    near.x = node.x + 40;
    near.y = node.y;
    near.active = false;
    near.alertUntil = -1;

    const far = state.enemies[1];
    if (far) {
      far.x = node.x + ALARM_RADIUS + 500;
      far.y = node.y;
      far.active = false;
      far.alertUntil = -1;
    }

    state.openNodeId = node.id;
    answerNode(state, (node.answer + 1) % node.options.length);

    expect(near.active).toBe(true);
    expect(near.alertUntil).toBeGreaterThan(state.time);
    if (far) expect(far.active).toBe(false);
  });

  it('refuses an answer when no question is open', () => {
    const state = stageSix();
    state.openNodeId = null;
    expect(answerNode(state, 0)).toBe('none');
    expect(state.nodesMissed).toBe(0);
  });

  it('closes the question either way, so you cannot cycle the other three', () => {
    const state = stageSix();

    const node = state.nodes[0]!;
    state.openNodeId = node.id;
    answerNode(state, (node.answer + 1) % node.options.length);

    expect(state.openNodeId).toBeNull();
    expect(answerNode(state, node.answer)).toBe('none');
  });

  it('leaves a blown node standing, so it can be tried again', () => {
    const state = stageSix();

    const node = state.nodes[0]!;
    state.openNodeId = node.id;
    answerNode(state, (node.answer + 1) % node.options.length);

    // Walk back to it. Proximity is the retry; nothing has to be reset.
    state.player.x = node.x;
    state.player.y = node.y;
    state.driving = false;
    updateNodes(state);

    expect(state.openNodeId).toBe(node.id);
    expect(answerNode(state, node.answer)).toBe('captured');
  });
});

describe('opening the question', () => {
  it('opens in reach and closes out of it', () => {
    const state = new RunState(readableDay(), undefined, 6);

    const node = state.nodes[0]!;

    state.player.x = node.x;
    state.player.y = node.y;
    updateNodes(state);
    expect(state.openNodeId).toBe(node.id);

    state.player.x = node.x + NODE_REACH + 60;
    updateNodes(state);
    expect(state.openNodeId).toBeNull();
  });

  it('does not open while driving', () => {
    const state = new RunState(readableDay(), undefined, 6);

    const node = state.nodes[0]!;
    state.player.x = node.x;
    state.player.y = node.y;
    state.driving = true;
    updateNodes(state);

    expect(state.openNodeId).toBeNull();
  });
});

describe('the stage', () => {
  it('puts reads on stage six and nowhere else', () => {
    for (const n of [1, 2, 3, 4, 5, 7]) {
      expect(new RunState(readableDay(), undefined, n).nodes).toHaveLength(0);
    }
  });
});

describe('the way out', () => {
  /** Stand on the pad and take one step, which is what arriving looks like. */
  function arrive(state: RunState): void {
    state.player.x = state.city!.exitX;
    state.player.y = state.city!.exitY;
    state.player.vx = 0;
    state.player.vy = 0;
    step(state, 1 / 60, STILL);
  }

  it('stays shut while a read is outstanding', () => {
    const state = new RunState(readableDay(), undefined, 6);
    arrive(state);
    expect(state.phase).toBe('flying');
  });

  it('opens once every panel has been read', () => {
    const state = new RunState(readableDay(), undefined, 6);
    for (const node of state.nodes) {
      state.openNodeId = node.id;
      answerNode(state, node.answer);
    }

    arrive(state);
    expect(state.phase).toBe('extracted');
  });

  it('is never shut on a stage with no reads', () => {
    // The failure that would strand a player: a quiet day, no sourced posts, no
    // nodes, and a gate that counted zero of zero as unfinished.
    const state = new RunState(practiceMission('2026-07-29'), undefined, 6);
    expect(state.nodes).toHaveLength(0);
    arrive(state);
    expect(state.phase).toBe('extracted');
  });
});
