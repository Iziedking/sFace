/**
 * The run, as plain data.
 *
 * Nothing in this file knows that a screen exists. The renderer reads this and
 * draws it, and it never writes back. Keeping that line clean is what lets the
 * same state be produced by a live player or replayed from a recorded input
 * trace without the two paths diverging.
 *
 * Two separate random streams, and the distinction is load bearing:
 *
 *   levelRng  Consumed once, at construction, to lay out the whole level. Two
 *             players on the same seed get identical enemies and faces in
 *             identical places no matter how they play.
 *   runRng    Everything cosmetic or reactive during play. It is allowed to
 *             diverge between players because it never changes the level.
 *
 * If enemy fire timing drew from levelRng, one player killing an enemy early
 * would shift every later draw and the two levels would quietly stop matching.
 * That bug is invisible until a challenge settles wrong, so keep them apart.
 */

import { Rng } from '../core/rng';
import type { FaceQuirk } from '../data/faces';
import { DEFAULT_WEAPON, weaponById, type Weapon, type WeaponId } from '../data/weapons';
import { stageAt, type Stage } from '../data/campaign';
import { layOutCaches, type Cache } from './cache';
import { openPurse, rollDrop, type ScripPurse } from './scrip';
import { lockUp } from './cell';
import { makeConvoy, type Convoy } from './convoy';
import { buildCity, openSpot, roomSpot, type City } from './city';
import { buildRingCity, spotOutside, type RingCity } from './rings';
import { makeCar, type Car } from './car';
import { layOutNodes, type StoryNode } from './node';
import { BASELINE_ASSIST, type AssistLevel } from './assist';
import { layOutAllies, layOutGates, type Ally, type Gate } from './ally';
import { layOutRefills, REFILL_REACH, type Refill } from './refill';
import { fallbackRoster, type DailyMission, type RosterEntry } from './mission';
import { Terrain, EXTRACTION_X, WORLD_HEIGHT, CEILING } from './terrain';

/**
 * Length of a run.
 *
 * Raised from ninety. The level is over eleven thousand units long, and at
 * ninety seconds a player who stopped to fight, took a cache and got someone
 * out simply ran out of clock before extraction. Reaching the end is the part
 * of a run worth having, so the budget now allows for a detour rather than
 * punishing one.
 */
export const RUN_SECONDS = 110;
export const PLAYER_MAX_HEALTH = 100;

/** Score awarded the moment a face is freed, before it is safely out. */
export const RESCUE_FRACTION = 0.25;
export const ATTACKER_SCORE = 50;
export const TIME_BONUS_PER_SECOND = 20;

export type EnemyKind = 'drifter' | 'diver' | 'turret' | 'runner';
export type FaceState = 'trapped' | 'following' | 'extracted' | 'lost';
export type RunPhase = 'flying' | 'extracted' | 'died' | 'timeout';

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  /** Aim direction, always normalised. Starts facing forward. */
  aimX: number;
  aimY: number;
  fireCooldown: number;
  /** Run time of the last shot. The skittish face watches this. */
  lastFiredAt: number;
  /** Run time until which damage is ignored, so one hit is not three. */
  invulnerableUntil: number;
  facing: 1 | -1;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  fireCooldown: number;
  alive: boolean;
  /** Awake only once the player is near, so the level does not run ahead. */
  active: boolean;
  /** Anchor for drifters, which bob around where they were placed. */
  homeY: number;
  phase: number;
  /**
   * How close this one is to noticing you, 0 to 1. City stages only.
   *
   * Per attacker rather than global, because in a city the whole point is that
   * the one round the corner has not seen you while the one in front has.
   */
  notice: number;
  /** Run clock until which it keeps coming after losing sight of you. */
  alertUntil: number;
  /** Which way it is walking its patch when it has not noticed anything. */
  patrolHeading: number;
  /**
   * Scrip paid out when this one is cleared.
   *
   * Drawn at layout rather than rolled on death. A roll at death time is
   * consumed in whatever order the player happens to kill things, so two
   * players on one seed would finish with different money, which is exactly
   * the divergence the two-stream rule exists to prevent.
   */
  drop: number;
  /**
   * This one is in a car. City stages only.
   *
   * A flag on the ordinary attacker rather than a separate entity, and that is
   * the whole reason it is cheap: patrol behaviour, damage, drops, scoring, the
   * minimap and the alarm all work on it already. What changes is how fast it
   * covers ground, how far it can sense from, how big it is to shoot, and how it
   * is drawn.
   *
   * Deliberately NOT a vehicle you can steal. A second drivable car would need
   * its own entry prompt, its own seat state and its own answer to what happens
   * to the driver, for a mechanic the stage does not need.
   */
  driving: boolean;

  /**
   * When this one can be hit by the car again.
   *
   * A drive-through is contact for several frames, and without a cooldown every
   * one of those frames was a separate hit. That made a ram an instant kill no
   * matter how it was tuned, which is the opposite of reading as being run over:
   * nothing staggers, nothing gets back up, the attacker is simply gone.
   *
   * One pass, one hit. Coming back around for the second is the point.
   */
  rammedUntil: number;
}

