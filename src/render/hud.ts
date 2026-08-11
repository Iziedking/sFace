/**
 * The heads-up display: clock, hull, who you are carrying, how far is left.
 *
 * Four things and nothing else. Everything a player needs mid-run has to be
 * readable in the quarter of a second they can spare from flying, so anything
 * merely interesting waits for the results screen.
 *
 * On a bright canvas a HUD cannot be thin grey type, because the chart runs
 * underneath it and grey on cream disappears. So every readout sits on a solid
 * ink plate: a printed strip laid over the page. That also means the HUD reads
 * identically whether the chart behind it is high or low, which thin type
 * never manages.
 *
 * Safe-area insets are read from the live CSS environment rather than guessed,
 * because Nimiq Pay renders edge to edge and a hardcoded top margin puts the
 * clock under the notch on some phones and floating in space on others.
 */

import { theme, MONO } from './theme';
import { hintFor } from './hints';
import { gateCardLayout } from '../core/gatecard';
import { STICK_FULL_TILT } from '../core/input';
import type { Input, StickView } from '../core/input';
import type { RunState } from '../game/state';
import { PLAYER_MAX_HEALTH } from '../game/state';
import { CONSUMABLES } from '../data/consumables';
import { padLayout, type PadRegion, slotStrip, useRegion } from '../core/pads';
import { alerted } from '../game/sight';
import { assistTier } from '../game/assist';
import { gateQuestion, READ_COST } from '../game/ally';
import { CONVOY_MAX_HEALTH } from '../game/convoy';
import { isCaged } from '../game/cell';
import { snapsToDirections, touchCapable, usingPads } from '../core/scheme';

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Seconds left at which the clock turns and starts pulsing. */
const CLOCK_WARNING = 15;
const BAR_HEIGHT = 46;

/**
 * How long the gate card stays up after arriving at a wall.
 *
 * Long enough to read a question and three tickers without hurrying, short
 * enough that it is gone before it becomes scenery.
 */
const GATE_CARD_SECONDS = 6;

/**
 * How wide the arc counts as being at the gap, in radians either side.
 *
 * Roughly matches where attackers stand, so the card is up exactly where the
 * stage is contested and down while you are circling looking for the opening.
 */
const GATE_ARC = 0.7;

/**
 * Where a map goes, and it is the same corner for both of them.
 *
 * Top right, which is the one part of the screen no hand covers.
 *
 * Both maps used to sit bottom left, lifted 150 pixels whenever the fixed pads
 * were on, because that corner belongs to the movement pad. Lifting them only
 * moved the problem: the map left the pad alone and landed on the level
 * instead, in the band a player is flying through, and on a phone it also
 * crowded the row of buys along the bottom centre. Reported from a phone twice,
 * the second time as the map affecting the play itself.
 *
 * The top right has none of that. Nothing is drawn there but the assist tier
 * line, which is one row of 10px text, so the map starts below it.
 *
 * Shared by drawMap and drawRingMap rather than written twice, because a map
 * that changes corner depending on which stage you are on is a map you have to
 * hunt for, and two copies of this arithmetic is how that happens.
 */
function mapCorner(insets: SafeInsets, width: number, w: number): { x: number; y: number } {
  return {
    x: width - insets.right - 12 - w,
    // Clear of the strip and of the assist tier line beneath it.
    y: insets.top + BAR_HEIGHT + 30,
  };
}

/**
 * How long a button that has just become useful draws attention to itself.
 *
 * Long enough to be noticed by somebody looking at the middle of the screen,
 * short enough that it is over before it is annoying. Three pulses inside it.
 */
const NUDGE_SECONDS = 2.7;
/** One expand-and-fade. Three of these fit inside the window above. */
const NUDGE_CYCLE = 0.9;

export class Hud {
  private insets: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  /**
   * Run clock at which each buy first became affordable, or undefined.
   *
   * The buys have been on screen, priced and dimmed, since the day they were
   * added, and the dimming was doing the whole job of saying "not yet". Nothing
   * said "now", so a player watching the level rather than the bottom of the
   * screen never learned the buttons were for using at all. Reported from a
   * phone, as not knowing the buttons were to be used.
   *
   * Set once per slot per run and never cleared, so a slot pulses the first
   * time it comes within reach and not again every time the purse crosses back
   * over the price. Once is instruction; every time is a flashing button.
   */
  private nudgedAt: number[] = [];
  /** Whether the use button has already announced itself this run. */
  private useNudgedAt: number | null = null;
  /** Last run clock seen, so a rewind can be read as a new run. */
  private nudgeClock = 0;

  /** Which gate the card is currently about, and when it came up. */
  private gateShownFor: number | null = null;
  private gateOpenedAt = 0;
  /**
   * Whether the card was drawn on the last frame.
   *
   * Read by the loop to decide whether its rows are tappable. A hit target that
   * outlives what it belongs to would answer a gate nobody can see.
   */
  gateCardVisible = false;

  /**
   * Top of the play area, which the input layer needs to place the gate rows.
   *
   * Read from the HUD rather than recomputed, because it depends on the safe
   * area insets and those are re-read on every resize. Two copies would agree
   * until somebody rotated a phone with a notch.
   */
  get playTop(): number {
    return this.insets.top + BAR_HEIGHT;
  }
  private probe: HTMLDivElement | null = null;

  /**
   * How long ago each buy became affordable, or -1 for never yet.
   *
   * Computed once a frame and handed to whichever of the three layouts is
   * drawing, so the pads arc, the thumb strip and the keyboard row all pulse on
   * the same rule rather than each deciding for itself.
   */
  private nudges(state: RunState): number[] {
    // A rewound clock is a new run, and the only signal available here that the
    // previous run's history has stopped applying.
    if (state.time < this.nudgeClock) {
      this.nudgedAt = [];
      this.useNudgedAt = null;
    }
    this.nudgeClock = state.time;

    return CONSUMABLES.map((item, index) => {
      if (state.purse.held < item.cost) return -1;

      const at = this.nudgedAt[index] ?? state.time;
      this.nudgedAt[index] = at;
      return state.time - at;
    });
  }

