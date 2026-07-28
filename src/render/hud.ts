/**
 * The heads-up display: clock, health, who you are carrying, how far is left.
 *
 * Four things and nothing else. Everything a player needs mid-run has to be
 * readable in the quarter of a second they can spare from flying, so anything
 * that is merely interesting waits for the results screen.
 *
 * Drawn in screen space, in CSS pixels, after the world transform is dropped.
 * The safe-area insets are read from the live CSS environment rather than
 * guessed, because Nimiq Pay renders edge to edge and a hardcoded top margin
 * puts the clock under the notch on some phones and floating in space on others.
 */

import { theme, MONO } from './theme';
import type { Input } from '../core/input';
import type { RunState } from '../game/state';
import { PLAYER_MAX_HEALTH, RUN_SECONDS } from '../game/state';
import { EXTRACTION_X } from '../game/terrain';

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Seconds left at which the clock turns red and starts pulsing. */
const CLOCK_WARNING = 15;

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
    const padX = 18 + Math.max(this.insets.left, this.insets.right);
    const top = 16 + this.insets.top;

    ctx.save();
    ctx.textBaseline = 'top';

    this.drawClock(ctx, state, width, top);
    this.drawTicker(ctx, state, padX, top);
    this.drawHealth(ctx, state, width - padX, top);
    this.drawProgress(ctx, state, padX, width - padX, top);
    this.drawCarrying(ctx, state, padX, height - this.insets.bottom - 34);
    this.drawStick(ctx, input);

    ctx.restore();
  }

  /** Centre top, mono, big. The clock is the pressure. */
  private drawClock(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    width: number,
    top: number,
  ): void {
    const left = state.timeLeft;
    const warning = left <= CLOCK_WARNING;
    // A pulse rather than a beep. A game inside a wallet should not make noise
    // the user did not ask for.
    const pulse = warning ? 0.72 + Math.abs(Math.sin(state.time * 5)) * 0.28 : 1;

    ctx.globalAlpha = pulse;
    ctx.fillStyle = warning ? theme.danger : theme.ink;
    ctx.font = `700 30px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(formatClock(left), width / 2, top);
    ctx.globalAlpha = 1;
  }

  /** The real ticker, in mono, because it came from somewhere real. */
  private drawTicker(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    x: number,
    top: number,
  ): void {
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent;
    ctx.font = `700 15px ${MONO}`;
    ctx.fillText(state.mission.ticker, x, top + 2);

    if (state.mission.live) {
      ctx.fillStyle = theme.inkMuted;
      ctx.font = `500 12px ${MONO}`;
      ctx.fillText(`${state.mission.changePct.toFixed(1)}%`, x, top + 21);
    }
  }

  private drawHealth(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    right: number,
    top: number,
  ): void {
    const width = 108;
    const height = 8;
    const x = right - width;
    const fraction = Math.max(0, state.player.health / PLAYER_MAX_HEALTH);

    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(x, top + 6, width, height, 4);
    ctx.fill();

    ctx.fillStyle = fraction > 0.3 ? theme.ink : theme.danger;
    ctx.beginPath();
    ctx.roundRect(x, top + 6, Math.max(2, width * fraction), height, 4);
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.fillStyle = theme.inkFaint;
    ctx.font = `500 11px ${MONO}`;
    ctx.fillText('HULL', right, top + 19);
  }

  /**
   * A thin line showing how much of the chart is behind you. This is the only
   * way to know how far extraction is without a minimap, and it costs one rect.
   */
  private drawProgress(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    left: number,
    right: number,
    top: number,
  ): void {
    const y = top + 40;
    const width = right - left;
    const fraction = Math.min(1, Math.max(0, state.player.x / EXTRACTION_X));

    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(left, y, width, 2);
    ctx.fillStyle = theme.accentDim;
    ctx.fillRect(left, y, width * fraction, 2);

    ctx.fillStyle = theme.accent;
    ctx.fillRect(left + width * fraction - 1, y - 3, 2, 8);
  }

  /** One pip per face aboard, filled. Empty pips would imply a quota. */
  private drawCarrying(
    ctx: CanvasRenderingContext2D,
    state: RunState,
    x: number,
    y: number,
  ): void {
    const carried = state.faces.filter((f) => f.state === 'following');
    if (carried.length === 0) return;

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.inkFaint;
    ctx.font = `500 11px ${MONO}`;
    ctx.fillText('ABOARD', x, y - 16);

    carried.forEach((_, index) => {
      ctx.fillStyle = theme.face;
      ctx.beginPath();
      ctx.roundRect(x + index * 20, y, 14, 14, 3);
      ctx.fill();
    });
  }

  /** The floating stick, drawn where the thumb actually went down. */
  private drawStick(ctx: CanvasRenderingContext2D, input: Input): void {
    const stick = input.stick;
    if (!stick) return;

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.origin.x, stick.origin.y, 52, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(stick.current.x, stick.current.y, 22, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export { RUN_SECONDS };
