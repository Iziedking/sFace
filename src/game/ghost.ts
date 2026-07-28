/**
 * Recording a run, and playing one back beside you.
 *
 * This is the trick that makes sFace read as co-op without any netcode. Every
 * player on a given day flies the same seeded level, so a run recorded
 * yesterday afternoon replays perfectly alongside one happening right now.
 * Four people flying together is four synchronised solo runs, and it cannot
 * desync because there is nothing to sync.
 *
 * **Positions, not inputs.** The obvious approach is to record the input trace
 * and re-simulate it, which is smaller and would let the server verify a
 * score. It was rejected: any drift at all, a quantised aim angle or a float
 * that rounds differently on another device, compounds over ninety seconds
 * into a ghost that flies into a hill. A position trace cannot drift because
 * there is nothing to integrate. Ghosts are cosmetic, so correctness of the
 * picture beats compactness of the file.
 *
 * The format is deliberately fixed-width rather than delta encoded. Deltas
 * would save about a third, and would also mean a player moving unusually fast
 * overflows a byte and corrupts every frame after it. Three kilobytes is not
 * worth that failure mode.
 *
 *   header  [magic u8][version u8][sampleHz u8][reserved u8][frameCount u16]
 *   frame   [x u16][y u16][angle u8][flags u8]              6 bytes each
 *
 * At 20Hz over a 90 second run that is 1800 frames, about 10.8 kB raw and
 * 14.4 kB as base64. Small enough to post without thinking about it.
 */

import { WORLD_HEIGHT, WORLD_WIDTH } from './terrain';
import { RUN_SECONDS, type RunState } from './state';

const MAGIC = 0x5f;
const VERSION = 1;
export const SAMPLE_HZ = 20;
const HEADER_BYTES = 6;
const FRAME_BYTES = 6;

/** A little slack over the run length, so a final frame is never dropped. */
const MAX_FRAMES = Math.ceil((RUN_SECONDS + 2) * SAMPLE_HZ);

const FLAG_FIRING = 1 << 0;
const FLAG_DOWN = 1 << 1;
/** Faces aboard live in bits 2 to 4, which is plenty for a level holding five. */
const CARRY_SHIFT = 2;
const CARRY_MASK = 0b111;

export interface GhostFrame {
  x: number;
  y: number;
  /** Facing, in radians. */
  angle: number;
  firing: boolean;
  down: boolean;
  carrying: number;
}

// Quantisation. Positions are stored across the full 16 bit range of the world,
// which is a resolution of about 0.18 world units horizontally. A ghost is
// drawn at seventeen pixels across, so this is far finer than anyone can see.

function packX(x: number): number {
  return clampInt((x / WORLD_WIDTH) * 65535, 0, 65535);
}

function packY(y: number): number {
  return clampInt((y / WORLD_HEIGHT) * 65535, 0, 65535);
}

function unpackX(value: number): number {
  return (value / 65535) * WORLD_WIDTH;
}

function unpackY(value: number): number {
  return (value / 65535) * WORLD_HEIGHT;
}

function packAngle(angle: number): number {
  // Normalise into [0, 2pi) first, so a negative atan2 result does not wrap to 0.
  const turns = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
  return clampInt(turns * 256, 0, 255);
}

