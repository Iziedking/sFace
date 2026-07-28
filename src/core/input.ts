/**
 * Two-thumb touch, with a mouse and keyboard fallback so the game is testable
 * on a desktop without a phone in hand.
 *
 * The screen splits down the middle. A touch that lands on the left half
 * becomes a floating stick anchored wherever the thumb went down, which beats
 * a fixed stick because nobody looks at their thumb. A touch on the right half
 * aims and holds fire.
 *
 * Coordinates here are CSS pixels relative to the canvas. Converting to world
 * space is the camera's job, and this file deliberately knows nothing about
 * the player, the world, or the run.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface StickView {
  /** Where the thumb went down. */
  origin: Vec2;
  /** Where it is now, clamped to the stick radius. */
  current: Vec2;
}

/** Past this distance the stick is at full tilt. */
const STICK_RADIUS = 64;
/** Inside this, treat it as no input, so a resting thumb does not drift. */
const STICK_DEADZONE = 8;

export class Input {
  /** Thrust direction, each axis in [-1, 1]. */
  readonly move: Vec2 = { x: 0, y: 0 };
  /** Where the player is aiming, in canvas CSS pixels. Null when not aiming. */
  aim: Vec2 | null = null;
  /** True while the fire thumb is held. */
  firing = false;

  /** Exposed so the HUD can draw the stick where the thumb actually is. */
  stick: StickView | null = null;

  private movePointer: number | null = null;
  private aimPointer: number | null = null;
  private stickOrigin: Vec2 = { x: 0, y: 0 };
  private keys = new Set<string>();
  private detachers: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.attach();
  }

  /** Drop every listener. Called when the run screen tears down. */
  destroy(): void {
    for (const off of this.detachers) off();
    this.detachers = [];
    this.reset();
  }

  /** Clear held state, used when a run ends so input does not leak forward. */
  reset(): void {
    this.move.x = 0;
    this.move.y = 0;
    this.aim = null;
    this.firing = false;
    this.stick = null;
    this.movePointer = null;
    this.aimPointer = null;
    this.keys.clear();
  }

  private attach(): void {
    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLCanvasElement,
      type: K,
      handler: (event: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(type, handler as EventListener, options);
      this.detachers.push(() =>
        target.removeEventListener(type, handler as EventListener, options),
      );
    };

    on(this.canvas, 'pointerdown', this.onDown);
    on(window, 'pointermove', this.onMove);
    on(window, 'pointerup', this.onUp);
    on(window, 'pointercancel', this.onUp);
    on(window, 'keydown', this.onKeyDown);
    on(window, 'keyup', this.onKeyUp);

    // A dropped pointerup while the tab is hidden leaves a thumb stuck down.
    // Clearing on blur is cheaper than reconciling it later.
    on(window, 'blur', this.reset);
  }

  private local(event: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onDown = (event: PointerEvent): void => {
    const point = this.local(event);
    const leftHalf = point.x < this.canvas.clientWidth / 2;

    if (leftHalf && this.movePointer === null) {
      this.movePointer = event.pointerId;
      this.stickOrigin = point;
      this.stick = { origin: point, current: point };
      return;
    }

    if (!leftHalf && this.aimPointer === null) {
      this.aimPointer = event.pointerId;
      this.aim = point;
      this.firing = true;
    }
  };

  private onMove = (event: PointerEvent): void => {
    const point = this.local(event);

    if (event.pointerId === this.movePointer) {
      const dx = point.x - this.stickOrigin.x;
      const dy = point.y - this.stickOrigin.y;
      const distance = Math.hypot(dx, dy);

      if (distance < STICK_DEADZONE) {
        this.move.x = 0;
        this.move.y = 0;
      } else {
        const clamped = Math.min(distance, STICK_RADIUS);
        this.move.x = (dx / distance) * (clamped / STICK_RADIUS);
        this.move.y = (dy / distance) * (clamped / STICK_RADIUS);
      }

      const scale = distance > STICK_RADIUS ? STICK_RADIUS / distance : 1;
      this.stick = {
        origin: this.stickOrigin,
        current: {
          x: this.stickOrigin.x + dx * scale,
          y: this.stickOrigin.y + dy * scale,
        },
      };
      return;
    }

    if (event.pointerId === this.aimPointer) {
      this.aim = point;
    }
  };

  private onUp = (event: PointerEvent): void => {
    if (event.pointerId === this.movePointer) {
      this.movePointer = null;
      this.move.x = 0;
      this.move.y = 0;
      this.stick = null;
      return;
    }

    if (event.pointerId === this.aimPointer) {
      this.aimPointer = null;
      this.firing = false;
      // Keep the last aim so the ship does not snap back to facing right.
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    this.applyKeys();
    if (event.code === 'Space') {
      this.firing = true;
      event.preventDefault();
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    this.applyKeys();
    if (event.code === 'Space') this.firing = false;
  };

  /** Desktop testing only. Touch always wins if both are in play. */
  private applyKeys(): void {
    if (this.movePointer !== null) return;
    const held = (...codes: string[]): number =>
      codes.some((code) => this.keys.has(code)) ? 1 : 0;

    this.move.x =
      held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft');
    this.move.y = held('KeyS', 'ArrowDown') - held('KeyW', 'ArrowUp');
  }
}
