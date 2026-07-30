/**
 * Story nodes: capture ground by reading the timeline correctly.
 *
 * ## The verb
 *
 * Every other stage asks whether you can fly, hit, sneak or drive. This one
 * asks whether you can tell signal from cope, which is the actual skill crypto
 * X demands and the one thing this game is uniquely placed to test, because it
 * already reads the real timeline every morning.
 *
 * A node offers four posts that genuinely went out today, each with a link.
 * One of them is the read: the post the day actually turned on. Pick it and the
 * node flips. Pick wrong and it alarms.
 *
 * ## Why the options are real posts and not written dialogue
 *
 * The obvious version of this stage is conversations with the accounts in the
 * roster, generated from their recent takes. That is putting invented words in
 * real people's mouths, we already shipped a version that did it, and it
 * fabricated statements for accounts that never said them. The rule since is
 * absolute: no claim attributed to a real person without a link to the post it
 * came from.
 *
 * Real posts are also a better puzzle. Four things that were genuinely said,
 * one of which mattered, is a harder and more honest question than four
 * sentences a model wrote to be wrong.
 *
 * ## Which one is right
 *
 * The service already ranks the day's posts when it builds the Dispatch: the
 * model is handed real candidates and returns them in order of how much they
 * explain. The answer is whichever of a node's four sits highest in that
 * ranking, so "correct" is a judgement about real posts rather than a fact
 * invented for a game.
 *
 * The four are drawn from the level stream, so two players on one seed are
 * asked exactly the same questions in the same places.
 */

import type { Rng } from '../core/rng';
import type { DispatchPost } from './mission';
import type { RunState } from './state';

export interface NodeOption {
  post: DispatchPost;
  /** Where it sat in the day's ranking. Lower is a stronger read. */
  rank: number;
}

export interface StoryNode {
  id: number;
  x: number;
  y: number;
  options: NodeOption[];
  /** Index into options. Set once at construction and never recomputed. */
  answer: number;
  captured: boolean;
  /** How many times this one has been read wrong. Shown, so it stings. */
  missed: number;
}

/** Choices per node. Four fits the existing four input slots exactly. */
export const OPTIONS_PER_NODE = 4;

/**
 * Build the nodes for a run.
 *
 * Returns an empty list when the day did not give us enough real posts to make
 * an honest question. A node with invented options would be worse than no node,
 * so a quiet day simply has fewer of them and the stage adjusts.
 */
export function layOutNodes(
  rng: Rng,
  posts: DispatchPost[],
  wanted: number,
  place: () => { x: number; y: number },
  nextId: () => number,
): StoryNode[] {
  /*
   * Every node gets its OWN answer, and its distractors are all ranked below it.
   *
   * The obvious build is to draw four posts at random per node and call the
   * best-ranked one the answer. On a real day that fails badly: the service
   * returns six or so posts, so the day's strongest read lands in most nodes,
   * every node has the same answer, and after the first one the stage is free.
   *
   * So node k answers to the post ranked k, and its three distractors come from
   * the ranks below it. That gives four genuinely different questions, and the
   * rule stays true at every panel: the right answer really is the strongest
   * read of the four in front of you.
   *
   * The cost is that a node needs three posts ranked beneath its answer, so a
   * thin day yields fewer nodes. `wanted` is a ceiling, not a promise.
   */
  const buildable = Math.min(wanted, posts.length - OPTIONS_PER_NODE + 1);
  if (buildable <= 0) return [];

  const nodes: StoryNode[] = [];

  for (let n = 0; n < buildable; n++) {
    /*
     * Shuffle the ranks below the answer rather than picking with retries. A
     * retry loop takes a variable number of draws, which would shift every
     * later draw from the level stream and change the rest of the level for
     * anybody unlucky enough to collide twice.
     */
    const weaker: number[] = [];
    for (let i = n + 1; i < posts.length; i++) weaker.push(i);
    for (let i = weaker.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const a = weaker[i]!;
      const b = weaker[j]!;
      weaker[i] = b;
      weaker[j] = a;
    }

    const ranks = [n, ...weaker.slice(0, OPTIONS_PER_NODE - 1)];

    // Where the answer sits, drawn separately, so it is not learnable as
    // "always the first row".
    const answer = rng.int(0, ranks.length - 1);
    const first = ranks[0]!;
    ranks[0] = ranks[answer]!;
    ranks[answer] = first;

    const options: NodeOption[] = ranks.map((index) => ({
      post: posts[index]!,
      rank: index,
    }));

    const spot = place();
    nodes.push({
      id: nextId(),
      x: spot.x,
      y: spot.y,
      options,
      answer,
      captured: false,
      missed: 0,
    });
  }

  return nodes;
}

