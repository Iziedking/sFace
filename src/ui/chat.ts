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
 * Consecutive lines from one person are grouped: the first carries the avatar,
 * name, clan, wallet and time, and the rest are just what they said. A dozen
 * people talking is the case this screen has to survive, and repeating a masked
 * wallet under every sentence of a burst turns a conversation into a list.
 *
 * ## Replies
 *
 * A message can answer another one, and the answer draws a quote of what it is
 * answering. The quote is resolved here, from the room, rather than sent along
 * with the reply: the room already holds every message, so the quote is always
 * the current text under the current name instead of a copy that went stale.
 * Tapping it goes to the original and marks it, which is the whole navigation
 * this needs. There is no thread to open.
 *
 * ## Runs, and why they are the thing being tipped
 *
 * A room of text gives nobody a reason to send anybody money. You cannot see a
 * run in it, so the only way to find one worth tipping was to read a
 * leaderboard on another screen that has no tip button on it.
 *
 * So a message can carry a run, drawn as a card with the numbers on it and the
 * tip attached to that rather than to the person. The card is resolved by the
 * service from the sender's own board row, so the score on it is the score the
 * board is ranking. Nothing here renders a number a message supplied itself.
 *
 * ## Tipping
 *
 * The button shows even for somebody who has never connected a wallet, which is
 * the opposite of what this screen used to do. Hiding it was tidier and meant
 * that person never found out they were missing tips; now the attempt fails in
 * front of the tipper, costs nothing, and puts a note on the other pilot's bell
 * telling them what to connect.
 *
 * ## Nothing a stranger typed is ever markup, and almost nothing is a link
 *
 * Every piece of message text goes in as a text node. The only tappable thing
 * ever made out of a message is an sFace invite on this app's own origin, which
 * becomes a button to a screen inside the app. See findInvite for why a room
 * full of strangers is the wrong place to turn text into links.
 */

import { button, el, mount } from './dom';
import { maskAddress } from './screens';
import { findInvite } from '../data/chat';
import type { Invite } from '../data/chat';
import type { ChatMessage, ChatPerson, RunCard } from '../net/api';

/** Who a tip is aimed at. The address is the service's, never the message's. */
export interface TipTarget {
  pilotId: string;
  name: string;
  address: string | null;
}

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
  /**
   * Today's coin and date, so a card flown today can name what it was flown on.
   *
   * Supplied by the app rather than by the service, because the client already
   * knows today's mission and asking the room to look up a ticker per message
   * would put a paid read behind a page that refreshes every few seconds.
   */
  ticker: string | null;
  today: string;
  /** This app's own origin, which is the only one an invite may point at. */
  origin: string;
  /** The message being answered, if any. Held by the app, not by this screen. */
  replyingTo: string | null;
  onReply: (messageId: string | null) => void;
  onSend: (text: string) => void;
  onTip: (target: TipTarget, nim: number) => void;
  /** Null when there is no run of yours on today's board to post. */
  onShareRun: (() => void) | null;
  onInvite: (invite: Invite) => void;
  onClan: (tag: string) => void;
  onBack: () => void;
}

interface Live {
  screen: HTMLElement;
  update: (options: ChatOptions) => void;
}

const live = new WeakMap<HTMLElement, Live>();

/**
 * How close together two messages from one person have to be to group.
 *
 * Long enough that a burst of typing reads as one turn, short enough that
 * somebody coming back an hour later gets their name and the time again.
 */