export interface Face {
  id: number;
  defIndex: number;
  quirk: FaceQuirk;
  name: string;
  /** X handle without the @, or the archetype id on a fallback roster. */
  handle: string;
  /** Only ever set when a real picture was explicitly configured. */
  avatarUrl: string | null;
  line: string;
  bounty: number;
  x: number;
  y: number;
  state: FaceState;
  /**
   * Locked up. Touching does nothing until a breaching charge takes the door
   * off. A flag rather than its own entity, so a cell cannot desynchronise
   * from the person inside it. See cell.ts.
   */
  caged: boolean;
  /** Position in the follow chain, set when freed. */
  slot: number;
  /** Talker: run time until which it has stopped to finish a sentence. */
  pausedUntil: number;
  /** Talker: run time of its next interruption. Scheduled, not modulo-tested. */
  nextTalkAt: number;
  /** Mercenary: world x past which he lets himself out. */
  selfExtractX: number;
  /** Run time it was freed, used for the pickup line timing. */
  freedAt: number;
  /**
   * Seconds until this follower can take another shot.
   *
   * Freed people shoot back. See game/face.ts for why that is a rescue
   * mechanic rather than a combat one.
   */
  fireCooldown: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds remaining before it expires. */
  life: number;
  damage: number;
  friendly: boolean;
  /**
   * Enemies this round may pass through before it stops. Absent means none,
   * which is every enemy round and most of the player's, so it stays optional
   * rather than forcing a zero into every spawn site that will never use it.
   */
  pierce?: number;
  /**
   * Enemy ids this round has already damaged. Only ever allocated for a round
   * that can pierce, which is a couple a second at most.
   *
   * Without it a piercing round hits whatever it is overlapping again on the
   * next step, because a step is a snapshot and the round has not cleared the
   * hit box yet. That reads as a single shot doing double damage, which turned
   * the lance into a straight upgrade rather than a trade.
   */
  pierced?: number[];
}

export interface RunEvent {
  kind:
    | 'freed'
    | 'extracted'
    | 'lost'
    | 'hit'
    | 'kill'
    | 'pickupLine'
    | 'cache'
    | 'relic'
    | 'refill'
    | 'read'
    | 'misread';
  text?: string;
  x: number;
  y: number;
}

export class RunState {
  readonly mission: DailyMission;
  readonly terrain: Terrain;
  readonly runRng: Rng;

  /**
   * The gun this run is being flown with.
   *
   * Deliberately not part of the level. Nothing laid out below reads it, so
   * two pilots on the same seed still get identical terrain, identical enemies
   * in identical places and identical caches no matter what either of them
   * brought. See data/weapons.ts for why that line has to hold.
   */
  readonly weapon: Weapon;

  /**
   * The stage being flown, and the two numbers it decides that everything else
   * reads: how long the clock is, and where the pad is.
   *
   * Both used to be module constants. They are per-run now because that is
   * what makes seven stages seven stages rather than one level with a label on
   * it, and because a constant cannot be part of a seed.
   */
  readonly stage: Stage;
  readonly seconds: number;
  readonly extractionX: number;

  readonly player: Player;
  readonly enemies: Enemy[];
  readonly faces: Face[];
  readonly caches: Cache[];
  readonly refills: Refill[];
  readonly bullets: Bullet[] = [];

  /** Drained by the renderer each frame to spawn effects and floating text. */
  readonly events: RunEvent[] = [];

  /** Recent player positions, so freed faces trail behind in a chain. */
  readonly trail: Array<{ x: number; y: number }> = [];

  time = 0;
  phase: RunPhase = 'flying';

  attackersCleared = 0;
  facesFreed = 0;
  facesExtracted = 0;
  rescueScore = 0;
  extractionScore = 0;

