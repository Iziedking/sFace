/**
 * Opening a contest: the terms, before anybody has staked anything.
 *
 * ## One screen, five decisions
 *
 * Kind, stages, stake, seats, and how long it stays open. Everything else is
 * derived or fixed, and the screen refuses to grow past those: a form with
 * eight choices on it is a form people abandon, and this one sits between a
 * player and the thing they came to do.
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
  MAX_OPEN_MINUTES,
  MAX_SEATS,
  MAX_STAGE,
  MIN_OPEN_MINUTES,
  MIN_SEATS,
  endOfUtcDay,
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
  /**
   * How long it stays answerable, in minutes, or null for the rest of the day.
   *
   * Null is not "unset". It is the ordinary choice and the honest ceiling: a
   * contest is pinned to a level that stops existing at midnight UTC, so the
   * rest of the day is the longest window that can be flown.
   */
  openMinutes: number | null;
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

/**
 * The windows worth one tap.
 *
 * Half an hour for a contest between two people who are both holding their
 * phones, a couple of hours for one going out to a group, and the rest of the
 * day for everything else. Anything between them is the custom field.
 */
const WINDOWS: Array<{ minutes: number | null; label: string }> = [
  { minutes: 30, label: '30 min' },
  { minutes: 120, label: '2 hours' },
  { minutes: 360, label: '6 hours' },
  { minutes: null, label: 'Rest of day' },
];

/** The same bounds the service enforces, so nothing typed here is refused. */
const MIN_STAKE = 0;
const MAX_STAKE = 1000;

/**
 * Built once, then updated in place.
 *
 * ## Why this screen is not a pure render like the others
 *
 * Every other screen in the app repaints by rebuilding its DOM, which is fine
 * for a screen you look at. This is a form: somebody sits on it with a keyboard
 * open, changing one control at a time, and rebuilding the page under them on
 * every keystroke breaks it in three ways at once.
 *
 * The entry animation replays. `.screen > *` runs a staggered rise, so every
 * character typed set the whole page animating again. Reported as the page
 * flashing, repeatedly, and preserving the scroll position did nothing for it
 * because the flash was never about scroll.
 *
 * The field being typed into is destroyed and replaced. Restoring its text and
 * caret afterwards covers a desktop browser and does not cover a phone, where
 * replacing the focused element's ancestors closes the soft keyboard. Reported
 * as only the first character landing, which is what a keyboard closing after
 * one key looks like.
 *
 * And it is wasteful: a hundred nodes rebuilt to move one highlight.
 *
 * So the tree is built once and the controls that depend on the draft are
 * updated by hand. It is more code than a re-render, and it is the difference
 * between a form that works and one that does not.
 */
/**
 * A control that is built once and told what to show afterwards.
 *
 * Every screen elsewhere rebuilds its DOM to change a highlight, which is fine
 * for something you only read. On a form it destroys whatever is under the
 * thumb, so these keep their nodes and take instructions instead.
 */
interface Control<T> {
  node: HTMLElement;
  set: (value: T) => void;
}

/** The same, for a control whose state needs two things to describe it. */
interface Control2<A, B> {
  node: HTMLElement;
  set: (a: A, b: B) => void;
}

interface Live {
  screen: HTMLElement;
  update: (options: ContestNewOptions) => void;
}

const live = new WeakMap<HTMLElement, Live>();

export function renderContestNew(root: HTMLElement, options: ContestNewOptions): void {
  const existing = live.get(root);
  // Still the screen we built, and still on the page. Anything else means the
  // player went somewhere and came back, and gets a fresh build.
  if (existing && existing.screen.parentElement === root) {
    existing.update(options);
    return;
  }

  live.set(root, build(root, options));
}

