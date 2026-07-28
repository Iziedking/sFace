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
import { FACES, pickFace, type FaceQuirk } from '../data/faces';
import type { DailyMission } from './mission';
import { Terrain, EXTRACTION_X, WORLD_HEIGHT, CEILING } from './terrain';

export const RUN_SECONDS = 90;
export const PLAYER_MAX_HEALTH = 100;

/** Score awarded the moment a face is freed, before it is safely out. */
export const RESCUE_FRACTION = 0.25;
export const ATTACKER_SCORE = 50;
export const TIME_BONUS_PER_SECOND = 20;

export type EnemyKind = 'drifter' | 'diver' | 'turret';
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
}

export interface Face {
  id: number;
  defIndex: number;
  quirk: FaceQuirk;
  name: string;
  line: string;
  bounty: number;
  x: number;
  y: number;
  state: FaceState;
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
}

export interface RunEvent {
  kind: 'freed' | 'extracted' | 'lost' | 'hit' | 'kill' | 'pickupLine';
  text?: string;
  x: number;
  y: number;
}

export class RunState {
  readonly mission: DailyMission;
  readonly terrain: Terrain;
  readonly runRng: Rng;

  readonly player: Player;
  readonly enemies: Enemy[];
  readonly faces: Face[];
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

  private nextId = 1;

  constructor(mission: DailyMission) {
    this.mission = mission;
    this.terrain = new Terrain(mission.terrain);
    this.runRng = new Rng(`${mission.seed}:run`);

    const levelRng = new Rng(mission.seed);
    this.enemies = layOutEnemies(levelRng, this.terrain, mission.difficulty, () => this.nextId++);
    this.faces = layOutFaces(levelRng, this.terrain, () => this.nextId++);

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
    return Math.max(0, RUN_SECONDS - this.time);
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
      this.attackersCleared * ATTACKER_SCORE +
      timeBonus;
    return Math.floor(raw * this.mission.bountyMultiplier);
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
): Enemy[] {
  const enemies: Enemy[] = [];
  // Difficulty 1 is a quiet day, 5 is extreme fear and a crowded sky.
  const densityScale = 0.45 + difficulty * 0.22;
  const step = 210;

  for (let x = 640; x < EXTRACTION_X - 200; x += step) {
    const local = terrain.volatilityAt(x);
    // Even a calm stretch gets something, or the level has dead air in it.
    const chance = Math.min(0.95, (0.25 + local * 0.75) * densityScale);
    if (!rng.chance(chance)) continue;

    const kind = pickKind(rng, local, difficulty);
    const y =
      kind === 'turret'
        ? terrain.groundAt(x) - 26
        : clamp(terrain.clearAbove(x, rng.range(120, 340)), CEILING + 30, WORLD_HEIGHT - 90);

    enemies.push({
      id: nextId(),
      kind,
      x: x + rng.range(-60, 60),
      y,
      vx: 0,
      vy: 0,
      health: kind === 'turret' ? 40 : kind === 'diver' ? 18 : 28,
      fireCooldown: rng.range(0.4, 2.2),
      alive: true,
      active: false,
      homeY: y,
      phase: rng.range(0, Math.PI * 2),
    });
  }

  return enemies;
}

/** Volatile stretches favour divers, calm ones favour turrets on the ground. */
function pickKind(rng: Rng, volatility: number, difficulty: number): EnemyKind {
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
function layOutFaces(rng: Rng, terrain: Terrain, nextId: () => number): Face[] {
  const faces: Face[] = [];
  const count = FACES.length;
  const usable = EXTRACTION_X - 900;
  const band = usable / count;

  // Shuffle which archetype lands in which band, deterministically.
  const order = FACES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = order[i] ?? i;
    const b = order[j] ?? j;
    order[i] = b;
    order[j] = a;
  }

  for (let i = 0; i < count; i++) {
    const defIndex = order[i] ?? i;
    // pickFace keeps the weighting honest if this ever becomes a random draw.
    const def = FACES[defIndex] ?? pickFace(rng.next());
    const x = 700 + band * i + rng.range(band * 0.2, band * 0.7);
    const y = terrain.groundAt(x) - rng.range(40, 130);

    faces.push({
      id: nextId(),
      defIndex,
      quirk: def.quirk,
      name: def.name,
      line: def.line,
      bounty: def.bounty,
      x,
      y: Math.max(CEILING + 40, y),
      state: 'trapped',
      slot: -1,
      pausedUntil: 0,
      nextTalkAt: 0,
      selfExtractX: x + (EXTRACTION_X - x) * rng.range(0.4, 0.65),
      freedAt: 0,
    });
  }

  return faces;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