  /**
   * Face recovered from caches.
   *
   * Banked on pickup and never lost, unlike the extraction half of a rescue.
   * A cache is already out of the ground once you touch it, and taking it back
   * for dying would make the risk of a deep dive read as a punishment rather
   * than a gamble.
   */
  cacheScore = 0;
  cachesTaken = 0;
  /**
   * The day's token, scavenged and spent inside this run only.
   *
   * Never persisted, never posted, never read from the profile. See scrip.ts
   * for why it must never be purchasable.
   */
  readonly purse: ScripPurse;
  cacheScrip = 0;
  /** Run clock at which overdrive expires. Past time means it is not running. */
  overdriveUntil = -1;
  /** Cells opened this run. Scored, because breaking in is work. */
  cellsOpened = 0;
  /**
   * How close the level is to noticing you, 0 to 1. See game/sight.ts.
   *
   * Only ever moves on a stage with sight on, so stages one to three carry it
   * at zero for their whole run and nothing reads it.
   */
  alert = 0;
  /** True on the frame a watcher currently has the player. Drives the HUD. */
  watched = false;
  /** Run clock until which the level stays angry. Past means calm. */
  alertedUntil = -1;
  /** How many times the alert filled. Shown on the results screen. */
  alertsRaised = 0;
  /**
   * The transport, on a stage that has one. Null everywhere else.
   *
   * Nullable rather than always present with a disabled flag, so every reader
   * has to acknowledge that most stages do not have one and none of them can
   * accidentally read a dormant convoy's health as meaningful.
   */
  /**
   * The city, on a stage that is one. Null on every chart run.
   *
   * When this is set the world is boxes and streets rather than a height per
   * column, and the parts of the game that assume a ground line branch on it.
   */
  readonly city: City | null;
  /**
   * The ring city, on the finale. Null everywhere else.
   *
   * A third world shape beside the heightmap and the block grid, so everything
   * that asks "what am I standing in" has three answers rather than two.
   */
  readonly rings: RingCity | null;
  /** The car, in a city. Null on a chart run, which has the transport instead. */
  readonly car: Car | null;
  readonly convoy: Convoy | null;
  /**
   * True while the player is at the wheel rather than flying.
   *
   * A mode flag on the run rather than on the player, because almost everything
   * that reads it cares about the run being in a different shape: the physics,
   * the camera, the HUD and the transport all branch on it.
   */
  driving = false;
  /** Run clock before which the seat is refused, so getting out is possible. */
  remountAt = -1;
  /** Raised by the input layer for one step when the use key was pressed. */
  useRequested = false;

  /**
   * How much help the gun gets pointing, 0 to 3. See game/assist.ts.
   *
   * Mutable and set by the app after construction rather than passed in, because
   * it belongs to the PLAYER rather than to the level: it must not touch either
   * random stream, and the service rebuilds a run to bound a score without
   * knowing or caring who is flying it. A staked challenge pins it to the
   * baseline so a bet is not settled on who has played longer.
   */
  assist: AssistLevel = BASELINE_ASSIST;

  /**
   * The day's reads, on a stage that has them. Empty everywhere else.
   *
   * Also empty on a stage that wants them but on a day the service could not
   * give us four sourced posts, because a question built from anything less
   * would have to invent an option. See game/node.ts.
   */
  readonly nodes: StoryNode[];
  /**
   * The projects that join you on the last stage, and the seals they open.
   *
   * Empty everywhere else. See game/ally.ts for why the final stage is a march
   * through sealed regions rather than another lap of the chart.
   */
  readonly allies: Ally[];
  readonly gates: Gate[];
  /** Id of the gate whose question is up, or null. Set by proximity. */
  openGateId: number | null = null;
  /** Gates solved. The stage's actual objective. */
  gatesOpened = 0;
  /** Gates answered wrong. Shown on the results screen, because it is the skill. */
  gatesMissed = 0;
  /** Id of the node whose question is up, or null. Set by proximity. */
  openNodeId: number | null = null;
  /** Reads landed. The stage's actual objective. */
  nodesCaptured = 0;
  /** Reads blown. Shown on the results screen, because it is the skill. */
  nodesMissed = 0;
  /** Run clock until which a blown read is still pulling attackers in. */
  nodeAlarmUntil = -1;
  /** Score from captured nodes, banked as they land rather than at the end. */
  nodeScore = 0;
  /** Nothing about this run will be saved. */
  readonly practice: boolean;
  /** A clipped look at a stage this player has not signed in to fly properly. */
  readonly taster: boolean;
  /** True when this run is a look at the game from outside Nimiq Pay. */
  readonly preview: boolean;
  refillsTaken = 0;
  /** Whether the day's single relic was recovered. Tracked for the profile. */
  relicTaken = false;