const GROUP_MS = 4 * 60_000;

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

  /*
   * Share sits above the box rather than beside Send.
   *
   * Posting a run is not sending what is typed, and a second button on that row
   * would be pressed by people meaning to send a message. Its own line, its own
   * label, and it disappears entirely on a day you have not flown.
   */
  const share = el('button', {
    class: 'room__share',
    type: 'button',
    text: 'Share my run',
    title: 'Post your run on the board into the room',
  });
  share.addEventListener('click', () => options.onShareRun?.());

  /*
   * What you are answering, above the box, the way every chat does it.
   *
   * It has to be visible while typing and it has to be cancellable, because the
   * common mistake is tapping reply on the wrong line and only noticing while
   * writing. Built once and filled in, like everything else on this screen.
   */
  const replyName = el('span', { class: 'room__replyname' });
  const replyText = el('span', { class: 'room__replytext' });
  const replyCancel = el('button', {
    class: 'room__replycancel',
    type: 'button',
    text: 'Cancel',
    'aria-label': 'Stop replying',
  });
  replyCancel.addEventListener('click', () => options.onReply(null));

  const replyBar = el(
    'div',
    { class: 'room__replybar' },
    el('div', { class: 'room__replybody' }, replyName, replyText),
    replyCancel,
  );

  field.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Enter') {
      event.preventDefault();
      send();
      return;
    }
    // Escape drops the reply rather than the whole message, which is what it
    // does everywhere else and what somebody reaching for it expects.
    if (key === 'Escape' && options.replyingTo) {
      event.preventDefault();
      options.onReply(null);
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

    el('div', { class: 'room__sharerow' }, share),
    replyBar,
    el('div', { class: 'room__compose' }, field, sendButton),

    el('div', { class: 'actions' }, button('Back', () => options.onBack(), 'ghost')),
  );

  function update(next: ChatOptions): void {
    const wasReplyingTo = options.replyingTo;
    options = next;

    sendButton.disabled = next.sending;
    sendButton.textContent = next.sending ? 'Sending...' : 'Send';

    // Hidden rather than disabled. A greyed button on a day you have not flown
    // is a thing to wonder about; nothing there is self explanatory.
    share.hidden = next.onShareRun === null;
    share.disabled = next.sending;

    notice.textContent = next.notice ?? '';
    notice.hidden = !next.notice;

    const answering = next.replyingTo
      ? (next.messages.find((m) => m.id === next.replyingTo) ?? null)
      : null;

    replyBar.hidden = answering === null;
    if (answering) {
      replyName.textContent = nameOf(answering.pilotId, next);
      replyText.textContent = summarise(answering);
      // Only when it has just been opened. Focusing on every refresh would drag
      // the keyboard back up under somebody who had put it away.
      if (wasReplyingTo !== next.replyingTo) field.focus();
    }

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
        : next.messages.map((message, index) =>
            line(
              message,
              next,
              list,
              next.messages[index - 1] ?? null,
              next.messages[index + 1] ?? null,
            ),
          )),
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

function nameOf(pilotId: string, options: ChatOptions): string {
  return options.people[pilotId]?.name ?? 'Pilot';
}

/** What a message reads as in one line, for a quote or a reply bar. */
function summarise(message: ChatMessage): string {
  if (message.text.length > 0) return message.text;
  if (message.run) return `A run: ${message.run.score.toLocaleString()}`;
  return 'A run';
}

/**
 * Whether this message continues the one before it.
 *
 * Same person, close in time, and not answering somebody else: a reply always
 * starts its own group, because it carries a quote and needs the name above it
 * to make sense of who is answering whom.
 */
function continues(message: ChatMessage | null, previous: ChatMessage | null): boolean {
  if (!message || !previous) return false;
  if (previous.pilotId !== message.pilotId) return false;
  if (message.replyTo) return false;
  return message.at - previous.at <= GROUP_MS;
}