  /** Re-read on every resize, since rotating a phone changes the insets. */
  measure(): void {
    if (!this.probe) {
      const probe = document.createElement('div');
      probe.style.cssText = [
        'position:fixed',
        'visibility:hidden',
        'pointer-events:none',
        'top:0',
        'left:0',
        'padding-top:env(safe-area-inset-top)',
        'padding-right:env(safe-area-inset-right)',
        'padding-bottom:env(safe-area-inset-bottom)',
        'padding-left:env(safe-area-inset-left)',
      ].join(';');
      document.body.appendChild(probe);
      this.probe = probe;
    }

    const style = getComputedStyle(this.probe);
    this.insets = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    input: Input,
    width: number,
    height: number,
  ): void {
    const top = this.insets.top;
    const padX = 16 + Math.max(this.insets.left, this.insets.right);
    // Once a frame, before any of the three layouts draw, so they all pulse on
    // the same rule and the same clock.
    const nudges = this.nudges(state);

    ctx.save();

    // One solid ink strip across the top. Everything readable sits on it.
    ctx.fillStyle = theme.ink;
    ctx.fillRect(0, 0, width, top + BAR_HEIGHT);

    ctx.textBaseline = 'middle';
    const mid = top + BAR_HEIGHT / 2;

    const tickerRight = this.drawTicker(ctx, state, padX, mid);
    this.drawClock(ctx, state, width, mid);
    this.drawHull(ctx, state, width - padX, mid);
    /*
     * The purse sits with the things it buys, not across the strip from them.
     *
     * It used to live beside the hull bar on the far right while the slots were
     * on the far left, so the two halves of one idea were as far apart as the
     * screen allows and nothing suggested they were related. Money belongs next
     * to the price tags.
     */
    const scripRight = this.drawScrip(ctx, state, tickerRight + 18, mid);
    // Clear of the ticker block, which owns the left of the strip. The offset
    // is the ticker's own width plus a gap, measured once rather than guessed:
    // the ticker is at most five characters of 17px mono.
    // The reads take the slots over while you are at a node, so only one of
    // these two ever draws and the numbers under your thumb always mean one
    // thing. See the matching branch in main.ts.
    /*
     * The priced row is for a keyboard, and only for a keyboard.
     *
     * On a phone the same four buys are drawn as pucks beside the fire button,
     * where a thumb can actually reach them. Drawing both put an identical set
     * of controls at the top of the screen that cannot be pressed while playing,
     * and the reasonable question that follows is how anybody is meant to use
     * them. They are not: those are the keyboard's, these are the thumb's.
     */
    if (!touchCapable() && state.openNodeId === null && state.openGateId === null) {
      this.drawSlots(ctx, state, scripRight + 14, mid, nudges);
    }
    this.drawCargo(ctx, state, width / 2, mid);
    this.drawAlert(ctx, state, width, top + BAR_HEIGHT);
    this.drawReadTally(ctx, state, padX, top + BAR_HEIGHT + 16);
    this.drawAssistMark(ctx, state, width - padX, top + BAR_HEIGHT + 16);
    this.drawHint(ctx, state, width / 2, top + BAR_HEIGHT + 62);
    this.drawRead(ctx, state, width, top + BAR_HEIGHT);
    this.drawGate(ctx, state, width, top + BAR_HEIGHT, height);
    // A city has no progress along a line, so it gets a map instead.
    if (state.rings) this.drawRingMap(ctx, state, width, height);
    else if (state.city) this.drawMap(ctx, state, width, height);
    else this.drawProgress(ctx, state, width, top + BAR_HEIGHT);
    /*
     * Where the carried count goes, which is not next to the thumb.
     *
     * The bottom left corner is contested: the movement pad wants it, the map
     * wants it, and this wants it. Stacking them worked arithmetically and
     * still put a status readout inside the zone the left hand lives in, on top
     * of the control that matters most. Lifting it higher only pushes it
     * further into the level.
     *
     * On a touch device it moves to the top strip instead, into the space the
     * four buys used to occupy before they went to the thumb. That is where
     * every other status already is, and it is the one part of the screen no
     * hand covers. Desktop keeps the corner: there are no thumbs there, and the
     * strip is still holding the priced row.
     */
    if (touchCapable()) {
      this.drawCarrying(ctx, state, scripRight + 14, mid);
    } else {
      // No clearance to leave any more. This used to be lifted by the height of
      // whichever map was drawn, back when both of them sat in this corner.
      this.drawCarrying(ctx, state, padX, height - this.insets.bottom - 26);
    }
    this.drawStick(ctx, input);
    this.drawPads(ctx, state, input, width, height, nudges);
    this.drawSlotStrip(ctx, state, input, width, height, nudges);
    this.drawUse(ctx, state, input, width, height);

    ctx.restore();
  }

  /** The real ticker, in mono, because it came from somewhere real. */
  private drawTicker(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    x: number,
    mid: number,
  ): number {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent;
    ctx.font = `700 17px ${MONO}`;
    ctx.fillText(state.mission.ticker, x, mid - 7);

    ctx.fillStyle = state.mission.live ? theme.canvas : theme.inkFaint;
    ctx.font = `500 11px ${MONO}`;
    // Blank on a practice mission: the ticker above already reads PRACTICE, and
    // printing it twice in a two-line block is just a stutter.
    const sub = state.mission.live ? `${state.mission.changePct.toFixed(1)}%` : '';
    if (sub) ctx.fillText(sub, x, mid + 10);

    /*
     * Hand back the right edge, measured.
     *
     * Everything to the right used to start at a fixed offset that assumed a
     * short ticker. A practice mission's ticker is the word PRACTICE, which is
     * twice as wide as PUMP, so the scrip block landed on top of it and the
     * strip read as two overlapping words. Measuring costs nothing and the
     * guess was only ever right for the tickers we happened to test with.
     */
    ctx.font = `700 17px ${MONO}`;
    const tickerWidth = ctx.measureText(state.mission.ticker).width;
    ctx.font = `500 11px ${MONO}`;
    return x + Math.max(tickerWidth, ctx.measureText(sub).width);
  }

