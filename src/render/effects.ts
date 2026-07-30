/**
 * Particles, floating text, and hit flashes.
 *
 * Everything in here is cosmetic and lives outside RunState on purpose. A
 * replayed ghost run must produce the same simulation whether or not effects
 * are drawn, and effects use Math.random freely, so keeping them out of the
 * state is what guarantees that.
 *
 * When the player has asked for reduced motion, particles and shake are cut
 * rather than slowed. Floating text stays, because it carries information and
 * hiding it would cost the player something real.
 */

import { theme, MONO, reducedMotion } from './theme';
import type { RunEvent } from '../game/state';
import type { Camera } from './camera';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
}

/*
 * How long a line of world text stays up.
 *
 * Reported from a playtest as words disappearing before you could read them,
 * and the old numbers say why. Every line lived 2.2 seconds and its opacity was
 * life/maxLife scaled by 1.6, so it was only fully solid for the first 0.8 of
 * that and spent the remaining 1.4 fading while drifting upward. A short one
 * like "+32" was fine. A pickup line is a whole sentence, and a sentence you
 * have less than a second of solid contrast on, while flying, is a sentence you
 * do not read.
 *
 * So the budget scales with how much there is to read, and the fade is moved to
 * the very end instead of running the whole time: it holds, then goes.
 */
const TEXT_BASE_SECONDS = 2.4;
/** Reading time per character. Roughly 240 words a minute, generously rounded. */
const TEXT_SECONDS_PER_CHAR = 0.055;
/** Long enough for the longest pickup line, short enough not to stack up. */
const TEXT_MAX_SECONDS = 6;
/** Only the last stretch fades. Before that the line is at full contrast. */
const TEXT_FADE_SECONDS = 0.45;

const MAX_PARTICLES = 300;

export class Effects {
  private particles: Particle[] = [];
  private texts: FloatingText[] = [];
  /** Full-screen tint strength, 0 to 1. Rises on damage. */
  private flash = 0;
  private flashColor = theme.danger;

  /**
   * Drain the run's event queue into effects. The run produces events, this
   * consumes them, and the run never knows a renderer exists.
   */
  consume(events: RunEvent[], camera: Camera): void {
    const quiet = reducedMotion();

    for (const event of events) {
      switch (event.kind) {
        case 'hit':
          if (!quiet) this.burst(event.x, event.y, 6, theme.danger, 120);
          break;
        case 'kill':
          if (!quiet) {
            this.burst(event.x, event.y, 16, theme.ink, 220);
            camera.shake(7);
          }
          /*
           * The payout, said out loud.
           *
           * This was the whole bug: the drop was credited correctly and
           * nothing on screen ever mentioned it, so a player watched a number
           * in the corner move for reasons they could not connect to anything
           * they did. Money you cannot see arriving is money you do not know
           * you have. Shown even under reduced motion, because it is
           * information rather than decoration.
           */
          if (event.text) this.say(event.x, event.y, event.text, theme.accentDeep);
          break;
        case 'freed':
          if (!quiet) this.burst(event.x, event.y, 14, theme.rescue, 180);
          break;
        case 'extracted':
          this.say(event.x, event.y, event.text ?? 'Out', theme.rescue);
          if (!quiet) this.burst(event.x, event.y, 20, theme.rescue, 240);
          break;
        case 'lost':
          this.say(event.x, event.y, event.text ?? 'Lost', theme.danger);
          break;
        case 'pickupLine':
          if (event.text) this.say(event.x, event.y, event.text, theme.ink);
          break;
        case 'refill':
          if (event.text) this.say(event.x, event.y, event.text, '#b07a12');
          if (!quiet) this.burst(event.x, event.y, 12, '#e9b13c', 190);
          break;
        case 'cache':
          if (event.text) this.say(event.x, event.y, event.text, theme.accentDeep);
          if (!quiet) this.burst(event.x, event.y, 14, theme.accent, 200);
          break;
        case 'relic':
          if (event.text) this.say(event.x, event.y, event.text, theme.accentDeep);
          if (!quiet) {
            // The one moment in a run that earns a proper flourish.
            this.burst(event.x, event.y, 34, theme.accent, 320);
            camera.shake(11);
          }
          break;
      }
    }

    events.length = 0;
  }

  /** Called when the player takes damage, separately from the event drain. */
  damageFlash(): void {
    if (reducedMotion()) return;
    this.flash = 0.55;
    this.flashColor = theme.danger;
  }

  update(dt: number): void {
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 420 * dt;
      particle.vx *= 0.96;
      particle.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const text of this.texts) {
      /*
       * Rises quickly, then settles.
       *
       * A constant climb carried a long line more than a hundred units up the
       * screen before it expired, out of the place the thing it describes
       * happened. Easing on the elapsed fraction means it pops clear of the
       * character in the first moment and then holds roughly still to be read.
       */
      const elapsed = 1 - text.life / text.maxLife;
      text.y -= 34 * Math.max(0, 1 - elapsed * 4) * dt;
      text.life -= dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);

    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  /** Drawn in world space, under the transform. */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      const alpha = particle.life / particle.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.fillRect(
        particle.x - particle.size / 2,
        particle.y - particle.size / 2,
        particle.size,
        particle.size,
      );
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 13px ${MONO}`;
    for (const text of this.texts) {
      // Solid until the last moment, then out. See TEXT_FADE_SECONDS.
      ctx.globalAlpha = Math.min(1, text.life / TEXT_FADE_SECONDS);

      // A solid plate behind the line. Type over a moving chart on a bright
      // canvas is unreadable, and a drop shadow on paper looks like a mistake.
      const width = ctx.measureText(text.text).width + 12;
      ctx.fillStyle = text.color;
      ctx.beginPath();
      ctx.roundRect(text.x - width / 2, text.y - 9, width, 18, 4);
      ctx.fill();

      ctx.fillStyle = theme.canvas;
      ctx.fillText(text.text, text.x, text.y + 1);
    }
    ctx.globalAlpha = 1;
  }

  /** Drawn in screen space, over everything. */
  drawScreen(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.flash <= 0) return;
    ctx.globalAlpha = this.flash * 0.35;
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.particles.length = 0;
    this.texts.length = 0;
    this.flash = 0;
  }

  private burst(x: number, y: number, count: number, color: string, speed: number): void {
    const room = MAX_PARTICLES - this.particles.length;
    const spawn = Math.min(count, Math.max(0, room));

    for (let i = 0; i < spawn; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      const life = 0.3 + Math.random() * 0.4;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private say(x: number, y: number, text: string, color: string): void {
    // One line at a time per spot. Overlapping quips are unreadable on a phone.
    this.texts = this.texts.filter((t) => Math.abs(t.x - x) > 40 || Math.abs(t.y - y) > 24);
    const life = Math.min(
      TEXT_MAX_SECONDS,
      TEXT_BASE_SECONDS + text.length * TEXT_SECONDS_PER_CHAR,
    );
    this.texts.push({ x, y: y - 26, text, life, maxLife: life, color });
  }
}