  /**
   * Multiplier from today's contracts, set once when the run ends.
   *
   * One means none were met, which is a normal outcome rather than a penalty.
   * It is applied last, after the market bounty and the stage bounty, because
   * it is the only one of the three the player had any say over.
   */
  contractBonus = 1;

  private nextId = 1;

  /**
   * How long a taster lasts on a stage a practice player has not unlocked.
   *
   * Long enough to meet the stage properly: see its weather, its density, and
   * on a caged stage to find a cell and understand that it needs a charge.
   * Short enough that finishing it is not on the table.
   */
  static readonly TASTER_SECONDS = 45;

  /**
   * How long a run lasts outside Nimiq Pay.
   *
   * Enough to fly into the day's chart, meet its weather and see who is trapped
   * in it. Not enough to extract anybody, which is deliberate: the point is to
   * make somebody want the real run, not to hand them a worse copy of it.
   */
  static readonly PREVIEW_SECONDS = 25;

  constructor(
    mission: DailyMission,
    weapon: WeaponId = DEFAULT_WEAPON,
    stageNumber = 1,
    /**
     * A run that will never be saved.
     *
     * Stage one is the whole game, unlimited and replayable forever: it is the
     * argument for signing in and it would be a poor argument if it were
     * clipped. Every later stage is a taster on a clock, because seeing the
     * cells and the ash and then running out of time is a far better reason to
     * sign in than being told about them.
     */
    practice = false,
    /**
     * Running outside Nimiq Pay.
     *
     * sFace is a Mini App, and the full game is the one in the wallet: rank that
     * compounds, a clan, a challenge you can actually settle, a place on the
     * board. A browser tab can show what the game IS, and it should, because
     * that is how somebody decides to open it properly. What it cannot do is be
     * the whole thing, or the wallet becomes a payment step people route around
     * rather than the place the game lives.
     *
     * So out here every stage is a look: long enough to see the day's chart, the
     * cast and the weather, and short enough that finishing is not on the table.
     */
    preview = false,
  ) {
    this.mission = mission;
    this.terrain = new Terrain(mission.terrain);
    this.weapon = weaponById(weapon);

    const stage = stageAt(stageNumber);
    this.stage = stage;
    this.practice = practice;
    // Only later stages are clipped. Stage one practice is the full run.
    /*
     * Stage one is never clipped, for anybody.
     *
     * It is the argument for signing in, and a clipped argument is a weak one.
     * The front door has always promised the full first stage as many times as
     * you like, and a preview that cut it made the app contradict its own
     * headline: somebody arriving cold was shown a handoff screen before they
     * had finished a single run.
     *
     * So the short look applies from stage two, where the point is to SEE what
     * is up there rather than to finish it.
     */
    this.preview = preview && stage.n > 1;
    this.taster = this.preview || (practice && stage.n > 1);
    this.seconds = this.preview
      ? Math.min(stage.seconds, RunState.PREVIEW_SECONDS)
      : this.taster
      ? Math.min(stage.seconds, RunState.TASTER_SECONDS)
      : stage.seconds;
    // Never shorter than a level worth flying, whatever a stage asks for.
    this.extractionX = Math.max(3_000, Math.round(EXTRACTION_X * stage.span));

    /*
     * The stage is part of the seed.
     *
     * Two players comparing Stage 3 scores have to have flown the same Stage 3,
     * and the same day's Stage 1 and Stage 3 must not be the same level with a
     * different clock. Folding the number into both streams is what guarantees
     * both, and it costs one string concatenation.
     */
    const seed = `${mission.seed}:s${stage.n}`;
    this.runRng = new Rng(`${seed}:run`);

    // Denominated in the day's own ticker. Practice missions have one too, so
    // a practice run shows the real game rather than a stripped version of it.
    this.purse = openPurse(mission.ticker);

    const levelRng = new Rng(seed);
    // Fear and Greed still sets the day's difficulty; the stage raises the
    // floor so a calm market cannot make the last stage a walk.
    const difficulty = Math.max(mission.difficulty, stage.minDifficulty);

    this.enemies = layOutEnemies(
      levelRng,
      this.terrain,
      difficulty,
      () => this.nextId++,
      this.extractionX,
      stage.density,
      stage.runners,
    );
    this.faces = layOutFaces(
      levelRng,
      this.terrain,
      mission.roster,
      () => this.nextId++,
      this.extractionX,
    );
    // Lock some of them up. Drawn from the level stream immediately after the
    // faces are placed, so the draw order is fixed and two players get the
    // same people behind the same doors.
    lockUp(levelRng, this.faces, stage.n);

    this.caches = layOutCaches(
      levelRng,
      this.terrain,
      difficulty,
      () => this.nextId++,
      this.extractionX,
      stage.caches,
    );
    /*
     * Built from the same chart the terrain is, off the same level stream, so a
     * city and a chart run made from one seed are two projections of one day.
     */
    this.city = stage.city ? buildCity(levelRng, mission.terrain) : null;
    /*
     * Built before anything is placed, because on the finale everything is
     * placed relative to a ring rather than to a ground line.
     */
    /*
     * One wall per GATE, not per project.
     *
     * The first project is met in the open field before any wall, because a gate
     * asking about one project is not a question. Building a ring per project
     * left the outermost wall with no gate attached to it, which made the stage
     * unwinnable: nothing could ever unlock it.
     */
    this.rings = stage.rings ? buildRingCity(levelRng, Math.max(1, stage.allies - 1)) : null;
    // Parked a little way from the start, so the first decision of the run is
    // whether to walk to it at all rather than being handed it for free.
    this.car = this.city ? makeCar(this.city.startX + 260, this.city.startY - 120) : null;
    this.convoy = stage.convoy ? makeConvoy(this.terrain) : null;

    /*
     * The last stage, laid out before the relocation pass so nothing else
     * shifts. Allies sit above the chart and the seals stand across it.
     */
    this.allies =
      stage.allies > 0
        ? layOutAllies(
            levelRng,
            mission.survivors,
            stage.allies,
            this.extractionX,
            (x) => this.terrain.groundAt(x),
            () => this.nextId++,
          )
        : [];
    this.gates =
      this.allies.length > 0
        ? layOutGates(levelRng, this.allies, this.extractionX, () => this.nextId++)
        : [];

    /*
     * On the ring city, everything sits on the approach to the wall it belongs
     * to, outside it, so what you need for a gate is always on the side you are
     * standing on. Ring 0 is innermost, so the list is walked backwards: the
     * first project you meet guards the outermost wall.
     */
    if (this.rings) {
      const rings = this.rings;
      /*
       * Outermost first, one per band, working in.
       *
       * The last one lands inside the innermost wall, in the band around the
       * core, so the final thing you learn is the one standing next to what you
       * came for.
       */
      this.allies.forEach((ally, index) => {
        const spot = spotOutside(rings, levelRng, rings.rings.length - 1 - index);
        ally.x = spot.x;
        ally.y = spot.y;
      });

      for (const enemy of this.enemies) {
        const spot = spotOutside(rings, levelRng, levelRng.int(0, rings.rings.length - 1));
        enemy.x = spot.x;
        enemy.y = spot.y;
        enemy.homeY = enemy.y;
      }
      for (const face of this.faces) {
        const spot = spotOutside(rings, levelRng, levelRng.int(0, rings.rings.length - 1));
        face.x = spot.x;
        face.y = spot.y;
      }
    }

    this.refills = layOutRefills(
      levelRng,
      this.terrain,
      () => this.nextId++,
      this.extractionX,
      stage.refills,
    );

    /*
     * Relocate everything into the streets.
     *
     * The layout functions place things against a ground line, which in a city
     * means inside a building or floating above one. Rather than write a second
     * placement path for every entity, the level is laid out as normal and then
     * moved: the counts, the tiers, the quirks and the drops are all decided by
     * the same code, so a city and a chart run made from one seed still contain
     * exactly the same things. Only where they stand changes.
     *
     * Drawn from the level stream after every other placement, so adding this
     * cannot shift any draw that came before it.
     */
    if (this.city) {
      const city = this.city;
      const place = (item: { x: number; y: number }, clearance: number): void => {
        const spot = openSpot(city, levelRng, clearance);
        item.x = spot.x;
        item.y = spot.y;
      };

      for (const enemy of this.enemies) {
        place(enemy, 46);
        enemy.homeY = enemy.y;
      }
      for (const face of this.faces) place(face, 42);
      for (const cache of this.caches) place(cache, 40);

      /*
       * Some of them get cars.
       *
       * Only on the stage that has the towers look, so the two city stages read
       * as two places rather than one map twice: stage five is people on foot in
       * a warehouse district, stage six is a downtown with traffic in it that is
       * looking for you.
       *
       * A share rather than a count, so a dense day fields more of them and a
       * calm day fewer, which is the same rule the rest of the level follows.
       */
      if (stage.look.city === 'towers') {
        for (const enemy of this.enemies) {
          // Turrets are rooted by definition. Putting one in a car would make it
          // the only thing in the game that is both immobile and a vehicle.
          if (enemy.kind === 'turret') continue;
          if (levelRng.chance(0.3)) enemy.driving = true;
        }
      }

      /*
       * Hull refills go INSIDE the buildings that have a way in.
       *
       * These used to be built after this block ran, so they were the one thing
       * in the level that never got relocated: they kept the positions the chart
       * layout gave them, against a ground line the city does not have, and
       * ended up sealed inside walls. Reported from a playtest as health you can
       * see and cannot reach, which is exactly what it was.
       *
       * Fixing the order alone would have scattered them along the streets like
       * everything else. Putting them indoors instead makes the interiors worth
       * the detour, and since the doorway is too narrow for the car, topping up
       * your hull is something you can only do on foot. One placement decision
       * pays for the rooms, gives the walking route an advantage the driving
       * route cannot have, and turns the medkit into a reason to explore.
       *
       * Street fallback for the days that produce no interiors at all.
       */
      this.refills.forEach((refill, index) => {
        const indoors = roomSpot(city, levelRng, index, REFILL_REACH + 8);
        if (indoors) {
          refill.x = indoors.x;
          refill.y = indoors.y;
        } else {
          place(refill, 34);
        }
      });
    }

    /*
     * The reads, last of all, so a stage that has none draws nothing and every
     * placement above it lands identically on stage five and stage six.
     */
    this.nodes =
      this.city && stage.nodes > 0
        ? layOutNodes(
            levelRng,
            mission.story?.posts ?? [],
            stage.nodes,
            () => openSpot(this.city!, levelRng, 70),
            () => this.nextId++,
          )
        : [];

    this.player = {
      x: 120,
      y: this.terrain.clearAbove(120, 220),
      vx: 0,
      vy: 0,
      health: PLAYER_MAX_HEALTH,
      aimX: 1,
      aimY: 0,
      fireCooldown: 0,
      lastFiredAt: -10,
      invulnerableUntil: 0,
      facing: 1,
    };
  }

