/**
 * Opening a contest: the terms, before anybody has staked anything.
 *
 * ## One screen, four decisions
 *
 * Kind, stages, stake, seats. Everything else is derived or fixed, and the
 * screen deliberately refuses to grow past those four: a form with eight
 * choices on it is a form people abandon, and this one sits between a player
 * and the thing they came to do.
 *
 * ## Why the terms are settled here and never again
 *
 * Every entrant flies the same seeded stages, and the stake is agreed before
 * anyone has a score. That ordering is the entire fairness argument: nobody can
 * see a result and then decide what it was worth. So this screen writes the
 * terms once, and nothing downstream may edit them.
 *
 * The preview line at the bottom is not decoration. It restates the four
 * choices as one English sentence, because a contest is an agreement and the
 * moment to catch a misread is before the link goes out rather than after
 * somebody has staked against it.
 */

import { button, el, mount } from './dom';
import {
  KIND_LABEL,
  KIND_SAY,
  MAX_SEATS,
  MAX_STAGE,
  MIN_SEATS,
  stageRange,
  stagesLabel,
  type ContestKind,
  type ContestVisibility,
} from '../data/contests';

export interface ContestDraft {
  kind: ContestKind;
  from: number;
  to: number;
  stakeNim: number;
  seats: number;
  visibility: ContestVisibility;
}

export interface ContestNewOptions {
  draft: ContestDraft;
  /** Re-render under the thumb that changed something. */
  onChange: (next: ContestDraft) => void;
  /** Null when this pilot has no clan, which rules out a clan contest. */
  clanTag: string | null;
  /**
   * Whether they run that clan.
   *
   * Entering a clan commits every member's score to a result, so it is the
   * owner's call. A member sees the row with the reason rather than a control
   * that fails after they have set everything else.
   */
  ownsClan: boolean;
  /** Highest stage they have cleared, so they cannot stake on one they cannot fly. */
  stagesCleared: number;
  busy: boolean;
  notice: string | null;
  onOpen: () => void;
  onBack: () => void;
}

const KINDS: ContestKind[] = ['duel', 'clan', 'gauntlet'];
/*
 * Free first, and it is not a lesser option.
 *
 * A stake of nothing is the same seeded stages and the same standings with no
 * wallet required, which is the version most people racing a friend actually
 * want. Putting it first says so; burying it behind three amounts would make
 * money look like the default way to play.
 */
const STAKES = [0, 1, 5, 10, 25];

/** The same bounds the service enforces, so nothing typed here is refused. */
const MIN_STAKE = 0;
const MAX_STAKE = 1000;

