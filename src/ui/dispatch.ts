/**
 * The Dispatch: what crypto X actually did today.
 *
 * ## Why a game has a news screen
 *
 * Because the read is already happening. Every day this thing asks Grok what
 * the timeline is arguing about, who was in the middle of it, and what is
 * still unresolved, and until now it spent all of that on one headline chip
 * and five names. Everything else was thrown away.
 *
 * Showing it turns sFace from a game you play into a page you check. That is a
 * different retention story entirely: on a day somebody does not feel like
 * flying, there is still a reason to open the app, and the thing they read is
 * the same thing that built today's level.
 *
 * ## What it is not
 *
 * It is not a timeline and it is not a quote machine. Every post here is a
 * summary and an attribution: what was said, by whom, and why it mattered.
 * Reprinting somebody's post inside a commercial product is a different thing
 * from telling you it happened and pointing you at them, and the prompt in
 * server/xsense.ts asks for the summary explicitly.
 *
 * ## Threads are the part worth building
 *
 * A rug is not one day's news. Exploits get traced, filings get decided,
 * disputes settle, and following any of that by scrolling is genuinely hard,
 * which is exactly why a screen that carries the state of each one across days
 * is worth more than another feed. The read is asked for status, not drama.
 */

import { button, el, mount } from './dom';
import type { DailyMission, DispatchPost, DispatchThread } from '../game/mission';

export interface DispatchOptions {
  mission: DailyMission;
  onBack: () => void;
  /** Opens the post on X. Separate so the caller owns the navigation. */
  onOpen: (url: string) => void;
}

const KIND_LABEL: Record<DispatchPost['kind'], string> = {
  loud: 'LOUD',
  call: 'CALL',
  warning: 'WARNING',
  receipt: 'RECEIPT',
  denial: 'DENIAL',
};

const STATE_LABEL: Record<DispatchThread['state'], string> = {
  watching: 'WATCHING',
  escalating: 'ESCALATING',
  resolved: 'RESOLVED',
  cold: 'COLD',
};

export function renderDispatch(root: HTMLElement, options: DispatchOptions): void {
  const story = options.mission.story;
  const posts = story?.posts ?? [];
  const threads = story?.threads ?? [];

  mount(
    root,
    el(
      'div',
      { class: 'screen' },
      el('p', { class: 'eyebrow', text: story?.live ? 'LIVE ON X' : 'DISPATCH' }),
      el('h1', { text: 'The Dispatch' }),

      story
        ? el('p', { class: 'dispatch__headline', text: story.headline })
        : el('p', {
            class: 'quiet',
            // Honest rather than empty. A read that did not happen is a fact
            // about today, not a screen that failed.
            text: 'Nothing read today. The mission is running on the stand-in cast, and this fills back in on the next read.',
          }),

      story ? sentimentBar(story.sentiment) : null,

      threads.length > 0
        ? el(
            'div',
            {},
            el('p', { class: 'stat__label', text: 'STILL RUNNING' }),
            el('div', { class: 'threads' }, ...threads.map(threadRow)),
          )
        : null,

      posts.length > 0
        ? el(
            'div',
            {},
            el('p', { class: 'stat__label', text: "TODAY'S HEAVY POSTS" }),
            el('div', { class: 'posts' }, ...posts.map((post) => postRow(post, options))),
          )
        : null,

      story && posts.length === 0 && threads.length === 0
        ? el('div', {
            class: 'empty',
            text: 'Quiet one. Nothing on the timeline was heavy enough to carry, which is itself worth knowing.',
          })
        : null,

      posts.length > 0
        ? el('p', {
            class: 'quiet',
            // What it is, not how it is made. A player does not care which
            // model read the timeline; they care that they can check it.
            text: 'Summaries, not quotes. Tap any of them to read the post itself.',
          })
        : null,

      el('div', { class: 'actions' }, button('Back', options.onBack, 'ghost')),
    ),
  );
}

/**
 * Sentiment as a bar with a needle rather than a number.
 *
 * "Sentiment: -42" means nothing at a glance. A needle sitting well left of
 * centre on a track labelled at both ends means something immediately, which
 * is the only job this element has.
 */
function sentimentBar(sentiment: number): HTMLElement {
  const clamped = Math.max(-100, Math.min(100, sentiment));
  const at = (clamped + 100) / 2;

  return el(
    'div',
    { class: 'mood' },
    el(
      'div',
      { class: 'mood__head' },
      el('span', { class: 'stat__label', text: 'CAPITULATION' }),
      el('span', { class: 'mood__value', text: label(clamped) }),
      el('span', { class: 'stat__label', text: 'EUPHORIA' }),
    ),
    el(
      'div',
      { class: 'mood__track' },
      el('div', { class: 'mood__needle', style: `left:${at}%` }),
    ),
  );
}

function label(sentiment: number): string {
  if (sentiment <= -60) return 'CAPITULATION';
  if (sentiment <= -20) return 'FEARFUL';
  if (sentiment < 20) return 'MIXED';
  if (sentiment < 60) return 'BULLISH';
  return 'EUPHORIC';
}

function threadRow(thread: DispatchThread): HTMLElement {
  return el(
    'div',
    { class: `thread thread--${thread.state}` },
    el(
      'div',
      { class: 'thread__head' },
      el('span', { class: 'thread__title', text: thread.title }),
      el('span', { class: 'thread__state', text: STATE_LABEL[thread.state] }),
    ),
    el('p', { class: 'thread__status', text: thread.status }),
  );
}

function postRow(post: DispatchPost, options: DispatchOptions): HTMLElement {
  const row = el(
    'div',
    { class: 'post' },
    el(
      'div',
      { class: 'post__head' },
      el('span', { class: 'post__handle', text: `@${post.handle}` }),
      el('span', { class: `post__kind post__kind--${post.kind}`, text: KIND_LABEL[post.kind] }),
    ),
    el('p', { class: 'post__summary', text: post.summary }),
    post.why ? el('p', { class: 'post__why', text: post.why }) : null,
  );

  // The whole row opens the post it is summarising. That is the point of
  // requiring the link: everything here is checkable in one tap.
  row.classList.add('post--link');
  row.setAttribute('role', 'link');
  row.setAttribute('tabindex', '0');
  row.addEventListener('click', () => options.onOpen(post.url));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      options.onOpen(post.url);
    }
  });

  return row;
}
