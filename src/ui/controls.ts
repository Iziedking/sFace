/**
 * How to play: what the game is, how it works, and what you are aiming at.
 *
 * It used to be a key map and nothing else, which answered the smallest of the
 * three questions somebody has when they open this. A player who knows W is
 * thrust and does not know that the ground is a real chart has learned the
 * least interesting thing on the screen.
 *
 * ## Why chapters rather than a stack of blocks
 *
 * The second version had the right words in a flat stack of headed lists, and
 * a flat stack reads as reference material: you scan it for the one line you
 * came for and leave. This is not reference material. It is the only place the
 * game explains that the ground is a real chart, that the currency is the token
 * that crashed, and that somebody is behind bars, and those are arguments
 * rather than lookups.
 *
 * So it is numbered chapters that arrive one after another. The number is a
 * promise that there is an end, which is what makes a long explanation
 * readable at all, and the stagger gives the eye somewhere to go next.
 *
 * Motion is one property, one direction, once. It is cut entirely under
 * prefers-reduced-motion, and nothing depends on it: the page is complete and
 * correct with every animation disabled, because a player who cannot use motion
 * still needs the rules.
 *
 * Still off the critical path. Onboarding under sixty seconds is a judging
 * criterion and a tutorial nobody asked for is the usual way to lose it, so
 * this is one tap from the brief and never in front of anyone who did not ask.
 *
 * Controls shown are the ones the device in hand actually has, first. A phone
 * player being told about WASD learns nothing and concludes the game was not
 * built for them.
 */

import { button, el, mount } from './dom';
import { STAGES } from '../data/campaign';
import { reducedMotion } from '../render/theme';

export interface ControlsOptions {
  onBack: () => void;
}

/**
 * Coarse pointer means a finger. Not a perfect signal, and it does not need to
 * be: both sets are shown regardless, this only decides which comes first.
 */
