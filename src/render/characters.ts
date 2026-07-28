/**
 * Everyone on screen is a person.
 *
 * The whole cast, the player, the squadmates, the attackers and the people
 * being rescued, is drawn by one function. That is deliberate: they share a
 * silhouette, so the screen reads as a crowd of humans rather than a set of
 * shapes, and the only things that separate them are colour and posture.
 *
 * How a body is built, and why:
 *
 * - **The body does not rotate with the aim.** Only the arm does. A figure that
 *   spins to face its crosshair reads as a sprite being rotated; a figure that
 *   stays upright and points reads as a person. The body gets a small tilt from
 *   velocity instead, which is what sells the speed.
 * - **Ink outlines, flat fills.** On a bright canvas, shading turns to mud at
 *   this size. An outline holds the figure together at thirty pixels tall and
 *   still reads at ten.
 * - **The head is a socket.** It draws a generated face by default, and a real
 *   profile picture when one is available. Nothing else about the body changes,
 *   so a connected account is a swap rather than a separate render path.
 *
 * A note on cross-origin images, because it bites silently: avatars are loaded
 * with crossOrigin set. Without it the image still draws, but it taints any
 * canvas it touches, and the score card is exported with toDataURL, which
 * throws on a tainted canvas. The failure would appear as "sharing broke for
 * users who connected their account" and nowhere near this file.
 */

import { theme, hashString, pickFrom, MONO } from './theme';

export type Role = 'player' | 'squad' | 'drifter' | 'diver' | 'turret' | 'runner' | 'rescue';

export interface HumanOptions {
  x: number;
  y: number;
  /** Where they are pointing, radians. Drives the arm, never the body. */
  aim: number;
  /** Which way the body faces. */
  facing: 1 | -1;
  /** Lean from velocity, radians. Small values only. */
  tilt: number;
  /** Animation clock in seconds. Drives legs and the jet plume. */
  time: number;
  /** 0 to 1. Opens the plume and straightens the legs. */
  thrust: number;
  role: Role;
  /** Stable string for the generated look. A handle, or an entity id. */
  seed: string;
  /** A loaded, untainted profile picture, or null for a generated face. */
  avatar: HTMLImageElement | null;
  alpha: number;
  firing: boolean;
  /** Drawn above the head when present. */
  label?: string | null;
}

/** Half-height of a figure, matching the collision radius it is drawn for. */
export const HUMAN_HEIGHT = 38;
const HEAD_R = 7.5;
const OUTLINE = 1.8;

const SKIN = ['#f2c9a0', '#e0aa78', '#c58a5c', '#9c6440', '#6f4429', '#f7ddc0'] as const;
const HAIR = ['#1d1712', '#3f2a18', '#7a4a22', '#c9a227', '#8c8378', '#2b2b3a'] as const;

/**
 * Jacket per role. The only thing separating a friend from a threat, so the
 * gap between them has to be enormous.
 *
 * Attackers wear ink, not red. Red jackets were tried and they sat too close
 * to the player's orange to tell apart in peripheral vision, which is the only
 * vision you have while dodging. Ink against a cream canvas is the largest
 * contrast available, so a threat now reads as a black silhouette and the
 * player reads as the one orange thing on screen. Red is kept for the visor
 * and the bullets, where it means "this specific thing will hurt you".
 */
const JACKET: Record<Role, string> = {
  player: theme.accent,
  squad: theme.paperDeep,
  drifter: theme.ink,
  diver: theme.ink,
  turret: theme.ink,
  runner: theme.ink,
  rescue: theme.rescue,
};

const HOSTILE: ReadonlySet<Role> = new Set<Role>(['drifter', 'diver', 'turret', 'runner']);

export function drawHuman(ctx: CanvasRenderingContext2D, o: HumanOptions): void {
  const jacket = JACKET[o.role];
  const skin = pickFrom(SKIN, o.seed, 1);
  const hair = pickFrom(HAIR, o.seed, 2);
  const hairStyle = hashString(o.seed) % 4;
  const glasses = hashString(`${o.seed}g`) % 5 === 0;

  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.translate(o.x, o.y);
  ctx.rotate(o.tilt);
  ctx.scale(o.facing, 1);

  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = theme.ink;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (o.role === 'runner') drawRunner(ctx, o, jacket, skin, hair, hairStyle, glasses);
  else if (o.role === 'turret') drawCrouched(ctx, o, jacket, skin, hair, hairStyle, glasses);
  else drawUpright(ctx, o, jacket, skin, hair, hairStyle, glasses);

  ctx.restore();

  if (o.label) drawLabel(ctx, o);
}

