/**
 * The campaign: seven stages, each one restoring a piece of what 2026 took.
 *
 * ## What a stage is, honestly
 *
 * A stage is the same engine with different numbers and a different thing you
 * have to achieve. It is not a bespoke level with its own systems, and this
 * file does not pretend otherwise: what changes between Stage 1 and Stage 7 is
 * how many attackers there are, how long you have, how much incoming fire you
 * face, how much of the map you have to cross, and what counts as clearing it.
 *
 * That is a real campaign and it is also a deliberate limit. The escalation is
 * in the parameters and the objectives, not in seven separate games, because
 * seven separate games is not a thing one person ships honestly. Everything in
 * the design that needed new engines rather than new numbers, PvP arenas, boss
 * entities, escort AI and maps that reshape mid-run, is named in the README as
 * unbuilt rather than half-built here.
 *
 * ## The terrain is still the market
 *
 * Every stage flies the same day's chart, because that is the premise of the
 * whole game and a stage that invented its own ground would be a different
 * product. What a stage changes is which stretch of it you fly and what is
 * waiting there. Stage 1 gives you the opening third with room to learn; Stage
 * 7 gives you all of it with everything switched on.
 *
 * ## Objectives are checked against the run, not claimed by it
 *
 * Each stage's `clear` reads a finished RunState and returns whether it was
 * met. That keeps the definition of "cleared" in one place next to the numbers
 * that make it hard, rather than spread across the results screen and the
 * server.
 */

import type { RunState } from '../game/state';

export interface StageProgress {
  /** People still with you at the pad. */
  extracted: number;
  caches: number;
  relic: boolean;
  attackers: number;
  /** True when the run reached extraction rather than ending in the ground. */
  survived: boolean;
  /** Fraction of hull left, 0 to 1. */
  hull: number;
}

/**
 * How a stage looks.
 *
 * Three flat colours and a hatch spacing, which is all the palette allows and
 * more than enough to make seven stages read as seven places. The rule from
 * theme.ts still holds: orange is the chart and the action, crimson is danger,
 * and nothing else is coloured. What changes here is the paper the poster is
 * printed on, not the ink on it.
 */
export interface StageLook {
  /** Sky behind the chart. */
  sky: string;
  /** The ground mass under the price line. */
  ground: string;
  /** Ruled hatching in the ground. Wider means emptier and colder. */
  hatch: number;
}

export interface Stage {
  /** 1 to 7. Also the unlock order: stage n needs n-1 cleared. */
  n: number;
  name: string;
  /** The piece of crypto's face this stage restores. */
  restores: string;
  /** One paragraph of brief. Dry, and about the actual 2026 thing. */
  brief: string;
  /** The single line that tells a player what "cleared" means. */
  objective: string;

  /** Seconds on the clock. */
  seconds: number;
  /** Multiplier on the day's enemy density. */
  density: number;
  /** Fear-and-Greed difficulty is clamped up to at least this. */
  minDifficulty: number;
  /** How many caches the level lays out. */
  caches: number;
  /** Incoming rounds per turret volley, at the start and at the end. */
  volley: [number, number];
  /** Fraction of the chart flown. Stage 1 is a short hop, Stage 7 is all of it. */
  span: number;
  /** Face multiplier for clearing it. Later stages are worth the trouble. */
  bounty: number;
  /**
   * Share of attackers that come at you along the ground rather than through
   * the air. Zero for the first two stages, because the floor is where you
   * learn to fly and a chaser down there while you are still finding the stick
   * is not a lesson, it is a wall.
   */
  runners: number;
  look: StageLook;

  /** Did this finished run clear the stage? */
  clear: (run: StageProgress) => boolean;
}

