/**
 * What clearing the campaign is for.
 *
 * ## The idea
 *
 * Seven stages are spent inside one bad day, close up, where it fills the whole
 * screen and every ridge of it is something trying to kill you. The ending is
 * the camera pulling back.
 *
 * The same chart is redrawn small, then smaller, until the catastrophe you have
 * been living in is a notch on a line that goes up. That is the whole argument
 * and it is made with the game's own material rather than with a slogan: the
 * player recognises the shape, because they just flew it.
 *
 * ## Why there are no photographs here
 *
 * Everything in sFace is drawn: flat ink on cream, hard shadows, one accent.
 * Dropping a stock image of a trading floor into that would read as clip art
 * pasted over a poster, which is a more generic result than the thing it was
 * meant to improve. The texture comes from the drawing and from the numbers
 * being real.
 *
 * ## Every number on this screen is fetched
 *
 * Total market capitalisation, its own daily move, the largest asset's share,
 * and how many assets exist at all. Same source as the wreck. Nothing is
 * asserted about the future, because a screen that promises a price is a screen
 * that lies; what it says is how small this is compared to what it is trying to
 * replace, which is a fact rather than a forecast.
 *
 * When the market call failed the figures are simply absent. The ending still
 * works, because the chart does the argument on its own.
 */

import { button, el, mount } from './dom';
import { theme } from '../render/theme';
import { reducedMotion } from '../render/theme';
import { audio } from '../core/audio';
import { narrator } from '../core/voice';
import type { RunState } from '../game/state';

export interface EndingOptions {
  state: RunState;
  onContinue: () => void;
}

/**
 * What the narrator says over this screen.
 *
 * Written to be heard once, by somebody who has just finished seven stages and
 * is looking at a chart shrinking into a line. It says what the year was like,
 * then what the number on screen actually means, and stops.
 *
 * Read from the same figures the screen shows, so the voice cannot claim a
 * different total from the one in front of them. No forecast anywhere in it:
 * the argument is about size, which is measurable, and a game that invented a
 * price would be lying in the one place it has been careful not to.
 */
function narration(state: RunState): string[] {
  const market = state.mission.market;
  const lines = [
    'You just spent seven stages inside one bad day.',
    'It has been a long run of them. Projects winding down, tokens going to nothing, and a thread every week explaining why it was always going to happen.',
  ];

  if (market) {
    lines.push(
      `All of crypto is worth ${trillions(market.totalUsd)} right now, spread across ${market.assets.toLocaleString()} assets.`,
      'That is about one large technology company, split tens of thousands of ways, for an entire financial system being rebuilt in the open.',
    );
  }

  lines.push(
    'Nothing about that is finished. The day you just flew did not stop it, and neither did any of the ones before it.',
    'It is still early. That is the whole argument, and you had to earn it.',
  );

  return lines;
}

/** Trillions, to two places. The unit is the point. */
function trillions(usd: number): string {
  return `$${(usd / 1e12).toFixed(2)}T`;
}

export function renderEnding(root: HTMLElement, options: EndingOptions): void {
  const { state } = options;
  const market = state.mission.market;
  root.className = '';

  const canvas = el('canvas', { class: 'ending__canvas' }) as HTMLCanvasElement;

  const figure = (value: string, label: string): HTMLElement =>
    el(
      'div',
      { class: 'ending__figure' },
      el('span', { class: 'ending__value', text: value }),
      el('span', { class: 'ending__label', text: label }),
    );

  mount(
    root,
    el(
      'div',
      { class: 'screen ending' },

      el('p', { class: 'eyebrow', text: 'Face restored' }),
      el('h1', { class: 'ending__head', text: 'Still early.' }),

      el('div', { class: 'ending__stage' }, canvas),

      el('p', {
        class: 'ending__lede',
        text: `You spent seven stages inside one day on ${state.mission.ticker}. Here it is against everything that came before it.`,
      }),

      market
        ? el(
            'div',
            { class: 'ending__figures' },
            figure(trillions(market.totalUsd), 'all of crypto, today'),
            figure(`${market.assets.toLocaleString()}`, 'assets in existence'),
            figure(`${market.btcDominance.toFixed(0)}%`, 'held by the largest'),
          )
        : null,

      /*
       * The closing line does not predict anything.
       *
       * "Still early" is a claim about size, and size is measurable. A screen
       * that promised a number would be the one dishonest thing in a game whose
       * entire premise is that none of it is invented.
       */
      el('p', {
        class: 'ending__close',
        text: market
          ? `${trillions(market.totalUsd)} is not a finished industry. It is a rounding error next to what it is trying to replace, held by a few million people out of eight billion. The worst day you just flew did not stop it, and neither did any of the ones before it.`
          : 'The worst day you just flew did not stop it, and neither did any of the ones before it. The whole thing is smaller than it looks from the inside, and earlier than it feels.',
      }),

      el('p', {
        class: 'ending__sign',
        text: 'Somebody has to save face. Tomorrow there is another one.',
      }),

      el(
        'div',
        { class: 'actions' },
        button('Done', () => {
          narrator.stop();
          options.onContinue();
        }),
      ),
      el('p', {
        class: 'ending__skip',
        // Said plainly, because somebody who does not want a voice reading at
        // them should not have to guess whether pressing Done cuts it off.
        text: 'Done stops the voice and takes you to your score.',
      }),
    ),
  );

  drawZoomOut(canvas, state);
  celebrate(root, state);
}

