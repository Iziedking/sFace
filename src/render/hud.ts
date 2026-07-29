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
import type { Input, StickView } from '../core/input';
import type { RunState } from '../game/state';
import { PLAYER_MAX_HEALTH } from '../game/state';
import { CONSUMABLES } from '../data/consumables';

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Seconds left at which the clock turns and starts pulsing. */
const CLOCK_WARNING = 15;
const BAR_HEIGHT = 46;

export class Hud {
  private insets: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private probe: HTMLDivElement | null = null;

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

    ctx.save();

    // One solid ink strip across the top. Everything readable sits on it.
    ctx.fillStyle = theme.ink;
    ctx.fillRect(0, 0, width, top + BAR_HEIGHT);

    ctx.textBaseline = 'middle';
    const mid = top + BAR_HEIGHT / 2;

    this.drawTicker(ctx, state, padX, mid);
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
    const scripRight = this.drawScrip(ctx, state, padX + 74, mid);
    // Clear of the ticker block, which owns the left of the strip. The offset
    // is the ticker's own width plus a gap, measured once rather than guessed:
    // the ticker is at most five characters of 17px mono.
    this.drawSlots(ctx, state, scripRight + 14, mid);
    this.drawProgress(ctx, state, width, top + BAR_HEIGHT);
    this.drawCarrying(ctx, state, padX, height - this.insets.bottom - 26);
    this.drawStick(ctx, input);

    ctx.restore();
  }

  /** The real ticker, in mono, because it came from somewhere real. */
  private drawTicker(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    x: number,
    mid: number,
  ): void {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent;
    ctx.font = `700 17px ${MONO}`;
    ctx.fillText(state.mission.ticker, x, mid - 7);

    ctx.fillStyle = state.mission.live ? theme.canvas : theme.inkFaint;
    ctx.font = `500 11px ${MONO}`;
    ctx.fillText(
      state.mission.live ? `${state.mission.changePct.toFixed(1)}%` : 'PRACTICE',
      x,
      mid + 10,
    );
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
    });

    ctx.globalAlpha = 1;
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
    if (input.stick) drawPuck(ctx, input.stick, theme.ink, false);
    if (input.aimStick) drawPuck(ctx, input.aimStick, theme.accent, true);
  }
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
  ctx.arc(stick.origin.x, stick.origin.y, 52, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.4;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(stick.current.x, stick.current.y, 22, 0, Math.PI * 2);
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

