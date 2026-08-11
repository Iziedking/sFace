/**
 * The tour, on screen.
 *
 * core/tour.ts decides what to say and when. This says it, and owns none of the
 * decisions, which is the same split hints.ts and the renderer already use.
 *
 * ## Why it is not drawn on the canvas
 *
 * Everything else in the run is, and this is the exception on purpose. The card
 * carries a Skip control that has to be pressable, and a pressable thing on the
 * canvas means teaching the input layer about a hit box that only exists during
 * a tutorial, on a device where every stray touch is also a flight command. The
 * screens layer already solves that: it is transparent and click-through during
 * a run, and only the controls in it take input. See `#ui.is-hud` in style.css.
 *
 * ## Updated in place, not rebuilt
 *
 * The update loop runs sixty times a second and the card changes maybe eight
 * times a run. Rebuilding the DOM every step would restart the card's entry
 * animation on every frame, which is a card that never finishes arriving, and
 * it would drop the Skip button out from under a thumb mid-press. So the
 * element is made once and its text is written only when the step id changes.
 *
 * ## Where it points
 *
 * At the button, not at a corner. The ring is positioned from core/pads.ts,
 * which is the one place a pad's position is decided, so a layout change moves
 * the pointer with the thing it points at rather than leaving an arrow aimed at
 * empty screen. A keyboard has no button to point at, so it gets the keys drawn
 * as caps instead.
 */

import { el } from './dom';
import { padLayout, slotStrip, useRegion, type PadRegion } from '../core/pads';
import { usingPads } from '../core/scheme';
import type { TourStep, TourTarget } from '../core/tour';

export interface TourCardOptions {
  /** Ends the tour for good. */
  onSkip: () => void;
}

/** Canvas size in CSS pixels, which is also the screens layer's size. */
export interface TourViewport {
  width: number;
  height: number;
  /** How many consumable buttons the layout is drawing. */
  slotCount: number;
}

export class TourCard {
  private layer: HTMLElement | null = null;
  private titleNode: HTMLElement | null = null;
  private sayNode: HTMLElement | null = null;
  private countNode: HTMLElement | null = null;
  private keysNode: HTMLElement | null = null;
  private ring: HTMLElement | null = null;

  /** The step currently written into the DOM, so a repeat is a no-op. */
  private written: string | null = null;

  /**
   * The last thing shown, so a card that comes back comes back complete.
   *
   * The layer is rebuilt every time the screens layer is repainted, which
   * happens on every pause and resume. Without this the new card is blank until
   * the next update tick fills it, and a blank card with a Skip button on it is
   * what a player sees for that frame. It is one frame at sixty a second and it
   * is also the frame right after a pause, when the game is being looked at
   * rather than played.
   */
  private last: { step: TourStep; position: number; length: number } | null = null;

  constructor(private readonly options: TourCardOptions) {}

  /**
   * Put the card in the layer, or put it back.
   *
   * Called after anything that repaints the screens layer, because mount()
   * replaces the layer's children and the run overlay is repainted every time
   * the game is paused and resumed. Cheap and idempotent: if the element is
   * still attached this does nothing at all.
   */
  attach(root: HTMLElement): void {
    if (this.layer && this.layer.parentElement === root) return;

    const title = el('span', { class: 'tour__title' });
    const say = el('p', { class: 'tour__say' });
    const count = el('span', { class: 'tour__count' });
    const keys = el('div', { class: 'tour__keys' });

    const skip = el('button', {
      class: 'tour__skip',
      type: 'button',
      text: 'Skip',
    });
    skip.addEventListener('click', this.options.onSkip);

    const card = el(
      'div',
      { class: 'tour', role: 'status', 'aria-live': 'polite' },
      el('div', { class: 'tour__head' }, count, title),
      say,
      keys,
      skip,
    );

    const ring = el('div', { class: 'tour__ring', hidden: true });

    /*
     * Hidden until it has something to say.
     *
     * The layer is built here and filled by the next update tick, which is one
     * frame later. For one frame the card is on screen with an empty headline
     * and a Skip button under it, and that frame is not always as short as it
     * sounds: a throttled tab or a run that pauses immediately can hold it. An
     * empty card that offers to be skipped is the worst possible first
     * impression of a thing whose whole job is explaining.
     */
    const layer = el('div', { class: 'tour-layer', hidden: true }, ring, card);
    root.append(layer);

    this.layer = layer;
    this.titleNode = title;
    this.sayNode = say;
    this.countNode = count;
    this.keysNode = keys;
    this.ring = ring;
    // Forget what was written, because the nodes holding it were just replaced.
    this.written = null;

    // And write it straight back, so the card that arrives is the card that
    // left rather than an empty one waiting for the next tick.
    if (this.last) this.write(this.last.step, this.last.position, this.last.length);
  }

