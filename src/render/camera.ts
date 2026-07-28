/**
 * Camera and the world-to-screen transform.
 *
 * The viewport problem here is real: this runs in a wallet's WebView, so it is
 * portrait on a phone and landscape on a desktop during development, and a
 * side-scroller needs horizontal room in both. Fixing a virtual width makes a
 * tall phone show a strip of sky. Fixing a virtual height makes it show a
 * corridor you cannot dodge in.
 *
 * So we guarantee a minimum box instead. Scale is chosen so at least
 * MIN_VIEW_W by MIN_VIEW_H world units are always on screen, and whatever
 * shape the device is, the extra pixels show more world rather than stretching
 * it. Nothing is ever distorted and nothing is ever cropped below the minimum.
 */

import { clamp } from '../game/collision';
import type { Player } from '../game/state';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../game/terrain';

const MIN_VIEW_W = 560;
const MIN_VIEW_H = 760;
/**
 * Upper bound on how much world any device may see.
 *
 * Without this, a desktop browser shows well over twice the world a phone
 * does, which is a straightforward competitive advantage in a game where two
 * people are betting NIM on the same seed. The minimum keeps the game
 * playable, the maximum keeps it fair, and the maximum wins when they fight.
 */
const MAX_VIEW_W = 900;
const MAX_VIEW_H = 1000;

/** How far ahead of the ship the camera leads, at full speed. */
const LOOKAHEAD = 130;
/** Fraction of the gap closed per second. Loose enough to feel alive. */
const FOLLOW_SPRING = 6;

export class Camera {
  /** Centre of the view, in world units. */
  x = 0;
  y = 0;
  /** World units to CSS pixels. */
  scale = 1;
  viewW = MIN_VIEW_W;
  viewH = MIN_VIEW_H;

  private shakeAmount = 0;
  private shakeX = 0;
  private shakeY = 0;

  resize(cssWidth: number, cssHeight: number): void {
    // Zoom out until the minimum box fits, then zoom back in far enough that
    // neither dimension exceeds the maximum. Taking the larger of the two
    // lower bounds is what makes the fairness cap win over the comfort floor.
    const toFitMinimum = Math.min(cssWidth / MIN_VIEW_W, cssHeight / MIN_VIEW_H);
    const toCapMaximum = Math.max(cssWidth / MAX_VIEW_W, cssHeight / MAX_VIEW_H);

    this.scale = Math.max(toFitMinimum, toCapMaximum);
    this.viewW = cssWidth / this.scale;
    this.viewH = cssHeight / this.scale;
  }

  /** Snap straight to the target, used on the first frame of a run. */
  jumpTo(player: Player, groundY: number): void {
    const target = this.target(player, groundY);
    this.x = target.x;
    this.y = target.y;
  }

  follow(player: Player, groundY: number, dt: number): void {
    const target = this.target(player, groundY);
    const pull = 1 - Math.exp(-FOLLOW_SPRING * dt);
    this.x += (target.x - this.x) * pull;
    this.y += (target.y - this.y) * pull;

    // Decay is exponential so a big hit and a small hit both settle in about
    // the same time, which keeps the screen from ringing after a busy stretch.
    this.shakeAmount *= Math.pow(0.02, dt);
    if (this.shakeAmount < 0.4) this.shakeAmount = 0;
    this.shakeX = (Math.random() * 2 - 1) * this.shakeAmount;
    this.shakeY = (Math.random() * 2 - 1) * this.shakeAmount;
  }

  /** Called on hits and kills. Cosmetic only, never affects the simulation. */
  shake(amount: number): void {
    this.shakeAmount = Math.min(26, this.shakeAmount + amount);
  }

  private target(player: Player, groundY: number): { x: number; y: number } {
    const lead = clamp(player.vx / 400, -1, 1) * LOOKAHEAD;

    const halfW = this.viewW / 2;
    const halfH = this.viewH / 2;

    /*
     * Bias the camera down toward the ground rather than centring on the ship.
     *
     * Centring alone loses the terrain entirely on a wide, short window: the
     * view is only a few hundred world units tall there, so a player flying
     * three hundred units above the chart sees empty grid and cannot tell
     * where the ground is or what is coming. Since the chart is both the
     * terrain and the entire premise, losing sight of it is not acceptable.
     *
     * Half the gap, capped, so the ship never drifts toward the top edge.
     */
    const gap = Math.max(0, groundY - player.y);
    const bias = Math.min(gap * 0.5, this.viewH * 0.2);
    const eye = player.y + bias;

    // When the view is wider or taller than the world, centre on the world
    // rather than clamping to an inverted range.
    const x =
      this.viewW >= WORLD_WIDTH
        ? WORLD_WIDTH / 2
        : clamp(player.x + lead, halfW, WORLD_WIDTH - halfW);
    const y =
      this.viewH >= WORLD_HEIGHT
        ? WORLD_HEIGHT / 2
        : clamp(eye, halfH, WORLD_HEIGHT - halfH);

    return { x, y };
  }

  /** Left edge of the view in world units, shake included. */
  get left(): number {
    return this.x - this.viewW / 2 + this.shakeX;
  }

  /** Top edge of the view in world units, shake included. */
  get top(): number {
    return this.y - this.viewH / 2 + this.shakeY;
  }

  /** Apply the transform to a context whose state has already been saved. */
  applyTo(ctx: CanvasRenderingContext2D): void {
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.left, -this.top);
  }

  /** Canvas CSS pixels to world units. Used to turn a thumb into an aim point. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx / this.scale + this.left, y: sy / this.scale + this.top };
  }

  /** True when a world x band is anywhere near the view. Cheap cull. */
  visibleX(x: number, margin = 80): boolean {
    return x > this.left - margin && x < this.left + this.viewW + margin;
  }
}
