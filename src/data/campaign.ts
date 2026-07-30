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
  /**
   * Weather over the level.
   *
   * The one thing that changes what a stage FEELS like rather than what colour
   * it is, and it is drawn from the fiction rather than picked to look nice:
   * ash for a market that burned down, static for a compromised bridge, embers
   * for the last stand. Rendered as slow drifting flecks with no gameplay
   * effect whatsoever, because a stage that is harder to see is not a harder
   * stage, it is an unfair one.
   */
  weather: 'clear' | 'dust' | 'ash' | 'static' | 'ember';
  /** How much of it. Zero is none at all. */
  density: number;
  /**
   * Paint on the car you drive. Only read on a city stage.
   *
   * Per stage rather than one constant, because two city stages sharing a
   * vehicle made the second one read as a re-skin of the first: same streets,
   * same car, different wash over the top. The car is the thing on screen the
   * player's eye is actually on, so it is the cheapest place to buy a sense of
   * somewhere else.
   */
  car?: string;
  /**
   * How the buildings are drawn.
   *
   * `slabs` is the original: flat masses, a district of warehouses. `towers`
   * gives them window rows and a marked road surface, which reads as downtown.
   * The geometry is identical either way, so this changes what a stage looks
   * like without changing what it plays like or where anything is.
   */
  city?: 'slabs' | 'towers';
}

/**
 * The one line that makes somebody want to get there.
 *
 * Shown on a LOCKED stage card, where the brief is not. A player looking at
 * Stage 5 from Stage 2 can read what it is going to be like without being told
 * how to clear something they cannot attempt yet, which is the difference
 * between a teaser and a spoiler.
 */
export interface StageTease {
  /** What it looks like when you get there. */
  scene: string;
  /** What is going to be different about flying it. */
  threat: string;
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
  /**
   * Hull refills laid along the route.
   *
   * Was a flat six on every stage, which meant 192 hull whether you faced 18
   * attackers or 48 and made stage one nearly impossible to lose. Scaled with
   * the opposition now: lean early, where flying well should be enough, and
   * generous late, where the sky is genuinely crowded.
   */
  /**
   * Does this stage watch you?
   *
   * Off for one to three, which stay a pure shooting problem and are the right
   * first hour of the game. On from four, where the question becomes whether
   * you can get past a watcher rather than whether you can hit it. See
   * game/sight.ts.
   */
  /**
   * Does a transport crawl this stage, and must it survive?
   *
   * Stage five only. It changes what clearing means: the stage is cleared by
   * the cargo arriving rather than by the player arriving, which takes the
   * pacing away from the player entirely. See game/convoy.ts.
   */
  /**
   * Is this stage a city rather than a chart run?
   *
   * A city is a different world representation entirely: solid boxes with
   * streets between them instead of one ground height per column. See
   * game/city.ts for why a heightmap cannot express a place.
   */
  /**
   * How many projects join you on this stage, and therefore how many gates bar
   * the way. Zero on every stage but the last.
   */
  allies: number;
  /**
   * The ring city. Only the finale, and it is a third world shape.
   *
   * Not the grid of stages five and six: concentric walls around a core, worked
   * inward rather than crossed. See game/rings.ts.
   */
  rings: boolean;
  /**
   * How many story nodes this stage plants. Zero on every stage but six.
   *
   * A node is captured by picking, from four posts that genuinely went out
   * today, the one the day actually turned on. See game/node.ts.
   */
  nodes: number;
  city: boolean;
  convoy: boolean;
  sight: boolean;
  refills: number;
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
  /** Shown while it is still locked. See StageTease. */
  tease: StageTease;

  /** Did this finished run clear the stage? */
  clear: (run: StageProgress) => boolean;
}

