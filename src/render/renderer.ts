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

import { NODE_REACH } from '../game/node';
import { theme, MONO, DISPLAY } from './theme';
import { touchCapable } from '../core/scheme';
import { AvatarCache, drawHuman, type Role } from './characters';
import type { Camera } from './camera';
import type { Effects } from './effects';
import type { Enemy, Face, RunState } from '../game/state';
import type { Squad } from '../game/squad';
import { POINT_SPACING, WORLD_HEIGHT, CEILING } from '../game/terrain';
import { BULLET_RADIUS } from '../game/bullet';
import { BREACH_REACH, CELL_RADIUS, cellInReach, isCaged } from '../game/cell';
import { CONSUMABLES } from '../data/consumables';
import { CAR_RADIUS, CAR_REACH } from '../game/car';
import { PATROL_CAR_RADIUS } from '../game/enemy';
import { SIGHT_RANGE, gaze, sees, watches } from '../game/sight';
import { CONVOY_MAX_HEALTH, CONVOY_RADIUS } from '../game/convoy';
import { MAX_SPEED } from '../game/player';

/**
 * NIM's gold. The one colour outside the palette, used for exactly one thing.
 *
 * The palette is deliberately tiny and every colour in it already carries a
 * meaning, so a refill borrowing one would inherit the wrong sentence. Gold
 * says currency, which is what a refill is dressed as.
 */
const REFILL_GOLD = '#e9b13c';

/**
 * Paint on a patrol car.
 *
 * Not theme.ink, which is what it was, and that was the bug: the windscreen and
 * the outline are both ink, so an ink body swallowed both and the car came out
 * as a featureless black lozenge with no readable front. A dark plum is close
 * enough to ink to read as hostile at a glance and far enough off it that the
 * glass and the panel lines survive.
 */