  /** Centre, mono, big. The clock is the pressure. */
  private drawClock(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    width: number,
    mid: number,
  ): void {
    const left = state.timeLeft;
    const warning = left <= CLOCK_WARNING;
    // A pulse rather than a beep. A game inside a wallet should not make noise
    // the user did not ask for.
    const pulse = warning ? 0.65 + Math.abs(Math.sin(state.time * 5)) * 0.35 : 1;

    ctx.globalAlpha = pulse;
    ctx.fillStyle = warning ? theme.danger : theme.canvas;
    ctx.font = `700 26px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(formatClock(left), width / 2, mid);
    ctx.globalAlpha = 1;
  }

  private drawHull(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    right: number,
    mid: number,
  ): void {
    const width = 96;
    const height = 9;
    const x = right - width;
    const fraction = Math.max(0, state.player.health / PLAYER_MAX_HEALTH);

    ctx.fillStyle = 'rgba(244, 237, 224, 0.22)';
    ctx.beginPath();
    ctx.roundRect(x, mid - 2, width, height, 4.5);
    ctx.fill();

    ctx.fillStyle = fraction > 0.3 ? theme.canvas : theme.danger;
    ctx.beginPath();
    ctx.roundRect(x, mid - 2, Math.max(3, width * fraction), height, 4.5);
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.fillStyle = theme.inkFaint;
    ctx.font = `600 10px ${MONO}`;
    ctx.fillText('HULL', right, mid - 11);
  }

  /**
   * What you have scavenged, in the day's own ticker.
   *
   * Sits beside the hull because the two are the same kind of information:
   * what you have left to spend on staying alive. Denominated in the ticker
   * rather than in a made-up coin name, because the whole point is that this
   * is the token that wrecked the day.
   */
  private drawScrip(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    left: number,
    mid: number,
  ): number {
    const purse = state.purse;

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.inkFaint;
    ctx.font = `600 9px ${MONO}`;
    ctx.fillText(purse.ticker, left, mid - 11);

    // Held, not collected. What is spendable right now is the only number a
    // player can act on mid-run. Accent rather than paper once there is
    // something to spend, so the moment it becomes useful is visible.
    ctx.fillStyle = purse.held > 0 ? theme.accent : theme.inkFaint;
    ctx.font = `700 18px ${MONO}`;
    const shown = String(purse.held);
    ctx.fillText(shown, left, mid + 8);

    // Hand the right edge back, so the slots sit against it rather than at a
    // guessed offset that drifts the moment the number gets a fourth digit.
    return left + Math.max(30, ctx.measureText(shown).width);
  }

  /**
   * The three things scrip buys, always on screen, never a menu.
   *
   * A run is 110 seconds, so a shop you open and close would eat a tenth of it.
   * These sit in the strip with their price showing: affordable ones are lit,
   * the rest are dimmed, and the number on the left is the key that buys it.
   * Nothing to open, nothing to close, nothing to learn beyond "1 is a bomb".
   */
  private drawSlots(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    left: number,
    mid: number,
    nudges: readonly number[],
  ): void {
    const held = state.purse.held;
    const boxW = 62;
    const gap = 6;

    CONSUMABLES.forEach((item, index) => {
      const x = left + index * (boxW + gap);
      const affordable = held >= item.cost;

      ctx.globalAlpha = affordable ? 1 : 0.34;

      ctx.strokeStyle = theme.canvas;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, mid - 12, boxW, 26, 5);
      ctx.stroke();

      // The key that buys it, in its own corner, so the binding never has to
      // be explained anywhere else.
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.inkFaint;
      ctx.font = `700 9px ${MONO}`;
      ctx.fillText(String(index + 1), x + 5, mid - 3);

      ctx.textAlign = 'center';
      ctx.fillStyle = theme.canvas;
      ctx.font = `700 10px ${MONO}`;
      ctx.fillText(item.label, x + boxW / 2 + 4, mid - 2);

      ctx.fillStyle = affordable ? theme.accent : theme.inkFaint;
      ctx.font = `600 10px ${MONO}`;
      ctx.fillText(String(item.cost), x + boxW / 2 + 4, mid + 10);

      /*
       * And the same announcement the thumb layouts get, in this row's shape.
       *
       * A rounded box rather than a ring, because a circle drawn around a
       * 62 by 26 plate reads as a smudge rather than as a pulse coming off the
       * thing it belongs to. Same timing, same reason, different geometry.
       */
      const since = nudges[index] ?? -1;
      if (since >= 0 && since < NUDGE_SECONDS) {
        const phase = (since % NUDGE_CYCLE) / NUDGE_CYCLE;
        const grow = phase * 7;

        ctx.globalAlpha = (1 - phase) * (1 - since / NUDGE_SECONDS) * 0.95;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x - grow, mid - 12 - grow, boxW + grow * 2, 26 + grow * 2, 5 + grow);
        ctx.stroke();
      }
    });

    ctx.globalAlpha = 1;
  }

  /**
   * Cargo health, centred under the clock.
   *
   * Given the middle of the strip because on an escort stage it is the number
   * that decides the run: a player can finish on one per cent hull and still
   * clear, and cannot finish at all if this reaches zero. It sits under the
   * clock rather than beside the hull so the two health bars are never confused
   * for each other at a glance.
   */
  private drawCargo(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    centre: number,
    mid: number,
  ): void {
    const convoy = state.convoy;
    if (!convoy) return;

    const width = 110;
    const fraction = Math.max(0, convoy.health / CONVOY_MAX_HEALTH);
    const left = centre - width / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(244, 237, 224, 0.22)';
    ctx.fillRect(left, mid + 14, width, 5);
    ctx.fillStyle = fraction > 0.35 ? theme.rescue : theme.danger;
    ctx.fillRect(left, mid + 14, width * fraction, 5);

    ctx.textAlign = 'center';
    ctx.font = `600 9px ${MONO}`;
    // Named only when it needs attention, so the strip stays quiet otherwise.
    if (convoy.arrived) {
      ctx.fillStyle = theme.rescue;
      ctx.fillText('CARGO THROUGH', centre, mid + 30);
    } else if (convoy.blocked) {
      // Why it will not move, said plainly. A vehicle that stops dead against
      // a slope reads as a bug unless the game admits it is a slope.
      ctx.fillStyle = theme.danger;
      ctx.fillText('TOO STEEP', centre, mid + 30);
    } else if (state.driving) {
      ctx.fillStyle = theme.accent;
      ctx.fillText('DRIVING', centre, mid + 30);
    } else if (convoy.stalled) {
      ctx.fillStyle = theme.inkFaint;
      ctx.fillText('CARGO PARKED', centre, mid + 30);
    } else {
      ctx.fillStyle = theme.inkFaint;
      ctx.fillText('CARGO', centre, mid + 30);
    }
    ctx.restore();
  }

  /**
   * How close the level is to noticing, as a bar under the strip.
   *
   * Sits directly above the progress rule so the two read as one instrument.
   * Absent entirely on a stage without sight rather than shown empty: a meter
   * that never moves teaches a player to stop looking at that part of the
   * screen, and stage four needs them looking.
   */
  /**
   * One rule, restated at the moment it starts to matter.
   *
   * Placed under the pause control rather than beside anything. That band is
   * the only part of the screen with nothing permanent in it: the strip owns
   * the top, the read tally and the assist mark sit at the far left and right
   * of the row above this, and the maps and pads own the bottom. The node and
   * gate cards do come through here, which is why hints.ts stands down whenever
   * one is open rather than this trying to dodge them.
   */
  private drawHint(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    centre: number,
    y: number,
  ): void {
    const hint = hintFor(state);
    if (!hint) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 10px ${MONO}`;

    const width = ctx.measureText(hint.text).width + 22;
    const height = 22;

    ctx.globalAlpha = hint.alpha * 0.82;
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.roundRect(centre - width / 2, y - height / 2, width, height, 5);
    ctx.fill();

    ctx.globalAlpha = hint.alpha;
    ctx.fillStyle = theme.canvas;
    ctx.fillText(hint.text, centre, y + 0.5);

    ctx.restore();
  }

