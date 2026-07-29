/**
 * Draws the world.
 *
 * The premise is that you are flying inside a printed chart, so the chart is
 * the hero: it gets the accent colour, the heaviest line on screen, and a
 * solid ground mass under it. Everything else is ink on paper.
 *
 * The whole cast is drawn by one function in characters.ts. Attackers, the
 * people being rescued, squadmates and the player share a silhouette, which is
 * what makes the screen read as a crowd rather than as a set of shapes. What
 * separates them is jacket colour and posture, and those are the two things a
 * player can actually parse at speed on a phone.
 *
 * Performance notes, because this targets a WebView on a mid phone: no blur
 * filters anywhere, no gradients per entity, and everything off screen is
 * culled on x before a single path is built. A figure costs about fifteen path
 * operations and there are rarely more than twenty on screen.
 */

import { theme, MONO, DISPLAY } from './theme';
import { AvatarCache, drawHuman, type Role } from './characters';
import type { Camera } from './camera';
import type { Effects } from './effects';
import type { Enemy, Face, RunState } from '../game/state';
import type { Squad } from '../game/squad';
import { POINT_SPACING, WORLD_HEIGHT, CEILING } from '../game/terrain';
import { BULLET_RADIUS } from '../game/bullet';
import { CELL_RADIUS, isCaged } from '../game/cell';
import { MAX_SPEED } from '../game/player';

/**
 * NIM's gold. The one colour outside the palette, used for exactly one thing.
 *
 * The palette is deliberately tiny and every colour in it already carries a
 * meaning, so a refill borrowing one would inherit the wrong sentence. Gold
 * says currency, which is what a refill is dressed as.
 */
const REFILL_GOLD = '#e9b13c';

