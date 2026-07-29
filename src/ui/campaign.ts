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
import { RunState } from '../game/state';

/** Kept in one place so the card and the run can never disagree. */
const TASTER_SECONDS = RunState.TASTER_SECONDS;

export interface CampaignOptions {
  /** Highest stage cleared, 0 to 7. */
  cleared: number;
  /** The stage currently selected to fly. */
  selected: number;
  onSelect: (n: number) => void;
  onBack: () => void;
  /**
   * Flying without an account.
   *
   * Every stage opens, because the point of practice is to SEE the game rather
   * than be told about it. Stage one is the full run, replayable forever. The
   * rest are tasters on a clock, and running out of time inside stage six with
   * three people still behind bars is a better argument for signing in than
   * any sentence we could write.
   */
  practice: boolean;
  /** Null when X connect is not configured on this deployment. */
  onConnectX: (() => void) | null;
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
          ? 'All seven. The whole winter, walked back. Nobody could have written that sentence in January, and any stage is still there to fly again.'
          : `Seven stages, one for each thing 2026 took. The setup stays the same and the job inside it changes every day. ${cleared} of ${STAGES.length} restored.`,
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
  // In practice nothing is locked: it is all open, and later stages are simply
  // short. A padlock would hide exactly what we want a stranger to see.
  const unlocked = options.practice || stageUnlocked(stage.n, cleared);
  const taster = options.practice && stage.n > 1;
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
        : taster
          ? el('span', { class: 'stage__badge stage__badge--taster', text: 'TASTER 45s' })
          : unlocked
          ? null
          : el('span', { class: 'stage__badge stage__badge--locked', text: 'LOCKED' }),
    ),

    /*
     * A locked stage shows the tease, not the brief.
     *
     * The brief tells you how to fly something you cannot attempt yet, which
     * is a spoiler with no payoff. The tease tells you what it will look like
     * and what will be different about it, which is the anticipation the whole
     * seven-stage arc is supposed to build.
     */
    unlocked
      ? el('p', { class: 'stage__brief', text: stage.brief })
      : el(
          'div',
          { class: 'tease' },
          el('p', { class: 'tease__scene', text: stage.tease.scene }),
          el('p', { class: 'tease__threat', text: stage.tease.threat }),
        ),

    unlocked
      ? el(
          'div',
          { class: 'stage__objective' },
          el('span', { class: 'stat__label', text: 'TO CLEAR' }),
          el('span', { text: stage.objective }),
        )
      : null,

    el(
      'div',
      { class: 'stage__numbers' },
      // The clock a practice player will actually get, not the one the stage
      // has. Advertising 110s and handing over 45 is a small lie, and a small
      // lie on the card that sells the sign-in is a bad place to put one.
      figure('TIME', taster ? `${TASTER_SECONDS}s` : `${stage.seconds}s`),
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

    el('div', { class: 'stage__weather' }, ...swatch(stage)),

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

/**
 * What the place looks like, as three colours and a word.
 *
 * The sky and ground are the actual values the renderer uses, so the swatch on
 * the card cannot drift from the stage it describes. That matters more than it
 * sounds: a preview that lies about the thing it previews is worse than none.
 */
function swatch(stage: Stage): HTMLElement[] {
  return [
    el('span', {
      class: 'swatch',
      style: `background:${stage.look.sky};border-color:${stage.look.ground}`,
    }),
    el('span', { class: 'swatch', style: `background:${stage.look.ground}` }),
    el('span', {
      class: 'stage__weatherword',
      text: stage.look.weather === 'clear' ? 'clear skies' : stage.look.weather,
    }),
  ];
}

function figure(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'rack__figure' },
    el('span', { class: 'stat__label', text: label }),
    el('span', { class: 'rack__value', text: value }),
  );
}