/** How close you must be for a node to open its question. */
export const NODE_REACH = 96;

/** The node you are standing at, or null. */
export function nodeInReach(
  nodes: StoryNode[],
  x: number,
  y: number,
): StoryNode | null {
  for (const node of nodes) {
    if (node.captured) continue;
    if (Math.hypot(node.x - x, node.y - y) <= NODE_REACH) return node;
  }
  return null;
}

export type ReadResult = 'captured' | 'wrong' | 'none';

/** Banked per correct read. Worth more than an attacker, because it is harder. */
export const NODE_SCORE = 400;

/**
 * How long a blown read keeps the neighbourhood angry.
 *
 * The cost of reading badly is time and noise, not a hidden score penalty. A
 * penalty you cannot see teaches nothing; six seconds of everyone within a
 * street walking at you teaches immediately, and you still have the clock to
 * recover if you handle it.
 */
export const ALARM_SECONDS = 6;

/**
 * How far a blown read carries.
 *
 * Wider than a patrol's own hearing, because the point is that the mistake
 * reaches people who had not noticed you. Not the whole map, or one wrong
 * answer would end the run outright and players would stop guessing, which is
 * the opposite of what the stage wants.
 */
export const ALARM_RADIUS = 1_100;

/**
 * Answer the open node.
 *
 * Returns what happened so the caller can decide what to say about it. Both
 * outcomes close the question: a wrong read does not let you sit at the panel
 * cycling through the other three while the street fills up.
 */
export function answerNode(state: RunState, choice: number): ReadResult {
  if (state.openNodeId === null) return 'none';

  const node = state.nodes.find((n) => n.id === state.openNodeId);
  if (!node || node.captured) return 'none';
  if (choice < 0 || choice >= node.options.length) return 'none';

  state.openNodeId = null;

  if (choice === node.answer) {
    node.captured = true;
    state.nodesCaptured++;
    state.nodeScore += NODE_SCORE;
    state.emit({ kind: 'read', x: node.x, y: node.y, text: 'Read landed' });
    return 'captured';
  }

  node.missed++;
  state.nodesMissed++;
  state.nodeAlarmUntil = state.time + ALARM_SECONDS;

  /*
   * Wake the neighbourhood.
   *
   * Set both `notice` and `alertUntil`: notice alone would decay before they
   * arrived, and alertUntil alone would let them forget the moment you broke
   * line of sight, which is exactly the escape a wrong answer should not buy.
   */
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    if (Math.hypot(enemy.x - node.x, enemy.y - node.y) > ALARM_RADIUS) continue;
    enemy.active = true;
    enemy.notice = 1;
    enemy.alertUntil = Math.max(enemy.alertUntil, state.time + ALARM_SECONDS);
  }

  state.emit({ kind: 'misread', x: node.x, y: node.y, text: 'Wrong read' });
  return 'wrong';
}

/**
 * Open the nearest node's question, or close the one that is open.
 *
 * Called every step. Walking away closes it, which is the retry: a node you
 * read wrong is still there, and coming back to it after the street calms down
 * is how you get the second attempt.
 */
export function updateNodes(state: RunState): void {
  if (state.nodes.length === 0) return;

  const player = state.player;
  const near = nodeInReach(state.nodes, player.x, player.y);

  // Not while driving. Reading four posts through a windscreen at five hundred
  // units a second is not a decision, and the car already has its own trade.
  state.openNodeId = near && !state.driving ? near.id : null;
}
