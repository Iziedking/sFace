/**
 * Clans: one screen that joins, invites, and ranks.
 *
 * Three separate screens was the first sketch and it was wrong. A clan is a
 * four character tag and a pooled total, which is not enough substance to fill
 * one page let alone three, and every extra hop is somewhere a player stops.
 * So the whole feature is here: where you stand, how to bring someone in, and
 * who is ahead of you.
 *
 * The order is deliberate. Your own clan first, because that is what you came
 * to see. The invite immediately under it, because the moment you are proud of
 * a number is the moment you will send it to someone. The table last, because
 * it is the reason to come back rather than the reason you are here now.
 */

import { button, el, mount } from './dom';
import type { ClanDetail, ClanRow } from '../net/api';

export interface ClanOptions {
  /** Our own pilot id, so the screen knows whether it is looking at the owner. */
  meId: string;
  /** The tag on this pilot's profile, or null when they are unattached. */
  myTag: string | null;
  /** A tag we have asked to join and are waiting on. */
  awaiting: string | null;
  onDecide: (memberId: string, approve: boolean) => void;
  onCancelRequest: () => void;
  /** Detail for the pilot's own clan. Null while it is still loading. */
  mine: ClanDetail | null;
  /** The standings. Empty while loading, or when nobody has formed one. */
  table: ClanRow[];
  loading: boolean;
  offline: boolean;
  /** Pre-filled from an invite link, so an invited player only has to tap join. */
  suggested: string | null;
  /** Set when the last attempt was refused, so we can say why. */
  notice: string | null;
  busy: boolean;
  onJoin: (tag: string) => void;
  /**
   * Ask whether a tag is already somebody's. Resolves null when unknown, which
   * keeps the button on its neutral label rather than guessing.
   */
  onLookup: (tag: string) => Promise<{ taken: boolean; owner: string | null } | null>;
  onLeave: () => void;
  onInvite: () => void;
  onBack: () => void;
}

export function renderClan(root: HTMLElement, options: ClanOptions): void {
  /*
   * Carry the join field across a re-render.
   *
   * This screen repaints whenever the standings land, which is a moment after
   * it opens and again after every join. Every screen in this game is a full
   * remount, which is fine for read-only ones and is not fine here: the input
   * is destroyed mid-word, so a player typing a tag watches their letters
   * vanish and the caret jump out of the box.
   *
   * Read off the outgoing DOM rather than threaded through app state, because
   * the old field is still mounted at this point and it is the only thing that
   * knows what was typed. Nothing else needs to care.
   */
  const outgoing = root.querySelector<HTMLInputElement>('.field');
  const carried = outgoing?.value ?? '';
  const hadFocus = outgoing !== null && document.activeElement === outgoing;

  mount(
    root,
    el(
      'div',
      { class: 'screen' },
      el('p', { class: 'eyebrow', text: options.myTag ? `CLAN ${options.myTag}` : 'CLANS' }),
      el('h1', {
        text: options.myTag
          ? 'Your clan'
          : options.awaiting
            ? 'Waiting to be let in'
            : 'Fly with people',
      }),

      options.offline
        ? el('div', {
            class: 'notice notice--error',
            text: 'Clans need the service. Everything else still works.',
          })
        : null,

      options.notice ? el('div', { class: 'notice notice--error', text: options.notice }) : null,

      options.myTag
        ? minePanel(options)
        : options.awaiting
          ? waitingPanel(options)
          : joinPanel(options, carried),

      el('p', { class: 'stat__label', text: 'STANDINGS' }),
      el('p', {
        class: 'quiet',
        // Said plainly, because the alternative is a player working out for
        // themselves that there is no lock on the door and concluding we hid it.
        text: 'A clan is a tag and a pooled total. Anyone can join any tag, and joining only ever adds Face to it, so there is nothing to take by walking in.',
      }),
      standings(options),

      el('div', { class: 'actions' }, button('Back', options.onBack, 'ghost')),
    ),
  );

  // Put the caret back where it was. Restoring the text without the focus
  // would still throw a typist out of the box on every repaint.
  if (hadFocus) {
    const field = root.querySelector<HTMLInputElement>('.field');
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }
}

