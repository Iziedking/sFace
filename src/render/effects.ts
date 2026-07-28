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
            this.burst(event.x, event.y, 16, theme.danger, 220);
            camera.shake(7);
          }
          break;
        case 'freed':
          if (!quiet) this.burst(event.x, event.y, 14, theme.accent, 180);
          break;
        case 'extracted':
          this.say(event.x, event.y, event.text ?? 'Out', theme.accent);
          if (!quiet) this.burst(event.x, event.y, 20, theme.accent, 240);
          break;
        case 'lost':
          this.say(event.x, event.y, event.text ?? 'Lost', theme.danger);
          break;
        case 'pickupLine':
          if (event.text) this.say(event.x, event.y, event.text, theme.face);
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
      text.y -= 26 * dt;
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
    for (const text of this.texts) {
      const alpha = Math.min(1, (text.life / text.maxLife) * 1.6);
      ctx.globalAlpha = alpha;
      ctx.font = `600 14px ${MONO}`;
      ctx.fillStyle = 'rgba(8, 9, 13, 0.75)';
      ctx.fillText(text.text, text.x + 1, text.y + 1);
      ctx.fillStyle = text.color;
      ctx.fillText(text.text, text.x, text.y);
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
    this.texts.push({ x, y: y - 26, text, life: 2.2, maxLife: 2.2, color });
  }
}
