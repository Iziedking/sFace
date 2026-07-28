/**
 * Today's job, inside today's stage.
 *
 * ## The problem this solves
 *
 * Seven stages is an arc, and an arc ends. Once you have cleared Stage 7 the
 * campaign has nothing left to say, and "run it again for a bigger number" is
 * the weakest reason a game can give you to come back. Contracts are the other
 * axis: the stage is the setup, and the contract is what the setup is being
 * used for today.
 *
 * So Stage 3 on Tuesday and Stage 3 on Wednesday are the same terrain shape and
 * a different job. Tomorrow the market has picked a different casualty, crypto
 * X is arguing about different people, and the three things worth doing in
 * there have changed with them.
 *
 * ## Why they are generated, not authored
 *
 * A contract has to name the actual day: this ticker, that percentage, the
 * account that was genuinely loud. Nobody can hand-write that in advance, and a
 * list of generic objectives on rotation is a daily quest system with the
 * serial numbers filed off, which players recognise immediately.
 *
 * So they are drawn from the seed, which already encodes the date, the market
 * and the cast. That gives two things at once: the copy is about real events,
 * and every player on a given day and stage gets the identical three. The
 * second half matters more than it looks. Contracts pay a Face multiplier, so
 * if two people betting NIM on the same seed drew different contracts they
 * would be playing for different money, and the fair bet this whole codebase
 * protects would be gone.
 *
 * ## Difficulty rides the stage
 *
 * The same contract asks for more on Stage 7 than on Stage 1, because the
 * stage already gives you a longer level, more attackers and less clock. A
 * fixed target would be trivial late and impossible early.
 */

import { Rng } from '../core/rng';
import type { StageProgress } from './campaign';

export interface Contract {
  id: string;
  /** One line, naming the real thing it is about. */
  label: string;
  /** Why this is the job today. Grounded in the market or the timeline. */
  because: string;
  /** Added to the run's Face multiplier when met. */
  bonus: number;
  met: (progress: StageProgress) => boolean;
}

/** What a contract needs to know about the day it belongs to. */
export interface ContractContext {
  seed: string;
  ticker: string;
  changePct: number;
  fearGreed: number;
  /** Handles of the people in the wreck, for contracts that name someone. */
  roster: readonly string[];
  /** Live X topics, when there was a read. Empty when there was not. */
  topics: readonly string[];
  /** 1 to 7. Scales every target. */
  stage: number;
}

/** How much a stage stretches a target. Stage 1 asks for the base, Stage 7 for double. */
function scale(stage: number): number {
  return 1 + (Math.max(1, Math.min(7, stage)) - 1) * 0.17;
}

function pct(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

/**
 * Every shape a contract can take.
 *
 * Each one is a different verb, because three contracts that all ask you to
 * kill things is one contract printed three times. Between them they pull on
 * rescue, salvage, combat, survival and speed, so a day's three usually pull in
 * directions that cannot all be satisfied by flying the same line.
 */
type Shape = (c: ContractContext, rng: Rng) => Contract;

const SHAPES: Shape[] = [
  // Someone specific, named off the live roster. The most "today" of the set.
  (c, rng) => {
    const who = c.roster[rng.int(0, Math.max(0, c.roster.length - 1))] ?? null;
    const need = Math.max(2, Math.round(2 * scale(c.stage)));
    return {
      id: 'rescue',
      label: who ? `Get @${who} out, and ${need - 1} more` : `Get ${need} people out`,
      because: who
        ? `@${who} was in the middle of it today.`
        : 'Everyone in there is somebody.',
      bonus: 0.25,
      met: (p) => p.extracted >= need,
    };
  },

  // Salvage. Scales hard, because caches are the skill expression.
  (c) => {
    const need = Math.max(3, Math.round(3 * scale(c.stage)));
    return {
      id: 'salvage',
      label: `Recover ${need} caches`,
      because: `${c.ticker} shed ${pct(c.changePct)}. There is a lot loose down there.`,
      bonus: 0.2,
      met: (p) => p.caches >= need,
    };
  },

  // The day's worst moment, which is where the relic always is.
  (c) => ({
    id: 'relic',
    label: 'Take the relic',
    because: `The bottom of ${c.ticker}'s day is the worst place on the chart.`,
    bonus: 0.3,
    met: (p) => p.relic,
  }),

  // Combat, scaled. The one contract that rewards going looking for trouble.
  (c) => {
    const need = Math.max(8, Math.round(9 * scale(c.stage)));
    return {
      id: 'clear',
      label: `Clear ${need} attackers`,
      because:
        c.fearGreed <= 30
          ? `Fear at ${c.fearGreed}. The sky is crowded.`
          : `Fear at ${c.fearGreed}. Thin out what is up there.`,
      bonus: 0.2,
      met: (p) => p.attackers >= need,
    };
  },

  // Survival. Directly at odds with the salvage and combat contracts, which is
  // the point: three contracts you cannot all have is a decision.
  (c) => {
    const floor = Math.min(0.75, 0.4 + (c.stage - 1) * 0.06);
    return {
      id: 'intact',
      label: `Finish above ${Math.round(floor * 100)}% hull`,
      because: 'Coming back in one piece is the whole job.',
      bonus: 0.25,
      met: (p) => p.survived && p.hull >= floor,
    };
  },

  // A clean sweep. Rare, expensive, and the one people will chase.
  (c) => ({
    id: 'clean',
    label: 'Everyone out, nobody left',
    because:
      c.topics.length > 0
        ? `Crypto X spent today on ${c.topics[0]}. Give it something else.`
        : 'Nobody gets left in the wreck.',
    bonus: 0.4,
    met: (p) => p.survived && p.extracted >= 5,
  }),
];

/**
 * The three contracts for a day and a stage.
 *
 * Seeded on the mission seed plus the stage, so it is stable for everyone
 * everywhere, and different for every stage on the same day. Shapes are drawn
 * without replacement, so a day never asks the same thing twice.
 */
export function contractsFor(context: ContractContext): Contract[] {
  const rng = new Rng(`${context.seed}:s${context.stage}:contracts`);

  const pool = SHAPES.map((shape, index) => ({ shape, index }));
  const picked: Contract[] = [];

  while (picked.length < 3 && pool.length > 0) {
    const at = rng.int(0, pool.length - 1);
    const entry = pool.splice(at, 1)[0];
    if (entry) picked.push(entry.shape(context, rng));
  }

  return picked;
}

/** Total multiplier earned. One is "none of them", which is a normal outcome. */
export function contractBonus(contracts: readonly Contract[], progress: StageProgress): number {
  return contracts.reduce((total, c) => total + (c.met(progress) ? c.bonus : 0), 1);
}

export function metContracts(
  contracts: readonly Contract[],
  progress: StageProgress,
): Contract[] {
  return contracts.filter((c) => c.met(progress));
}