  private drawAlert(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    width: number,
    y: number,
  ): void {
    if (!state.stage.sight) return;
    if (state.alert <= 0) return;

    const angry = alerted(state);
    ctx.save();
    ctx.globalAlpha = angry ? 0.95 : 0.7;
    ctx.fillStyle = angry ? theme.danger : theme.accent;
    ctx.fillRect(0, y, width * state.alert, 3);

    if (angry) {
      // Named only once it means something. A label on a half-full meter is
      // noise; a label on a full one is the reason the level got louder.
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.danger;
      ctx.font = `700 10px ${MONO}`;
      ctx.fillText('SEEN', width / 2, y + 15);
    }
    ctx.restore();
  }

  /**
   * Which aim tier is live, top right, small.
   *
   * An earned advantage the player cannot see is not an advantage they know they
   * have, and worse, a staked run silently pinning them back to the baseline
   * would feel like the gun had got worse for no reason. Naming the tier means
   * both facts are visible at the moment they matter.
   *
   * Nothing at all when it is off, because a label reading OFF is noise.
   */
  private drawAssistMark(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    right: number,
    y: number,
  ): void {
    if (state.assist <= 0) return;

    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = `700 10px ${MONO}`;
    ctx.fillStyle = theme.inkFaint;
    ctx.fillText(`AIM ${assistTier(state.assist).label.toUpperCase()}`, right, y);
    ctx.restore();
  }

  /**
   * How many reads are left, and therefore whether the way out is shut.
   *
   * The exit refusing to open is the kind of thing a player blames on a bug
   * rather than on themselves, so the count is on screen for the whole run and
   * it says EXIT OPEN the moment the last one lands. Nothing about the
   * objective should have to be inferred from a door that will not work.
   */
  private drawReadTally(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    x: number,
    y: number,
  ): void {
    if (state.nodes.length === 0) return;
    // Suppressed while the question is up, which is drawn directly beneath it.
    if (state.openNodeId !== null) return;

    const done = state.nodesCaptured >= state.nodes.length;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = `700 12px ${MONO}`;
    ctx.fillStyle = done ? theme.accent : theme.ink;
    ctx.fillText(
      done ? 'EXIT OPEN' : `READS ${state.nodesCaptured}/${state.nodes.length}`,
      x,
      y,
    );
    ctx.restore();
  }

