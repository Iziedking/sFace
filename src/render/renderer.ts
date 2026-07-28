/**
 * Draws the world.
 *
 * The identity of this game is that you are flying inside a trading terminal,
 * so the chart is the hero. It gets the grid behind it, the glow on it, and the
 * accent colour. Everything else is drawn plainly so the chart stays the thing
 * you look at.
 *
 * Performance notes, because this targets a WebView on a mid phone:
 * shadowBlur is expensive per draw call, so it is used exactly twice, on the
 * chart line and the extraction beacon, both of which are single strokes.
 * Entities fake their glow with a second larger, dimmer shape, which costs a
 * fill instead of a blur pass. Everything off screen is culled on x before any
 * path is built.
 */

import { theme, MONO } from './theme';
import type { Camera } from './camera';
import type { Effects } from './effects';
import type { Enemy, Face, RunState } from '../game/state';
import type { Squad } from '../game/squad';
import { POINT_SPACING, WORLD_HEIGHT, EXTRACTION_X, CEILING } from '../game/terrain';
import { PLAYER_RADIUS } from '../game/player';
import { radiusOf } from '../game/enemy';
import { FACE_RADIUS } from '../game/face';
import { BULLET_RADIUS } from '../game/bullet';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
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

  draw(state: RunState, camera: Camera, effects: Effects, squad?: Squad): void {
    const ctx = this.ctx;

    ctx.save();
    // setTransform in resize already carries the DPR, so reapply it rather
    // than assuming the identity here.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = theme.void;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    camera.applyTo(ctx);

    this.drawGrid(camera);
    this.drawTerrain(state, camera);
    this.drawExtraction(state, camera);
    this.drawFaces(state, camera);
    this.drawEnemies(state, camera);
    this.drawBullets(state, camera);
    // Squadmates go under the player, so your own ship is never hidden behind
    // somebody else's at the moment you need to see it.
    if (squad) this.drawSquad(squad, camera);
    this.drawPlayer(state);
    effects.drawWorld(ctx);

    ctx.restore();

    effects.drawScreen(ctx, this.width, this.height);
    ctx.restore();
  }

  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /** The terminal behind the chart. Parallaxed so it reads as depth, not wallpaper. */
  private drawGrid(camera: Camera): void {
    const ctx = this.ctx;
    const spacing = 120;
    const parallax = 0.55;

    // Offset the grid by a fraction of the camera so it slides slower than the
    // world. Drawn in world space, so the offset has to be added back.
    const drift = camera.left * (1 - parallax);
    const startX = Math.floor((camera.left - drift) / spacing) * spacing + drift;

    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    for (let x = startX; x < camera.left + camera.viewW; x += spacing) {
      ctx.moveTo(x, CEILING);
      ctx.lineTo(x, WORLD_HEIGHT);
    }
    for (let y = CEILING; y <= WORLD_HEIGHT; y += spacing) {
      ctx.moveTo(camera.left, y);
      ctx.lineTo(camera.left + camera.viewW, y);
    }
    ctx.stroke();

    // The ceiling reads as the top of the chart pane, so it gets a real line.
    ctx.strokeStyle = theme.gridStrong;
    ctx.beginPath();
    ctx.moveTo(camera.left, CEILING);
    ctx.lineTo(camera.left + camera.viewW, CEILING);
    ctx.stroke();
  }

  /** The chart, as ground. This is the whole premise, so it gets the glow. */
  private drawTerrain(state: RunState, camera: Camera): void {
    const ctx = this.ctx;
    const terrain = state.terrain;

    const from = Math.max(0, Math.floor((camera.left - POINT_SPACING) / POINT_SPACING));
    const to = Math.min(
      terrain.heights.length - 1,
      Math.ceil((camera.left + camera.viewW + POINT_SPACING) / POINT_SPACING),
    );

    const path = new Path2D();
    path.moveTo(from * POINT_SPACING, terrain.heights[from] ?? WORLD_HEIGHT);
    for (let i = from + 1; i <= to; i++) {
      path.lineTo(i * POINT_SPACING, terrain.heights[i] ?? WORLD_HEIGHT);
    }

    const fill = new Path2D(path);
    fill.lineTo(to * POINT_SPACING, WORLD_HEIGHT);
    fill.lineTo(from * POINT_SPACING, WORLD_HEIGHT);
    fill.closePath();

    const gradient = ctx.createLinearGradient(0, camera.top, 0, WORLD_HEIGHT);
    gradient.addColorStop(0, theme.accentSoft);
    gradient.addColorStop(1, 'rgba(255, 162, 43, 0.02)');
    ctx.fillStyle = gradient;
    ctx.fill(fill);

    // Solid mass under the line, so the ground reads as ground rather than as
    // a tinted region you might be able to fly through.
    ctx.fillStyle = 'rgba(8, 9, 13, 0.55)';
    ctx.fill(fill);

    ctx.save();
    ctx.shadowColor = theme.accentDim;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.restore();
  }

  private drawExtraction(state: RunState, camera: Camera): void {
    if (!camera.visibleX(EXTRACTION_X, 200)) return;

    const ctx = this.ctx;
    const groundY = state.terrain.groundAt(EXTRACTION_X);

    const beam = ctx.createLinearGradient(0, CEILING, 0, groundY);
    beam.addColorStop(0, 'rgba(255, 162, 43, 0)');
    beam.addColorStop(1, 'rgba(255, 162, 43, 0.22)');
    ctx.fillStyle = beam;
    ctx.fillRect(EXTRACTION_X - 26, CEILING, 52, groundY - CEILING);

    ctx.save();
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(EXTRACTION_X, groundY);
    ctx.lineTo(EXTRACTION_X, CEILING + 40);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = theme.accent;
    ctx.font = `700 13px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('EXTRACTION', EXTRACTION_X, CEILING + 32);
  }

  private drawFaces(state: RunState, camera: Camera): void {
    const ctx = this.ctx;
    const pulse = 0.5 + Math.sin(state.time * 3.4) * 0.5;

    for (const face of state.faces) {
      if (face.state === 'extracted' || face.state === 'lost') continue;
      if (!camera.visibleX(face.x)) continue;

      if (face.state === 'trapped') {
        // A ring that breathes, so a trapped face is findable at a glance
        // without a minimap or an arrow cluttering the HUD.
        ctx.strokeStyle = `rgba(255, 162, 43, ${0.25 + pulse * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(face.x, face.y, FACE_RADIUS + 10 + pulse * 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      this.drawFaceBody(face);
    }
  }

  private drawFaceBody(face: Face): void {
    const ctx = this.ctx;
    const r = FACE_RADIUS;

    ctx.fillStyle = theme.face;
    ctx.beginPath();
    ctx.roundRect(face.x - r, face.y - r, r * 2, r * 2, 5);
    ctx.fill();

    // Two eyes and a flat mouth. At this size anything more is mud.
    ctx.fillStyle = theme.void;
    ctx.fillRect(face.x - 6, face.y - 5, 3, 4);
    ctx.fillRect(face.x + 3, face.y - 5, 3, 4);
    ctx.fillRect(face.x - 5, face.y + 4, 10, 2);
  }

  private drawEnemies(state: RunState, camera: Camera): void {
    for (const enemy of state.enemies) {
      if (!enemy.alive || !enemy.active) continue;
      if (!camera.visibleX(enemy.x)) continue;
      this.drawEnemy(enemy);
    }
  }

  private drawEnemy(enemy: Enemy): void {
    const ctx = this.ctx;
    const r = radiusOf(enemy);

    // Fake glow: one oversized translucent shape instead of a blur pass. Kept
    // tight, because a wide halo on a near-black background stops reading as
    // light and starts reading as a dark disc the enemy is sitting inside.
    ctx.fillStyle = theme.dangerSoft;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r + 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.danger;

    switch (enemy.kind) {
      case 'drifter': {
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = theme.void;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'diver': {
        // Points where it is going, so its intent is readable at speed.
        const angle = Math.atan2(enemy.vy, enemy.vx);
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(r * 1.4, 0);
        ctx.lineTo(-r * 0.8, -r * 0.85);
        ctx.lineTo(-r * 0.8, r * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'turret': {
        ctx.beginPath();
        ctx.moveTo(enemy.x - r, enemy.y + r * 0.9);
        ctx.lineTo(enemy.x - r * 0.55, enemy.y - r * 0.7);
        ctx.lineTo(enemy.x + r * 0.55, enemy.y - r * 0.7);
        ctx.lineTo(enemy.x + r, enemy.y + r * 0.9);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
  }

  private drawBullets(state: RunState, camera: Camera): void {
    const ctx = this.ctx;

    for (const bullet of state.bullets) {
      if (bullet.life <= 0) continue;
      if (!camera.visibleX(bullet.x, 40)) continue;

      const colour = bullet.friendly ? theme.accent : theme.danger;
      const soft = bullet.friendly ? theme.accentSoft : theme.dangerSoft;

      ctx.fillStyle = soft;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, BULLET_RADIUS + 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, BULLET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Squadmates, whether they are recordings or live players. Drawn from the
   * same struct through the same code, because by the time it reaches here
   * there is no difference worth encoding.
   *
   * They are translucent and unlit, which is the honest signal: a squadmate
   * cannot shoot you, cannot be shot, and cannot take a face you were going
   * for. Drawing them as solid as your own ship would promise otherwise.
   */
  private drawSquad(squad: Squad, camera: Camera): void {
    const ctx = this.ctx;

    for (const mate of squad.members) {
      const pose = mate.pose;
      if (!pose || !camera.visibleX(pose.x, 60)) continue;

      ctx.save();
      ctx.globalAlpha = pose.down ? 0.16 : 0.4;
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.angle);

      ctx.fillStyle = mate.source === 'live' ? theme.accent : theme.ink;
      ctx.beginPath();
      ctx.moveTo(PLAYER_RADIUS * 1.25, 0);
      ctx.lineTo(-PLAYER_RADIUS * 0.75, -PLAYER_RADIUS * 0.8);
      ctx.lineTo(-PLAYER_RADIUS * 0.4, 0);
      ctx.lineTo(-PLAYER_RADIUS * 0.75, PLAYER_RADIUS * 0.8);
      ctx.closePath();
      ctx.fill();

      if (pose.firing) {
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(PLAYER_RADIUS * 1.5, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // A pip per face they are towing, so you can see who is doing well.
      if (pose.carrying > 0) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = theme.face;
        for (let i = 0; i < pose.carrying; i++) {
          ctx.fillRect(pose.x - 10 + i * 7, pose.y - PLAYER_RADIUS - 22, 5, 5);
        }
      }

      ctx.globalAlpha = 0.55;
      ctx.fillStyle = mate.source === 'live' ? theme.accent : theme.inkMuted;
      ctx.font = `500 11px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(mate.name, pose.x, pose.y - PLAYER_RADIUS - 8);
      ctx.globalAlpha = 1;
    }
  }

  private drawPlayer(state: RunState): void {
    const ctx = this.ctx;
    const player = state.player;

    // Blink through invulnerability so the player can see they are in it.
    const blinking = state.time < player.invulnerableUntil;
    if (blinking && Math.floor(state.time * 14) % 2 === 0) return;

    const angle = Math.atan2(player.aimY, player.aimX);
    const thrust = Math.hypot(player.vx, player.vy) / 400;

    ctx.save();
    ctx.translate(player.x, player.y);

    // Jetpack plume, drawn opposite the ship's travel rather than its aim, so
    // it points where the thrust is actually going.
    if (thrust > 0.08) {
      const travel = Math.atan2(player.vy, player.vx);
      ctx.save();
      ctx.rotate(travel);
      const length = 12 + thrust * 26;
      const plume = ctx.createLinearGradient(-PLAYER_RADIUS, 0, -PLAYER_RADIUS - length, 0);
      plume.addColorStop(0, 'rgba(255, 162, 43, 0.85)');
      plume.addColorStop(1, 'rgba(255, 162, 43, 0)');
      ctx.fillStyle = plume;
      ctx.beginPath();
      ctx.moveTo(-PLAYER_RADIUS, -5);
      ctx.lineTo(-PLAYER_RADIUS - length, 0);
      ctx.lineTo(-PLAYER_RADIUS, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.rotate(angle);

    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.moveTo(PLAYER_RADIUS * 1.25, 0);
    ctx.lineTo(-PLAYER_RADIUS * 0.75, -PLAYER_RADIUS * 0.8);
    ctx.lineTo(-PLAYER_RADIUS * 0.4, 0);
    ctx.lineTo(-PLAYER_RADIUS * 0.75, PLAYER_RADIUS * 0.8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(PLAYER_RADIUS * 0.3, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