/** One message, with whatever can be done about the person who sent it. */
function line(
  message: ChatMessage,
  options: ChatOptions,
  list: HTMLElement,
  previous: ChatMessage | null,
  next: ChatMessage | null,
): HTMLElement {
  const person = options.people[message.pilotId];
  const name = nameOf(message.pilotId, options);
  const mine = message.pilotId === options.meId;
  const grouped = continues(message, previous);

  /*
   * Everybody but you can be tipped, wallet or no wallet.
   *
   * The refusal is the feature. A pilot with nothing to receive with gets told
   * somebody tried, which is the only way anybody ever learns that connecting
   * one is worth doing.
   */
  /*
   * Once per turn, not once per sentence.
   *
   * Somebody firing off three lines in a row is one person to tip, and a Tip
   * @name under each of them was the single noisiest thing on this screen.
   * Reply stays on every line, because which line you are answering is exactly
   * the thing a reply is for.
   */
  const endsGroup = !continues(next, message);
  const canTip = !mine && endsGroup;
  const target: TipTarget = {
    pilotId: message.pilotId,
    name,
    address: person?.address ?? null,
  };

  const parent = message.replyTo
    ? (options.messages.find((m) => m.id === message.replyTo) ?? null)
    : null;

  const invite = message.text.length > 0 ? findInvite(message.text, options.origin) : null;

  const node = el(
    'div',
    {
      class: [
        'room__line',
        mine ? 'room__line--mine' : '',
        grouped ? 'room__line--grouped' : '',
      ]
        .filter(Boolean)
        .join(' '),
      // So a quote can find what it points at without holding a reference to a
      // node that the next refresh throws away.
      'data-id': message.id,
    },

    grouped
      ? el('div', { class: 'room__avatar room__avatar--tuck' })
      : person?.avatarUrl
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

      grouped
        ? null
        : el(
            'div',
            { class: 'room__who' },
            el('span', { class: 'room__name', text: name }),
            // A clan tag is a thing you can act on, so it is a button rather
            // than a label: this is how somebody with no friends here finds a
            // clan.
            person?.clanTag ? clanChip(person.clanTag, options) : null,
            person?.address
              ? el('span', { class: 'room__wallet', text: maskAddress(person.address) })
              : null,
            el('span', { class: 'room__when', text: clock(message.at) }),
          ),

      // What is being answered, drawn above the answer.
      message.replyTo ? quote(parent, options, list) : null,

      /*
       * Set as text, never as markup.
       *
       * This is the one screen in the app that shows what a stranger typed. It
       * goes in as a text node and nothing here ever assembles HTML from it.
       */
      message.text.length > 0 ? el('p', { class: 'room__said', text: message.text }) : null,

      // The one thing in a message that is ever made tappable, and only because
      // it points inside this app. See findInvite.
      invite ? inviteChip(invite, options) : null,

      /*
       * The card, when the run behind it still resolves.
       *
       * A message can outlive the board row it points at, because a room keeps
       * a day and a board is pruned on its own schedule. That reads as a line
       * about a run that is gone rather than as a broken card, and it
       * deliberately keeps no tip button: there is nothing left to tip.
       */
      message.run
        ? runCard(message.run, mine, target, options)
        : message.runDate
          ? el('p', { class: 'room__gone', text: 'That run has rolled off the board.' })
          : null,

      el(
        'div',
        { class: 'room__acts' },
        // Reply is offered on everybody's line except your own, where it would
        // be a conversation with yourself.
        mine ? null : replyChip(message, options),
        // The plain tip, for a line with no run on it. Same money, aimed at the
        // person rather than at something they did.
        canTip && !message.run ? tipRow(target, options, null) : null,
      ),
    ),
  );

  return node;
}

