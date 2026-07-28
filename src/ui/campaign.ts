/**
 * The campaign screen: seven stages, and how far up them you are.
 *
 * Locked stages show everything except the button. Hiding them would make the
 * campaign look like one level until you finished it, and a player who cannot
 * see what Stage 7 is has no reason to want to get there. The whole arc is the
 * pitch, so the whole arc is on screen from the first visit.
 *
 * Each card states the numbers that make it harder rather than a difficulty
 * word. "Enemies x1.8, 100 seconds, three-round volleys" is checkable; "very
 * hard" is a claim.
 */

import { button, el, mount } from './dom';
import { STAGES, stageUnlocked, type Stage } from '../data/campaign';

export interface CampaignOptions {
  /** Highest stage cleared, 0 to 7. */
  cleared: number;
  /** The stage currently selected to fly. */
  selected: number;
  onSelect: (n: number) => void;
  onBack: () => void;
}

export function renderCampaign(root: HTMLElement, options: CampaignOptions): void {
  const cleared = Math.max(0, Math.min(STAGES.length, options.cleared));
  const done = cleared >= STAGES.length;

  mount(
    root,
    el(
      'div',
      { class: 'screen' },
      el('p', { class: 'eyebrow', text: 'THE CAMPAIGN' }),
      el('h1', { text: done ? 'Face restored' : 'Save face' }),

      el('p', {
        class: 'quiet',
        text: done
          ? 'Every stage cleared. The industry got its face back, which is a sentence nobody could write in 2026. Any stage can be flown again.'
          : `Seven stages. Each one takes back a piece of what 2026 cost, and each one is harder than the last. ${cleared} of ${STAGES.length} restored.`,
      }),

      progressBar(cleared),

      el('div', { class: 'stages' }, ...STAGES.map((stage) => card(stage, cleared, options))),

      el('div', { class: 'actions' }, button('Back', options.onBack, 'ghost')),
    ),
  );
}

/** Seven blocks. Filled ones are done, and the next one is the one to fly. */
function progressBar(cleared: number): HTMLElement {
  return el(
    'div',
    { class: 'ladder' },
    ...STAGES.map((stage) =>
      el('span', {
        class:
          stage.n <= cleared
            ? 'ladder__step is-done'
            : stage.n === cleared + 1
              ? 'ladder__step is-next'
              : 'ladder__step',
        text: String(stage.n),
      }),
    ),
  );
}

function card(stage: Stage, cleared: number, options: CampaignOptions): HTMLElement {
  const unlocked = stageUnlocked(stage.n, cleared);
  const restored = stage.n <= cleared;
  const selected = stage.n === options.selected && unlocked;

  const classes = ['stage'];
  if (!unlocked) classes.push('stage--locked');
  if (restored) classes.push('stage--done');
  if (selected) classes.push('stage--on');

  return el(
    'div',
    { class: classes.join(' ') },

    el(
      'div',
      { class: 'stage__head' },
      el('span', { class: 'stage__n', text: String(stage.n) }),
      el(
        'div',
        { class: 'stage__title' },
        el('div', { class: 'stage__name', text: stage.name }),
        el('div', { class: 'stage__restores', text: `Restores: ${stage.restores}` }),
      ),
      restored
        ? el('span', { class: 'stage__badge', text: 'RESTORED' })
        : unlocked
          ? null
          : el('span', { class: 'stage__badge stage__badge--locked', text: 'LOCKED' }),
    ),

    el('p', { class: 'stage__brief', text: stage.brief }),

    el(
      'div',
      { class: 'stage__objective' },
      el('span', { class: 'stat__label', text: 'TO CLEAR' }),
      el('span', { text: stage.objective }),
    ),

    el(
      'div',
      { class: 'stage__numbers' },
      figure('TIME', `${stage.seconds}s`),
      figure('ENEMIES', `×${stage.density.toFixed(2).replace(/0$/, '')}`),
      figure('CACHES', String(stage.caches)),
      figure(
        'VOLLEY',
        stage.volley[0] === stage.volley[1]
          ? String(stage.volley[0])
          : `${stage.volley[0]} → ${stage.volley[1]}`,
      ),
      figure('FACE', `×${stage.bounty}`),
    ),

    unlocked && !selected
      ? button(restored ? 'Fly it again' : 'Select', () => options.onSelect(stage.n), 'ghost')
      : null,

    !unlocked
      ? el('p', {
          class: 'stage__gate',
          text: `Clear Stage ${stage.n - 1} to open this.`,
        })
      : null,
  );
}

function figure(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'rack__figure' },
    el('span', { class: 'stat__label', text: label }),
    el('span', { class: 'rack__value', text: value }),
  );
}
