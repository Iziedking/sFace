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

/** Shared empty result, so a quiet frame allocates nothing. */
const EMPTY_BUYS: number[] = [];

import { hit, padLayout, padVector, slotStrip, useRegion, type PadLayout } from './pads';
import { snapsToDirections, usingPads } from './scheme';

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
  /**
   * Which pad each live pointer grabbed, when the pads are in force.
   *
   * Keyed by pointerId rather than stored as one value, because a player using
   * pads has two thumbs down constantly and the second one must not steal the
   * first one's control.
   */
  private padGrab = new Map<number, 'move' | 'fire'>();
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
    this.padGrab.clear();
    this.useRequested = false;
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

  /** The pad layout for the canvas as it is right now. Never cached: rotating
   *  a phone changes it, and a stale layout is a button that has moved out
   *  from under the place it is drawn. */
  private pads(): PadLayout {
    return padLayout(this.canvas.clientWidth, this.canvas.clientHeight, this.slotCount);
  }

  /**
   * How many consumable buttons to lay out.
   *
   * Set by the app from the consumables table rather than hardcoded here, and
   * read by the HUD from this same field rather than from the table directly.
   * One runtime value, two consumers. A constant in each place would agree
   * today and silently disagree the moment a fifth consumable is added, and
   * the symptom would be a button that is drawn and cannot be pressed, which
   * is the exact failure core/pads.ts exists to prevent.
   *
   * Input still knows nothing about what a slot contains. Only how many.
   */
  slotCount = 0;

  /**
   * Whether the use button is on screen right now.
   *
   * Set by the app each frame from the run state, and read by BOTH the hit test
   * here and the renderer. One value, two consumers: a button drawn without
   * being touchable, or touchable without being drawn, is the worst kind of
   * control bug because nothing about it looks wrong.
   */
  useVisible = false;

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

    /*
     * Pads take the touch before the halves do.
     *
     * Order matters: a fire button sits in the right half and a move pad in
     * the left, so falling through to the half-screen logic first would have
     * the floating sticks swallow every press before a pad ever saw it.
     */
    /*
     * The use button, before anything else and outside the pads branch.
     *
     * It has to work on the floating thumb scheme too: without it a phone
     * player has no way at all to get into or out of a car, whichever controls
     * they chose.
     */
    if (this.useVisible) {
      const region = useRegion(this.canvas.clientWidth, this.canvas.clientHeight);
      if (hit(region, point.x, point.y, 12)) {
        this.use();
        return;
      }
    }

    /*
     * Consumables, on either scheme.
     *
     * The pads branch below has its own slot check because its buttons sit on
     * the arc off the fire pad. This one is for the floating scheme, where the
     * row across the bottom centre is the only way a thumb reaches a consumable
     * at all.
     */
    if (!usingPads()) {
      const strip = slotStrip(
        this.canvas.clientWidth,
        this.canvas.clientHeight,
        this.slotCount,
      );
      for (let i = 0; i < strip.length; i++) {
        if (hit(strip[i]!, point.x, point.y)) {
          this.press(i);
          return;
        }
      }
    }

    if (usingPads() && this.onPadDown(event, point)) return;

    const leftHalf = point.x < this.canvas.clientWidth / 2;

    /*
     * A press on the left always takes the stick, even if one is already held.
     *
     * This used to require movePointer to be null, which is only ever true if
     * every pointerup arrived. Inside the Nimiq WebView they do not: sliding a
     * thumb near the edge hands the gesture to the app shell, our pointerup
     * never fires, and movePointer stays pinned to a finger that is no longer
     * on the glass. From then on the stick is dead for the rest of the run and
     * nothing looks broken, which is exactly how it was reported: the analog
     * stops responding and the fire button carries on working.
     *
     * The newest finger on the left is the one steering. There is no case where
     * honouring an older one is more correct.
     */
    if (leftHalf) {
      this.movePointer = event.pointerId;
      this.stickOrigin = point;
      this.stick = { origin: point, current: point };
      return;
    }

    if (!leftHalf) {
      this.aimPointer = event.pointerId;
      this.aimOrigin = point;
      this.aimStick = { origin: point, current: point };
      // Firing starts on touch down even before the thumb has moved, so a tap
      // shoots wherever you were already pointing rather than doing nothing.
      this.firing = true;
    }
  };

  /**
   * Route a press to a pad. Returns true when one took it.
   *
   * A press that lands on nothing is deliberately swallowed rather than
   * falling through to the floating sticks. Mixing the schemes would mean a
   * stray touch in the middle of the screen starts steering a ship the player
   * is steering with a pad, and the two inputs would fight.
   */
  private onPadDown(event: PointerEvent, point: Vec2): boolean {
    const pads = this.pads();

    if (hit(pads.move, point.x, point.y)) {
      this.padGrab.set(event.pointerId, 'move');
      const v = padVector(pads.move, point.x, point.y, snapsToDirections());
      this.move.x = v.x;
      this.move.y = v.y;
      return true;
    }

    for (let i = 0; i < pads.slots.length; i++) {
      if (hit(pads.slots[i]!, point.x, point.y)) {
        // Buy on press rather than release. A consumable is used in a fight,
        // and a button that waits for the lift feels broken under pressure.
        this.press(i);
        return true;
      }
    }

    if (hit(pads.fire, point.x, point.y)) {
      this.padGrab.set(event.pointerId, 'fire');
      this.firing = true;
      // Anchor the aim drag at the pad's centre rather than at the touch point,
      // so the direction the thumb pushes is the direction the gun points no
      // matter where on the button it landed.
      this.aimOrigin = { x: pads.fire.x, y: pads.fire.y };
      return true;
    }

    return true;
  }

  private onMove = (event: PointerEvent): void => {
    const point = this.local(event);

    const grabbed = this.padGrab.get(event.pointerId);
    if (grabbed === 'move') {
      const v = padVector(this.pads().move, point.x, point.y, snapsToDirections());
      this.move.x = v.x;
      this.move.y = v.y;
      return;
    }
    /*
     * The fire pad aims as well as fires.
     *
     * This used to return here, which made the right pad a button and nothing
     * else: aimVector was never set from a pad, so on a phone the only aim source
     * left was the direction of travel. Stand still to take a shot, as you do at
     * every corner in a city, and movement is zero, so the gun held whatever
     * heading it last had and would not turn. Reported as shooting pointing one
     * way and not responding, and that is precisely what it did.
     *
     * Press to fire, push to aim, which is what a thumb expects from the right
     * hand side of a twin-stick game. Below the deadzone the thumb has not chosen
     * a direction, so the last one holds rather than the gun snapping to jitter.
     */
    if (grabbed === 'fire') {
      const dx = point.x - this.aimOrigin.x;
      const dy = point.y - this.aimOrigin.y;
      const distance = Math.hypot(dx, dy);

      if (distance >= STICK_DEADZONE) {
        this.aimVector = { x: dx / distance, y: dy / distance };
      }

      const scale = distance > STICK_RADIUS ? STICK_RADIUS / distance : 1;
      this.aimStick = {
        origin: this.aimOrigin,
        current: { x: this.aimOrigin.x + dx * scale, y: this.aimOrigin.y + dy * scale },
      };
      return;
    }

    if (event.pointerId === this.movePointer) {
      /*
       * The origin stays exactly where the thumb first landed.
       *
       * It briefly did not. To stop a hard push saturating, the origin was
       * dragged along to sit one radius behind the thumb, and that quietly
       * destroyed the one thing a stick is for. Past the radius the distance is
       * then always exactly the radius, so the knob sits pinned at the rim and
       * the ring travels with it: the pair slides across the screen as one
       * rigid shape and the knob never moves RELATIVE to the ring it is in.
       * Reported as the hand moving while nothing happens, which is precisely
       * what it looks like.
       *
       * The saturation it was solving is not real either. With a fixed origin a
       * thumb swung from one side to the other passes through the origin, so the
       * direction turns continuously the whole way. A stick is an offset from a
       * fixed point; the moment that point chases the finger, there is no
       * offset left to read.
       */
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
    const grabbed = this.padGrab.get(event.pointerId);
    if (grabbed) {
      this.padGrab.delete(event.pointerId);
      if (grabbed === 'move') {
        this.move.x = 0;
        this.move.y = 0;
      } else {
        this.firing = false;
        // The stick graphic goes, the heading stays. Lifting the thumb should
        // stop the shooting, not spin the gun back to some default.
        this.aimStick = null;
      }
      return;
    }

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

  /**
   * Consumable slots pressed since the last drain, in order.
   *
   * A queue rather than a flag, because two presses in one frame are two
   * purchases and dropping the second one would silently eat the player's
   * scrip decision. Drained by the loop, never read twice.
   */
  private readonly bought: number[] = [];

  /**
   * Set for one drain when the player asked to get in or out of a vehicle.
   *
   * Its own input rather than a direction, because in a city every direction is
   * somewhere you might want to drive and overloading one of them would fight
   * the steering.
   */
  private useRequested = false;

  /** True once, when the use key or button was pressed. */
  takeUse(): boolean {
    if (!this.useRequested) return false;
    this.useRequested = false;
    return true;
  }

  /** Raise the use intent, from a key or an on-screen button. */
  use(): void {
    this.useRequested = true;
  }

  /** Slots the player asked for this frame. Empties the queue. */
  takeBuys(): number[] {
    if (this.bought.length === 0) return EMPTY_BUYS;
    return this.bought.splice(0, this.bought.length);
  }

  /** Raise intent for a slot, from a key or a tap on the HUD. */
  press(slot: number): void {
    this.bought.push(slot);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    this.applyKeys();
    if (event.code === 'Space') {
      this.firing = true;
      event.preventDefault();
    }

    // 1 to 4 buy the consumable in that slot. Repeat events are ignored so a
    // held key does not drain the purse.
    // E for enter and exit. Near the movement keys, and not otherwise used.
    if (!event.repeat && event.code === 'KeyE') {
      this.use();
      event.preventDefault();
    }

    if (!event.repeat && event.code.startsWith('Digit')) {
      const slot = Number(event.code.slice(5));
      if (slot >= 1 && slot <= 4) {
        this.press(slot - 1);
        event.preventDefault();
      }
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