function touchFirst(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

interface Row {
  key: string;
  what: string;
}

interface Shot {
  /** In public/guide, written by scripts/shoot.mjs from the real game. */
  src: string;
  alt: string;
  /** One line under it. Says what to look at, not what the picture is. */
  caption: string;
}

interface Chapter {
  title: string;
  /** One line under the title, in the voice of the game rather than a manual. */
  lead: string;
  rows: Row[];
  /**
   * A picture of the thing this chapter is about.
   *
   * Not decoration. Read cold, this guide was a list of mechanics nobody had
   * seen yet: "four posts, one explains the day" means nothing until you have
   * looked at the card, and "the pads put your buys on an arc" means nothing
   * until you have seen the arc. One screenshot per chapter turns each of them
   * from a definition into a thing you recognise when it appears.
   *
   * Captured from the running game by scripts/shoot.mjs rather than drawn, so
   * the guide cannot end up describing a build that no longer exists.
   */
  shot?: Shot;
}

const TOUCH: Row[] = [
  { key: 'Left thumb', what: 'Anywhere on the left half. Drag to fly or walk.' },
  { key: 'Right thumb', what: 'Anywhere on the right half. Drag to aim, and it fires while held.' },
  {
    key: 'Tap a buy',
    what: 'The four round buttons along the bottom middle. One tap buys and uses it, and a dim one is one you cannot afford yet.',
  },
  {
    key: 'Tap E',
    what: 'Appears beside a car when you are close enough. Tap again, stopped, to get out.',
  },
  {
    key: 'At a panel',
    what: 'Those same four buttons become the four answers, numbered. Tap the one you believe.',
  },
  { key: 'Pause', what: 'The button at the top, clear of both thumbs.' },
  {
    key: 'Prefer buttons?',
    what: 'Settings offers a fixed stick and d-pad instead of drag-anywhere.',
  },
];

const DESKTOP: Row[] = [
  { key: 'W A S D', what: 'Fly or walk. Arrow keys work too.' },
  { key: 'Mouse', what: 'Aim. No need to hold a button.' },
  { key: 'Click or Space', what: 'Fire.' },
  { key: '1 2 3 4', what: 'Buy and use a charge, bomb, patch or boost. No menu, no pause.' },
  { key: 'E', what: 'Get into a car you are standing at, and out of one you have stopped.' },
  { key: 'At a panel', what: 'The same 1 2 3 4 pick the answer instead of buying.' },
  { key: 'Esc', what: 'Pause, and resume again. There is a button on screen too.' },
];

/**
 * The seven stages, built from the campaign rather than written out.
 *
 * A guide that lists what each stage asks for is the first thing a new player
 * wants and the easiest thing to get out of date. Somebody finished stage seven
 * three people short and had no idea what the requirement had been, because the
 * only place it existed was inside a function.
 *
 * Reading STAGES means the clock and the pass conditions here are the ones the
 * game checks. Change a stage and this page changes with it.
 */
function stageChapter(): Chapter {
  return {
    title: 'The seven stages',
    lead: 'Each one asks for something the others do not.',
    rows: STAGES.map((stage) => ({
      key: `${stage.n}. ${stage.name}`,
      what: `${world(stage.n)} · ${clock(stage.seconds)}. ${stage.demands
        .map((demand) => demand.text)
        .join(', ')}.`,
    })),
  };
}

/** Which of the three worlds a stage is built in. */
function world(n: number): string {
  if (n === 7) return 'Ring city';
  if (n >= 5) return 'City';
  if (n === 4) return 'Chart, watched';
  return 'Chart';
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const CHAPTERS: Chapter[] = [
  {
    title: 'None of this is invented',
    lead: 'The level is a screenshot of a bad day, and you have to fly it.',
    rows: [
      {
        key: 'The ground is a chart',
        what: "Every day the worst performer in the top 100 becomes the level. Its real 24-hour chart is the ground, pulled at midnight UTC.",
      },
      {
        key: 'The people are real',
        what: 'The five in the wreck are the accounts crypto X was arguing about today, with their real handles and pictures.',
      },
      {
        key: 'The market sets the odds',
        what: "Fear and Greed sets how crowded the sky is. The chart's own volatility decides where the attackers sit.",
      },
    ],
    shot: {
      src: '/guide/chart.webp',
      alt: 'Stage one, flying over the day’s real price chart',
      caption: 'That ridge is a real price move from the last 24 hours.',
    },
  },
  {
    title: 'Get them out',
    lead: 'Flying is easy. Leaving with everyone is the hard part.',
    rows: [
      {
        key: 'Fly into someone',
        what: 'That frees them, and they fall in behind you in a line that follows where you flew.',
      },
      {
        key: 'Reach extraction',
        what: 'The pad at the end of the day. Everyone still behind you gets out with you.',
      },
      {
        key: 'Go down and they go too',
        what: 'Everyone aboard is lost. Face you already took from caches is safe.',
      },
    ],
  },
  {
    title: 'Some of them are locked up',
    lead: 'From stage two, the worst day belongs to somebody behind bars.',
    rows: [
      {
        key: 'A cell ignores you',
        what: 'Flying into it does nothing at all. Bars mean deal with this; the breathing orange ring means come and get me.',
      },
      {
        key: 'Set a charge',
        what: 'Stand next to the cell and press 1. The door comes off. It cannot be done from safety.',
      },
      {
        key: 'The door is not the rescue',
        what: 'Once it is open they are trapped in the ordinary way, and you still have to fly in and pick them up.',
      },
    ],
  },
  {
    title: 'The token that wrecked the day is the money',
    lead: 'You are scavenging the thing that did this.',
    rows: [
      {
        key: 'It is the real ticker',
        what: "On a PUMP day you collect PUMP, off cleared attackers and out of caches. The HUD counts it in the day's own symbol.",
      },
      {
        key: 'Spend it in the run',
        what: 'Four slots in the top strip: a charge to open a cell, a bomb, a hull patch, a fire rate boost. One press, no menu.',
      },
      {
        key: 'Everything is a trade',
        what: 'A bomb wakes the next stretch early. A boost pushes you harder as it fires faster. Nothing here is a free upgrade.',
      },
      {
        key: 'It expires tonight',
        what: 'Scrip dies with the run and the ticker changes tomorrow. Nobody accumulates an advantage, and none of it is for sale.',
      },
    ],
    shot: {
      src: '/guide/pads.webp',
      alt: 'The fixed pads in play: a stick, a fire button and four priced buys',
      caption: 'Your four buys sit beside the fire button, priced in the day’s own ticker.',
    },
  },
  stageChapter(),
  {
    title: 'What you are climbing',
    lead: 'The day resets. The ladder does not.',
    rows: [
      {
        key: 'Face is the record',
        what: 'Your score, and it adds up. It ranks you all time and unlocks the weapon rack.',
      },
      {
        key: 'Seven stages',
        what: 'Clearing one opens the next, and it stays cleared.',
      },
      {
        key: 'The mission changes daily',
        what: 'Same stage, new level, new cast, and three new contracts drawn from the day.',
      },
    ],
  },
  {
    title: 'Later on, the level is a city',
    lead: 'Stages five and six drop the chart and hand you streets.',
    rows: [
      {
        key: 'Move anywhere',
        what: 'No ground line and no forward. The map is in the bottom left corner.',
      },
      {
        key: 'Take the car, or walk',
        what: 'Twice your speed, heard from twice as far. Some gaps are too narrow for it.',
      },
      {
        key: 'They have to notice you first',
        what: 'Patrols walk their patch until they sense you. On foot you are quiet.',
      },
      {
        key: 'Doors',
        what: 'Some buildings open. A person fits, a car does not, and the medkits are inside.',
      },
      {
        key: 'Read the panels',
        what: 'Four posts that genuinely went out today. Pick the one that explains it.',
      },
    ],
    shot: {
      src: '/guide/city.webp',
      alt: 'A city stage, with streets built from the day’s price bars',
      caption: 'The same numbers as the chart, drawn as bars. The gaps are the streets.',
    },
  },
  {
    title: 'The gun helps, and it helps more as you go',
    lead: 'Aiming with a thumb is hard, so the gun helps.',
    rows: [
      {
        key: 'Everyone gets it',
        what: 'From your first run, the gun bends toward whatever you are nearly pointing at.',
      },
      {
        key: 'It gets stronger',
        what: 'Clear stages, win with a clan, or win challenges. The tier is shown top right.',
      },
      {
        key: 'It will not cheat for you',
        what: 'No lock-on, nothing through a wall, nothing behind your back.',
      },
      {
        key: 'Staked runs are level',
        what: 'A challenge puts both players on the same baseline, whatever either has earned.',
      },
    ],
    shot: {
      src: '/guide/panel.webp',
      alt: 'A stage six panel showing four real posts to choose between',
      caption: 'Stage six asks you to read. Four posts that genuinely went out, one is right.',
    },
  },
  {
    title: 'Why a bet on this is fair',
    lead: 'The one rule everything else is built to protect.',
    rows: [
      {
        key: 'Identical levels',
        what: 'Two people on the same day fly a byte for byte identical level. Same terrain, same attackers, same places, same faces.',
      },
      {
        key: 'Nothing is for sale',
        what: 'Weapons trade rather than upgrade, and scrip cannot be bought. No advantage in this game has a price in real money.',
      },
      {
        key: 'You pay each other',
        what: 'A challenge settles wallet to wallet in Nimiq Pay. sFace never holds funds, and cannot: there is no pot.',
      },
    ],
    shot: {
      src: '/guide/rings.webp',
      alt: 'Stage seven, a ring city with a gate question',
      caption: 'The finale. No weapon opens a gate, so the answer is the only key.',
    },
  },
];

export function renderControls(root: HTMLElement, options: ControlsOptions): void {
  const quiet = reducedMotion();
  const first = touchFirst() ? TOUCH : DESKTOP;
  const second = touchFirst() ? DESKTOP : TOUCH;

  const chapters = CHAPTERS.map((chapter, index) => renderChapter(chapter, index, quiet));

  chapters.push(
    renderChapter(
      {
        title: touchFirst() ? 'On a phone' : 'On a keyboard',
        lead: 'Both always work. This is just the one you are holding.',
        rows: first,
      },
      CHAPTERS.length,
      quiet,
    ),
    renderChapter(
      {
        title: touchFirst() ? 'On a keyboard' : 'On a phone',
        lead: 'The same game, the other way round.',
        rows: second,
      },
      CHAPTERS.length + 1,
      quiet,
    ),
  );

  mount(
    root,
    el(
      'div',
      { class: 'screen guide' },

      el(
        'div',
        { class: 'guide__top' },
        el('p', { class: 'eyebrow', text: 'How to play' }),
        el('h1', { text: "Crypto's down. Somebody has to save face." }),
        el('p', {
          class: 'guide__lead',
          text: 'A rescue shooter where the market builds the level. Eight short chapters, about a minute to read, and then you know the whole game.',
        }),
      ),

      el('div', { class: 'guide__chapters' }, ...chapters),

      el('div', { class: 'actions' }, button('Got it', options.onBack)),
    ),
  );
}

function renderChapter(chapter: Chapter, index: number, quiet: boolean): HTMLElement {
  const node = el(
    'section',
    { class: 'chapter' },
    el(
      'div',
      { class: 'chapter__head' },
      el('span', { class: 'chapter__n', text: String(index + 1).padStart(2, '0') }),
      el(
        'div',
        {},
        el('h2', { class: 'chapter__title', text: chapter.title }),
        el('p', { class: 'chapter__lead', text: chapter.lead }),
      ),
    ),
    chapter.shot
      ? el(
          'figure',
          { class: 'chapter__shot' },
          el('img', {
            src: chapter.shot.src,
            alt: chapter.shot.alt,
            loading: 'lazy',
            decoding: 'async',
          }),
          el('figcaption', { text: chapter.shot.caption }),
        )
      : null,
    el(
      'div',
      { class: 'keys' },
      ...chapter.rows.map((r) =>
        el(
          'div',
          { class: 'keys__row' },
          el('span', { class: 'keys__key', text: r.key }),
          el('span', { class: 'keys__what', text: r.what }),
        ),
      ),
    ),
  );

  if (!quiet) {
    /*
     * Staggered by index rather than by a scroll observer.
     *
     * The list is short and fixed, so an observer would be machinery bought for
     * nothing, and it has a failure mode this does not: if it never fires, the
     * chapters stay invisible and the page is empty. A delay cannot fail open.
     */
    node.classList.add('chapter--enter');
    node.style.animationDelay = `${Math.min(index * 70, 560)}ms`;
  }

  return node;
}