  get timeLeft(): number {
    return Math.max(0, this.seconds - this.time);
  }

  get carrying(): number {
    return this.faces.filter((f) => f.state === 'following').length;
  }

  get finished(): boolean {
    return this.phase !== 'flying';
  }

  /**
   * Total score. Rescue credit lands the moment a face is freed so progress
   * always registers, and the rest lands on extraction so the run still has
   * teeth. Dying loses everything you are still carrying.
   */
  get score(): number {
    const timeBonus =
      this.phase === 'extracted' ? Math.floor(this.timeLeft * TIME_BONUS_PER_SECOND) : 0;
    const raw =
      this.rescueScore +
      this.extractionScore +
      this.cacheScore +
      this.nodeScore +
      this.attackersCleared * ATTACKER_SCORE +
      timeBonus;
    return Math.floor(raw * this.mission.bountyMultiplier * this.stage.bounty * this.contractBonus);
  }

  emit(event: RunEvent): void {
    this.events.push(event);
  }

  takeId(): number {
    return this.nextId++;
  }
}

/**
 * Enemy placement. Density follows the chart's own volatility, so the choppy
 * hours of the real day are the dangerous stretches of the level, and the
 * difficulty from the Fear and Greed index scales the whole thing.
 */
function layOutEnemies(
  rng: Rng,
  terrain: Terrain,
  difficulty: number,
  nextId: () => number,
  extractionX: number,
  /** The stage's own multiplier on top of the day's difficulty. */
  density: number,
  /** Share of attackers that come at you along the ground. Zero early on. */
  runners: number,
): Enemy[] {
  const enemies: Enemy[] = [];
  // Difficulty 1 is a quiet day, 5 is extreme fear and a crowded sky.
  const densityScale = (0.45 + difficulty * 0.22) * density;
  const step = 210;

  for (let x = 640; x < extractionX - 200; x += step) {
    const local = terrain.volatilityAt(x);
    // Even a calm stretch gets something, or the level has dead air in it.
    const chance = Math.min(0.95, (0.25 + local * 0.75) * densityScale);
    if (!rng.chance(chance)) continue;

    const kind = pickKind(rng, local, difficulty, runners);
    const y =
      kind === 'turret'
        ? terrain.groundAt(x) - 26
        : kind === 'runner'
          ? terrain.groundAt(x) - 22
          : clamp(terrain.clearAbove(x, rng.range(120, 340)), CEILING + 30, WORLD_HEIGHT - 90);

    enemies.push({
      id: nextId(),
      kind,
      x: x + rng.range(-60, 60),
      y,
      vx: 0,
      vy: 0,
      health: kind === 'turret' ? 40 : kind === 'diver' ? 18 : kind === 'runner' ? 26 : 28,
      fireCooldown: rng.range(0.4, 2.2),
      alive: true,
      active: false,
      homeY: y,
      phase: rng.range(0, Math.PI * 2),
      drop: rollDrop(rng, difficulty),
      notice: 0,
      alertUntil: -1,
      // A quarter turn each, so a street has patrols crossing it rather than a
      // column all walking the same way.
      patrolHeading: rng.int(0, 3) * (Math.PI / 2),
      // Set below, once the city is known. Rolled here anyway so the draw count
      // per attacker does not depend on which stage is being built.
      driving: false,
      rammedUntil: -1,
    });
  }

  return enemies;
}

