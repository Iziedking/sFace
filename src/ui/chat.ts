/**
 * The room, as a screen.
 *
 * ## Built once and updated in place
 *
 * Same reason as the contest form: this holds a text field somebody is typing
 * into, and rebuilding the page under them destroys it. On a phone that also
 * closes the keyboard, so a message can lose everything after its first
 * character. See renderContestNew for the full account of that.
 *
 * It also matters more here than there, because the room refreshes on a timer.
 * A screen that rebuilds every few seconds while you are composing is unusable
 * whether or not anything else is wrong with it.
 *
 * ## What a line shows
 *
 * A name, what they said, and what you can do about it. The name, picture, clan
 * and wallet all come from the sender's profile rather than from the message,
 * so nobody can post as somebody else and a name change lands on every line at
 * once.
 *
 * ## Tipping
 *
 * Offered only for pilots whose wallet has been proved by a signature, because
 * that is the only address this app has any business sending NIM to. Somebody
 * who has never signed shows no tip button rather than a broken one.
 */

import { button, el, mount } from './dom';
import { maskAddress } from './screens';
import type { ChatMessage, ChatPerson } from '../net/api';

export interface ChatOptions {
  messages: ChatMessage[];
  people: Record<string, ChatPerson>;
  meId: string;
  /** Null until the service has been asked, so the room can say it is loading. */
  loading: boolean;
  notice: string | null;
  sending: boolean;
  /** Longest a message may be, from the service so the two cannot disagree. */
  maxLength: number;
  onSend: (text: string) => void;
  /** Null when this pilot cannot tip: no wallet of their own yet. */
  onTip: ((person: ChatPerson, name: string, nim: number) => void) | null;
  onClan: (tag: string) => void;
  onBack: () => void;
}

interface Live {
  screen: HTMLElement;
  update: (options: ChatOptions) => void;
}

const live = new WeakMap<HTMLElement, Live>();

export function renderChat(root: HTMLElement, options: ChatOptions): void {
  const existing = live.get(root);
  if (existing && existing.screen.parentElement === root) {
    existing.update(options);
    return;
  }

  live.set(root, build(root, options));
}

function build(root: HTMLElement, first: ChatOptions): Live {
  let options = first;

  const list = el('div', { class: 'room__list' });
  const notice = el('p', { class: 'room__notice' });

  const field = el('input', {
    class: 'room__field',
    type: 'text',
    placeholder: 'Say something',
    'aria-label': 'Your message',
    maxlength: String(first.maxLength),
  }) as HTMLInputElement;

  const send = (): void => {
    const text = field.value.trim();
    if (text.length === 0 || options.sending) return;
    // Cleared here rather than when the service answers, so the room feels like
    // it took the message. A refusal puts the notice up and the text is short
    // enough to retype; leaving it in the box while it may or may not have sent
    // is the worse of the two.
    field.value = '';
    options.onSend(text);
  };

  const sendButton = button('Send', send, 'primary');

  field.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      send();
    }
  });

  const screen = el(
    'div',
    { class: 'screen room' },

    el('p', { class: 'eyebrow', text: 'The room' }),
    el('h1', { text: 'Who else is flying' }),
    el('p', {
      class: 'quiet',
      text: 'Everyone playing today, in one place. Find a clan, find somebody to race, tip a good run. Messages last a day, like the level.',
    }),

    list,
    notice,

    el('div', { class: 'room__compose' }, field, sendButton),

    el('div', { class: 'actions' }, button('Back', () => options.onBack(), 'ghost')),
  );

  function update(next: ChatOptions): void {
    options = next;

    sendButton.disabled = next.sending;
    sendButton.textContent = next.sending ? 'Sending...' : 'Send';

    notice.textContent = next.notice ?? '';
    notice.hidden = !next.notice;

    /*
     * The list is rebuilt, and only the list.
     *
     * It is the part that genuinely changes, and it holds nothing anybody is
     * typing into. The field and the button are built once and left alone,
     * which is the whole reason this screen updates in place at all.
     */
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 60 || list.childElementCount === 0;

    list.replaceChildren(
      ...(next.messages.length === 0
        ? [
            el('p', {
              class: 'room__empty',
              text: next.loading
                ? 'Reading the room...'
                : 'Nobody has said anything today. Go first.',
            }),
          ]
        : next.messages.map((message) => line(message, next))),
    );

    // Follow the conversation, unless the reader has scrolled up to read
    // something. Yanking them back to the bottom mid-sentence is worse than
    // missing a line.
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  update(first);
  mount(root, screen);
  return { screen, update };
}