export function renderContestNew(root: HTMLElement, options: ContestNewOptions): void {
  const { draft } = options;
  const stages = stageRange(draft.from, draft.to);

  /*
   * The ceiling is what they have actually cleared, never the whole campaign.
   *
   * Staking NIM on stage seven having never reached it is a bet somebody is
   * going to lose to a level they have not seen, and the game would have taken
   * their money for the privilege. One is always available so a new player can
   * still open something.
   */
  const ceiling = Math.max(1, Math.min(MAX_STAGE, options.stagesCleared || 1));

  mount(
    root,
    el(
      'div',
      { class: 'screen contestnew' },

      el('p', { class: 'eyebrow', text: 'New contest' }),
      el('h1', { text: 'Set the terms' }),

      el('p', { class: 'group', text: 'WHAT KIND' }),
      el(
        'div',
        { class: 'picks' },
        ...KINDS.map((kind) =>
          pick(
            KIND_LABEL[kind],
            KIND_SAY[kind],
            draft.kind === kind,
            // A clan contest with no clan behind it has nothing to enter, so
            // the row says why rather than vanishing.
            blockedReason(kind, options),
            () => options.onChange({ ...draft, kind }),
          ),
        ),
      ),

      el('p', { class: 'group', text: 'HOW MANY STAGES' }),
      el(
        'div',
        { class: 'stagepick' },
        stepper('From', draft.from, 1, ceiling, (n) =>
          options.onChange({ ...draft, from: n, to: Math.max(n, draft.to) }),
        ),
        stepper('To', draft.to, 1, ceiling, (n) =>
          options.onChange({ ...draft, to: n, from: Math.min(n, draft.from) }),
        ),
      ),
      ceiling < MAX_STAGE
        ? el('p', {
            class: 'quiet',
            text: `You can stake up to stage ${ceiling}, which is as far as you have cleared. Clear more and the rest open up.`,
          })
        : null,

      el('p', { class: 'group', text: 'THE STAKE' }),
      el(
        'div',
        { class: 'chips' },
        ...STAKES.map((nim) =>
          chip(nim === 0 ? 'Free' : `${nim} NIM`, draft.stakeNim === nim, () =>
            options.onChange({ ...draft, stakeNim: nim }),
          ),
        ),
        // The presets cover the common cases and cannot cover everybody. Two
        // people who agreed on 7 NIM should not have to round to 5 or 10.
        stakeField(options),
      ),

      // Seats are meaningless on a clan contest, where the roster decides who
      // turns up, so the control is simply absent rather than disabled.
      draft.kind === 'clan'
        ? null
        : el(
            'div',
            { class: 'contestnew__seats' },
            el('p', { class: 'group', text: 'HOW MANY CAN ENTER' }),
            stepper('Seats', draft.seats, MIN_SEATS, MAX_SEATS, (n) =>
              options.onChange({ ...draft, seats: n }),
            ),
          ),

      el('p', { class: 'group', text: 'WHO CAN SEE IT' }),
      el(
        'div',
        { class: 'chips' },
        chip('Anyone', draft.visibility === 'open', () =>
          options.onChange({ ...draft, visibility: 'open' }),
        ),
        chip('Link only', draft.visibility === 'private', () =>
          options.onChange({ ...draft, visibility: 'private' }),
        ),
      ),
      el('p', {
        class: 'quiet',
        text:
          draft.visibility === 'open'
            ? 'It appears in Contests for anybody to take a seat in.'
            : 'It stays off the Contests list. Only someone with the link can enter, so the link is the invitation.',
      }),

      /*
       * The terms as one sentence.
       *
       * A contest is an agreement, and four separate controls do not read as
       * one. This is the last chance to notice that "stages 1 to 7" was not
       * what was meant, and it costs a line.
       */
      el(
        'div',
        { class: 'contestnew__preview' },
        el('p', { class: 'contestnew__previewhead', text: 'THE AGREEMENT' }),
        el('p', {
          class: 'contestnew__previewsay',
          text: summarise(options, stages),
        }),
      ),

      options.notice ? el('div', { class: 'notice notice--error', text: options.notice }) : null,

      el(
        'div',
        { class: 'actions' },
        button(options.busy ? 'Opening...' : 'Open it', options.onOpen, 'primary', {
          disabled: options.busy || blockedReason(draft.kind, options) !== null,
        }),
        button('Back', options.onBack, 'ghost'),
      ),
    ),
  );
}

/**
 * Any amount the presets do not carry.
 *
 * Bounded to the same range the service enforces, so nothing typed here can be
 * refused on the far side. Clamped on the way out rather than blocked on the
 * way in: somebody typing 100 passes through 1 and 10, and rejecting keystrokes
 * as they arrive makes the field feel broken while it is being used.
 */
function stakeField(options: ContestNewOptions): HTMLElement {
  const preset = STAKES.includes(options.draft.stakeNim);

  const field = el('input', {
    class: preset ? 'stakefield' : 'stakefield stakefield--on',
    type: 'number',
    inputmode: 'numeric',
    min: String(MIN_STAKE),
    max: String(MAX_STAKE),
    step: '1',
    placeholder: 'Custom',
    value: preset ? '' : String(options.draft.stakeNim),
    'aria-label': `Custom stake in NIM, ${MIN_STAKE} to ${MAX_STAKE}`,
  }) as HTMLInputElement;

  field.addEventListener('input', () => {
    const typed = Number.parseInt(field.value, 10);
    if (!Number.isFinite(typed)) return;
    options.onChange({
      ...options.draft,
      stakeNim: Math.max(MIN_STAKE, Math.min(MAX_STAKE, typed)),
    });
  });

  return field;
}