function unpackAngle(value: number): number {
  return (value / 256) * Math.PI * 2;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Samples a live run at a fixed rate off the run clock, not wall clock, so a
 * dropped frame or a backgrounded tab cannot stretch the recording.
 */
export class GhostRecorder {
  private frames: GhostFrame[] = [];
  private nextIndex = 0;

  /** Call once per simulation step, after the step has been applied. */
  sample(run: RunState): void {
    if (this.frames.length >= MAX_FRAMES) return;

    const index = Math.floor(run.time * SAMPLE_HZ);
    if (index < this.nextIndex) return;

    // If the loop ever skips forward, repeat the current pose into the gap so
    // frame index stays a direct function of time. A ghost that drifts out of
    // step with the clock is worse than one that pauses for a frame.
    while (this.nextIndex <= index && this.frames.length < MAX_FRAMES) {
      this.frames.push(poseOf(run));
      this.nextIndex++;
    }
  }

  get length(): number {
    return this.frames.length;
  }

  encode(): string {
    return encodeTrace(this.frames);
  }

  reset(): void {
    this.frames = [];
    this.nextIndex = 0;
  }
}

function poseOf(run: RunState): GhostFrame {
  return {
    x: run.player.x,
    y: run.player.y,
    angle: Math.atan2(run.player.aimY, run.player.aimX),
    firing: run.player.fireCooldown > 0,
    down: run.phase === 'died',
    carrying: run.carrying,
  };
}

export function encodeTrace(frames: readonly GhostFrame[]): string {
  const count = Math.min(frames.length, MAX_FRAMES);
  const buffer = new ArrayBuffer(HEADER_BYTES + count * FRAME_BYTES);
  const view = new DataView(buffer);

  view.setUint8(0, MAGIC);
  view.setUint8(1, VERSION);
  view.setUint8(2, SAMPLE_HZ);
  view.setUint8(3, 0);
  view.setUint16(4, count);

  for (let i = 0; i < count; i++) {
    const frame = frames[i]!;
    const at = HEADER_BYTES + i * FRAME_BYTES;
    view.setUint16(at, packX(frame.x));
    view.setUint16(at + 2, packY(frame.y));
    view.setUint8(at + 4, packAngle(frame.angle));
    view.setUint8(
      at + 5,
      (frame.firing ? FLAG_FIRING : 0) |
        (frame.down ? FLAG_DOWN : 0) |
        ((Math.min(frame.carrying, CARRY_MASK) & CARRY_MASK) << CARRY_SHIFT),
    );
  }

  return toBase64(new Uint8Array(buffer));
}

/**
 * Decode a trace. Returns null on anything unexpected rather than throwing.
 *
 * This runs on data fetched from the network, so it is a trust boundary: a
 * truncated or hostile payload must produce a missing ghost, never an
 * exception in the middle of somebody's run.
 */
export function decodeTrace(encoded: string): GhostFrame[] | null {
  try {
    const bytes = fromBase64(encoded);
    if (bytes.length < HEADER_BYTES) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint8(0) !== MAGIC) return null;
    if (view.getUint8(1) !== VERSION) return null;

    const hz = view.getUint8(2);
    if (hz !== SAMPLE_HZ) return null;

    const count = view.getUint16(4);
    if (count > MAX_FRAMES) return null;
    if (bytes.length < HEADER_BYTES + count * FRAME_BYTES) return null;

    const frames: GhostFrame[] = [];
    for (let i = 0; i < count; i++) {
      const at = HEADER_BYTES + i * FRAME_BYTES;
      const flags = view.getUint8(at + 5);
      frames.push({
        x: unpackX(view.getUint16(at)),
        y: unpackY(view.getUint16(at + 2)),
        angle: unpackAngle(view.getUint8(at + 4)),
        firing: (flags & FLAG_FIRING) !== 0,
        down: (flags & FLAG_DOWN) !== 0,
        carrying: (flags >> CARRY_SHIFT) & CARRY_MASK,
      });
    }

    return frames;
  } catch {
    return null;
  }
}

/**
 * Reads a decoded trace at an arbitrary run time.
 *
 * The trace is sampled at 20Hz and the screen refreshes at 60 or more, so
 * positions are interpolated. Angle is interpolated the short way around the
 * circle, because the naive version spins the ghost a full turn every time it
 * crosses from just under 2pi to just over 0.
 */
export class GhostTrack {
  constructor(private frames: readonly GhostFrame[]) {}

  get duration(): number {
    return this.frames.length / SAMPLE_HZ;
  }

  get finished(): boolean {
    return this.frames.length === 0;
  }

  /** Pose at a run time, or null once the recording has run out. */
  at(time: number): GhostFrame | null {
    if (this.frames.length === 0) return null;

    const position = time * SAMPLE_HZ;
    const index = Math.floor(position);

    if (index < 0) return this.frames[0] ?? null;
    if (index >= this.frames.length - 1) {
      // Hold the last pose rather than vanishing. A squadmate who reached
      // extraction should still be standing on the pad when you arrive.
      return this.frames[this.frames.length - 1] ?? null;
    }

    const a = this.frames[index]!;
    const b = this.frames[index + 1]!;
    const t = position - index;

    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      angle: lerpAngle(a.angle, b.angle, t),
      // Booleans and counts step rather than blend. A half-fired gun is not a
      // thing, and a ghost carrying 2.4 faces is not either.
      firing: a.firing,
      down: a.down,
      carrying: a.carrying,
    };
  }
}

function lerpAngle(from: number, to: number, t: number): number {
  const full = Math.PI * 2;
  let delta = ((to - from) % full + full * 1.5) % full - Math.PI;
  return from + delta * t;
}

// Base64 helpers. The browser has atob and btoa, node has Buffer, and this
// module is imported by both the game and the tests.

function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    // Chunked, because spreading a 10kB array into String.fromCharCode blows
    // the argument limit on some engines.
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(encoded: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(encoded, 'base64'));
}

export { MAX_FRAMES, FRAME_BYTES, HEADER_BYTES };