/** One message, with whatever can be done about the person who sent it. */
function line(message: ChatMessage, options: ChatOptions): HTMLElement {
  const person = options.people[message.pilotId];
  const name = person?.name ?? 'Pilot';
  const mine = message.pilotId === options.meId;

  const canTip = options.onTip !== null && !mine && Boolean(person?.address);

  return el(
    'div',
    { class: mine ? 'room__line room__line--mine' : 'room__line' },

    person?.avatarUrl
      ? el('img', {
          class: 'room__avatar',
          src: person.avatarUrl,
          alt: '',
          referrerpolicy: 'no-referrer',
          loading: 'lazy',
        })
      : el('div', { class: 'room__avatar' }),

    el(
      'div',
      { class: 'room__body' },
      el(
        'div',
        { class: 'room__who' },
        el('span', { class: 'room__name', text: name }),
        // A clan tag is a thing you can act on, so it is a button rather than a
        // label: this is how somebody with no friends here finds a clan.
        person?.clanTag ? clanChip(person.clanTag, options) : null,
        person?.address
          ? el('span', { class: 'room__wallet', text: maskAddress(person.address) })
          : null,
      ),

      /*
       * Set as text, never as markup.
       *
       * This is the one screen in the app that shows what a stranger typed. It
       * goes in as a text node and nothing here ever assembles HTML from it.
       */
      el('p', { class: 'room__said', text: message.text }),

      canTip && person ? tipChip(person, name, options) : null,
    ),
  );
}

/** A clan tag you can press, which is how somebody here finds one to join. */
function clanChip(tag: string, options: ChatOptions): HTMLElement {
  const node = el('button', {
    class: 'room__clan',
    type: 'button',
    text: tag,
    title: `Look at clan ${tag}`,
  });
  node.addEventListener('click', () => options.onClan(tag));
  return node;
}

/**
 * Send somebody NIM for a good run, to the wallet they proved by signing.
 *
 * ## Why the amounts are buttons rather than a box
 *
 * The obvious version asks how much, and the obvious way to ask is a prompt.
 * A JavaScript dialog blocks a WebView: inside Nimiq Pay it can stop the page
 * answering anything at all, which is a bad trade for a number somebody would
 * have picked from three options anyway.
 *
 * So the tip opens three amounts in place. Tapping one goes straight to the
 * wallet, which is where the real confirmation belongs and already exists.
 */
const TIPS = [1, 5, 10];

function tipChip(person: ChatPerson, name: string, options: ChatOptions): HTMLElement {
  const row = el('div', { class: 'room__tiprow' });

  const open = el('button', { class: 'room__tip', type: 'button', text: `Tip ${name}` });
  open.addEventListener('click', () => {
    open.hidden = true;
    for (const amount of amounts) amount.hidden = false;
  });

  const amounts = TIPS.map((nim) => {
    const node = el('button', {
      class: 'room__tipamount',
      type: 'button',
      text: `${nim} NIM`,
    });
    node.hidden = true;
    node.addEventListener('click', () => {
      // Back to the single button straight away. The wallet is about to take
      // over, and a row of amounts left open behind it invites a second tap on
      // a dialog that is already up.
      open.hidden = false;
      for (const other of amounts) other.hidden = true;
      options.onTip?.(person, name, nim);
    });
    return node;
  });

  row.append(open, ...amounts);
  return row;
}
