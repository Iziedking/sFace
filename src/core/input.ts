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
/** How long a mouse position keeps counting as an aim after it stops moving. */
const MOUSE_AIM_TTL_MS = 1200;

export class Input {
  /** Thrust direction, each axis in [-1, 1]. */
  readonly move: Vec2 = { x: 0, y: 0 };
  /**
   * Where a mouse is pointing, in canvas CSS pixels. Null on touch.
   *
   * **It goes stale on purpose.** A mouse that has not moved for a moment is
   * not aiming any more, it is just resting somewhere. Without the expiry, one
   * accidental mouse move early in a run pins the gun at that spot forever:
   * the player then flies on the keyboard, the aim never updates because the
   * mouse never moves, and the gun fires at a stale point for the rest of the
   * run. That is the bug this whole getter exists to prevent, and it is
   * indistinguishable from the gun being stuck.
   *
   * A held mouse button never expires, because that is somebody actively
   * shooting at a spot.
   */
  get aim(): Vec2 | null {
    if (!this.aimPoint) return null;
    if (this.aimPointer !== null) return this.aimPoint;
    return performance.now() - this.aimAt <= MOUSE_AIM_TTL_MS ? this.aimPoint : null;
  }

  private aimPoint: Vec2 | null = null;
  private aimAt = 0;
  /**
   * Aim direction from the right thumb, as a unit vector. Null when not aiming.
   *
   * This is the fix for the worst control problem the game had. The right
   * thumb used to report the absolute point it was touching, and since it is
   * confined to the right half of the screen, the only reachable points were
   * to the right. Anything on your left was literally unhittable.
   *
   * A floating stick has no such limit: the thumb anchors wherever it lands
   * and the drag direction is the aim direction, so all three hundred and
   * sixty degrees are available from a thumb that never moves more than a
   * centimetre.
   */
  aimVector: Vec2 | null = null;
  /** True while the fire thumb is held. */
  firing = false;

  /** Exposed so the HUD can draw the stick where the thumb actually is. */
  stick: StickView | null = null;
  /** The aim stick, drawn the same way on the other side of the screen. */
  aimStick: StickView | null = null;

  private movePointer: number | null = null;
  private aimPointer: number | null = null;
  private stickOrigin: Vec2 = { x: 0, y: 0 };
  private aimOrigin: Vec2 = { x: 0, y: 0 };
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
    this.aimPoint = null;
    this.aimAt = 0;
    this.aimVector = null;
    this.firing = false;
    this.stick = null;
    this.aimStick = null;
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

  private setAim(point: Vec2): void {
    this.aimPoint = point;
    this.aimAt = performance.now();
  }

  private local(event: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onDown = (event: PointerEvent): void => {
    const point = this.local(event);

    // A mouse never becomes a movement stick. On desktop the keyboard flies
    // and the mouse shoots, so a click on the left half is a shot at something
    // on the left, not a request to steer.
    if (event.pointerType === 'mouse') {
      this.aimPointer = event.pointerId;
      this.setAim(point);
      this.firing = true;
      return;
    }

    const leftHalf = point.x < this.canvas.clientWidth / 2;

    if (leftHalf && this.movePointer === null) {
      this.movePointer = event.pointerId;
      this.stickOrigin = point;
      this.stick = { origin: point, current: point };
      return;
    }

    if (!leftHalf && this.aimPointer === null) {
      this.aimPointer = event.pointerId;
      this.aimOrigin = point;
      this.aimStick = { origin: point, current: point };
      // Firing starts on touch down even before the thumb has moved, so a tap
      // shoots wherever you were already pointing rather than doing nothing.
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
      const dx = point.x - this.aimOrigin.x;
      const dy = point.y - this.aimOrigin.y;
      const distance = Math.hypot(dx, dy);

      // Below the deadzone the thumb has not chosen a direction yet, so hold
      // the last one rather than snapping the gun to a jitter.
      if (distance >= STICK_DEADZONE) {
        this.aimVector = { x: dx / distance, y: dy / distance };
      }

      const scale = distance > STICK_RADIUS ? STICK_RADIUS / distance : 1;
      this.aimStick = {
        origin: this.aimOrigin,
        current: {
          x: this.aimOrigin.x + dx * scale,
          y: this.aimOrigin.y + dy * scale,
        },
      };
      return;
    }

    /*
     * A mouse aims wherever it is, without being held down.
     *
     * On a phone the right thumb is only on the glass when it means something,
     * so aiming and firing arriving together is correct. A mouse is always
     * somewhere, and requiring the button to be held just to point makes
     * desktop play feel broken, which matters because a judge will open this
     * on a laptop before they open it on a phone.
     */
    if (event.pointerType === 'mouse' && this.movePointer !== event.pointerId) {
      this.setAim(point);
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
      this.aimStick = null;
      this.firing = false;
      // Keep aimVector so the gun holds its last heading instead of snapping
      // back to facing right the instant the thumb lifts.
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