  /**
   * Show a step, and point at whatever it is about.
   *
   * The ring is repositioned every call rather than only on a change of step,
   * because the pads move when the device rotates and a pointer that stayed
   * where the button used to be is worse than no pointer.
   */
  show(step: TourStep, position: number, length: number, view: TourViewport): void {
    this.last = { step, position, length };
    if (!this.layer) return;

    this.write(step, position, length);
    this.point(step.target, view);
  }

  /**
   * Put a step into the card, once per step rather than once per frame.
   *
   * The update loop runs sixty times a second and the card changes maybe eight
   * times a run. Rewriting it every frame would restart the entry animation on
   * every one of them, which is a card that never finishes arriving, and it
   * would drop the Skip button out from under a thumb mid-press.
   */
  private write(step: TourStep, position: number, length: number): void {
    const layer = this.layer;
    if (!layer || this.written === step.id) return;

    this.written = step.id;
    // There is something to read now, so it may be looked at.
    layer.hidden = false;
    if (this.titleNode) this.titleNode.textContent = step.title;
    if (this.sayNode) this.sayNode.textContent = step.say;
    if (this.countNode) {
      const of = String(length).padStart(2, '0');
      this.countNode.textContent = `${String(position).padStart(2, '0')}/${of}`;
    }
    this.writeKeys(step.keys);

    // Restarted per step, so each instruction arrives rather than the text
    // silently swapping under the reader.
    layer.classList.remove('tour--in');
    // Reading a layout property is what makes the removal take effect before
    // the class goes back on. Without it the browser coalesces the pair into no
    // change at all and the animation never replays.
    void layer.offsetWidth;
    layer.classList.add('tour--in');
  }

  /** Take the card off screen. Safe to call when it is already gone. */
  detach(): void {
    this.layer?.remove();
    this.layer = null;
    this.titleNode = null;
    this.sayNode = null;
    this.countNode = null;
    this.keysNode = null;
    this.ring = null;
    this.written = null;
    // Cleared too, or the next tour would open on the last card of the previous
    // one for a frame before its own first step arrived.
    this.last = null;
  }

  private writeKeys(keys: readonly string[]): void {
    const node = this.keysNode;
    if (!node) return;

    node.replaceChildren(...keys.map((key) => el('kbd', { class: 'tour__key', text: key })));
    node.hidden = keys.length === 0;
  }

  private point(target: TourTarget, view: TourViewport): void {
    const ring = this.ring;
    if (!ring) return;

    const region = regionFor(target, view);
    if (!region) {
      ring.hidden = true;
      return;
    }

    // A little wider than the control, so the ring frames it rather than
    // sitting on top of the label a thumb is trying to read.
    const r = region.r + 8;
    ring.hidden = false;
    ring.style.left = `${region.x - r}px`;
    ring.style.top = `${region.y - r}px`;
    ring.style.width = `${r * 2}px`;
    ring.style.height = `${r * 2}px`;
  }
}

/**
 * Where the thing this step is about actually is.
 *
 * Null on a keyboard for everything except the pause button, which is the one
 * on-screen control a desktop has. Everything else on a desktop is a key, and a
 * ring drawn in the corner of an empty screen points at nothing.
 */
function regionFor(target: TourTarget, view: TourViewport): PadRegion | null {
  if (target === null) return null;

  if (target === 'pause') {
    // Mirrors .hud-overlay in style.css: top centre, below the strip. Not read
    // from the DOM, because the button is in a layer that is repainted and the
    // measurement would be taken during the frame it is missing.
    return { x: view.width / 2, y: 70, r: 26 };
  }

  const pads = usingPads();

  if (target === 'use') {
    return useRegion(view.width, view.height);
  }

  if (target === 'slots') {
    if (pads) {
      const layout = padLayout(view.width, view.height, view.slotCount);
      return spanOf(layout.slots);
    }
    return spanOf(slotStrip(view.width, view.height, view.slotCount));
  }

  /*
   * Move and fire only have a place on the fixed pads.
   *
   * The floating scheme draws nothing until a thumb lands and then draws it
   * wherever the thumb landed, which is the whole point of it. There is no
   * button to ring, so the copy carries the instruction alone: "anywhere on the
   * left half" is a complete description of a control with no position.
   */
  if (!pads) return null;

  const layout = padLayout(view.width, view.height, view.slotCount);
  return target === 'move' ? layout.move : layout.fire;
}

/** One circle around a row of buttons, so four slots get one ring. */
function spanOf(regions: PadRegion[]): PadRegion | null {
  const first = regions[0];
  const last = regions[regions.length - 1];
  if (!first || !last) return null;

  const x = (first.x + last.x) / 2;
  const y = (first.y + last.y) / 2;
  const half = Math.hypot(last.x - first.x, last.y - first.y) / 2;

  return { x, y, r: half + first.r };
}