/** What you get once you are in one. */
function minePanel(options: ClanOptions): HTMLElement {
  const mine = options.mine;
  // "1st of 12 clans" says something. "1st of every clan" says nothing until
  // you already know how many there are.
  const total = Math.max(options.table.length, mine?.place ?? 0);

  if (!mine) {
    return el('div', { class: 'clan' }, el('p', { class: 'spinner', text: 'Reading the clan' }));
  }

  return el(
    'div',
    { class: 'clan' },
    el(
      'div',
      { class: 'clan__head' },
      el('span', { class: 'clan__tag', text: mine.tag }),
      el(
        'div',
        {},
        el('div', {
          class: 'clan__face',
          text: `${mine.face.toLocaleString()} Face`,
        }),
        el('div', {
          class: 'clan__meta',
          text:
            mine.place > 0 && total > 0
              ? `${ordinal(mine.place)} of ${plural(total, 'clan')} · ${plural(mine.members, 'pilot')}`
              : plural(mine.members, 'pilot'),
        }),
      ),
    ),

    mine.roster.length > 0
      ? el(
          'div',
          { class: 'clan__roster' },
          ...mine.roster.slice(0, 8).map((member) =>
            el(
              'div',
              { class: 'clan__member' },
              member.avatarUrl
                ? el('img', {
                    class: 'clan__avatar',
                    src: member.avatarUrl,
                    alt: '',
                    referrerpolicy: 'no-referrer',
                    loading: 'lazy',
                  })
                : el('div', { class: 'clan__avatar' }),
              el('span', { class: 'clan__name', text: member.name }),
              el('span', {
                class: 'clan__contribution',
                text: member.lifetimeFace.toLocaleString(),
              }),
            ),
          ),
        )
      : el('p', { class: 'quiet', text: 'Nobody has posted a run under this tag yet.' }),

    requestsPanel(options, mine),

    el(
      'div',
      { class: 'actions' },
      button('Invite on X', options.onInvite, 'x'),
      button('Leave clan', options.onLeave, 'quiet'),
    ),
  );
}

/**
 * The door, for whoever is holding it.
 *
 * Only the owner sees this, and only when somebody is knocking. A permanently
 * present empty "no requests" box on every member's screen would be furniture
 * that never does anything.
 */
function requestsPanel(options: ClanOptions, mine: ClanDetail): HTMLElement | null {
  const isOwner = mine.ownerId !== null && mine.ownerId === options.meId;
  if (!isOwner || mine.pending.length === 0) return null;

  return el(
    'div',
    { class: 'requests' },
    el('p', {
      class: 'stat__label',
      text: `${mine.pending.length} WAITING TO JOIN`,
    }),
    ...mine.pending.map((request) =>
      el(
        'div',
        { class: 'requests__row' },
        el('span', { class: 'requests__name', text: request.name }),
        el(
          'div',
          { class: 'requests__act' },
          button('Let in', () => options.onDecide(request.id, true), 'ghost'),
          button('No', () => options.onDecide(request.id, false), 'quiet'),
        ),
      ),
    ),
  );
}

/** Asked, and waiting. The one state that is neither in nor out. */
function waitingPanel(options: ClanOptions): HTMLElement {
  return el(
    'div',
    { class: 'clan' },
    el(
      'div',
      { class: 'clan__head' },
      el('span', { class: 'clan__tag', text: options.awaiting ?? '' }),
      el('div', { class: 'clan__face', text: 'Request sent' }),
    ),
    el('p', {
      class: 'clan__pitch',
      text: `${options.awaiting} is somebody's clan, so getting in is their call. You will be in as soon as they say yes. Nothing stops you flying in the meantime.`,
    }),
    el(
      'div',
      { class: 'actions' },
      button('Withdraw the request', options.onCancelRequest, 'quiet'),
    ),
  );
}