function build(root: HTMLElement, first: ContestNewOptions): Live {
  /*
   * The live options, so every handler reads the current draft.
   *
   * Handlers are bound once when the tree is built and outlive any particular
   * update, so closing over the options from build time would spread the first
   * draft over every later change.
   */
  let options = first;

  /*
   * The ceiling is what they have actually cleared, never the whole campaign.
   *
   * Staking NIM on stage seven having never reached it is a bet somebody is
   * going to lose to a level they have not seen, and the game would have taken
   * their money for the privilege. One is always available so a new player can
   * still open something.
   */
  const ceiling = Math.max(1, Math.min(MAX_STAGE, first.stagesCleared || 1));

  const kinds = KINDS.map((kind) =>
    pick(KIND_LABEL[kind], KIND_SAY[kind], () => options.onChange({ ...options.draft, kind })),
  );

  const from = stepper('From', 1, ceiling, (n) =>
    options.onChange({ ...options.draft, from: n, to: Math.max(n, options.draft.to) }),
  );
  const to = stepper('To', 1, ceiling, (n) =>
    options.onChange({ ...options.draft, to: n, from: Math.min(n, options.draft.from) }),
  );
  const seats = stepper('Seats', MIN_SEATS, MAX_SEATS, (n) =>
    options.onChange({ ...options.draft, seats: n }),
  );

  const stakeChips = STAKES.map((nim) =>
    chip(nim === 0 ? 'Free' : `${nim} NIM`, () =>
      options.onChange({ ...options.draft, stakeNim: nim }),
    ),
  );
  // The presets cover the common cases and cannot cover everybody. Two people
  // who agreed on 7 NIM should not have to round to 5 or 10.
  const stake = numberField({
    className: 'stakefield',
    min: MIN_STAKE,
    max: MAX_STAKE,
    placeholder: 'Custom',
    label: `Custom stake in NIM, ${MIN_STAKE} to ${MAX_STAKE}`,
    commit: (stakeNim) => options.onChange({ ...options.draft, stakeNim }),
  });

  const windowChips = WINDOWS.map((window) =>
    chip(window.label, () => options.onChange({ ...options.draft, openMinutes: window.minutes })),
  );
  const minutes = numberField({
    className: 'stakefield',
    min: MIN_OPEN_MINUTES,
    max: MAX_OPEN_MINUTES,
    placeholder: 'Minutes',
    label: `Custom window in minutes, ${MIN_OPEN_MINUTES} to ${MAX_OPEN_MINUTES}`,
    commit: (openMinutes) => options.onChange({ ...options.draft, openMinutes }),
  });

  const anyone = chip('Anyone', () => options.onChange({ ...options.draft, visibility: 'open' }));
  const linkOnly = chip('Link only', () =>
    options.onChange({ ...options.draft, visibility: 'private' }),
  );

  const windowNote = el('p', { class: 'quiet' });
  const seeNote = el('p', { class: 'quiet' });
  const preview = el('p', { class: 'contestnew__previewsay' });

  // Seats are meaningless on a clan contest, where the roster decides who turns
  // up. Hidden rather than removed, so changing kind moves nothing else.
  const seatsBlock = el(
    'div',
    { class: 'contestnew__seats' },
    el('p', { class: 'group', text: 'HOW MANY CAN ENTER' }),
    seats.node,
  );

  const notice = el('div', { class: 'notice notice--error' });
  const open = button('Open it', () => options.onOpen(), 'primary');

  const screen = el(
    'div',
    { class: 'screen contestnew' },

    el('p', { class: 'eyebrow', text: 'New contest' }),
    el('h1', { text: 'Set the terms' }),

    el('p', { class: 'group', text: 'WHAT KIND' }),
    el('div', { class: 'picks' }, ...kinds.map((k) => k.node)),

    el('p', { class: 'group', text: 'HOW MANY STAGES' }),
    el('div', { class: 'stagepick' }, from.node, to.node),
    ceiling < MAX_STAGE
      ? el('p', {
          class: 'quiet',
          text: `You can stake up to stage ${ceiling}, which is as far as you have cleared. Clear more and the rest open up.`,
        })
      : null,

    el('p', { class: 'group', text: 'THE STAKE' }),
    el('div', { class: 'chips' }, ...stakeChips.map((c) => c.node), stake.node),

    seatsBlock,

    el('p', { class: 'group', text: 'HOW LONG IT STAYS OPEN' }),
    el('div', { class: 'chips' }, ...windowChips.map((c) => c.node), minutes.node),
    windowNote,

    el('p', { class: 'group', text: 'WHO CAN SEE IT' }),
    el('div', { class: 'chips' }, anyone.node, linkOnly.node),
    seeNote,

    /*
     * The terms as one sentence.
     *
     * A contest is an agreement, and four separate controls do not read as one.
     * This is the last chance to notice that "stages 1 to 7" was not what was
     * meant, and it costs a line.
     */
    el(
      'div',
      { class: 'contestnew__preview' },
      el('p', { class: 'contestnew__previewhead', text: 'THE AGREEMENT' }),
      preview,
    ),

    notice,

    el('div', { class: 'actions' }, open, button('Back', () => options.onBack(), 'ghost')),
  );

  function update(next: ContestNewOptions): void {
    options = next;
    const { draft } = next;
    const stages = stageRange(draft.from, draft.to);

    kinds.forEach((row, i) => {
      const kind = KINDS[i]!;
      // A clan contest with no clan behind it has nothing to enter, so the row
      // says why rather than vanishing.
      row.set(draft.kind === kind, blockedReason(kind, next));
    });

    from.set(draft.from);
    to.set(draft.to);
    seats.set(draft.seats);
    seatsBlock.hidden = draft.kind === 'clan';

    stakeChips.forEach((c, i) => c.set(draft.stakeNim === STAKES[i]));
    stake.set(STAKES.includes(draft.stakeNim) ? null : draft.stakeNim);

    windowChips.forEach((c, i) => c.set(draft.openMinutes === WINDOWS[i]!.minutes));
    minutes.set(
      draft.openMinutes === null || WINDOWS.some((w) => w.minutes === draft.openMinutes)
        ? null
        : draft.openMinutes,
    );

    anyone.set(draft.visibility === 'open');
    linkOnly.set(draft.visibility === 'private');

    windowNote.textContent = windowSay(draft.openMinutes, Date.now());
    seeNote.textContent =
      draft.visibility === 'open'
        ? 'It appears in Contests for anybody to take a seat in.'
        : 'It stays off the Contests list. Only someone with the link can enter, so the link is the invitation.';
    preview.textContent = summarise(next, stages);

    notice.textContent = next.notice ?? '';
    notice.hidden = !next.notice;

    open.textContent = next.busy ? 'Opening...' : 'Open it';
    open.disabled = next.busy || blockedReason(draft.kind, next) !== null;
  }

  update(first);
  mount(root, screen);
  return { screen, update };
}