export const STAGES: readonly Stage[] = [
  {
    n: 1,
    name: 'Daily Humiliation Ritual',
    restores: 'Nerve, on the worst chart of the day',
    brief:
      "Today's biggest loser is the map. You fly the exact shape of somebody's bad morning, clear the doom off it, and reach the vault at the bottom before the reading drops again. Everyone starts here, every day, on a different disaster.",
    objective: 'Reach extraction and take the relic.',
    seconds: 110,
    density: 0.7,
    minDifficulty: 1,
    caches: 5,
    refills: 3,
    sight: false,
    convoy: false,
    city: false,
    nodes: 0,
    allies: 0,
    rings: false,
    volley: [1, 1],
    span: 0.45,
    bounty: 1,
    runners: 0,
    look: { sky: '#f6f0e4', ground: '#ded2ba', hatch: 26, weather: 'clear', density: 0 },
    tease: {
      scene: 'A pale chart with the panic still settling on it.',
      threat: 'Nothing hurries you. This is where you find out the ship answers.',
    },
    clear: (r) => r.survived && r.relic,
  },
  {
    n: 2,
    name: 'Shutdown Tour',
    restores: 'Everything that went dark without a note',
    brief:
      'Wallets, bridges, exchanges, layer twos. Some posted a thread. Most changed nothing and stopped replying. The contracts are still running and the residue is still in them, right up until somebody stops paying the bill.',
    objective: 'Pull four caches out and get two people to the pad.',
    seconds: 110,
    density: 0.9,
    minDifficulty: 2,
    caches: 7,
    refills: 3,
    sight: false,
    convoy: false,
    city: false,
    nodes: 0,
    allies: 0,
    rings: false,
    volley: [1, 2],
    span: 0.6,
    bounty: 1.15,
    runners: 0,
    look: { sky: '#efe1c4', ground: '#d3c096', hatch: 22, weather: 'dust', density: 0.35 },
    tease: {
      scene: 'Shuttered towers throwing dust over a longer stretch of the day.',
      threat: 'The clock starts to matter, and the sky learns to fire twice.',
    },
    // Reaching the pad is part of every objective. Caches are banked on pickup
    // and survive a crash, so without this a player could dive for four, die,
    // and be told they cleared a stage whose brief says "to the pad".
    clear: (r) => r.survived && r.caches >= 4 && r.extracted >= 2,
  },
  {
    n: 3,
    name: 'Exploit Afterparty',
    restores: 'Trust, after somebody found the hole',
    brief:
      'The bridge got drained at four in the morning and the thread went up at nine. What is left is still bleeding: every second in here is value leaving through a hole nobody has sealed.',
    objective: 'Clear twelve attackers and finish above half hull.',
    seconds: 105,
    density: 1.25,
    minDifficulty: 3,
    caches: 8,
    refills: 4,
    sight: false,
    convoy: false,
    city: false,
    nodes: 0,
    allies: 0,
    rings: false,
    volley: [1, 2],
    span: 0.7,
    bounty: 1.3,
    runners: 0.14,
    look: { sky: '#f0dcd4', ground: '#d6b3a6', hatch: 20, weather: 'static', density: 0.5 },
    tease: {
      scene: 'A drained bridge under a haze of dead signal.',
      threat: 'The floor stops being safe. Things start coming at you along it.',
    },
    clear: (r) => r.survived && r.attackers >= 12 && r.hull >= 0.5,
  },
  {
    n: 4,
    name: 'Clarity Circus',
    restores: 'The rules, such as they are',
    brief:
      'They nearly wrote the rules four times. Fly the part of the day where nobody could tell you what was legal, take the wrong line and get roasted for it, and come out holding something anyway.',
    objective: 'Take the relic, six caches, and reach the pad.',
    seconds: 100,
    density: 1.4,
    minDifficulty: 3,
    caches: 9,
    refills: 4,
    sight: true,
    convoy: false,
    city: false,
    nodes: 0,
    allies: 0,
    rings: false,
    volley: [2, 2],
    span: 0.8,
    bounty: 1.5,
    runners: 0.2,
    look: { sky: '#e7ead3', ground: '#c4cc9e', hatch: 18, weather: 'dust', density: 0.6 },
    tease: {
      scene: 'A washed-out maze of half-written rules.',
      threat: 'Two rounds a volley from the first second, and a longer way home.',
    },
    clear: (r) => r.survived && r.relic && r.caches >= 6,
  },
  {
    n: 5,
    name: 'Institutional Face Escort',
    restores: 'The case that any of this is real',
    brief:
      'They came, they looked at the wreckage, and they did not sign. What they wanted was proof that somebody could get value out of here intact. Nobody has shown them yet.',
    objective: 'Get four people out alive.',
    seconds: 100,
    density: 1.55,
    minDifficulty: 4,
    caches: 9,
    refills: 5,
    sight: true,
    convoy: false,
    city: true,
    nodes: 0,
    allies: 0,
    rings: false,
    volley: [2, 3],
    span: 0.85,
    bounty: 1.7,
    runners: 0.26,
    look: {
      sky: '#dee7e2',
      ground: '#b4c4bc',
      hatch: 16,
      weather: 'ash',
      density: 0.55,
      car: '#c4552c',
      city: 'slabs',
    },
    tease: {
      scene: 'Ash over a wide contested floor, with people watching who do not post.',
      threat: 'Everyone comes out or nobody does. Losing one is losing the stage.',
    },
    clear: (r) => r.survived && r.extracted >= 4,
  },
  {
    n: 6,
    name: 'Narrative Thunderdome',
    restores: 'The story, off whoever is shouting loudest',
    brief:
      'Everyone who spent last cycle saying we were early has gone quiet. What is left is the accounts with nothing to lose, and they are setting the terms. The panels in this district are still arguing about why today happened, and each one is showing four posts that genuinely went out. One of them is right. Pick it and the panel flips. Pick wrong and everyone within a street starts walking toward the noise.',
    objective: 'Read every panel, then get out.',
    seconds: 100,
    density: 1.8,
    minDifficulty: 4,
    caches: 10,
    refills: 5,
    sight: true,
    convoy: false,
    city: true,
    nodes: 4,
    allies: 0,
    rings: false,
    volley: [2, 3],
    span: 0.92,
    bounty: 2,
    runners: 0.3,
    look: {
      sky: '#e0dae8',
      ground: '#bcb2c8',
      hatch: 14,
      weather: 'static',
      density: 0.8,
      // Deep teal against stage five's rust. Reads as a different vehicle at a
      // glance without leaving the ink-on-paper register the rest of the game
      // sits in.
      car: '#2f6b70',
      city: 'towers',
    },
    tease: {
      scene: 'A district arguing with itself, four panels deep, and nobody agreeing.',
      threat: 'The way out stays shut until you have read every one of them right.',
    },
    /*
     * No node count in here, and that is deliberate.
     *
     * Reaching the pad on this stage already requires every panel read, because
     * the exit will not open otherwise. Restating it as a clear condition would
     * be a second copy of one rule that could drift from the first, and on a day
     * too quiet for four sourced posts it would make the stage impossible while
     * the exit stood open.
     */
    clear: (r) => r.survived && r.extracted >= 3,
  },
  {
    n: 7,
    name: 'Save Face',
    restores: 'The season itself',
    brief:
      'This is the one everything else was for. The road out is sealed into regions and no weapon opens a gate. Each gate asks a question about the projects that were here before this cycle and will be here after it. Go and find them. Learn where each one sits and how it is holding up while today falls apart. Then answer, and walk out.',
    objective: 'Learn every project, answer every gate.',
    // The longest run in the game, by a distance. Five rings have to be circled
    // and read, and a clock that fits stage six would make it a sprint past the
    // thing the stage is about.
    seconds: 180,
    /*
     * A fraction of what the stage used to field.
     *
     * The finale is decided by working out what is going on, not by clearing a
     * room. Attackers are still here because a completely empty world has no
     * pressure in it at all, but there are few enough that they are something
     * pulling at your attention rather than something you have to solve. It is
     * possible to reach the core without firing.
     */
    density: 0.35,
    minDifficulty: 5,
    caches: 11,
    refills: 6,
    sight: true,
    convoy: false,
    city: false,
    nodes: 0,
    allies: 5,
    rings: true,
    volley: [3, 3],
    span: 1,
    bounty: 2.5,
    runners: 0.34,
    look: { sky: '#e9cdba', ground: '#b8917a', hatch: 11, weather: 'ember', density: 1 },
    tease: {
      scene: 'The whole day, end to end, with the ones that outlasted it waiting in it.',
      threat: 'Gates that ask instead of shoot. Fly past a project and you cannot answer.',
    },
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