/**
 * A driver in an open buggy.
 *
 * It has to be recognisable as a vehicle from the far edge of the screen and
 * still be a person, because the whole cast is people and a faceless drone
 * would be the one thing on the level that is not. So: wheels, a low chassis,
 * a roll bar, and somebody sitting in it holding a gun.
 *
 * The wheels turn with distance travelled rather than with time, so a runner
 * that has been stopped by a hill is visibly stopped.
 */
function drawRunner(
  ctx: CanvasRenderingContext2D,
  o: HumanOptions,
  jacket: string,
  skin: string,
  hair: string,
  hairStyle: number,
  glasses: boolean,
): void {
  const spin = o.time * 6;

  // Wheels first, so the chassis sits over them.
  for (const wx of [-14, 13]) {
    ctx.beginPath();
    ctx.arc(wx, 12, 7.5, 0, Math.PI * 2);
    ctx.fillStyle = theme.ink;
    ctx.fill();

    // One spoke, which is all it takes to read as rolling.
    ctx.save();
    ctx.translate(wx, 12);
    ctx.rotate(spin);
    ctx.strokeStyle = theme.canvas;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4.5, 0);
    ctx.lineTo(4.5, 0);
    ctx.stroke();
    ctx.restore();
  }

  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = theme.ink;

  // Chassis: a low wedge, nose forward.
  ctx.beginPath();
  ctx.moveTo(-20, 8);
  ctx.lineTo(-16, -2);
  ctx.lineTo(8, -2);
  ctx.lineTo(21, 3);
  ctx.lineTo(21, 8);
  ctx.closePath();
  ctx.fillStyle = jacket;
  ctx.fill();
  ctx.stroke();

  // Roll bar behind the driver.
  ctx.beginPath();
  ctx.moveTo(-13, -2);
  ctx.lineTo(-13, -16);
  ctx.lineTo(-4, -18);
  ctx.stroke();

  // The driver: torso, head, and a gun held over the nose.
  ctx.beginPath();
  ctx.roundRect(-9, -16, 13, 15, 4);
  ctx.fillStyle = jacket;
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.translate(-2, -10);
  ctx.rotate(o.aim * o.facing);
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(17, 0);
  ctx.stroke();
  ctx.restore();

  // Sat in a chassis, so the head rides lower than an upright figure's.
  ctx.save();
  ctx.translate(-3, -11);
  drawHead(ctx, o, skin, hair, hairStyle, glasses);
  ctx.restore();
}

function drawUpright(
  ctx: CanvasRenderingContext2D,
  o: HumanOptions,
  jacket: string,
  skin: string,
  hair: string,
  hairStyle: number,
  glasses: boolean,
): void {
  // Legs swing when hovering and tuck when under thrust, which is the cheapest
  // possible read on whether someone is flying or drifting.
  const swing = Math.sin(o.time * 6) * (1 - o.thrust) * 0.5;
  const tuck = o.thrust * 5;

  // Jet pack, behind the torso.
  if (o.role !== 'rescue') {
    ctx.fillStyle = theme.ink;
    roundRect(ctx, -9, -6, 5, 13, 2);
    ctx.fill();

    if (o.thrust > 0.06) {
      const flame = 6 + o.thrust * 16 + Math.sin(o.time * 30) * 2;
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(-8.5, 7);
      ctx.lineTo(-6.5, 7);
      ctx.lineTo(-7.5, 7 + flame);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Legs.
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-1.5, 6);
  ctx.lineTo(-3 - swing * 4, 15 - tuck);
  ctx.moveTo(1.5, 6);
  ctx.lineTo(3 + swing * 4, 15 - tuck);
  ctx.stroke();
  ctx.lineWidth = OUTLINE;

  // Torso.
  ctx.fillStyle = jacket;
  roundRect(ctx, -6, -6, 12, 13, 3.5);
  ctx.fill();
  ctx.stroke();

  drawArm(ctx, o, skin);
  drawHead(ctx, o, skin, hair, hairStyle, glasses);
}

/** Turrets are people who dug in. Same body, planted and hunched. */
function drawCrouched(
  ctx: CanvasRenderingContext2D,
  o: HumanOptions,
  jacket: string,
  skin: string,
  hair: string,
  hairStyle: number,
  glasses: boolean,
): void {
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-2, 4);
  ctx.lineTo(-7, 13);
  ctx.moveTo(2, 4);
  ctx.lineTo(6, 13);
  ctx.stroke();
  ctx.lineWidth = OUTLINE;

  ctx.fillStyle = jacket;
  roundRect(ctx, -6.5, -4, 13, 10, 3);
  ctx.fill();
  ctx.stroke();

  drawArm(ctx, o, skin, -1);
  drawHead(ctx, o, skin, hair, hairStyle, glasses, -9);
}

/**
 * One arm, pointing where they are aiming. Drawn in unflipped space so a
 * figure facing left still points its gun at the actual target rather than
 * mirroring into thin air.
 */