/** Hours and minutes, local. Nothing here is precise to the second. */
function clock(at: number): string {
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/**
 * The message being answered, drawn above the answer.
 *
 * A parent that is no longer in the room says so rather than disappearing. The
 * room keeps a day and the newest few hundred, so a reply can outlive what it
 * was answering, and a quote that silently vanished would leave an answer to
 * nothing with no explanation of what happened.
 */
function quote(
  parent: ChatMessage | null,
  options: ChatOptions,
  list: HTMLElement,
): HTMLElement {
  if (!parent) {
    return el('div', { class: 'room__quote room__quote--gone' }, el('span', {
      class: 'room__quotetext',
      text: 'A message that is no longer here',
    }));
  }

  const node = el(
    'button',
    { class: 'room__quote', type: 'button', title: 'Go to that message' },
    el('span', { class: 'room__quotename', text: nameOf(parent.pilotId, options) }),
    el('span', { class: 'room__quotetext', text: summarise(parent) }),
  );

  node.addEventListener('click', () => {
    const original = list.querySelector(`[data-id="${CSS.escape(parent.id)}"]`);
    if (!original) return;

    original.scrollIntoView({ block: 'center', behavior: 'smooth' });
    /*
     * Marked, then unmarked.
     *
     * Scrolling on its own is not an answer in a busy room: the line you were
     * sent to looks like every other line once it stops moving. The class is
     * removed rather than left, so the next refresh does not inherit a
     * highlight from a jump nobody remembers making.
     */
    original.classList.add('room__line--found');
    window.setTimeout(() => original.classList.remove('room__line--found'), 1600);
  });

  return node;
}

function replyChip(message: ChatMessage, options: ChatOptions): HTMLElement {
  const answering = options.replyingTo === message.id;

  const node = el('button', {
    class: answering ? 'room__reply room__reply--on' : 'room__reply',
    type: 'button',
    text: answering ? 'Replying' : 'Reply',
  });

  // Tapping the one you are already answering puts it back, which is the
  // cheapest way out of a reply opened by accident.
  node.addEventListener('click', () => options.onReply(answering ? null : message.id));
  return node;
}

/**
 * An sFace invite somebody pasted, as a button rather than as a link.
 *
 * It goes to a screen in this app, so it is a navigation and not a link out.
 * Nothing else in a message is ever made tappable: see findInvite for why a
 * room full of strangers is the wrong place to be turning text into links.
 */
function inviteChip(invite: Invite, options: ChatOptions): HTMLElement {
  const node = el('button', {
    class: 'room__invite',
    type: 'button',
    text: invite.kind === 'contest' ? 'Take a seat' : 'See the challenge',
  });
  node.addEventListener('click', () => options.onInvite(invite));
  return node;
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
 * A run, drawn as the thing worth paying for.
 *
 * Every number here came from the board. The score is the one being ranked, the
 * rank is that day's, and the two marks along the bottom are claims this
 * service can stand behind: signed means a wallet put its name to the score,
 * on chain means there is a transaction carrying it that outlives all of this.
 *
 * That distinction is the reason a card is worth tipping rather than a name. A
 * stranger's number means nothing; a stranger's number with a transaction under
 * it is checkable by anybody who cares to.
 */
function runCard(
  run: RunCard,
  mine: boolean,
  target: TipTarget,
  options: ChatOptions,
): HTMLElement {
  // Only today's coin is known here, so an older card says the date instead of
  // naming a ticker it would be guessing at.
  const what = run.date === options.today && options.ticker ? options.ticker : run.date;

  return el(
    'div',
    { class: 'runcard' },

    el(
      'div',
      { class: 'runcard__top' },
      el('span', { class: 'runcard__what', text: what }),
      el('span', { class: 'runcard__stage', text: `Stage ${run.stage}` }),
      run.rank > 0 ? el('span', { class: 'runcard__rank', text: `#${run.rank}` }) : null,
    ),

    el('div', { class: 'runcard__score', text: run.score.toLocaleString() }),

    el('div', {
      class: 'runcard__detail',
      text: `${run.facesExtracted} pulled out, ${run.attackersCleared} down`,
    }),

    el(
      'div',
      { class: 'runcard__marks' },
      run.signed ? el('span', { class: 'runcard__mark', text: 'SIGNED' }) : null,
      run.anchor
        ? el('span', { class: 'runcard__mark runcard__mark--chain', text: 'ON CHAIN' })
        : null,
    ),

    mine ? null : tipRow(target, options, run),
  );
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

function tipRow(target: TipTarget, options: ChatOptions, run: RunCard | null): HTMLElement {
  const row = el('div', { class: 'room__tiprow' });

  const open = el('button', {
    class: 'room__tip',
    type: 'button',
    // On a card the money is for the run, so the label says so. On a bare line
    // there is nothing to point at but the person.
    text: run ? 'Tip this run' : `Tip ${target.name}`,
  });
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
      options.onTip(target, nim);
    });
    return node;
  });

  row.append(open, ...amounts);
  return row;
}