export const STAGES: readonly Stage[] = [
  {
    n: 1,
    name: 'The Fear Index',
    restores: 'Market panic and pure FUD',
    brief:
      'Sentiment bottomed out and stayed there. Drop into the shallow end of the day\'s chart, clear the doom off it, and get to the Fear and Greed vault at the bottom before the reading falls further.',
    objective: 'Reach extraction and take the relic.',
    seconds: 110,
    density: 0.7,
    minDifficulty: 1,
    caches: 5,
    volley: [1, 1],
    span: 0.45,
    bounty: 1,
    runners: 0,
    look: { sky: '#f4ede0', ground: '#ded2ba', hatch: 26 },
    clear: (r) => r.survived && r.relic,
  },
  {
    n: 2,
    name: 'Ghost Protocols',
    restores: 'Project shutdowns and abandoned promises',
    brief:
      'Wallets, bridges, exchanges and layer twos went dark by the dozen. Most did not post a note. Their contracts are still running and the residue is still in them, right up until somebody stops paying the bill.',
    objective: 'Pull four caches out and get two people to the pad.',
    seconds: 110,
    density: 0.9,
    minDifficulty: 2,
    caches: 7,
    volley: [1, 2],
    span: 0.6,
    bounty: 1.15,
    runners: 0,
    look: { sky: '#efe6d6', ground: '#d3c7ae', hatch: 22 },
    // Reaching the pad is part of every objective. Caches are banked on pickup
    // and survive a crash, so without this a player could dive for four, die,
    // and be told they cleared a stage whose brief says "to the pad".
    clear: (r) => r.survived && r.caches >= 4 && r.extracted >= 2,
  },
  {
    n: 3,
    name: 'Exploit Shadows',
    restores: 'Security failures and lost trust',
    brief:
      'A bridge got drained and the trust went with it. What is left is still bleeding: every second you spend in here is value going out of a hole nobody sealed.',
    objective: 'Clear twelve attackers and finish above half hull.',
    seconds: 105,
    density: 1.25,
    minDifficulty: 3,
    caches: 8,
    volley: [1, 2],
    span: 0.7,
    bounty: 1.3,
    runners: 0.14,
    look: { sky: '#efe4de', ground: '#d2bdb4', hatch: 20 },
    clear: (r) => r.survived && r.attackers >= 12 && r.hull >= 0.5,
  },
  {
    n: 4,
    name: 'Clarity Gauntlet',
    restores: 'Regulatory uncertainty and stalled legislation',
    brief:
      'The rules were nearly written four times. Fly the part of the day where nobody knew what was legal, and come out holding something anyway.',
    objective: 'Take the relic, six caches, and reach the pad.',
    seconds: 100,
    density: 1.4,
    minDifficulty: 3,
    caches: 9,
    volley: [2, 2],
    span: 0.8,
    bounty: 1.5,
    runners: 0.2,
    look: { sky: '#ece7d8', ground: '#c9c2a6', hatch: 18 },
    clear: (r) => r.survived && r.relic && r.caches >= 6,
  },
  {
    n: 5,
    name: 'Tokenization Frontier',
    restores: 'Institutional credibility and real-world utility',
    brief:
      'The institutions came, looked at the wreckage, and did not sign. What they wanted to see was that somebody could get value out of here intact. Show them.',
    objective: 'Get four people out alive.',
    seconds: 100,
    density: 1.55,
    minDifficulty: 4,
    caches: 9,
    volley: [2, 3],
    span: 0.85,
    bounty: 1.7,
    runners: 0.26,
    look: { sky: '#e9e8dc', ground: '#c2c3ac', hatch: 16 },
    clear: (r) => r.survived && r.extracted >= 4,
  },
  {
    n: 6,
    name: 'Narrative War',
    restores: 'Broken storytelling and influencer credibility',
    brief:
      'Everyone who spent the last cycle telling you we were early went quiet. The loudest voices left are the ones with nothing to lose. Take the story back off them.',
    objective: 'All five out, eighteen attackers cleared.',
    seconds: 100,
    density: 1.8,
    minDifficulty: 4,
    caches: 10,
    volley: [2, 3],
    span: 0.92,
    bounty: 2,
    runners: 0.3,
    look: { sky: '#eae2e2', ground: '#c6b4b6', hatch: 14 },
    clear: (r) => r.survived && r.extracted >= 5 && r.attackers >= 18,
  },
  {
    n: 7,
    name: 'The Final Reckoning',
    restores: "The industry's collective dignity",
    brief:
      'Everything the Collapse still holds is in the last stretch of the chart, in the worst place on it, behind everything that has already tried to stop you. Nobody is coming after you. This is the run.',
    objective: 'Everyone out, the relic recovered, and eight caches.',
    seconds: 95,
    density: 2,
    minDifficulty: 5,
    caches: 11,
    volley: [3, 3],
    span: 1,
    bounty: 2.5,
    runners: 0.34,
    look: { sky: '#e6dcd6', ground: '#b9a89f', hatch: 11 },
    clear: (r) => r.survived && r.extracted >= 5 && r.relic && r.caches >= 8,
  },
];

export function stageAt(n: number): Stage {
  return STAGES.find((s) => s.n === n) ?? (STAGES[0] as Stage);
}

/**
 * Which stages a pilot may fly.
 *
 * One ahead of what they have cleared, never more. The arc is the product: a
 * player who can jump to Stage 7 on their first session sees a difficulty
 * spike, not a campaign, and none of the fiction lands because they skipped
 * the six things it is a resolution to.
 */
export function stageUnlocked(n: number, cleared: number): boolean {
  return n <= Math.max(1, Math.min(STAGES.length, cleared + 1));
}

export function nextStage(cleared: number): Stage {
  return stageAt(Math.min(STAGES.length, cleared + 1));
}

export function campaignComplete(cleared: number): boolean {
  return cleared >= STAGES.length;
}

/** Read a finished run into the shape an objective is checked against. */
export function progressOf(run: RunState, maxHealth: number): StageProgress {
  return {
    extracted: run.facesExtracted,
    caches: run.cachesTaken,
    relic: run.relicTaken,
    attackers: run.attackersCleared,
    survived: run.phase === 'extracted',
    hull: Math.max(0, Math.min(1, run.player.health / maxHealth)),
  };
}