/**
 * The sound, the fall, and the voice.
 *
 * All three are skipped when the player has asked for reduced motion or has the
 * sound off, and none of them holds anything up: the screen is complete and
 * readable before any of this starts, so a browser that blocks audio or a person
 * who ignores it loses nothing but the flourish.
 */
function celebrate(root: HTMLElement, state: RunState): void {
  audio.fanfare();

  if (!reducedMotion()) fall(root);

  /*
   * Spoken after a beat, so the fanfare is not talked over.
   *
   * Each line resolves when it has been read, so this walks the script rather
   * than firing it all at once. Stopped by Done, which is why the button calls
   * narrator.stop before continuing.
   */
  window.setTimeout(() => {
    void (async () => {
      for (const line of narration(state)) {
        await narrator.say(line);
      }
    })();
  }, 900);
}

/**
 * Confetti, drawn in the same ink as everything else.
 *
 * Flat rectangles in the product's own three colours, no gradients and no
 * rotation blur. Removed when they land rather than left in the DOM, and the
 * whole thing is one element so dismissing the screen takes it with it.
 */
function fall(root: HTMLElement): void {
  const sky = el('div', { class: 'ending__sky', 'aria-hidden': 'true' });
  const colours = ['var(--accent)', 'var(--ink)', 'var(--rescue)'];

  for (let i = 0; i < 42; i++) {
    const piece = el('span', { class: 'ending__flake' });
    // Spread across the width, staggered in time, and varied in size so it
    // reads as falling paper rather than a curtain coming down.
    piece.style.left = `${Math.round((i / 42) * 100 + (i % 5) * 2)}%`;
    piece.style.animationDelay = `${(i % 9) * 0.22}s`;
    piece.style.animationDuration = `${2.6 + (i % 6) * 0.45}s`;
    piece.style.background = colours[i % colours.length] as string;
    piece.style.width = `${6 + (i % 3) * 3}px`;
    piece.style.height = `${10 + (i % 4) * 4}px`;
    sky.append(piece);
  }

  root.append(sky);
  // Long enough for the slowest piece plus its delay, then gone.
  window.setTimeout(() => sky.remove(), 9000);
}

/**
 * The chart, pulled back.
 *
 * Three passes over the same terrain the player just flew, each one drawn into
 * a smaller slice of the width with an invented rise in front of it, so the day
 * shrinks from the whole picture to a notch. The rise is drawn as a plain climb
 * and is deliberately unlabelled and unscaled: it is a shape saying "there was
 * more before this", not a price claim.
 */
function drawZoomOut(canvas: HTMLCanvasElement, state: RunState): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || 640;
  const height = canvas.clientHeight || 200;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const terrain = state.mission.terrain;
  const quiet = reducedMotion();

  /*
   * The day occupies the last fraction of the width, and everything left of it
   * is the climb that got here. Drawn once at full size, then twice smaller,
   * so the eye reads it as a camera pulling back rather than as three charts.
   */
  const passes = quiet ? [0.18] : [1, 0.45, 0.18];
  let step = 0;

  const paint = (share: number, alpha: number): void => {
    const dayWidth = width * share;
    const dayLeft = width - dayWidth;
    const base = height - 14;

    ctx.save();
    ctx.globalAlpha = alpha;

    // The climb before the day. A simple accelerating rise, drawn faintly,
    // carrying no numbers because it is context rather than a claim.
    if (share < 1) {
      ctx.strokeStyle = theme.inkFaint;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= dayLeft; x += 4) {
        const t = x / Math.max(1, dayLeft);
        const y = base - Math.pow(t, 1.9) * (height - 46);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // The day itself, in the accent, exactly as the level drew it.
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = share > 0.5 ? 3 : 2.5;
    ctx.beginPath();
    for (let i = 0; i < terrain.length; i++) {
      const t = i / (terrain.length - 1);
      const x = dayLeft + t * dayWidth;
      // Anchored to the top of the climb so the notch sits on the line rather
      // than floating above the floor.
      const top = share < 1 ? base - (height - 46) : base;
      const y = top + (1 - (terrain[i] ?? 0.5)) * (height - 46) * (share < 1 ? share : 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  };

  const render = (): void => {
    ctx.clearRect(0, 0, width, height);
    paint(passes[step] ?? 0.18, 1);

    step++;
    if (step < passes.length) {
      // A beat between pulls, so the reframing is legible rather than an
      // animation somebody watches once and cannot describe.
      window.setTimeout(render, 900);
    }
  };

  render();
}
