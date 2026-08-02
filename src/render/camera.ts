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
import { MAX_SPEED } from '../game/player';
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
/**
 * The widest any device may see, and the most total world it may see.
 *
 * Width is the competitive axis, because the level runs left to right and
 * seeing further ahead is worth something in a staked run. It is capped at
 * 1200 rather than the old 900: a short landscape viewport has to be allowed to
 * pull back to get any sky at all, and 900 made it impossible.
 *
 * Area is what stops that becoming an advantage. Whatever shape a screen is, it
 * gets the same total amount of world as a portrait phone, so a wide short view
 * buys height at the cost of nothing and reach at the cost of sky.
 */
const MAX_VIEW_W = 1200;
const MAX_VIEW_AREA = 900 * 1000;

/**
 * Below this many CSS pixels of height, playability wins over the width cap.
 *
 * The wallet in landscape lands around here once its own chrome is taken out.
 * A screen this short is already seeing less of the world than anything else;
 * holding it to a width cap on top of that just makes it unplayable.
 */
const CRAMPED_HEIGHT = 340;

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

    /*
     * The ceiling is on AREA, plus a hard limit on width.
     *
     * It used to cap each dimension on its own, and on a short landscape screen
     * the width cap was the one that bound: a 660 by 280 viewport inside the
     * wallet resolved to a scale of 0.73 and about 380 world units of height.
     * The ship flies out of the top of that. Reported as not being able to see
     * things flying up, and it was the camera zooming IN to obey a rule meant to
     * stop it zooming out.
     *
     * Capping the area instead lets a short screen pull back until it sees a
     * comfortable amount of sky, while still never seeing more of the level in
     * total than a tall one. The width limit stays because the level runs left
     * to right, so horizontal reach is the axis a staked challenge could be won
     * on; it is simply looser than the old flat 900 rather than absent.
     */
    const toCapArea = Math.sqrt((cssWidth * cssHeight) / MAX_VIEW_AREA);

    /*
     * The width cap lifts on a screen too short to play on.
     *
     * Capping area was supposed to buy back the sky, and on a genuinely tiny
     * viewport it never binds: the wallet in landscape leaves about 200 usable
     * pixels of height, where the width cap alone forces a scale that leaves
     * 358 world units of sky. The ship still flies out of the top and the fix
     * did nothing.
     *
     * Below the threshold the area cap is the only limit. That does buy a wider
     * view, and it is the right trade rather than a loophole: the same screen is
     * seeing far LESS sky than a portrait phone, and in a game where attackers
     * come from above and you climb to reach people, height is the axis that
     * decides whether it is playable at all. Nobody gains by picking a 200 pixel
     * window, and the total world on screen is still the same for everyone.
     */
    const toCapWidth = cssHeight < CRAMPED_HEIGHT ? 0 : cssWidth / MAX_VIEW_W;

    this.scale = Math.max(toFitMinimum, toCapArea, toCapWidth);
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

  /**
   * Free follow, for a world with no ground line.
   *
   * The normal target biases downward to keep the chart on screen, which is
   * correct when there is exactly one surface and it is beneath you. A city has
   * walls on four sides and nothing to look down at, so that bias would push
   * the view off the bottom of the map and hide the street the player is
   * standing in.
   */
  followFree(player: Player, world: { width: number; height: number }, dt: number): void {
    const halfW = this.viewW / 2;
    const halfH = this.viewH / 2;
    const lead = clamp(player.vx / MAX_SPEED, -1, 1) * LOOKAHEAD;

    const x =
      this.viewW >= world.width ? world.width / 2 : clamp(player.x + lead, halfW, world.width - halfW);
    const y =
      this.viewH >= world.height ? world.height / 2 : clamp(player.y, halfH, world.height - halfH);

    const pull = 1 - Math.exp(-FOLLOW_SPRING * dt);
    this.x += (x - this.x) * pull;
    this.y += (y - this.y) * pull;

    this.shakeAmount *= Math.pow(0.02, dt);
    if (this.shakeAmount < 0.4) this.shakeAmount = 0;
    this.shakeX = (Math.random() * 2 - 1) * this.shakeAmount;
    this.shakeY = (Math.random() * 2 - 1) * this.shakeAmount;
  }

  /**
   * How much wider the view goes on the ring city.
   *
   * The rings sit five hundred apart in a world nearly six thousand across, and
   * at the normal scale you see one curved wall filling the screen with no way
   * to tell it is one of several. Pulling back is what makes the shape of the
   * place readable, which is the entire reason it is rings rather than a grid.
   *
   * Applied as a zoom rather than by raising the view caps, because those caps
   * exist to stop a desktop seeing more of a LEVEL than a phone. This changes
   * both devices by the same factor, so the fairness the caps protect is
   * untouched.
   *
   * ## Worked out from what a person ends up being, not chosen by eye
   *
   * The player is 17 units in radius, so at scale s they are 34s pixels tall.
   * On the Nimiq Pay viewport, which is the smallest screen this has to work
   * on and therefore the one that decides:
   *
   *   zoom 2.6   12px   the shipped value, and simply not visible
   *   zoom 1.75  18px   still reported as tiny and tiring to look at
   *   zoom 1.45  22px   what is set here
   *   zoom 1.2   27px   legible, but too close to read the place
   *   zoom 1.0   32px   the same size as every other stage
   *
   * Twice reported as characters too small to make out, and both times the
   * honest measure was the phone rather than the laptop it was checked on: the
   * same fraction of a smaller screen is a smaller number of actual pixels.
   *
   * Then reported the other way at 1.2, as too close. Both complaints are real
   * and they pull against each other, so this sits between them.
   *
   * Moved from 1.45 to 1.28 after the finale's camera was fixed. Until then
   * stage seven was drawing through the chart camera: the player spawned in a
   * corner and the view clamped to a world 960 tall inside one 5,800 across, so
   * every judgement about how the place read was made against a broken frame.
   * Retested on a working one and the characters were still too small, which is
   * the same complaint arriving for the third time and worth believing.
   *
   * 1.28 puts a figure at about 25px on the wallet viewport, up from 22, and
   * still shows one wall curving away with the next behind it.
   *
   * Past this the ring map in the corner does the job better. It draws every
   * wall, every gap and where you are, without shrinking the world you are
   * standing in, and the point of keeping the camera close is that the map
   * stays the thing you read the place with.
   */
  static readonly RING_ZOOM_OUT = 1.28;

  /** Widen the view for a world that has to be read at a distance. */
  zoomOut(factor: number): void {
    this.scale /= factor;
    this.viewW *= factor;
    this.viewH *= factor;
  }

  /** Snap straight to a free-follow target, for the first frame of a run. */
  jumpToFree(player: Player, world: { width: number; height: number }): void {
    const halfW = this.viewW / 2;
    const halfH = this.viewH / 2;
    this.x =
      this.viewW >= world.width ? world.width / 2 : clamp(player.x, halfW, world.width - halfW);
    this.y =
      this.viewH >= world.height ? world.height / 2 : clamp(player.y, halfH, world.height - halfH);
  }

  private target(player: Player, groundY: number): { x: number; y: number } {
    const lead = clamp(player.vx / MAX_SPEED, -1, 1) * LOOKAHEAD;

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
     *
     * The cap was a fifth of the view and that was not enough. A wide desktop
     * window is short in world units, about 490 tall once the fairness cap
     * bites, so a fifth is under a hundred units of bias against a gap that
     * routinely runs past four hundred. The chart went off the bottom of the
     * screen and stayed there for most of a run, which means the one thing the
     * whole game is built on was invisible while you played it. A third keeps
     * the ground on screen at any sane altitude and still leaves the ship
     * comfortably inside the frame rather than riding the top edge.
     */
    const gap = Math.max(0, groundY - player.y);
    const bias = Math.min(gap * 0.55, this.viewH * 0.32);
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