  /**
   * The question, when you are standing at a node.
   *
   * Anchored under the strip rather than above the thumbs, which is where a
   * panel this size wants to go and where it would sit directly on top of the
   * stick, the trigger and the map. Reading is the one moment in the game you
   * are not moving, so taking the top of the screen for it costs nothing.
   *
   * Every row is a real post. The handle is the account that actually sent it
   * and the line under it is the post's own summary from the Dispatch, so
   * nothing on this panel is a sentence written for the game.
   */
  private drawRead(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    width: number,
    top: number,
  ): void {
    if (state.openNodeId === null) return;
    const node = state.nodes.find((n) => n.id === state.openNodeId);
    if (!node) return;

    const cardW = Math.min(width - 24, 620);
    const x = (width - cardW) / 2;
    const rowH = 44;
    const headH = 34;
    const cardH = headH + node.options.length * rowH + 10;
    /*
     * Below the pause button, not under it.
     *
     * The pause control is a DOM overlay centred at the top of the play area:
     * `.hud-overlay` sits at inset-top + 54 and the button is 32 tall, so it
     * occupies inset-top + 54 through 86. `top` here is the bottom of the ink
     * strip, which is inset-top + 46. At the fourteen pixel gap the rest of the
     * HUD uses, the card's header ran straight underneath it and the pause glyph
     * landed in the middle of the question.
     *
     * Forty-eight clears the button by eight. Derived from those two numbers
     * rather than nudged until it looked right, so moving the pause button moves
     * this with it instead of quietly recreating the overlap.
     */
    const y = top + 48;

    ctx.save();

    ctx.fillStyle = theme.ink;
    ctx.globalAlpha = 0.93;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 10);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 10);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent;
    ctx.font = `700 12px ${MONO}`;
    ctx.fillText('WHICH POST EXPLAINS TODAY?', x + 14, y + 21);

    // Says what a wrong one does, at the moment you are about to press one.
    // The cost of a bad read is the whole design of the stage, so it is stated
    // rather than discovered.
    ctx.textAlign = 'right';
    ctx.fillStyle = node.missed > 0 ? theme.danger : theme.inkFaint;
    ctx.font = `600 10px ${MONO}`;
    ctx.fillText(node.missed > 0 ? 'WRONG ONCE' : 'WRONG WAKES THEM', x + cardW - 14, y + 21);

    node.options.forEach((option, index) => {
      const rowY = y + headH + index * rowH;

      // The key, boxed, matching the slot boxes it is standing in for.
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x + 12, rowY + 8, 22, 22, 5);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = theme.accent;
      ctx.font = `700 12px ${MONO}`;
      ctx.fillText(String(index + 1), x + 23, rowY + 23);

      ctx.textAlign = 'left';
      ctx.fillStyle = theme.canvas;
      ctx.font = `700 12px ${MONO}`;
      ctx.fillText(`@${option.post.handle}`, x + 44, rowY + 18);

      ctx.fillStyle = theme.inkFaint;
      ctx.font = `500 11px ${MONO}`;
      ctx.fillText(clip(ctx, option.post.summary, cardW - 60), x + 44, rowY + 33);
    });

    ctx.restore();
  }

  /**
   * The gate's question, when you are standing at one.
   *
   * Same shape and same position as stage six's read panel, because it is the
   * same act: a question in the strip, answered with the four numbered slots.
   * Two visually different question panels would teach a player nothing twice.
   *
   * Only the tickers are printed. What each one is worth was learned out in the
   * level, and printing it here would answer the question for them.
   */
  private drawGate(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    width: number,
    top: number,
    height: number,
  ): void {
    this.gateCardVisible = false;

    if (state.openGateId === null) {
      this.gateShownFor = null;
      return;
    }
    const gate = state.gates.find((g) => g.id === state.openGateId);
    if (!gate) return;

    /*
     * Up when it is useful, not for the whole run.
     *
     * On the ring city a gate is open for the entire band outside its wall,
     * which is most of a stage. That is right for answering, because circling a
     * wall looking for the gap should not cost you the ability to answer it. It
     * is wrong for drawing: the card sat over the level from the moment you
     * entered a band until you left it, and was reported as blocking the game.
     *
     * So it shows when you arrive at a wall, which is when you need to read the
     * question, and again whenever you are near the gap, which is where you act
     * on it. In between it gets out of the way and the ring map carries the
     * place. Answering is untouched: the keys and the taps work whether the card
     * is drawn or not.
     */
    if (this.gateShownFor !== gate.id) {
      this.gateShownFor = gate.id;
      this.gateOpenedAt = state.time;
    }

    const justArrived = state.time - this.gateOpenedAt < GATE_CARD_SECONDS;
    if (!justArrived && !nearGap(state, gate)) return;

    this.gateCardVisible = true;

    /*
     * Compact, and you can see through it.
     *
     * It was 620 wide by roughly 130 tall, sitting in the middle of the screen
     * at nearly full opacity. On a landscape phone that is a third of the view,
     * over the exact band the player and whatever is shooting at them occupy,
     * and it is up for as long as you stand at a gate. Reported as blocking the
     * game, which it was.
     *
     * The rows are short: a ticker and two words. Nothing here needed the width
     * it was taking. Narrower, tighter rows and enough transparency to track
     * something moving behind it costs nothing in legibility and hands most of
     * that band back.
     */
    // Room for the price line when there is one to show.
    const unknownCount = gate.options.filter((id) => {
      const ally = state.allies.find((a) => a.id === id);
      return ally !== undefined && !ally.known;
    }).length;

    /*
     * Laid out in core/gatecard.ts, which the input layer reads too.
     *
     * The rows are tappable, so where they are drawn and where a tap counts
     * have to be the same rectangle. Two copies of that arithmetic agreeing by
     * coincidence is how a hit target ends up a few pixels off the thing it
     * belongs to.
     */
    const layout = gateCardLayout({
      width,
      height,
      top,
      optionCount: gate.options.length,
      hasReadLine: unknownCount > 0,
    });

    const { x, y, headH, rowH, short } = layout;
    const cardW = layout.width;
    const cardH = layout.height;

    ctx.save();

    ctx.fillStyle = theme.ink;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 10);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 10);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent;
    ctx.font = `700 ${short ? 10 : 11}px ${MONO}`;
    ctx.fillText(gateQuestion(gate, state.mission.ticker), x + 12, y + (short ? 16 : 18));

    /*
     * The warning drops on a narrow card rather than being squeezed.
     *
     * At 320 wide it would run into the question, and the question is the thing
     * somebody is standing there to read. The consequence is already learned
     * the first time it happens, and a wrong answer still says so.
     */
    if (!short || cardW > 300) {
      ctx.textAlign = 'right';
      ctx.fillStyle = gate.missed > 0 ? theme.danger : theme.inkFaint;
      ctx.font = `600 ${short ? 9 : 10}px ${MONO}`;
      ctx.fillText(
        gate.missed > 0 ? 'WRONG ONCE' : short ? 'WRONG WAKES' : 'WRONG WAKES THEM',
        x + cardW - 12,
        y + (short ? 16 : 18),
      );
    }

    /*
     * The price of a read, when there is anything left to buy.
     *
     * Printed on the panel rather than left to be discovered, because a player
     * standing at a wall they cannot answer needs to know there is a way out of
     * it that is not guessing. Only shown when it would actually do something:
     * offering to sell somebody what they already know is worse than silence.
     */
    const unknown = gate.options.filter((id) => {
      const ally = state.allies.find((a) => a.id === id);
      return ally !== undefined && !ally.known;
    }).length;

    if (unknown > 0) {
      const affordable = state.purse.held >= READ_COST;
      ctx.textAlign = 'center';
      ctx.fillStyle = affordable ? theme.accent : theme.inkFaint;
      ctx.font = `700 10px ${MONO}`;
      ctx.fillText(
        `E  READ THE ${unknown === 1 ? 'ONE' : String(unknown)} YOU SKIPPED   ${READ_COST} ${state.purse.ticker}`,
        x + cardW / 2,
        y + cardH - 9,
      );
    } else {
      /*
       * How to answer, in the space the read offer is not using.
       *
       * The rows are numbered and tappable and nothing said so. On a keyboard
       * the numbers are a fair guess; on a phone there is no keyboard and the
       * numbers read as decoration, so a player who knew the answer still had
       * to discover that the row itself was the button.
       */
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.inkFaint;
      ctx.font = `600 9px ${MONO}`;
      ctx.fillText(
        usingPads() ? 'TAP THE ONE YOU MEAN' : 'PRESS ITS NUMBER, OR TAP IT',
        x + cardW / 2,
        y + cardH - 8,
      );
    }

    gate.options.forEach((id, index) => {
      const ally = state.allies.find((a) => a.id === id);
      if (!ally) return;
      const rowY = y + headH + index * rowH;

      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x + 12, rowY + 5, 22, 22, 5);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = theme.accent;
      ctx.font = `700 12px ${MONO}`;
      ctx.fillText(String(index + 1), x + 23, rowY + 17);

      ctx.textAlign = 'left';
      ctx.fillStyle = theme.canvas;
      ctx.font = `700 13px ${MONO}`;
      ctx.fillText(ally.ticker, x + 44, rowY + 17);

      /*
       * What you learned, given back to you.
       *
       * ## Why this is not giving away the answer
       *
       * The card used to show four tickers and nothing else, on the reasoning
       * that printing the figures would answer the question. That reasoning
       * holds for a project you flew past and it is wrong for one you went to.
       * The stage is gated on having looked, not on having memorised: you were
       * told the move once, in a toast, minutes ago, in the middle of a fight,
       * and then asked to rank four of them from memory. That is a different
       * game to the one the stage is designed as, and it plays as guessing.
       *
       * Reported exactly that way: cleared it without knowing what I did.
       *
       * So a project you reached shows its move, and one you skipped still
       * shows nothing. The question stays a real question whenever you missed
       * somebody, which is the consequence the design wants, and going to all
       * four now actually pays for itself.
       */
      ctx.textAlign = 'right';
      if (ally.known) {
        const move = `${ally.changePct >= 0 ? '+' : ''}${ally.changePct.toFixed(1)}%`;
        ctx.fillStyle = ally.changePct >= 0 ? theme.rescue : theme.danger;
        ctx.font = `700 12px ${MONO}`;
        ctx.fillText(move, x + cardW - 16, rowY + 17);
      } else {
        ctx.fillStyle = theme.inkFaint;
        ctx.font = `600 10px ${MONO}`;
        ctx.fillText('never asked', x + cardW - 16, rowY + 17);
      }
    });

    ctx.restore();
  }

  /**
   * The ring city, small, in the corner.
   *
   * Not optional. The view shows about a quarter of the ring city's width, so
   * from inside it you see one curved wall and no way to tell it is one of
   * several, or which side of it you are on. The stage is built on working
   * inward and without this there is nothing to work inward BY.
   *
   * It shows the walls, which ones are still shut, where the openings are, and
   * where you are. The gap markers matter most: hunting for the way through is
   * the movement of the whole stage, and hunting blind is not a puzzle, it is a
   * chore.
   */
  private drawRingMap(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    width: number,
    height: number,
  ): void {
    const rings = state.rings;
    if (!rings) return;

    const cramped = height < 520;
    const size = cramped ? 96 : 124;
    const scale = size / rings.width;
    const { x, y } = mapCorner(this.insets, width, size);

    const cx = x + rings.cx * scale;
    const cy = y + rings.cy * scale;

    ctx.save();
    ctx.globalAlpha = 0.92;

    ctx.fillStyle = theme.ink;
    ctx.fillRect(x - 3, y - 3, size + 6, size + 6);
    ctx.fillStyle = theme.canvas;
    ctx.fillRect(x, y, size, size);

    for (const ring of rings.rings) {
      const r = ring.radius * scale;

      // A shut wall is solid and loud. An answered one is a faint rule, so the
      // eye goes to what is still in the way.
      ctx.strokeStyle = ring.locked ? theme.danger : theme.hairline;
      ctx.lineWidth = ring.locked ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, ring.gapAt + ring.gapHalf, ring.gapAt - ring.gapHalf + Math.PI * 2);
      ctx.stroke();

      /*
       * The opening, marked.
       *
       * A gap this small is a couple of pixels of missing arc and invisible at
       * this scale, so it gets its own dot. Without it the map shows walls and
       * no doors, which tells a player they are trapped rather than where to go.
       */
      if (ring.locked) {
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ring.gapAt) * r, cy + Math.sin(ring.gapAt) * r, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The core, which is the way out.
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, rings.coreRadius * scale), 0, Math.PI * 2);
    ctx.fill();

    // Projects still to be asked, so the detour is findable.
    ctx.fillStyle = theme.rescue;
    for (const ally of state.allies) {
      if (ally.known) continue;
      ctx.beginPath();
      ctx.arc(x + ally.x * scale, y + ally.y * scale, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // You, last and brightest.
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(x + state.player.x * scale, y + state.player.y * scale, 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * The city, small, in the corner.
   *
   * A chart run needs no map: there is one direction and a bar under the strip
   * tells you how far along it you are. A city has no "along". Without a map
   * you are not exploring a place, you are lost in corridors, and the first
   * thing anyone asked after walking one was where they were meant to go.
   *
   * Deliberately shows the LAYOUT and the exit, not the attackers. A map that
   * marks every threat replaces the game with a radar display and makes the
   * corners it is built from meaningless. It answers where am I and where is
   * the way out, and nothing else.
   */
  private drawMap(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    width: number,
    height: number,
  ): void {
    const city = state.city;
    if (!city) return;

    const size = height < 520 ? 96 : 118;
    const scale = size / Math.max(city.width, city.height);
    const w = city.width * scale;
    const h = city.height * scale;

    const { x, y } = mapCorner(this.insets, width, w);

    ctx.save();
    ctx.globalAlpha = 0.9;

    ctx.fillStyle = theme.ink;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = theme.canvas;
    ctx.fillRect(x, y, w, h);

    // Buildings as solid ink, so the streets read as the negative space.
    ctx.fillStyle = 'rgba(20, 17, 14, 0.55)';
    for (const b of city.blocks) {
      ctx.fillRect(x + b.x * scale, y + b.y * scale, b.w * scale, b.h * scale);
    }

    /*
     * Punch the interiors back out.
     *
     * The walls are drawn as blocks above, so a hollow building comes out as a
     * solid smudge at this scale and looks exactly like one you cannot enter.
     * Clearing the floor is what makes the map answer "which of these can I get
     * into", which is the question the refills inside them create.
     */
    ctx.fillStyle = theme.canvas;
    for (const room of city.rooms) {
      ctx.fillRect(x + room.x * scale, y + room.y * scale, room.w * scale, room.h * scale);
    }

    // Anyone still to be got out, so a map answers "what is left" as well as
    // "where am I". Caged and free are drawn alike: both are somebody waiting.
    ctx.fillStyle = theme.rescue;
    for (const face of state.faces) {
      if (face.state !== 'trapped') continue;
      ctx.beginPath();
      ctx.arc(x + face.x * scale, y + face.y * scale, isCaged(face) ? 3 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    /*
     * Reads still open, as hollow squares.
     *
     * These are the objective on the stage that has them, and a node is a fixed
     * panel on a wall rather than a person who might have moved, so hiding them
     * would just mean walking every street twice. Squares against the circles
     * everything else uses, because the map is two colours and shape is the
     * only thing left to tell them apart with.
     */
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.6;
    for (const node of state.nodes) {
      if (node.captured) continue;
      ctx.strokeRect(x + node.x * scale - 3, y + node.y * scale - 3, 6, 6);
    }

    // The way out.
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + city.exitX * scale, y + city.exitY * scale, 4.5, 0, Math.PI * 2);
    ctx.stroke();

    // You, last and brightest.
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(x + state.player.x * scale, y + state.player.y * scale, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * How much of the chart is behind you, as a rule under the strip. The only
   * way to know how far extraction is without a minimap, and it costs one rect.
   */
  private drawProgress(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    width: number,
    y: number,
  ): void {
    const fraction = Math.min(1, Math.max(0, state.player.x / state.extractionX));

    ctx.fillStyle = theme.accentPale;
    ctx.fillRect(0, y, width, 4);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(0, y, width * fraction, 4);
  }

  /** One tick per person aboard. No empty slots, which would imply a quota. */
  private drawCarrying(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    x: number,
    y: number,
  ): void {
    const carried = state.faces.filter((f) => f.state === 'following');
    if (carried.length === 0) return;

    const width = 16 + carried.length * 22 + 62;

    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.roundRect(x, y - 16, width, 32, 16);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.inkFaint;
    ctx.font = `600 10px ${MONO}`;
    ctx.fillText('ABOARD', x + 14, y);

    carried.forEach((_, index) => {
      ctx.fillStyle = theme.rescue;
      ctx.beginPath();
      ctx.arc(x + 76 + index * 22, y, 8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /**
   * Both floating sticks, drawn wherever the thumbs actually went down.
   *
   * The right one gets an arrow, because it reports a direction rather than a
   * position and a bare puck would not say which way the gun is pointing. It
   * is drawn in the accent so the two thumbs are never confused for each
   * other mid-fight.
   */
  private drawStick(ctx: CanvasRenderingContext2D, input: Input): void {
    if (usingPads()) return;
    if (input.stick) drawPuck(ctx, input.stick, theme.ink, false);
    if (input.aimStick) drawPuck(ctx, input.aimStick, theme.accent, true);
  }

  /** The phone's equivalent of E, drawn from the same region input hit-tests. */
  private drawUse(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    input: Input,
    width: number,
    height: number,
  ): void {
    if (!touchCapable() || !input.useVisible) {
      // Out of reach again, so the next car gets its own announcement. Unlike
      // the buys, this button comes and goes with what is in front of the
      // player, and a car found ten streets later is a new thing to point at.
      this.useNudgedAt = null;
      return;
    }

    const region = useRegion(width, height);
    const label = state.driving ? 'EXIT' : state.city ? 'DRIVE' : 'READ';

    // Only the arrival is worth a pulse. Once somebody is at the wheel the
    // button says EXIT and they have already learned what it is for.
    if (this.useNudgedAt === null) this.useNudgedAt = state.time;
    if (!state.driving) drawNudge(ctx, region, state.time - this.useNudgedAt);

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(region.x, region.y, region.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'center';
    ctx.font = `800 11px ${MONO}`;
    ctx.fillText(label, region.x, region.y + 1);
    ctx.restore();
  }

  /**
   * The fixed pads, for players who chose them.
   *
   * Drawn from the same layout the input layer hit-tests, so a button cannot
   * be pressed anywhere other than where it appears. See core/pads.ts.
   *
   * Deliberately low contrast. These sit on top of the level for the whole run
   * and a control that shouts is a control that is in the way; they are there
   * to be found by a thumb, not read.
   */
  private drawPads(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    input: Input,
    width: number,
    height: number,
    nudges: readonly number[],
  ): void {
    if (!usingPads()) return;

    // From the input layer's count, not from the table, so the thing drawn and
    // the thing hit-tested can never be different numbers.
    const pads = padLayout(width, height, input.slotCount);
    ctx.save();

    if (snapsToDirections()) {
      drawDpad(ctx, pads.move, input.move);
    } else {
      drawRing(ctx, pads.move, input.move);
    }

    // Fire. The one control that gets the accent, because it is the one you
    // are looking for in a hurry.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(pads.fire.x, pads.fire.y, pads.fire.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.stroke();

    /*
     * Where the gun is pointing, on the button that points it.
     *
     * The fire pad aims as well as fires: push the thumb and the shot follows
     * the push. Nothing said so. drawStick, which draws the leaning puck on the
     * floating scheme, returns early when the pads are on, so the one scheme
     * built around a fixed button was the one with no aim readout at all.
     *
     * That is the whole point of a stick over a d-pad. You sweep the thumb
     * around and fire in every direction as you go, and you can only learn to
     * do that if the control shows you which direction you are asking for.
     */
    const aim = input.aimStick;
    if (aim) {
      const dx = aim.current.x - aim.origin.x;
      const dy = aim.current.y - aim.origin.y;
      const length = Math.hypot(dx, dy);

      if (length > 0.001) {
        const reach = Math.min(length, pads.fire.r * 0.6);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = theme.canvas;
        ctx.beginPath();
        ctx.arc(
          pads.fire.x + (dx / length) * reach,
          pads.fire.y + (dy / length) * reach,
          pads.fire.r * 0.34,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    /*
     * At a node these same buttons are the four answers.
     *
     * The hit regions do not move: main.ts already reroutes a slot press to the
     * open question, so the only thing that was wrong was the labelling. A phone
     * player saw pucks reading BOMB and 120 while the card above said 1 to 4, with
     * no indication the two were the same buttons. On a device with no keyboard
     * that made stage six unanswerable in practice.
     *
     * Reusing the pads rather than making the card's rows tappable is deliberate:
     * one set of coordinates that input and the renderer already agree on cannot
     * drift out of step, and the answer buttons land under the thumb that is
     * already there instead of at the top of the screen.
     */
    const reading = state.openNodeId !== null || state.openGateId !== null;
    if (reading) {
      const node = state.nodes.find((n) => n.id === state.openNodeId);
      const count = node?.options.length ?? 0;

      pads.slots.forEach((slot, index) => {
        if (index >= count) return;

        ctx.globalAlpha = 0.62;
        ctx.fillStyle = theme.canvas;
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, slot.r, 0, Math.PI * 2);
        ctx.fill();

        // Accent ring, because these are live choices rather than priced goods.
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = theme.ink;
        ctx.textAlign = 'center';
        ctx.font = `700 18px ${MONO}`;
        ctx.fillText(String(index + 1), slot.x, slot.y + 1);
      });

      ctx.restore();
      return;
    }

    drawBuys(ctx, state, pads.slots, nudges);

    ctx.restore();
  }

  /**
   * The same four buys, for the floating-stick scheme.
   *
   * Drawn across the bottom centre rather than on an arc, because the floating
   * scheme has no fire button to hang them off. See slotStrip for why that band
   * is the only part of a landscape screen a thumb is not already using.
   */
  private drawSlotStrip(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    input: Input,
    width: number,
    height: number,
    nudges: readonly number[],
  ): void {
    if (usingPads() || !touchCapable()) return;

    const regions = slotStrip(width, height, input.slotCount);
    if (regions.length === 0) return;

    ctx.save();

    // At a node or a gate these become the answers, exactly as the pad arc
    // does. main.ts reroutes a slot press to the open question either way, so
    // the only thing that has to change here is what is written on them.
    const node = state.nodes.find((n) => n.id === state.openNodeId);
    const reading = state.openNodeId !== null || state.openGateId !== null;

    if (reading) {
      const count = node?.options.length ?? 0;

      regions.forEach((slot, index) => {
        if (index >= count) return;

        ctx.globalAlpha = 0.62;
        ctx.fillStyle = theme.canvas;
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, slot.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = theme.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 18px ${MONO}`;
        ctx.fillText(String(index + 1), slot.x, slot.y + 1);
      });

      ctx.restore();
      return;
    }

    drawBuys(ctx, state, regions, nudges);
    ctx.restore();
  }
}

/**
 * The consumables, priced, and dimmed when they cannot be afforded so the thumb
 * learns which are live without reading anything.
 *
 * Takes the regions rather than the layout, because the two schemes put these
 * in different places and the only thing they disagree about is where.
 */
function drawBuys(
  ctx: CanvasRenderingContext2D,
  state: RunState,
  regions: readonly PadRegion[],
  nudges: readonly number[],
): void {
  regions.forEach((slot, index) => {
    const item = CONSUMABLES[index];
    if (!item) return;
    const affordable = state.purse.held >= item.cost;

    // Before the button, so the rings read as coming off it rather than
    // sitting on top of the price.
    drawNudge(ctx, slot, nudges[index] ?? -1);

    ctx.globalAlpha = affordable ? 0.55 : 0.22;
    ctx.fillStyle = theme.canvas;
    ctx.beginPath();
    ctx.arc(slot.x, slot.y, slot.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = affordable ? 0.9 : 0.4;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 9px ${MONO}`;
    ctx.fillText(item.label, slot.x, slot.y - 1);
    ctx.font = `600 9px ${MONO}`;
    ctx.fillText(String(item.cost), slot.x, slot.y + 10);
  });
}

/**
 * A ring or three, off a button that has just become worth pressing.
 *
 * The complaint this answers is not that first-timers cannot find the buys. It
 * is that nobody, on any run, was told the moment one went from unaffordable to
 * affordable, so the four buttons read as decoration for as long as a player
 * was looking anywhere else. Dimming says "not yet" and nothing said "now".
 *
 * Deliberately outside the button rather than on it. Anything drawn on top has
 * to compete with the label and the price, which are the two things somebody
 * looking at it needs to read.
 *
 * `since` is seconds since the button became live, or negative for never.
 */
function drawNudge(ctx: CanvasRenderingContext2D, region: PadRegion, since: number): void {
  if (since < 0 || since >= NUDGE_SECONDS) return;

  const phase = (since % NUDGE_CYCLE) / NUDGE_CYCLE;
  // Fades across the whole window as well as within each pulse, so the last
  // ring is a suggestion rather than stopping mid-shout.
  const fade = 1 - since / NUDGE_SECONDS;

  ctx.save();
  ctx.globalAlpha = (1 - phase) * fade * 0.95;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(region.x, region.y, region.r + 3 + phase * 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * The analog ring: an outer bound and a knob that goes where the thumb goes.
 *
 * The knob used to be drawn at the centre of the region and left there, which
 * made the whole control a picture of a stick rather than a stick. The ship was
 * moving, so the input was arriving, but nothing under the thumb acknowledged
 * it and the only reasonable reading is that the pad is broken. A stick that
 * does not lean is the one part of a touch scheme players check first.
 */
function drawRing(
  ctx: CanvasRenderingContext2D,
  region: PadRegion,
  move: { x: number; y: number },
): void {
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(region.x, region.y, region.r, 0, Math.PI * 2);
  ctx.stroke();

  // Clamped to the ring rather than to the vector, so a hard push sits on the
  // rim instead of climbing out of the control it belongs to.
  const reach = Math.min(1, Math.hypot(move.x, move.y)) * region.r * 0.62;
  const length = Math.hypot(move.x, move.y);
  const knobX = length > 0.001 ? region.x + (move.x / length) * reach : region.x;
  const knobY = length > 0.001 ? region.y + (move.y / length) * reach : region.y;

  ctx.globalAlpha = length > 0.001 ? 0.5 : 0.34;
  ctx.fillStyle = theme.ink;
  ctx.beginPath();
  ctx.arc(knobX, knobY, region.r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** Four arms, so it reads as on-or-off rather than as a stick. */
function drawDpad(
  ctx: CanvasRenderingContext2D,
  region: PadRegion,
  move: { x: number; y: number },
): void {
  const arm = region.r * 0.42;
  const thick = region.r * 0.34;

  // A d-pad does not lean, so it brightens instead. Same job as the knob: say
  // out loud that the press landed.
  const pressed = Math.hypot(move.x, move.y) > 0.001;

  ctx.globalAlpha = pressed ? 0.5 : 0.3;
  ctx.fillStyle = theme.ink;
  ctx.beginPath();
  ctx.roundRect(region.x - thick / 2, region.y - arm - thick / 2, thick, arm * 2 + thick, 6);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(region.x - arm - thick / 2, region.y - thick / 2, arm * 2 + thick, thick, 6);
  ctx.fill();
}

function drawPuck(
  ctx: CanvasRenderingContext2D,
  stick: StickView,
  colour: string,
  arrow: boolean,
): void {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 3;
  ctx.beginPath();
  // The rim is full thrust, so it is the same number the input uses. A ring
  // drawn at some other size is a dial with the wrong face on it.
  ctx.arc(stick.origin.x, stick.origin.y, STICK_FULL_TILT, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.4;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(stick.current.x, stick.current.y, 18, 0, Math.PI * 2);
  ctx.fill();

  if (arrow) {
    const dx = stick.current.x - stick.origin.x;
    const dy = stick.current.y - stick.origin.y;
    const length = Math.hypot(dx, dy);

    if (length > 6) {
      const angle = Math.atan2(dy, dx);
      ctx.globalAlpha = 0.85;
      ctx.translate(stick.current.x, stick.current.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(-3, -7);
      ctx.lineTo(-3, 7);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Cut a line to fit, with an ellipsis. Measured rather than counted, because a
 * post's summary is proportionally spaced text of no predictable width.
 */
function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let cut = text.length;
  while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}...`).width > maxWidth) cut--;
  return `${text.slice(0, cut).trimEnd()}...`;
}

/**
 * Is the player standing near the gap this gate guards?
 *
 * The ring city only. Everywhere else a gate is already a point on the level
 * rather than a whole band, so it is near by definition and the card behaves as
 * it always did.
 */
function nearGap(state: RunState, gate: { ring: number }): boolean {
  const rings = state.rings;
  if (!rings) return true;

  const ring = rings.rings[gate.ring];
  if (!ring) return true;

  const angle = Math.atan2(state.player.y - rings.cy, state.player.x - rings.cx);
  let apart = Math.abs(angle - ring.gapAt) % (Math.PI * 2);
  if (apart > Math.PI) apart = Math.PI * 2 - apart;

  return apart <= GATE_ARC;
}