/**
 * A field somebody can actually type a number into.
 *
 * ## What was wrong with the obvious version
 *
 * It clamped the value into range on every keystroke and handed it straight
 * back to the screen, which repainted. Three separate things went wrong at
 * once, and together they made both custom boxes impossible to use.
 *
 * The repaint destroyed the element being typed into, so the second character
 * went nowhere. The clamp fought the typist: on the way to 45 minutes you pass
 * through 4, which is below the floor, so it became 30 and the next keystroke
 * built on 30 instead of 4. And on the stake, typing 1 produced a value that is
 * one of the presets, so the field decided it was no longer in use and blanked
 * itself mid-word.
 *
 * ## The rule here
 *
 * While the field has focus it belongs to the person typing. Nothing rewrites
 * its text. A value inside the allowed range is committed as it is typed, so
 * the sentence underneath keeps up; a value outside it is simply not committed
 * yet, because half a number is not a smaller number. Leaving the field is what
 * settles it: on blur the value is clamped, and the text is corrected to match
 * what was actually kept.
 *
 * `data-keep` is what lets the repaint hand the text back if one happens
 * anyway. See mount in ui/dom.ts.
 */
function numberField(input: {
  className: string;
  min: number;
  max: number;
  placeholder: string;
  label: string;
  commit: (n: number) => void;
}): Control<number | null> {
  const field = el('input', {
    class: input.className,
    /*
     * Text rather than number, deliberately.
     *
     * A number input refuses to report a caret position, comes with spinners,
     * and accepts an exponent notation nobody wants in a stake. The numeric
     * keypad on a phone comes from inputmode, which is the part worth having.
     */
    type: 'text',
    inputmode: 'numeric',
    placeholder: input.placeholder,
    'aria-label': input.label,
  }) as HTMLInputElement;

  field.addEventListener('input', () => {
    const typed = Number.parseInt(field.value.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(typed)) return;
    // Out of range means still being typed. Committing a clamped version would
    // rewrite what is under the caret.
    if (typed < input.min || typed > input.max) return;
    input.commit(typed);
  });

  field.addEventListener('blur', () => {
    const typed = Number.parseInt(field.value.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(typed)) {
      // Nothing usable was left in it. The presets still hold whatever is set.
      field.value = '';
      return;
    }

    const settled = Math.max(input.min, Math.min(input.max, typed));
    field.value = String(settled);
    input.commit(settled);
  });

  return {
    node: field,
    set(value) {
      /*
       * Never while it has focus.
       *
       * This is the rule the whole screen turns on. A field being typed into
       * belongs to the person typing: rewriting its text under the caret is
       * what made 45 impossible to enter, because 4 is below the floor and the
       * screen kept correcting it back.
       */
      if (document.activeElement === field) {
        field.classList.toggle(`${input.className}--on`, value !== null);
        return;
      }

      const shown = value === null ? '' : String(value);
      if (field.value !== shown) field.value = shown;
      field.classList.toggle(`${input.className}--on`, value !== null);
    },
  };
}

/**
 * What the chosen window actually means today.
 *
 * The interesting case is the one the host cannot see coming: it is nine at
 * night UTC, they pick six hours, and they get three. Said here rather than
 * discovered on the card, because the window is part of the terms and somebody
 * is about to send this to a friend.
 */
function windowSay(openMinutes: number | null, now: number): string {
  const dayEnd = endOfUtcDay(now);
  const leftToday = Math.floor((dayEnd - now) / 60_000);

  if (openMinutes === null) {
    return `It closes at midnight UTC, about ${readMinutes(leftToday)} from now, when today's level is replaced.`;
  }

  if (openMinutes >= leftToday) {
    return `Today's level is replaced at midnight UTC, so this one closes in about ${readMinutes(leftToday)} rather than ${readMinutes(openMinutes)}.`;
  }

  return `It closes ${readMinutes(openMinutes)} after you open it. Nobody can take a seat or post a run after that.`;
}