function drawArm(
  ctx: CanvasRenderingContext2D,
  o: HumanOptions,
  skin: string,
  shoulderY = -2,
): void {
  if (o.role === 'rescue') return;

  ctx.save();
  // Undo the facing flip, then aim, so the arm is in world angles.
  ctx.scale(o.facing, 1);
  ctx.translate(0, shoulderY);
  ctx.rotate(o.aim);

  ctx.strokeStyle = skin;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(11, 0);
  ctx.stroke();

  ctx.fillStyle = theme.ink;
  roundRect(ctx, 9, -2.4, 9, 4.8, 1.5);
  ctx.fill();

  if (o.firing) {
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(20, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = theme.ink;
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  o: HumanOptions,
  skin: string,
  hair: string,
  hairStyle: number,
  glasses: boolean,
  headY = -14,
): void {
  ctx.save();
  ctx.translate(0, headY);
  // Heads never mirror, so a real profile picture is never shown backwards.
  ctx.scale(o.facing, 1);

  if (o.avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, HEAD_R + 1.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(o.avatar, -HEAD_R - 1.5, -HEAD_R - 1.5, (HEAD_R + 1.5) * 2, (HEAD_R + 1.5) * 2);
    ctx.restore();

    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = OUTLINE;
    ctx.beginPath();
    ctx.arc(0, 0, HEAD_R + 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, 0, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // Hair, four silhouettes. Enough that a roster of five reads as five people.
  ctx.fillStyle = hair;
  ctx.beginPath();
  switch (hairStyle) {
    case 0: // cropped
      ctx.arc(0, -1.5, HEAD_R, Math.PI, 0);
      break;
    case 1: // swept
      ctx.arc(0, -1, HEAD_R, Math.PI * 1.05, Math.PI * 0.1);
      ctx.lineTo(HEAD_R + 2, -HEAD_R + 1);
      break;
    case 2: // cap
      ctx.arc(0, -1, HEAD_R, Math.PI, 0);
      ctx.lineTo(HEAD_R + 4, -1.5);
      ctx.lineTo(HEAD_R, -3);
      break;
    default: // bare, just a rim
      ctx.arc(0, -3.5, HEAD_R * 0.85, Math.PI, 0);
      break;
  }
  ctx.closePath();
  ctx.fill();

  // A hostile wears a red visor across the eyes. It is the one place danger
  // red appears on a body, and it is what makes a black silhouette read as
  // "coming for you" rather than just "a person in a dark coat".
  if (HOSTILE.has(o.role)) {
    ctx.fillStyle = theme.danger;
    ctx.fillRect(-HEAD_R - 0.5, -2.6, HEAD_R * 2 + 1, 4);
    ctx.fillStyle = theme.ink;
    ctx.fillRect(-2, 3, 4, 1.2);
    ctx.restore();
    return;
  }

  ctx.fillStyle = theme.ink;
  if (glasses) {
    ctx.fillRect(-5, -1.4, 4, 2.6);
    ctx.fillRect(1, -1.4, 4, 2.6);
    ctx.fillRect(-1, -0.6, 2, 1);
  } else {
    ctx.fillRect(-3.4, -1.2, 1.8, 2);
    ctx.fillRect(1.6, -1.2, 1.8, 2);
  }
  ctx.fillRect(-2, 3, 4, 1.2);

  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, o: HumanOptions): void {
  if (!o.label) return;

  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.font = `600 10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const y = o.y - 26;
  const width = ctx.measureText(o.label).width + 8;

  // A solid tag rather than bare text, because type on a moving chart is
  // unreadable and an outline halo looks like a mistake.
  ctx.fillStyle = theme.ink;
  roundRect(ctx, o.x - width / 2, y - 12, width, 13, 3);
  ctx.fill();

  ctx.fillStyle = theme.canvas;
  ctx.fillText(o.label, o.x, y);
  ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Loads profile pictures once and hands back the decoded image.
 *
 * Returns null until an image is ready, and null forever if it fails, so every
 * caller falls back to the generated face without branching. A missing avatar
 * must never be a missing character.
 */
export class AvatarCache {
  private images = new Map<string, HTMLImageElement | null>();

  get(url: string | null | undefined): HTMLImageElement | null {
    if (!url) return null;

    const existing = this.images.get(url);
    if (existing !== undefined) return existing;

    // Mark as pending so a failing URL is not requested once per frame.
    this.images.set(url, null);

    const image = new Image();
    // Required. Without it the image draws but taints the canvas, and the
    // score card export throws when the player has connected an account.
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => this.images.set(url, image), { once: true });
    image.addEventListener('error', () => this.images.set(url, null), { once: true });
    image.src = url;

    return null;
  }

  clear(): void {
    this.images.clear();
  }
}
