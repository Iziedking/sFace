/**
 * The people flying next to you.
 *
 * A squadmate is either a recording being played back or a live player whose
 * poses arrive over a socket. Deliberately, those two are the same type. Once
 * a ghost is just "something that has a pose at the current run time", live
 * co-op stops being a separate feature and becomes a different way of filling
 * in the same struct, and there is exactly one render path to get right.
 *
 * Nothing in here touches the simulation. Squadmates cannot shoot you, cannot
 * be shot, and cannot take a face you were going for. That is a design choice
 * rather than a shortcut: the moment one player's actions change another
 * player's level, the shared seed stops guaranteeing a fair challenge, and the
 * fair challenge is what the NIM is riding on.
 */

import { GhostTrack, type GhostFrame } from './ghost';

/** A phone has to draw these. Five extra ships is already a busy screen. */
export const MAX_SQUAD = 5;

/**
 * Live poses arrive around 10Hz and the screen redraws at 60. Snapping to each
 * arrival looks like a stutter, so live squadmates ease toward the last pose
 * received. Ghosts do not need this, since a trace can be read at any time.
 */
const LIVE_SMOOTHING = 12;
/** Drop a live squadmate who has gone quiet for this long. */
const LIVE_TIMEOUT_MS = 6000;

export type SquadSource = 'ghost' | 'live';

export interface Squadmate {
  id: string;
  name: string;
  source: SquadSource;
  /** Their final score, when we know it. Ghosts do, live players do not yet. */
  score: number | null;
  /** Set when they connected an X account and shared a picture. */
  avatarUrl: string | null;
  /** Where to draw them right now, or null when they have nothing to show. */
  pose: GhostFrame | null;
}

interface Entry extends Squadmate {
  track: GhostTrack | null;
  target: GhostFrame | null;
  lastSeen: number;
}

export class Squad {
  private entries = new Map<string, Entry>();
  /** Injected so tests are not at the mercy of the wall clock. */
  constructor(private now: () => number = () => Date.now()) {}

  get members(): Squadmate[] {
    return [...this.entries.values()].filter((entry) => entry.pose !== null);
  }

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Add a recorded run. Returns false when the squad is already full. */
  addGhost(
    id: string,
    name: string,
    score: number,
    frames: readonly GhostFrame[],
    avatarUrl: string | null = null,
  ): boolean {
    if (this.entries.size >= MAX_SQUAD || this.entries.has(id)) return false;

    this.entries.set(id, {
      id,
      name,
      source: 'ghost',
      score,
      avatarUrl,
      pose: null,
      track: new GhostTrack(frames),
      target: null,
      lastSeen: this.now(),
    });
    return true;
  }

  /**
   * Add a live player. A live squadmate outranks a ghost, so if the squad is
   * full we evict a ghost to make room rather than turning them away. Somebody
   * actually playing right now is worth more than a replay.
   */
  addLive(id: string, name: string, avatarUrl: string | null = null): boolean {
    if (this.entries.has(id)) return true;

    if (this.entries.size >= MAX_SQUAD && !this.evictGhost()) return false;

    this.entries.set(id, {
      id,
      name,
      source: 'live',
      score: null,
      avatarUrl,
      pose: null,
      track: null,
      target: null,
      lastSeen: this.now(),
    });
    return true;
  }

  /** A pose off the socket. Ignored for anyone we are not tracking live. */
  pushLive(id: string, frame: GhostFrame): void {
    const entry = this.entries.get(id);
    if (!entry || entry.source !== 'live') return;

    entry.target = frame;
    entry.lastSeen = this.now();
    // First pose lands immediately, so a joining squadmate appears where they
    // are rather than sliding in from wherever the last one was.
    if (!entry.pose) entry.pose = { ...frame };
  }

  remove(id: string): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Call once per frame with the run clock. */
  update(runTime: number, dt: number): void {
    const now = this.now();

    for (const entry of [...this.entries.values()]) {
      if (entry.source === 'ghost') {
        entry.pose = entry.track?.at(runTime) ?? null;
        continue;
      }

      if (now - entry.lastSeen > LIVE_TIMEOUT_MS) {
        this.entries.delete(entry.id);
        continue;
      }

      if (entry.target && entry.pose) {
        const pull = 1 - Math.exp(-LIVE_SMOOTHING * dt);
        entry.pose.x += (entry.target.x - entry.pose.x) * pull;
        entry.pose.y += (entry.target.y - entry.pose.y) * pull;
        entry.pose.angle = easeAngle(entry.pose.angle, entry.target.angle, pull);
        entry.pose.firing = entry.target.firing;
        entry.pose.down = entry.target.down;
        entry.pose.carrying = entry.target.carrying;
      }
    }
  }

  private evictGhost(): boolean {
    for (const [id, entry] of this.entries) {
      if (entry.source === 'ghost') {
        this.entries.delete(id);
        return true;
      }
    }
    return false;
  }
}

/** Ease the short way round, or a ship crossing north spins a full turn. */
function easeAngle(from: number, to: number, t: number): number {
  const full = Math.PI * 2;
  const delta = ((to - from) % full + full * 1.5) % full - Math.PI;
  return from + delta * t;
}