/**
 * Volatile stretches favour divers, calm ones favour turrets on the ground.
 *
 * Runners are drawn first and from a share the stage sets, so the early
 * campaign has none at all and the late campaign has the floor covered. Drawing
 * them first rather than last keeps the other three in their existing
 * proportions to each other.
 */
function pickKind(
  rng: Rng,
  volatility: number,
  difficulty: number,
  runners: number,
): EnemyKind {
  if (runners > 0 && rng.chance(runners)) return 'runner';

  const roll = rng.next();
  const diverBias = volatility * 0.45 + difficulty * 0.04;
  if (roll < diverBias) return 'diver';
  if (roll < diverBias + 0.3) return 'turret';
  return 'drifter';
}

/**
 * Faces are spread across the level rather than placed randomly, so every run
 * has a rhythm: fly, fight, rescue, repeat. Five of them, one of each type,
 * because rescuing five different quirks is more interesting than rescuing the
 * same one five times.
 */
function layOutFaces(
  rng: Rng,
  terrain: Terrain,
  roster: readonly RosterEntry[],
  nextId: () => number,
  extractionX: number,
): Face[] {
  const faces: Face[] = [];
  // The roster is whoever crypto X was actually talking about today, topped up
  // from the archetypes so the headcount never changes. That matters: two
  // players on the same seed must get the same number of people in the same
  // places, or the challenge stops being a fair bet.
  const cast = roster.length > 0 ? roster : fallbackRoster();
  const count = cast.length;
  const usable = Math.max(1_200, extractionX - 900);
  const band = usable / count;

  // Shuffle who lands in which band, deterministically.
  const order = cast.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = order[i] ?? i;
    const b = order[j] ?? j;
    order[i] = b;
    order[j] = a;
  }

  for (let i = 0; i < count; i++) {
    const defIndex = order[i] ?? i;
    const def = cast[defIndex] ?? cast[0]!;
    const x = 700 + band * i + rng.range(band * 0.2, band * 0.7);
    const y = terrain.groundAt(x) - rng.range(40, 130);

    faces.push({
      id: nextId(),
      defIndex,
      quirk: def.quirk,
      name: def.displayName,
      handle: def.handle,
      avatarUrl: def.avatarUrl,
      line: def.line,
      bounty: def.bounty,
      x,
      y: Math.max(CEILING + 40, y),
      state: 'trapped',
      // Set by lockUp() right after the whole roster is placed, so the draw
      // does not interleave with face placement.
      caged: false,
      slot: -1,
      pausedUntil: 0,
      nextTalkAt: 0,
      selfExtractX: x + (extractionX - x) * rng.range(0.4, 0.65),
      freedAt: 0,
      fireCooldown: 0,
    });
  }

  return faces;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