/**
 * Why a kind cannot be picked, or null when it can.
 *
 * One function rather than a condition in the row and another on the button,
 * because those two drifting apart is how you get a form that looks fillable
 * and refuses at the end.
 */
function blockedReason(kind: ContestKind, options: ContestNewOptions): string | null {
  if (kind === 'gauntlet') return 'Coming soon. The survival level is still being built.';
  if (kind === 'clan' && !options.clanTag) return 'Join a clan first';
  if (kind === 'clan' && !options.ownsClan) {
    return 'Only the clan owner can enter the clan in a contest';
  }
  return null;
}

/** The four choices, said the way a person would say them. */
function summarise(options: ContestNewOptions, stages: number[]): string {
  const { draft } = options;
  const what = stagesLabel(stages).toLowerCase();
  const stake = draft.stakeNim === 0 ? 'nothing but pride' : `${draft.stakeNim} NIM`;

  if (draft.kind === 'clan') {
    return `${options.clanTag ?? 'Your clan'} against whoever answers, over ${what}, for ${stake}. Each clan is scored on the average of its members who finish, so turning up in numbers does not win it.`;
  }

  const seats = `${draft.seats} pilots`;
  const where =
    draft.visibility === 'open' ? 'Listed for anybody' : 'Link only, so nobody stumbles into it';

  if (draft.kind === 'gauntlet') {
    return `${where}. Up to ${seats} fly one shared survival level for ${stake}. Hideouts and pickups, a clock nobody outlives, and the furthest run takes it.`;
  }

  return `${where}. Up to ${seats} fly ${what} for ${stake}. Everyone gets the identical level and the best average wins.`;
}

function pick(
  label: string,
  say: string,
  active: boolean,
  blocked: string | null,
  onClick: () => void,
): HTMLElement {
  const node = el(
    'button',
    {
      class: active ? 'pickrow pickrow--on' : 'pickrow',
      type: 'button',
      role: 'radio',
      'aria-checked': active ? 'true' : 'false',
      ...(blocked ? { disabled: 'true' } : {}),
    },
    el(
      'div',
      { class: 'pickrow__body' },
      el('p', { class: 'pickrow__name', text: label }),
      el('p', { class: 'pickrow__say', text: blocked ?? say }),
    ),
    el('span', { class: 'pickrow__mark', text: active ? 'ON' : '' }),
  );

  if (!blocked) node.addEventListener('click', onClick);
  return node;
}

function chip(label: string, active: boolean, onClick: () => void): HTMLElement {
  const node = el('button', {
    class: active ? 'chip chip--on' : 'chip',
    type: 'button',
    text: label,
    'aria-pressed': active ? 'true' : 'false',
  });
  node.addEventListener('click', onClick);
  return node;
}

/**
 * A number with two buttons.
 *
 * Not a slider and not a text field. A slider on a phone is a thumb fighting a
 * four pixel target, and a text field opens a keyboard over the form to enter
 * one digit from a range of six.
 */
function stepper(
  label: string,
  value: number,
  min: number,
  max: number,
  onChange: (next: number) => void,
): HTMLElement {
  const down = el('button', {
    class: 'stepper__step',
    type: 'button',
    text: '−',
    'aria-label': `${label}: one fewer`,
    ...(value <= min ? { disabled: 'true' } : {}),
  });
  const up = el('button', {
    class: 'stepper__step',
    type: 'button',
    text: '+',
    'aria-label': `${label}: one more`,
    ...(value >= max ? { disabled: 'true' } : {}),
  });

  down.addEventListener('click', () => onChange(Math.max(min, value - 1)));
  up.addEventListener('click', () => onChange(Math.min(max, value + 1)));

  return el(
    'div',
    { class: 'stepper' },
    el('span', { class: 'stepper__label', text: label }),
    el(
      'div',
      { class: 'stepper__row' },
      down,
      el('span', { class: 'stepper__value', text: String(value) }),
      up,
    ),
  );
}