/** Set on the player's character when they have connected an account. */
export interface PlayerIdentity {
  handle: string | null;
  avatarUrl: string | null;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private avatars = new AvatarCache();
  /** CSS pixels, not device pixels. Everything below works in these. */
  width = 0;
  height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable in this WebView.');
    this.ctx = ctx;
  }

  /**
   * Match the backing store to the device pixel ratio, then work in CSS pixels
   * everywhere above this line. Capped at 2 because a 3x buffer on a phone
   * costs more than it shows.
   */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(
    state: RunState,
    camera: Camera,
    effects: Effects,
    squad?: Squad,
    me?: PlayerIdentity,
  ): void {
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The sky belongs to the stage. Seven stages on the same chart would
    // otherwise be seven identical pictures with a different number on them.
    ctx.fillStyle = state.stage.look.sky;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    camera.applyTo(ctx);

    this.drawGrid(camera);
    this.drawRidge(state, camera);
    this.drawWeather(state, camera);
    this.drawTerrain(state, camera);
    this.drawExtraction(state, camera);
    this.drawRefills(state, camera);
    this.drawCaches(state, camera);
    this.drawFaces(state, camera);
    this.drawEnemies(state, camera);
    this.drawBullets(state, camera);
    if (squad) this.drawSquad(squad, camera, state.time);
    this.drawPlayer(state, me);
    effects.drawWorld(ctx);

    ctx.restore();

    effects.drawScreen(ctx, this.width, this.height);
    ctx.restore();
  }

  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /** Warm up an avatar so it is decoded before it is first drawn. */
  preload(url: string | null | undefined): void {
    this.avatars.get(url);
  }

  /**
   * Faint rules, the way a chart pane is ruled. Not a decorative grid.
   *
   * The two axes are no longer drawn alike, because they do not mean alike. A
   * price pane is ruled horizontally: those lines are levels, and against them
   * you can see whether you are climbing. The vertical rules are just time and
   * on screen they were doing the most damage, cutting the sky into boxes and
   * competing with everything that can kill you. They are still there, at a
   * third of the weight, which is enough to read speed against and not enough
   * to look at.
   */
  private drawGrid(camera: Camera): void {
    const ctx = this.ctx;
    const spacing = 120;

    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.hairline;

    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    const startX = Math.floor(camera.left / spacing) * spacing;
    for (let x = startX; x < camera.left + camera.viewW; x += spacing) {
      ctx.moveTo(x, CEILING);
      ctx.lineTo(x, WORLD_HEIGHT);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let y = CEILING; y <= WORLD_HEIGHT; y += spacing) {
      ctx.moveTo(camera.left, y);
      ctx.lineTo(camera.left + camera.viewW, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The ceiling is the top of the pane, so it gets a real ink rule.
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(camera.left, CEILING);
    ctx.lineTo(camera.left + camera.viewW, CEILING);
    ctx.stroke();
  }

  /**
   * A distant echo of the same chart, scrolling at half speed behind the level.
   *
   * The sky was a flat wash with a grid on it, so flying felt like moving
   * through nothing: no speed, no depth, no sense of a place. The obvious fix
   * is a parallax layer and the obvious parallax layer is invented scenery,
   * which is exactly the decorative filler the design forbids.
   *
   * So this is the chart again. Same heights, sampled at half the rate and
   * flattened toward a horizon, which is what a real range does when it is far
   * away. It reads as distance, it gives the eye something to measure speed
   * against, and every ridge on it is still today's price action rather than
   * something a designer drew.
   *
   * Cosmetic and deterministic: it reads terrain heights and the camera, never
   * a random stream, so it cannot diverge between two players on a seed and
   * costs the simulation nothing.
   */
  private drawRidge(state: RunState, camera: Camera): void {
    const ctx = this.ctx;
    const terrain = state.terrain;
    const heights = terrain.heights;
    if (heights.length < 2) return;

    /** Fraction of the camera's motion the ridge takes. Lower reads further. */
    const PARALLAX = 0.5;
    /** How much of the chart's relief survives the distance. */
    const FLATTEN = 0.55;
    /**
     * Pushes the range up so it clears the near ground and stays visible. At
     * 150 it spent most of the run hidden behind the terrain it sits behind,
     * which is a layer nobody ever sees.
     */
    const LIFT = 250;

    const left = camera.left;
    const right = left + camera.viewW;
    // One vertex every 24 world units is smooth at any zoom this game reaches
    // and keeps the whole ridge under a hundred points.
    const stride = 24;

    ctx.save();
    ctx.beginPath();

    let started = false;
    for (let x = left - stride; x <= right + stride; x += stride) {
      // Sample the chart at half the travel, so the range slides past at half
      // the speed of the ground under it.
      const sampleX = x * PARALLAX;
      const index = sampleX / POINT_SPACING;
      const low = Math.floor(index);
      const high = low + 1;
      const blend = index - low;

      const a = heights[((low % heights.length) + heights.length) % heights.length] ?? WORLD_HEIGHT;
      const b =
        heights[((high % heights.length) + heights.length) % heights.length] ?? WORLD_HEIGHT;
      const sampled = a + (b - a) * blend;

      const y = WORLD_HEIGHT - (WORLD_HEIGHT - sampled) * FLATTEN - LIFT;

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.lineTo(right + stride, WORLD_HEIGHT + 900);
    ctx.lineTo(left - stride, WORLD_HEIGHT + 900);
    ctx.closePath();

    // Ink at low alpha rather than a second tan. A distant range is a value
    // shift, not a different material, and tinting it would invent a colour
    // the palette does not have.
    /*
     * Deliberately weak, and it has to stay that way. The near ground carries a
     * six pixel ink rule and a bright accent line on top of it; this carries
     * neither and no outline at all. That gap is the only thing telling a
     * player at speed which of the two shapes is solid, and a ridge mistaken
     * for terrain is worse than no ridge.
     */
    ctx.globalAlpha = 0.085;
    ctx.fillStyle = theme.ink;
    ctx.fill();
    ctx.restore();
  }

  /**
   * The chart, as ground. Solid mass below the line rather than a tint, so it
   * reads as something you cannot fly through, which is exactly what it is.
   */
  /**
   * Weather over the level. Ash, dust, static or embers, by stage.
   *
   * Three rules, and they are what keep this from being the decorative motion
   * the whole design forbids:
   *
   *   1. It never affects play. No collision, no occlusion of anything you
   *      need to see. A stage that is harder to READ is not a harder stage, it
   *      is an unfair one, and the level is a fair bet before it is a picture.
   *   2. It is drawn BEHIND the terrain and everything on it, so nothing that
   *      can kill you is ever obscured by a fleck.
   *   3. It is deterministic from the fleck's index and the run clock rather
   *      than from any random stream, so it costs no state, never diverges
   *      between two players, and cannot touch the level RNG.
   *
   * Positions are computed in world space from the camera window, so flecks
   * scroll with the world rather than sitting on the glass like a screen
   * effect, which is what makes it read as weather rather than as a filter.
   */
  private drawWeather(state: RunState, camera: Camera): void {
    const look = state.stage.look;
    if (look.weather === 'clear' || look.density <= 0) return;

    const ctx = this.ctx;
    const count = Math.round(90 * look.density);
    const time = state.time;

    ctx.save();

    for (let i = 0; i < count; i++) {
      // Two incommensurate multipliers, so the field never lines up into
      // visible rows the way a single stride does.
      const lane = (i * 137.508) % 1;
      const seed = (i * 0.6180339887) % 1;

      const drift = look.weather === 'ember' ? -34 : 22 + seed * 26;
      const fall = look.weather === 'static' ? 0 : 14 + seed * 30;

      const spanX = camera.viewW + 240;
      const spanY = WORLD_HEIGHT + 260;

      const x = camera.left - 120 + (((lane * spanX + time * drift) % spanX) + spanX) % spanX;
      const y = CEILING - 130 + (((seed * spanY + time * fall) % spanY) + spanY) % spanY;

      if (look.weather === 'static') {
        // Signal noise: short horizontal ticks that blink rather than fall.
        const on = Math.sin(time * 9 + i * 2.3) > 0.55;
        if (!on) continue;
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = theme.ink;
        ctx.fillRect(x, y, 9 + seed * 12, 2);
        continue;
      }

      if (look.weather === 'ember') {
        // The only weather that carries colour, and it rises.
        ctx.globalAlpha = 0.28 + Math.sin(time * 2.4 + i) * 0.12;
        ctx.fillStyle = seed > 0.7 ? theme.accent : theme.accentDeep;
        const size = 2 + seed * 2.4;
        ctx.fillRect(x, y, size, size);
        continue;
      }

      // Dust and ash: ink flecks at low alpha, ash heavier and slower.
      ctx.globalAlpha = look.weather === 'ash' ? 0.15 : 0.1;
      ctx.fillStyle = theme.ink;
      const size = look.weather === 'ash' ? 2.4 + seed * 2.6 : 1.6 + seed * 1.8;
      ctx.fillRect(x, y, size, size);
    }

    ctx.restore();
  }

  private drawTerrain(state: RunState, camera: Camera): void {
    const ctx = this.ctx;
    const terrain = state.terrain;

    const from = Math.max(0, Math.floor((camera.left - POINT_SPACING) / POINT_SPACING));
    const to = Math.min(
      terrain.heights.length - 1,
      Math.ceil((camera.left + camera.viewW + POINT_SPACING) / POINT_SPACING),
    );

    const line = new Path2D();
    line.moveTo(from * POINT_SPACING, terrain.heights[from] ?? WORLD_HEIGHT);
    for (let i = from + 1; i <= to; i++) {
      line.lineTo(i * POINT_SPACING, terrain.heights[i] ?? WORLD_HEIGHT);
    }

    /*
     * The ground runs well past the bottom of the world, not to it.
     *
     * A tall portrait viewport shows more height than the world has: the view
     * can be a thousand units tall against a nine-hundred-and-sixty unit
     * world, so the camera centres and there is spare canvas below. Ending the
     * mass exactly at WORLD_HEIGHT leaves a bare cream band under the ground
     * with the hatching stopping dead along a straight line, which reads as
     * the terrain having been cut off. Running it past the edge costs one
     * number and the band can never appear.
     */
    const floor = WORLD_HEIGHT + 900;

    const mass = new Path2D(line);
    mass.lineTo(to * POINT_SPACING, floor);
    mass.lineTo(from * POINT_SPACING, floor);
    mass.closePath();

    ctx.fillStyle = state.stage.look.ground;
    ctx.fill(mass);

    // Hatch the ground. A flat tan field below the chart is a large dead area
    // that makes the whole screen feel unfinished; ruled hatching reads as a
    // printed solid and gives the eye something to measure speed against.
    ctx.save();
    ctx.clip(mass);
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.09;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Tighter hatching later in the campaign, so the ground reads as denser
    // and colder the further in you get without adding a single colour.
    const step = state.stage.look.hatch;
    const first = Math.floor((camera.left - WORLD_HEIGHT) / step) * step;
    for (let x = first; x < camera.left + camera.viewW + WORLD_HEIGHT; x += step) {
      ctx.moveTo(x, WORLD_HEIGHT);
      ctx.lineTo(x + WORLD_HEIGHT, 0);
    }
    ctx.stroke();
    ctx.restore();

    // A hard ink rule on top of the accent line, which is what keeps a bright
    // orange from vanishing into a bright canvas at a glance.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 6;
    ctx.stroke(line);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3.2;
    ctx.stroke(line);
  }

private drawExtraction(state: RunState, camera: Camera): void {
    // The pad moves with the stage. Drawing it at the world's far end would
    // put the finish line a kilometre past where the run actually ends.
    const padX = state.extractionX;
    if (!camera.visibleX(padX, 220)) return;

    const ctx = this.ctx;
    const groundY = state.terrain.groundAt(padX);

    // A solid band, not a gradient. It is a landing zone painted on the floor.
    ctx.fillStyle = theme.accentPale;
    ctx.fillRect(padX - 34, CEILING, 68, groundY - CEILING);

    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(padX - 34, CEILING);
    ctx.lineTo(padX - 34, groundY);
    ctx.moveTo(padX + 34, CEILING);
    ctx.lineTo(padX + 34, groundY);
    ctx.stroke();

    ctx.fillStyle = theme.ink;
    ctx.fillRect(padX - 46, groundY - 12, 92, 12);

    ctx.fillStyle = theme.canvas;
    ctx.font = `700 13px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXTRACT', padX, groundY - 6);
  }

  /**
   * Hull refills, drawn as a hexagonal token in NIM's gold.
   *
   * A hexagon and a colour nothing else on screen uses, so it can never be
   * mistaken for a cache or a person at speed. Gold sits outside the palette
   * on purpose: orange means the chart and the action, red means it will hurt
   * you, green means someone to get out. A fourth meaning needs a fourth
   * colour or it inherits one it does not mean.
   */
  private drawRefills(state: RunState, camera: Camera): void {
    const ctx = this.ctx;

    for (const refill of state.refills) {
      if (refill.taken) continue;
      if (!camera.visibleX(refill.x, 80)) continue;

      const bob = Math.sin(state.time * 2.6 + refill.phase) * 4;
      const y = refill.y + bob;
      const r = 15;

      ctx.save();
      ctx.translate(refill.x, y);

      const hex = new Path2D();
      for (let i = 0; i < 6; i++) {
        // Flat-top hexagon, which is the shape NIM's own mark reads as.
        const angle = (Math.PI / 3) * i;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) hex.moveTo(px, py);
        else hex.lineTo(px, py);
      }
      hex.closePath();

      ctx.fillStyle = REFILL_GOLD;
      ctx.fill(hex);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 2.4;
      ctx.stroke(hex);

      // A cross, because it restores hull rather than paying anything.
      ctx.fillStyle = theme.ink;
      ctx.fillRect(-6.5, -2, 13, 4);
      ctx.fillRect(-2, -6.5, 4, 13);

      ctx.restore();
    }
  }

  /**
   * Caches. A sealed crate, a heavier vault, and the relic.
   *
   * The relic gets a beacon that reaches the ceiling, because it sits at the
   * lowest point of the day's chart and would otherwise be invisible until you
   * were already committed to the dive. Seeing it from a long way off and
   * having to decide whether the detour is worth the clock is the decision the
   * whole mechanic exists to create, so it has to be visible early.
   */
  private drawCaches(state: RunState, camera: Camera): void {
    const ctx = this.ctx;

    for (const cache of state.caches) {
      if (cache.taken) continue;
      if (!camera.visibleX(cache.x, 120)) continue;

      const bob = Math.sin(state.time * 2.2 + cache.phase) * 3;
      const y = cache.y + bob;

      if (cache.tier === 'relic') {
        // A column of light from the bottom of the crash to the top of the pane.
        ctx.fillStyle = theme.accentPale;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(cache.x - 13, CEILING, 26, y - CEILING);
        ctx.globalAlpha = 1;

        // Clear of the HUD strip, which sits over the top of the world and
        // would otherwise swallow the label exactly when it matters most.
        const labelY = CEILING + 78;
        ctx.fillStyle = theme.ink;
        ctx.beginPath();
        ctx.roundRect(cache.x - 30, labelY - 10, 60, 20, 4);
        ctx.fill();

        ctx.fillStyle = theme.accent;
        ctx.font = `700 11px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('RELIC', cache.x, labelY + 1);
      }

      const size = cache.tier === 'sealed' ? 15 : cache.tier === 'vault' ? 19 : 22;
      const fill =
        cache.tier === 'sealed'
          ? theme.paper
          : cache.tier === 'vault'
            ? theme.accentPale
            : theme.accent;

      // A ring on the two rarer tiers, so they read as worth the detour from
      // across the level rather than at the last second.
      if (cache.tier !== 'sealed') {
        const pulse = 0.5 + Math.sin(state.time * 3 + cache.phase) * 0.5;
        ctx.strokeStyle = theme.accent;
        ctx.globalAlpha = 0.25 + pulse * 0.45;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(cache.x, y, size + 10 + pulse * 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.lineWidth = 2.4;
      ctx.strokeStyle = theme.ink;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(cache.x - size / 2, y - size / 2, size, size, 3);
      ctx.fill();
      ctx.stroke();

      // A latch across the front. Reads as a container at any size.
      ctx.fillStyle = theme.ink;
      ctx.fillRect(cache.x - size / 2, y - 2, size, 3.2);
      ctx.fillRect(cache.x - 3, y - size / 2 - 1, 6, size + 2);
    }
  }

  private drawFaces(state: RunState, camera: Camera): void {
    const ctx = this.ctx;
    const pulse = 0.5 + Math.sin(state.time * 3.4) * 0.5;

    for (const face of state.faces) {
      if (face.state === 'extracted' || face.state === 'lost') continue;
      if (!camera.visibleX(face.x, 80)) continue;

      if (isCaged(face)) {
        this.drawCell(face.x, face.y);
      } else if (face.state === 'trapped') {
        // A ring that breathes, so somebody waiting to be pulled out is
        // findable at a glance without an arrow cluttering the HUD.
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2.4;
        ctx.globalAlpha = 0.35 + pulse * 0.5;
        ctx.beginPath();
        ctx.arc(face.x, face.y - 4, 26 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      this.drawFaceHuman(state, face);
    }
  }

  /**
   * Bars, drawn OVER the person inside them.
   *
   * Drawn on top rather than behind on purpose: a cage you can see through
   * cleanly does not read as shut, and the whole mechanic depends on a player
   * understanding at a glance that flying into this one will not work. Solid
   * ink, no pulse, no accent. It is not a thing to approach, it is a thing to
   * deal with, and the breathing accent ring already means "come and get me".
   */
  private drawCell(x: number, y: number): void {
    const ctx = this.ctx;
    const r = CELL_RADIUS;
    const top = y - r + 6;
    const bottom = y + r - 10;

    ctx.save();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    // Frame.
    ctx.beginPath();
    ctx.moveTo(x - r, top);
    ctx.lineTo(x + r, top);
    ctx.moveTo(x - r, bottom);
    ctx.lineTo(x + r, bottom);
    ctx.stroke();

    // Uprights. Five of them, wide enough apart to read the face behind.
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const bx = x - r + (i * (r * 2)) / 4;
      ctx.moveTo(bx, top);
      ctx.lineTo(bx, bottom);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawFaceHuman(state: RunState, face: Face): void {
    const following = face.state === 'following';

    drawHuman(this.ctx, {
      x: face.x,
      y: face.y,
      // Rescued people look where you are going. Trapped ones look at you.
      aim: 0,
      facing: state.player.x >= face.x ? 1 : -1,
      tilt: following ? 0.12 : 0,
      time: state.time + face.id,
      thrust: following ? 0.6 : 0,
      role: 'rescue',
      seed: face.handle,
      avatar: this.avatars.get(face.avatarUrl),
      alpha: 1,
      firing: false,
      label: face.state === 'trapped' ? handleTag(face) : null,
    });
  }

  private drawEnemies(state: RunState, camera: Camera): void {
    for (const enemy of state.enemies) {
      if (!enemy.alive || !enemy.active) continue;
      if (!camera.visibleX(enemy.x, 80)) continue;
      this.drawEnemy(state, enemy);
    }
  }

  private drawEnemy(state: RunState, enemy: Enemy): void {
    const toPlayer = Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x);
    const role: Role = enemy.kind;

    drawHuman(this.ctx, {
      x: enemy.x,
      y: enemy.y,
      aim: toPlayer,
      facing: state.player.x >= enemy.x ? 1 : -1,
      // Divers throw themselves at you, so they lean into it hard.
      tilt: enemy.kind === 'diver' ? clampTilt(Math.atan2(enemy.vy, enemy.vx) * 0.35) : 0,
      time: state.time + enemy.phase,
      thrust: enemy.kind === 'diver' ? 1 : enemy.kind === 'drifter' ? 0.35 : 0,
      role,
      seed: `attacker-${enemy.id}`,
      avatar: null,
      alpha: 1,
      firing: enemy.fireCooldown > 1.6,
      label: null,
    });
  }

  private drawBullets(state: RunState, camera: Camera): void {
    const ctx = this.ctx;

    for (const bullet of state.bullets) {
      if (bullet.life <= 0) continue;
      if (!camera.visibleX(bullet.x, 40)) continue;

      // A long thin streak along the direction of travel. Short and fat reads
      // as a floating pill sitting in the air; long and thin reads as
      // something moving fast, which is what it is.
      const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
      const tailX = bullet.x - (bullet.vx / speed) * 18;
      const tailY = bullet.y - (bullet.vy / speed) * 18;

      ctx.lineCap = 'round';
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = BULLET_RADIUS * 1.7;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(bullet.x, bullet.y);
      ctx.stroke();

      ctx.strokeStyle = bullet.friendly ? theme.accent : theme.danger;
      ctx.lineWidth = BULLET_RADIUS * 0.8;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(bullet.x, bullet.y);
      ctx.stroke();
    }
  }

  /**
   * Squadmates, whether they are recordings or live players. Drawn from the
   * same struct through the same code, because by the time it reaches here
   * there is no difference worth encoding.
   *
   * They are drawn pale and translucent, which is the honest signal: a
   * squadmate cannot shoot you, cannot be shot, and cannot take a face you
   * were going for. Drawing them as solid as your own character would promise
   * otherwise.
   */
  private drawSquad(squad: Squad, camera: Camera, time: number): void {
    for (const mate of squad.members) {
      const pose = mate.pose;
      if (!pose || !camera.visibleX(pose.x, 80)) continue;

      drawHuman(this.ctx, {
        x: pose.x,
        y: pose.y,
        aim: pose.angle,
        facing: Math.cos(pose.angle) >= 0 ? 1 : -1,
        tilt: 0,
        time: time + mate.id.charCodeAt(0),
        thrust: pose.down ? 0 : 0.5,
        role: 'squad',
        seed: mate.id,
        avatar: this.avatars.get(mate.avatarUrl),
        alpha: pose.down ? 0.22 : 0.55,
        firing: pose.firing,
        label: mate.name,
      });

      if (pose.carrying > 0) this.drawCarryPips(pose.x, pose.y, pose.carrying, 0.55);
    }
  }

  private drawPlayer(state: RunState, me?: PlayerIdentity): void {
    const player = state.player;

    // Blink through invulnerability so the player can see they are in it.
    const blinking = state.time < player.invulnerableUntil;
    if (blinking && Math.floor(state.time * 14) % 2 === 0) return;

    const speed = Math.hypot(player.vx, player.vy);

    drawHuman(this.ctx, {
      x: player.x,
      y: player.y,
      aim: Math.atan2(player.aimY, player.aimX),
      facing: player.facing,
      tilt: clampTilt(player.vx / 1400),
      time: state.time,
      thrust: Math.min(1, speed / MAX_SPEED),
      role: 'player',
      seed: me?.handle ?? 'you',
      avatar: this.avatars.get(me?.avatarUrl),
      alpha: 1,
      /*
       * Time since the shot, not time left on the cooldown.
       *
       * The cooldown test lit the muzzle for whatever fraction of the interval
       * was left, which on a slow weapon is nearly all of it. The lance sat
       * with a permanently lit barrel and the sidearm flickered at its own fire
       * rate, so neither one actually marked the moment a round left. Recency
       * gives every weapon the same short flash on the frame it fires.
       */
      firing: state.time - player.lastFiredAt < 0.055,
      label: null,
    });

    if (state.carrying > 0) this.drawCarryPips(player.x, player.y, state.carrying, 1);
  }

  /** One tick per person aboard, above the head. */
  private drawCarryPips(x: number, y: number, count: number, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = theme.rescue;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.4;

    const width = count * 8;
    for (let i = 0; i < count; i++) {
      ctx.beginPath();
      ctx.arc(x - width / 2 + 4 + i * 8, y - 34, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** A handle reads as a handle. An archetype id does not, so it is spelled out. */
function handleTag(face: Face): string {
  return /^[a-z0-9_]{1,15}$/.test(face.handle) && face.handle !== face.name.toLowerCase()
    ? `@${face.handle}`
    : face.name;
}

function clampTilt(value: number): number {
  return Math.max(-0.35, Math.min(0.35, value));
}

export { DISPLAY };
