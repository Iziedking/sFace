/**
 * The boot screen.
 *
 * The bar is driven by work that actually finished, never by a timer. A fake
 * progress bar is a small lie and it is always found out: it crawls to ninety
 * percent and sits there while the real work is still going, or it fills in
 * half a second and then the screen does nothing for three more. Either way
 * the player learns the bar means nothing, which is worse than no bar.
 *
 * So each step here is a real await, and the bar is simply how many of them
 * have come back. When the market is cached it fills instantly and nobody
 * reads it, which is correct. When the service is cold and Grok is reading X,
 * it takes a few seconds and the player can see which of those seconds is
 * which.
 *
 * It releases as soon as the mission is ready, not when everything is. Ghosts
 * and the record are enhancements and holding onboarding for them would spend
 * a judging criterion on nothing.
 */

import { el, mount } from './dom';

export interface LoadStep {
  key: string;
  label: string;
  done: boolean;
}

/** The steps in the order a player experiences them. */
export function initialSteps(): LoadStep[] {
  return [
    { key: 'market', label: 'Reading the market', done: false },
    { key: 'record', label: 'Checking your record', done: false },
    { key: 'squad', label: 'Finding your squad', done: false },
  ];
}

/**
 * The scene on the boot screen: the chart, the ground, and three figures.
 *
 * Inline SVG rather than the banner PNG, for two reasons. It scales to any
 * width without a second asset or a fixed aspect ratio, so a 320 pixel phone
 * and a 2560 pixel desktop both get a crisp version of the same picture. And
 * it costs no network request at all, on the one screen whose entire job is
 * to be up while the network is busy.
 *
 * It is a static author-written literal, which is why innerHTML is acceptable
 * here and nowhere else in this codebase. Nothing in this string comes from a
 * player, a mission, or a service.
 */
const SCENE = `
<svg viewBox="0 0 600 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <path d="M-10 84 L60 104 L112 78 L164 116 L220 96 L276 134 L332 112 L388 146 L448 124 L504 156 L560 140 L620 168 L620 220 L-10 220 Z" fill="#ded2ba"/>
  <path d="M-10 84 L60 104 L112 78 L164 116 L220 96 L276 134 L332 112 L388 146 L448 124 L504 156 L560 140 L620 168" fill="none" stroke="#14110e" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M-10 84 L60 104 L112 78 L164 116 L220 96 L276 134 L332 112 L388 146 L448 124 L504 156 L560 140 L620 168" fill="none" stroke="#ff5a1f" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>

  <g transform="translate(276,134) scale(1.35)">
    <path d="M-2 6 L-5 17 M2 6 L5 17" stroke="#14110e" stroke-width="5" stroke-linecap="round"/>
    <rect x="-9" y="-8" width="18" height="17" rx="5" fill="#14110e"/>
    <rect x="-7" y="-6" width="14" height="13" rx="4" fill="#ff5a1f"/>
    <path d="M0 -3 L15 -4" stroke="#14110e" stroke-width="6" stroke-linecap="round"/>
    <circle cx="0" cy="-19" r="11" fill="#14110e"/>
    <circle cx="0" cy="-19" r="9" fill="#f2c9a0"/>
    <circle cx="-3" cy="-21" r="1.5" fill="#14110e"/>
    <circle cx="3" cy="-21" r="1.5" fill="#14110e"/>
    <rect x="-3" y="-16" width="6" height="2" rx="1" fill="#14110e"/>
  </g>

  <g transform="translate(388,146) scale(1.2)">
    <path d="M-2 6 L-5 17 M2 6 L5 17" stroke="#14110e" stroke-width="5" stroke-linecap="round"/>
    <rect x="-9" y="-8" width="18" height="17" rx="5" fill="#14110e"/>
    <rect x="-7" y="-6" width="14" height="13" rx="4" fill="#2f7d63"/>
    <circle cx="0" cy="-19" r="11" fill="#14110e"/>
    <circle cx="0" cy="-19" r="9" fill="#e0aa78"/>
    <circle cx="-3" cy="-21" r="1.5" fill="#14110e"/>
    <circle cx="3" cy="-21" r="1.5" fill="#14110e"/>
    <rect x="-3" y="-16" width="6" height="2" rx="1" fill="#14110e"/>
  </g>

  <g transform="translate(504,156) scale(1.2)">
    <path d="M-2 6 L-5 17 M2 6 L5 17" stroke="#14110e" stroke-width="5" stroke-linecap="round"/>
    <rect x="-9" y="-8" width="18" height="17" rx="5" fill="#14110e"/>
    <path d="M0 -3 L-15 -4" stroke="#14110e" stroke-width="6" stroke-linecap="round"/>
    <circle cx="0" cy="-19" r="11" fill="#14110e"/>
    <circle cx="0" cy="-19" r="9" fill="#e0aa78"/>
    <rect x="-10" y="-22" width="20" height="5" fill="#d3212c"/>
    <rect x="-3" y="-16" width="6" height="2" rx="1" fill="#14110e"/>
  </g>

  <g transform="translate(164,116)">
    <path d="M0 -30 L0 -8" stroke="#ffd9c4" stroke-width="14"/>
    <rect x="-9" y="-9" width="18" height="18" rx="3" fill="#ff5a1f" stroke="#14110e" stroke-width="2.5"/>
    <rect x="-9" y="-2" width="18" height="3" fill="#14110e"/>
  </g>
</svg>`;

/** A static, author-written SVG. See the note on SCENE. */
function scene(): HTMLElement {
  const holder = el('div', { class: 'loading__scene' });
  holder.innerHTML = SCENE;
  return holder;
}

export function renderLoading(root: HTMLElement, steps: readonly LoadStep[]): void {
  const done = steps.filter((s) => s.done).length;
  const fraction = steps.length > 0 ? done / steps.length : 0;

  // The first step still running is what the player is actually waiting on.
  const current = steps.find((s) => !s.done) ?? steps[steps.length - 1];

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--center screen--bare' },
      el(
        'div',
        { class: 'loading' },
        el('h1', { class: 'loading__mark', text: 'sFace' }),
        el('p', { class: 'loading__sub', text: 'The Face Collapse' }),
        scene(),

        el(
          'div',
          { class: 'loading__bar' },
          el('div', {
            class: 'loading__fill',
            style: `width:${Math.round(fraction * 100)}%`,
          }),
        ),

        el(
          'ul',
          { class: 'loading__steps' },
          ...steps.map((step) =>
            el(
              'li',
              { class: step.done ? 'loading__step is-done' : 'loading__step' },
              el('span', { class: 'loading__tick' }),
              el('span', { text: step.label }),
            ),
          ),
        ),

        el('p', {
          class: 'loading__now',
          text: current && !current.done ? `${current.label}…` : 'Ready',
        }),
      ),
    ),
  );
}