/** The join form, for anyone not in one yet. */
function joinPanel(options: ClanOptions, carried: string): HTMLElement {
  const field = el('input', {
    class: 'field',
    type: 'text',
    inputmode: 'latin',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '4',
    // An input defaults to twenty characters wide whatever its CSS says, and
    // that intrinsic width was pushing the whole panel past the edge of a
    // phone. Four is what a tag is.
    size: '4',
    placeholder: 'FACE',
    'aria-label': 'Clan tag',
  });

  // What was being typed wins over the invite, because a player who has started
  // typing has decided against the suggestion.
  field.value = carried || options.suggested || '';

  // Corrected as they type rather than refused on submit. Somebody typing a
  // lowercase tag has not made a mistake worth an error message.
  field.addEventListener('input', () => {
    const clean = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (clean !== field.value) field.value = clean;
  });

  const action = button(options.busy ? 'Working' : 'Go', () => submit());
  const hint = el('p', { class: 'field__hint' });

  /*
   * Say which of the two things is about to happen.
   *
   * One button doing either "found a clan" or "ask to join somebody else's" is
   * the whole reason a player asks whether they can create one at all. The
   * copy explained it and the button still said Join, so the copy lost. Now the
   * button reads the tag and renames itself.
   *
   * Debounced, because this fires per keystroke and it is a network call.
   */
  let lookupAt = 0;
  const describe = async (): Promise<void> => {
    const tag = field.value.trim().toUpperCase();

    if (!/^[A-Z0-9]{2,4}$/.test(tag)) {
      action.textContent = 'Go';
      hint.textContent = '';
      return;
    }

    const at = ++lookupAt;
    const found = await options.onLookup(tag);
    // A slower answer to an older keystroke must not overwrite a newer one.
    if (at !== lookupAt) return;

    if (!found) {
      action.textContent = `Go with ${tag}`;
      hint.textContent = '';
      return;
    }

    action.textContent = found.taken ? `Ask to join ${tag}` : `Found ${tag}`;
    hint.textContent = found.taken
      ? `${tag} belongs to ${found.owner ?? 'somebody'}. They decide.`
      : `${tag} is free. Taking it makes you its owner.`;
  };

  // Wired after describe exists. Debounced, because it fires per keystroke and
  // it is a network call.
  let debounce: number | null = null;
  field.addEventListener('input', () => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = window.setTimeout(() => void describe(), 400);
  });

  // A pre-filled invite gets its label straight away rather than waiting for a
  // keystroke that is never coming.
  if (field.value) void describe();

  const submit = (): void => {
    if (options.busy) return;
    options.onJoin(field.value.trim().toUpperCase());
  };

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  return el(
    'div',
    { class: 'clan' },
    el('p', {
      class: 'clan__pitch',
      // Two different actions behind one button, so the copy has to say which
      // one is about to happen. Typing a taken tag sends a request; typing a
      // free one founds a clan and makes you its owner.
      text: options.suggested
        ? `You were invited to ${options.suggested}. Ask to join and its owner lets you in.`
        : 'Type two to four characters. If nobody has taken it you found it and you own it. If somebody has, this asks them to let you in.',
    }),
    el('div', { class: 'field__row' }, field, action),
    hint,
  );
}

function standings(options: ClanOptions): HTMLElement {
  if (options.loading) return el('p', { class: 'spinner', text: 'Reading the standings' });
  if (options.table.length === 0) {
    return el('div', { class: 'empty', text: 'No clans yet. Start the first one.' });
  }

  return el(
    'div',
    { class: 'board' },
    ...options.table.slice(0, 20).map((row, index) => {
      const isMine = row.tag === options.myTag;
      return el(
        'div',
        { class: isMine ? 'board__row board__row--you' : 'board__row' },
        el('span', { class: 'board__rank', text: `${index + 1}` }),
        row.topPilotAvatar
          ? el('img', {
              class: 'board__avatar',
              src: row.topPilotAvatar,
              alt: '',
              referrerpolicy: 'no-referrer',
              loading: 'lazy',
            })
          : el('div', { class: 'board__avatar' }),
        el(
          'div',
          { class: 'board__who' },
          el(
            'div',
            { class: 'board__name' },
            el('span', { class: 'board__clan', text: row.tag }),
            el('span', { text: isMine ? 'your clan' : plural(row.members, 'pilot') }),
          ),
          row.topPilot
            ? el('div', { class: 'board__tier', text: `led by ${row.topPilot}` })
            : null,
        ),
        el('span', { class: 'board__score', text: row.face.toLocaleString() }),
      );
    }),
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  const ones = place % 10;
  const suffix = ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
  return `${place}${suffix}`;
}
