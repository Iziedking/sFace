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
import type { RunState } from '../game/state';

export interface EndingOptions {
  state: RunState;
  onContinue: () => void;
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

      el('div', { class: 'actions' }, button('Back to today', options.onContinue)),
    ),
  );

  drawZoomOut(canvas, state);
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