/** Minutes as a person would say them. */
function readMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, minutes)} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'an hour' : `${hours} hours`;
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

/**
 * The choices, said the way a person would say them.
 *
 * The window belongs in here rather than only in the picker above. It is a
 * term like the stake is: somebody who takes a seat is agreeing to fly before
 * it closes, and forfeits if they do not. A sentence that names the stake and
 * omits the deadline describes a different agreement to the one being made.
 */
function summarise(options: ContestNewOptions, stages: number[]): string {
  const { draft } = options;
  const what = stagesLabel(stages).toLowerCase();
  const stake = draft.stakeNim === 0 ? 'nothing but pride' : `${draft.stakeNim} NIM`;
  const clock = closesAt(draft.openMinutes, Date.now());

  if (draft.kind === 'clan') {
    return `${options.clanTag ?? 'Your clan'} against whoever answers, over ${what}, for ${stake}. ${clock} Each clan is scored on the average of its members who finish, so turning up in numbers does not win it.`;
  }

  const seats = `${draft.seats} pilots`;
  const where =
    draft.visibility === 'open' ? 'Listed for anybody' : 'Link only, so nobody stumbles into it';

  if (draft.kind === 'gauntlet') {
    return `${where}. Up to ${seats} fly one shared survival level for ${stake}. ${clock} Hideouts and pickups, a clock nobody outlives, and the furthest run takes it.`;
  }

  return `${where}. Up to ${seats} fly ${what} for ${stake}. ${clock} Everyone gets the identical level and the best average wins.`;
}

/**
 * The deadline as a clause in the agreement.
 *
 * Shorter than the line under the picker on purpose. That one explains the
 * rule; this one is a term in a sentence somebody is about to send to a friend.
 */
function closesAt(openMinutes: number | null, now: number): string {
  const leftToday = Math.floor((endOfUtcDay(now) - now) / 60_000);
  const window = openMinutes === null ? leftToday : Math.min(openMinutes, leftToday);
  return `It closes in ${readMinutes(window)}, and anybody who has not finished by then forfeits.`;
}

function pick(label: string, say: string, onClick: () => void): Control2<boolean, string | null> {
  const name = el('p', { class: 'pickrow__name', text: label });
  const reason = el('p', { class: 'pickrow__say', text: say });
  const mark = el('span', { class: 'pickrow__mark' });

  const node = el(
    'button',
    { class: 'pickrow', type: 'button', role: 'radio' },
    el('div', { class: 'pickrow__body' }, name, reason),
    mark,
  ) as HTMLButtonElement;

  // Bound once. A blocked row refuses in the handler rather than by having no
  // handler, because whether it is blocked changes as the draft does.
  node.addEventListener('click', () => {
    if (!node.disabled) onClick();
  });

  return {
    node,
    set(active, blocked) {
      node.classList.toggle('pickrow--on', active);
      node.setAttribute('aria-checked', active ? 'true' : 'false');
      node.disabled = blocked !== null;
      reason.textContent = blocked ?? say;
      mark.textContent = active ? 'ON' : '';
    },
  };
}

function chip(label: string, onClick: () => void): Control<boolean> {
  const node = el('button', { class: 'pickchip', type: 'button', text: label });
  node.addEventListener('click', onClick);

  return {
    node,
    set(active) {
      node.classList.toggle('pickchip--on', active);
      node.setAttribute('aria-pressed', active ? 'true' : 'false');
    },
  };
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
  min: number,
  max: number,
  onChange: (next: number) => void,
): Control<number> {
  let current = min;

  const down = el('button', {
    class: 'stepper__step',
    type: 'button',
    text: '−',
    'aria-label': `${label}: one fewer`,
  }) as HTMLButtonElement;
  const up = el('button', {
    class: 'stepper__step',
    type: 'button',
    text: '+',
    'aria-label': `${label}: one more`,
  }) as HTMLButtonElement;
  const value = el('span', { class: 'stepper__value' });

  // Reads `current` at press time rather than closing over a value from build
  // time, which would step from the same number forever.
  down.addEventListener('click', () => onChange(Math.max(min, current - 1)));
  up.addEventListener('click', () => onChange(Math.min(max, current + 1)));

  const node = el(
    'div',
    { class: 'stepper' },
    el('span', { class: 'stepper__label', text: label }),
    el('div', { class: 'stepper__row' }, down, value, up),
  );

  return {
    node,
    set(next) {
      current = next;
      value.textContent = String(next);
      down.disabled = next <= min;
      up.disabled = next >= max;
    },
  };
}