const ENEMY_CAR_PAINT = '#463040';

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
   * How many pixels the renderer is willing to fill each frame.
   *
   * Canvas 2D redraws the whole world every frame, so cost is the area of the
   * backing store and nothing else. A laptop going fullscreen takes the canvas
   * from something like 1150 by 720 to 2560 by 1440, and at a 2x buffer that is
   * 3.3 million pixels becoming 14.7 million. The same drawing four and a half
   * times over, which is why fullscreen dragged so badly that the only way to
   * keep playing was to leave it.
   *
   * Four million is comfortably above 1080p at a 1.4x buffer and well inside
   * what a browser can fill at sixty frames. Small screens never come near it:
   * a phone in the wallet is around 1.6 million at its full 2x, so nothing about
   * a phone changes.
   */
  private static readonly PIXEL_BUDGET = 4_000_000;

  /**
   * The ratio actually in use, worked out in resize and read everywhere else.
   *
   * It used to be recomputed independently in draw, which was harmless only
   * because both copies agreed. The moment one of them is capped and the other
   * is not, the transform stops matching the backing store and everything is
   * drawn at the wrong scale.
   */
  private dpr = 1;

  /**
   * Match the backing store to the device pixel ratio, then work in CSS pixels
   * everywhere above this line.
   *
   * Capped at 2, because a 3x buffer on a phone costs more than it shows, and
   * capped again by area so a large window cannot ask for more pixels than can
   * be filled in a frame.
   */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();

    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));

    const wanted = Math.min(window.devicePixelRatio || 1, 2);
    const area = this.width * this.height;
    // Scale the ratio down, never the layout: the world on screen stays the
    // same size and the buffer behind it simply has fewer pixels in it.
    const affordable = Math.sqrt(Renderer.PIXEL_BUDGET / Math.max(1, area));

    this.dpr = Math.max(1, Math.min(wanted, affordable));

    const bufferW = Math.round(this.width * this.dpr);
    const bufferH = Math.round(this.height * this.dpr);

    /*
     * Only touch the buffer when it actually has to change.
     *
     * Assigning canvas.width reallocates and clears the backing store even when
     * the value assigned is the one already there. Entering fullscreen fires a
     * burst of resize events while the window animates, and every one of them
     * was throwing away and rebuilding a buffer of up to fifteen million
     * pixels. That is the drag: not the drawing, the reallocating.
     */
    if (this.canvas.width !== bufferW || this.canvas.height !== bufferH) {
      this.canvas.width = bufferW;
      this.canvas.height = bufferH;
    }

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(
    state: RunState,
    camera: Camera,
    effects: Effects,
    squad?: Squad,
    me?: PlayerIdentity,
  ): void {
    const ctx = this.ctx;

    ctx.save();
    // The ratio resize settled on, not a fresh guess. See the note on dpr.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // The sky belongs to the stage. Seven stages on the same chart would
    // otherwise be seven identical pictures with a different number on them.
    ctx.fillStyle = state.stage.look.sky;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    camera.applyTo(ctx);

    if (state.rings) {
      // The finale's own world. Nothing from the chart or the grid applies.
      this.drawRings(state);
    } else if (state.city) {
      // A city replaces the whole backdrop. Drawing the chart underneath it
      // would put a ground line through a place that has no ground.
      this.drawCity(state, camera);
    } else {
      this.drawGrid(camera);
      this.drawRidge(state, camera);
      this.drawWeather(state, camera);
      this.drawTerrain(state, camera);
    }
    this.drawSeals(state, camera);
    this.drawAllies(state, camera);
    this.drawExtraction(state, camera);
    this.drawConvoy(state, camera);
    this.drawRefills(state, camera);
    this.drawCaches(state, camera);
    this.drawFaces(state, camera);
    // Under the attackers, so a cone never sits on top of the thing casting it.
    this.drawSight(state, camera);
    this.drawEnemies(state, camera);
    this.drawBullets(state, camera);
    if (squad) this.drawSquad(squad, camera, state.time);
    this.drawCar(state, camera);
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
        this.drawCellPrompt(state, face);
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

  /**
   * What the level can see.
   *
   * Drawn as a filled wedge under everything that matters, in ink at very low
   * alpha rather than in the danger colour. A red cone would read as a hazard
   * to be avoided at all costs; this is a place you often have to cross, and
   * the question is whether you cross it quickly or stop inside it.
   *
   * A cone that currently HAS the player fills harder, which is the only
   * feedback that says "this specific one is the problem" when three overlap.
   *
   * Geometry comes from sight.ts, never recomputed here, so what is drawn and
   * what is tested are the same arc. The alternative is a cone that lies.
   */
  private drawSight(state: RunState, camera: Camera): void {
    if (!state.stage.sight) return;

    const ctx = this.ctx;
    const half = 0.44;

    ctx.save();
    for (const enemy of state.enemies) {
      if (!enemy.alive || !enemy.active || !watches(enemy)) continue;
      if (!camera.visibleX(enemy.x, SIGHT_RANGE)) continue;

      const heading = gaze(enemy, state.time);
      const onMe = sees(enemy, state.terrain, state.time, state.player.x, state.player.y);

      ctx.beginPath();
      ctx.moveTo(enemy.x, enemy.y);
      ctx.arc(enemy.x, enemy.y, SIGHT_RANGE, heading - half, heading + half);
      ctx.closePath();

      ctx.globalAlpha = onMe ? 0.16 : 0.055;
      ctx.fillStyle = onMe ? theme.danger : theme.ink;
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * The transport.
   *
   * Drawn as a heavy slab on wheels rather than as a character, because it is
   * cargo and not a person: nothing about it should suggest it can be rescued
   * or that it will get itself out. It carries its own health bar because it
   * is the thing the stage is actually about, and reading that from the top of
   * the screen while flying beside it is a glance the player should not have
   * to make.
   */
  private drawConvoy(state: RunState, camera: Camera): void {
    const convoy = state.convoy;
    if (!convoy || !camera.visibleX(convoy.x, 120)) return;
    if (convoy.health <= 0) return;

    const ctx = this.ctx;
    const w = CONVOY_RADIUS * 2.2;
    const h = CONVOY_RADIUS * 1.25;
    const x = convoy.x - w / 2;
    const y = convoy.y - h / 2;

    ctx.save();

    // Body.
    ctx.fillStyle = theme.accentDeep;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.stroke();

    // Wheels, so it reads as ground-bound at a glance.
    ctx.fillStyle = theme.ink;
    for (const wx of [x + w * 0.24, x + w * 0.76]) {
      ctx.beginPath();
      ctx.arc(wx, y + h, h * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Its own hull, above it, in the colour the rest of the game uses for
    // damage so it needs no legend.
    const fraction = Math.max(0, convoy.health / CONVOY_MAX_HEALTH);
    const barW = w;
    ctx.fillStyle = 'rgba(20, 17, 14, 0.2)';
    ctx.fillRect(x, y - 12, barW, 5);
    ctx.fillStyle = fraction > 0.35 ? theme.rescue : theme.danger;
    ctx.fillRect(x, y - 12, barW * fraction, 5);

    ctx.restore();
  }

  /**
   * The city: solid blocks, and the streets between them.
   *
   * Drawn as flat ink slabs rather than as anything perspective. This is a plan
   * view of a place, in the same register as the printed chart everywhere else,
   * and a fake three-quarter view would be the one thing on screen pretending
   * to be somewhere other than paper.
   */
  private drawCity(state: RunState, camera: Camera): void {
    const city = state.city;
    if (!city) return;

    const ctx = this.ctx;
    const look = state.stage.look;

    // Street surface under everything.
    ctx.fillStyle = look.ground;
    ctx.fillRect(0, 0, city.width, city.height);

    /*
     * Lane markings, downtown only.
     *
     * Drawn on a fixed pitch off the city's own dimensions rather than from the
     * block list, because the streets ARE the negative space: there is no list of
     * roads to iterate. A dashed rule down the middle of each avenue is enough to
     * turn "gaps between boxes" into "roads", and it gives the eye something to
     * measure the car's speed against on an otherwise flat surface.
     */
    if (look.city === 'towers') {
      const pitch = 646;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = theme.canvas;
      ctx.lineWidth = 3;
      ctx.setLineDash([26, 30]);

      ctx.beginPath();
      for (let x = 95; x < city.width; x += pitch) {
        if (!camera.visibleX(x, 40)) continue;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, city.height);
      }
      for (let y = 95; y < city.height; y += pitch) {
        ctx.moveTo(0, y);
        ctx.lineTo(city.width, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    /*
     * Interiors first, under the walls.
     *
     * A hollowed building is drawn as four wall blocks, so without this its
     * floor is just street and the only clue it can be entered is a notch in one
     * side. That is too subtle to spot from across a junction, and a player who
     * cannot tell a room from a solid block will never go in.
     *
     * A shade off the street rather than a new colour: it says indoors without
     * spending one of the three colours the palette allows.
     */
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = look.hatch > 0 ? look.sky : theme.canvas;
    for (const room of city.rooms) {
      if (!camera.visibleX(room.x + room.w / 2, room.w)) continue;
      ctx.fillRect(room.x, room.y, room.w, room.h);
    }
    ctx.restore();

    const towers = look.city === 'towers';

    ctx.save();
    for (const block of city.blocks) {
      if (!camera.visibleX(block.x + block.w / 2, block.w)) continue;

      ctx.fillStyle = look.sky;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.rect(block.x, block.y, block.w, block.h);
      ctx.fill();
      ctx.stroke();

      /*
       * Windows, on the downtown stage only.
       *
       * The geometry of the two city stages is identical by design, since both
       * are built from the same day's bars, so the only thing available to tell
       * them apart is surface. Flat slabs read as warehouses; a grid of windows
       * reads as offices, which is the right register for a stage about the
       * narrative being written.
       *
       * Skipped on anything too small to hold a row, so a wall segment of a
       * hollowed building does not end up speckled.
       */
      if (towers && block.w > 70 && block.h > 70) this.drawWindows(block);
    }
    ctx.restore();

    // The way out, marked, because an exit that is a point on a map has to be
    // findable without a minimap.
    const shut = state.nodes.length > 0 && state.nodesCaptured < state.nodes.length;

    ctx.save();
    // Faint and grey while it is shut, full accent once the reads are done. The
    // marker is the only thing at the exit, so it has to carry whether the exit
    // actually works rather than looking identical either way.
    ctx.strokeStyle = shut ? theme.hairline : theme.accent;
    ctx.lineWidth = 5;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.arc(city.exitX, city.exitY, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    this.drawNodes(state);
  }

  /**
   * The reads, in the street: a panel on a post.
   *
   * Deliberately a piece of street furniture rather than a glowing pickup. It
   * is a thing you walk up to and stand at, and the ring around it is exactly
   * the reach, so where the question opens is drawn rather than guessed at.
   */
  private drawNodes(state: RunState): void {
    if (state.nodes.length === 0) return;

    const ctx = this.ctx;

    for (const node of state.nodes) {
      ctx.save();
      ctx.translate(node.x, node.y);

      if (node.captured) {
        // Flipped. Filled and quiet: a captured node is scenery now, and it
        // should stop competing with the ones still to do.
        ctx.fillStyle = theme.accentPale;
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-22, -26, 44, 34, 4);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        continue;
      }

      // The reach, so standing in the right place is a visible thing.
      ctx.strokeStyle = theme.accentPale;
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, NODE_REACH, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // The post.
      ctx.fillStyle = theme.ink;
      ctx.fillRect(-3, -8, 6, 22);

      // The panel, unread.
      ctx.fillStyle = theme.canvas;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(-24, -30, 48, 36, 4);
      ctx.fill();
      ctx.stroke();

      // Four lines of something to read. Abstract, because the actual posts are
      // long and the panel is forty pixels wide; the words are in the HUD.
      ctx.fillStyle = theme.ink;
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(-16, -24 + i * 8, i === 1 ? 22 : 32, 3);
      }

      // A blown read is marked on the thing you blew, so coming back to it you
      // know which one already cost you.
      if (node.missed > 0) {
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(24, -30, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  /**
   * What to do about a cell, said at the cell.
   *
   * A locked door with no instructions is a puzzle nobody asked for. The rule
   * is simple once you know it and invisible until you are told, and the first
   * person to play a caged stage asked out loud how to open one, which is the
   * clearest possible evidence that the game was not saying.
   *
   * Only drawn when you are close enough to act on it, so the level is not
   * carpeted in labels. It shows the price when you cannot afford it and the
   * key when you can, because those are two different problems.
   */
  private drawCellPrompt(state: RunState, face: Face): void {
    const player = state.player;
    const near = Math.hypot(player.x - face.x, player.y - face.y) <= BREACH_REACH * 2.4;
    if (!near) return;

    const charge = CONSUMABLES[0];
    if (!charge) return;

    const inReach = cellInReach(state) === face;
    const afford = state.purse.held >= charge.cost;
    /*
     * Name the purchase, not just the price.
     *
     * This read NEED 90 M, where M is the day's ticker, and the question that
     * came back was what it meant. Fair: a bare number and a one-letter
     * currency beside a locked cell says nothing about what the number buys or
     * why it is being mentioned. The affordable version of this label already
     * ends in TO BLOW THE DOOR, so matching it makes the pair read as one
     * thought at two prices.
     */
    const label = !afford
      ? `NEED ${charge.cost} ${state.purse.ticker} TO BLOW THE DOOR`
      : inReach
        ? breachPrompt(charge.label)
        : 'GET CLOSER';

    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 12px ${MONO}`;

    const width = ctx.measureText(label).width + 16;
    const y = face.y + CELL_RADIUS + 18;

    ctx.fillStyle = afford && inReach ? theme.accent : theme.ink;
    ctx.beginPath();
    ctx.roundRect(face.x - width / 2, y - 10, width, 20, 4);
    ctx.fill();

    ctx.fillStyle = afford && inReach ? theme.ink : theme.canvas;
    ctx.fillText(label, face.x, y + 4);
    ctx.restore();
  }

  /**
   * The car, pointing where it is going.
   *
   * Drawn wider than it is long and rotated to its heading, so its footprint on
   * screen is the footprint it actually collides with. A vehicle drawn smaller
   * than its collision is the reason players say a game feels unfair when they
   * clip a corner they thought they had cleared.
   */
  private drawCar(state: RunState, camera: Camera): void {
    const car = state.car;
    if (!car || !camera.visibleX(car.x, 160)) return;

    // Falls back to the old paint when a stage does not name one, so a city
    // added later without a colour still draws something sensible.
    const paint = state.stage.look.car ?? theme.accentDeep;
    this.drawCarBody(car.x, car.y, car.heading, CAR_RADIUS, paint, false);

    /*
     * The prompt, only when close and only when out of it. A label floating
     * over a car you are already driving is noise, and one visible from across
     * the map would make every street shout.
     */
    if (!state.driving) {
      const near = Math.hypot(state.player.x - car.x, state.player.y - car.y) <= CAR_REACH;
      if (near) {
        this.drawTag(
          car.x,
          car.y - CAR_RADIUS - 16,
          touchCapable() ? 'TAP E TO DRIVE' : 'PRESS E TO DRIVE',
          true,
        );
      }
    }
  }

  /**
   * The ring city.
   *
   * Drawn as arcs, which is the whole point: after six stages of straight lines,
   * a screen full of curves says immediately that this is somewhere else. A
   * locked ring is a heavy crimson band with one gap in it; an answered one drops
   * to a thin rule, so the way you came stays legible without competing with the
   * wall you are working on now.
   *
   * The core sits at the middle under a target ring, because it is the only
   * thing in the game you are flying toward rather than across.
   */
  private drawRings(state: RunState): void {
    const rings = state.rings;
    if (!rings) return;

    const ctx = this.ctx;
    const look = state.stage.look;

    ctx.fillStyle = look.ground;
    ctx.fillRect(0, 0, rings.width, rings.height);

    ctx.save();

    /*
     * Faint spokes from the core.
     *
     * A ring world with nothing between the rings gives the eye no way to judge
     * how far round you have travelled, so circling a wall feels like standing
     * still. These are the only thing on screen that says which way is which.
     */
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const outer = rings.rings[rings.rings.length - 1]?.radius ?? rings.coreRadius;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.moveTo(rings.cx + Math.cos(a) * rings.coreRadius, rings.cy + Math.sin(a) * rings.coreRadius);
      ctx.lineTo(rings.cx + Math.cos(a) * (outer + 240), rings.cy + Math.sin(a) * (outer + 240));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (const ring of rings.rings) {
      if (ring.locked) {
        /*
         * The wall, as two arcs with the gap between them.
         *
         * Drawn from the far side of the gap round to the near side, so the
         * opening is a real hole in the stroke rather than something painted
         * over it. That matters because the gap is what the player is hunting.
         */
        ctx.strokeStyle = theme.danger;
        ctx.lineWidth = ring.thickness;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(
          rings.cx,
          rings.cy,
          ring.radius,
          ring.gapAt + ring.gapHalf,
          ring.gapAt - ring.gapHalf + Math.PI * 2,
        );
        ctx.stroke();

        // Ink edge, so it reads as built rather than as a coloured band.
        ctx.globalAlpha = 1;
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(rings.cx, rings.cy, ring.radius + ring.thickness / 2, ring.gapAt + ring.gapHalf, ring.gapAt - ring.gapHalf + Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rings.cx, rings.cy, ring.radius - ring.thickness / 2, ring.gapAt + ring.gapHalf, ring.gapAt - ring.gapHalf + Math.PI * 2);
        ctx.stroke();
      } else {
        // Answered. A thin rule: still there, no longer in the way.
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 3;
        ctx.setLineDash([18, 14]);
        ctx.beginPath();
        ctx.arc(rings.cx, rings.cy, ring.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // The core: what the whole campaign has been walking toward.
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(rings.cx, rings.cy, rings.coreRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = theme.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 46px ${DISPLAY}`;
    ctx.fillText('SAVE', rings.cx, rings.cy - 24);
    ctx.fillText('FACE', rings.cx, rings.cy + 24);

    ctx.restore();
  }

  /**
   * Window rows on a downtown building.
   *
   * Stepped on a fixed pitch and clipped to the block, so a wide squat building
   * gets many small windows and a narrow tall one gets a column of them. The
   * pattern comes from the block's own position rather than a random draw, which
   * keeps it identical for two players on one seed and costs nothing to compute.
   */
  private drawWindows(block: { x: number; y: number; w: number; h: number }): void {
    const ctx = this.ctx;
    const pitch = 30;
    const size = 13;
    const inset = 16;

    ctx.save();
    ctx.beginPath();
    ctx.rect(block.x + inset, block.y + inset, block.w - inset * 2, block.h - inset * 2);
    ctx.clip();

    ctx.fillStyle = theme.ink;
    ctx.globalAlpha = 0.5;
    for (let wy = block.y + inset; wy < block.y + block.h - inset; wy += pitch) {
      for (let wx = block.x + inset; wx < block.x + block.w - inset; wx += pitch) {
        /*
         * A few are dark. Every window lit identically reads as a texture swatch
         * rather than a building, and the choice is made from the coordinates so
         * it is stable rather than flickering every frame.
         */
        const lit = ((wx * 7 + wy * 13) >> 4) % 5 !== 0;
        if (!lit) continue;
        ctx.fillRect(wx, wy, size, size);
      }
    }
    ctx.restore();
  }

  /**
   * One car body, used for the one you drive and the ones hunting you.
   *
   * Shared deliberately. Two vehicles drawn by two pieces of code drift apart,
   * and the moment a patrol car stops reading as the same KIND of object as your
   * own the player stops being able to judge it. What differs is paint and one
   * detail, which is enough to tell them apart and not enough to make them
   * separate ideas.
   */
  private drawCarBody(
    x: number,
    y: number,
    heading: number,
    radius: number,
    paint: string,
    hostile: boolean,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);

    const w = radius * 2.1;
    const h = radius * 1.35;

    ctx.fillStyle = paint;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 6);
    ctx.fill();
    ctx.stroke();

    // A windscreen, so which end is the front is readable at a glance.
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.roundRect(w * 0.12, -h * 0.28, w * 0.26, h * 0.56, 3);
    ctx.fill();

    /*
     * A hostile one carries a bar across the roof.
     *
     * The difference has to survive being glanced at from across a junction while
     * something is shooting, so it is a shape rather than only a colour: colour
     * alone fails for the colour blind and fails again on a stage whose palette
     * happens to sit near the paint. Danger, because that is what it is, and it
     * is the one place the palette allows crimson.
     */
    if (hostile) {
      ctx.fillStyle = theme.danger;
      ctx.beginPath();
      ctx.roundRect(-w * 0.16, -h * 0.5 - 3, w * 0.3, 6, 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * The gates: what makes the last stage a question rather than a corridor.
   *
   * A full-height barrier, so it reads as impassable from any altitude. The
   * question itself is drawn by the HUD, in the strip, because it is text to be
   * read rather than scenery to be flown past.
   */
  private drawSeals(state: RunState, camera: Camera): void {
    if (state.gates.length === 0) return;

    const ctx = this.ctx;

    for (const gate of state.gates) {
      if (gate.open) continue;
      if (!camera.visibleX(gate.x, 120)) continue;

      ctx.save();

      // Hatched rather than solid: the level behind it stays visible, because
      // wanting what is on the other side is what makes answering worth it.
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = theme.danger;
      ctx.lineWidth = 6;
      ctx.setLineDash([22, 16]);
      ctx.beginPath();
      ctx.moveTo(gate.x, CEILING);
      ctx.lineTo(gate.x, WORLD_HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = 1;
      const y = state.player.y;

      ctx.fillStyle = theme.danger;
      ctx.beginPath();
      ctx.roundRect(gate.x - 46, y - 46, 92, 28, 5);
      ctx.fill();

      ctx.fillStyle = theme.canvas;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 10px ${MONO}`;
      ctx.fillText(gate.missed > 0 ? 'STILL SHUT' : 'SEALED', gate.x, y - 32);

      ctx.restore();
    }
  }

  /**
   * The projects still standing, waiting to be picked up.
   *
   * A ticker on a plate, not a figure. These are not people being rescued and
   * drawing them as one would put them in the same visual category as the cast,
   * which is the one distinction the last stage rests on.
   */
  private drawAllies(state: RunState, camera: Camera): void {
    if (state.allies.length === 0) return;

    const ctx = this.ctx;

    for (const ally of state.allies) {
      if (!camera.visibleX(ally.x, 90)) continue;

      ctx.save();
      ctx.translate(ally.x, ally.y);

      if (ally.known) {
        // Smaller and quieter once you have its intel. It is following, not
        // asking to be found, and five full-size plates in a chain would drown
        // out the cast the stage is actually about.
        ctx.globalAlpha = 0.85;
        ctx.scale(0.72, 0.72);
      } else {
        // A slow bob, so one still waiting reads as waiting rather than scenery.
        ctx.translate(0, Math.sin(state.time * 1.6 + ally.rank) * 4);
      }

      ctx.font = `700 14px ${MONO}`;
      const width = Math.max(56, ctx.measureText(ally.ticker).width + 22);

      ctx.fillStyle = theme.canvas;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-width / 2, -19, width, 38, 5);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.ink;
      ctx.fillText(ally.ticker, 0, -4);

      /*
       * The figures appear only once the intel has been taken.
       *
       * This is the whole stage in one rule. A gate asks which of four is the
       * largest, or which held up best, and shows nothing but tickers. If the
       * numbers were readable from across the level the question would answer
       * itself and the detour would be pointless. Reaching a project is how you
       * learn them, and remembering them is how you get through the door.
       */
      if (ally.known) {
        const up = ally.changePct >= 0;
        ctx.fillStyle = up ? theme.accent : theme.danger;
        ctx.font = `700 10px ${MONO}`;
        ctx.fillText(`no.${ally.rank}  ${up ? '+' : ''}${ally.changePct.toFixed(1)}%`, 0, 10);
      } else {
        ctx.fillStyle = theme.inkFaint;
        ctx.font = `700 9px ${MONO}`;
        ctx.fillText('GO AND ASK', 0, 10);
      }

      ctx.restore();
    }
  }

  /** A small plate of text in the world. Shared by the car and the cells. */
  private drawTag(x: number, y: number, label: string, live: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 12px ${MONO}`;
    const width = ctx.measureText(label).width + 16;

    ctx.fillStyle = live ? theme.accent : theme.ink;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - 10, width, 20, 4);
    ctx.fill();

    ctx.fillStyle = live ? theme.ink : theme.canvas;
    ctx.fillText(label, x, y + 4);
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
      // Everyone in the city is dressed for it, the people you are pulling out
      // included. It is the same day and the same crowd, one floor down.
      suit: state.city !== null,
      seed: face.handle,
      avatar: this.avatars.get(face.avatarUrl),
      alpha: 1,
      firing: false,
      label: face.state === 'trapped' ? handleTag(face) : null,
    });
  }

  private drawEnemies(state: RunState, camera: Camera): void {
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      /*
       * In a city, an attacker is drawn whether or not it has noticed you.
       *
       * This is not a cosmetic choice, it is the stage. A city attacker only
       * becomes `active` once it has SENSED the player, so hiding the inactive
       * ones meant every patrol walking its beat was invisible until the moment
       * it turned on you. Seeing it first is the entire advantage that being on
       * foot buys, and the game was refusing to show it.
       *
       * Together with the same guard on the bullet test, it also explains the
       * playtest report that attackers could only be killed from the car:
       * driving is sensed from much further away, so climbing in was what made
       * them appear and become hittable at all.
       *
       * A chart run keeps the old rule. There an attacker wakes at eight hundred
       * units, further than the view, so nothing is hidden that could be seen and
       * a sleeping turret two ridges ahead should not be drawn mid-air.
       */
      if (!state.city && !enemy.active) continue;
      if (!camera.visibleX(enemy.x, 80)) continue;
      this.drawEnemy(state, enemy);
    }
  }

  private drawEnemy(state: RunState, enemy: Enemy): void {
    const toPlayer = Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x);
    const role: Role = enemy.kind;

    /*
     * The ones in cars are a car with somebody in it.
     *
     * Drawn heading-first from its own travel direction rather than aimed at the
     * player, because a vehicle points where it is going. That is also the tell
     * that makes them readable: a patrol car crossing a junction is side-on and
     * obviously not looking at you, and one that has noticed you is pointed
     * straight down the street you are standing in.
     */
    if (enemy.driving) {
      const moving = Math.hypot(enemy.vx, enemy.vy) > 8;
      const heading = state.time < enemy.alertUntil
        ? toPlayer
        : moving
          ? Math.atan2(enemy.vy, enemy.vx)
          : enemy.patrolHeading;

      this.drawCarBody(enemy.x, enemy.y, heading, PATROL_CAR_RADIUS, ENEMY_CAR_PAINT, true);

      /*
       * The occupant is a head behind glass, not a figure.
       *
       * Drawing the full human here put a standing person on top of the roof:
       * drawHuman plants its feet at the y it is given and builds upward, which
       * is correct in a side view and nonsense in a plan view of a car. Top down,
       * all you can see of somebody in a vehicle is the top of their head, and
       * that is all it takes to say there is a person in there to shoot at.
       */
      const cabinX = enemy.x + Math.cos(heading) * PATROL_CAR_RADIUS * 0.42;
      const cabinY = enemy.y + Math.sin(heading) * PATROL_CAR_RADIUS * 0.42;
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = theme.canvas;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cabinX, cabinY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      return;
    }

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
      suit: state.city !== null,
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
      suit: state.city !== null,
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

/**
 * Name the control the player actually has in front of them.
 *
 * A phone has no number row, so "PRESS 1" was an instruction with nowhere to
 * carry it out. The charge is the first of the four buys, which on a touch
 * device is a labelled button on screen rather than a key, so the prompt says
 * what is written on it. Being told to press something that does not exist
 * reads as the game being broken, not as the player missing something.
 */
function breachPrompt(label: string): string {
  return touchCapable() ? `TAP ${label} TO BLOW THE DOOR` : 'PRESS 1 TO BLOW THE DOOR';
}
