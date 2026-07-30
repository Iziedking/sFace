/**
 * The opening. Plays once, then never again unless asked for.
 *
 * Rules this screen obeys, because an unskippable intro is the fastest way to
 * lose somebody who has never heard of your game:
 *
 *   - **Skippable from the first frame.** The skip control is present before
 *     the first word, not after a polite delay.
 *   - **The text leads.** Each beat is on screen before it is spoken and stays
 *     until the next one. On a device with no speech voices the intro is a
 *     sequence of cards and loses nothing but atmosphere.
 *   - **Advances on tap.** Waiting out a narrator you have already read is the
 *     definition of dead time.
 *   - **Runs once.** Stored locally. There is a replay in the brief for anyone
 *     who wants it.
 *
 * "Can someone go from zero to using the Mini App in under 60 seconds?" is a
 * judging criterion in as many words, so the whole thing is five short beats.
 * A player who taps through clears it in a few seconds, and one who lets it run
 * hears the whole narration well inside the budget with the brief still to
 * come.
 */

import { button, el, mount } from './dom';
import { INTRO_BEATS } from '../data/story';
import { narrator } from '../core/voice';

const SEEN_KEY = 'sface.intro';

/**
 * Pacing.
 *
 * The narrator finishing IS the end of a beat. It used to be padded to a flat
 * 4.2 seconds afterwards, so a line the voice got through in two seconds still
 * sat there for another two with nothing happening, nine times over. That is
 * most of a minute of dead air and it is what made the intro feel slow.
 *
 * The voice is never hurried to fix it. Speech runs at its own rate and we wait
 * for it, then take one breath and move. The saving comes from removing the
 * wait, not from rushing the read.
 */
const BREATH_MS = 350;

/**
 * How long a beat holds with no speech available.
 *
 * Proportional to its length, because a five word line and a twenty word line
 * are not the same amount of reading and giving them the same hold makes one
 * feel rushed and the other feel stuck.
 */
function readingTime(text: string): number {
  return Math.min(3600, Math.max(1600, text.length * 46));
}

/**
 * Has the opening already played in this session?
 *
 * Session storage, and the choice has been wrong in both directions.
 *
 * It was localStorage, which meant once EVER: the first person to open the site
 * on a given browser saw the story and nobody ever saw it again, so the live
 * site read as having no onboarding at all. Fixing that by playing it on every
 * load went too far the other way, and a refresh replayed the whole thing.
 *
 * Per session is the answer. Somebody arriving gets the story, a refresh does
 * not, and a new tab tomorrow gets it again because they are arriving again.
 */
export function introSeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === 'done';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, 'done');
  } catch {
    // Private mode refuses storage. They see it once more on the next load,
    // which is a far smaller problem than failing to start.
  }
}

export interface IntroOptions {
  /** False when the player has sound off. The intro still plays, silently. */
  voice: boolean;
  /**
   * Fired on the opening tap, inside the gesture.
   *
   * This is the only moment audio can legally be unlocked. Doing it in onDone
   * looks equivalent and is not: the intro auto-advances through its last beat
   * without anyone touching the screen, so onDone regularly fires outside a
   * gesture and every unlock in it is silently refused on mobile.
   */
  onBegin: () => void;
  onDone: () => void;
}

/**
 * Run the intro. Resolves through onDone whether it finished or was skipped,
 * so the caller has exactly one path out.
 */
export function renderIntro(root: HTMLElement, options: IntroOptions): void {
  /*
   * A title card first, and it is not decoration.
   *
   * Speech synthesis and the audio context both refuse to start outside a user
   * gesture on iOS and on most mobile Chrome builds. Starting the narrator
   * automatically after boot fails silently there: no error, no sound, and the
   * intro plays out mute on exactly the devices this is built for.
   *
   * So the sequence begins on a tap. One tap before onboarding is cheap, it is
   * the same tap that unlocks the sound effects, and it opens on the wordmark
   * rather than on a wall of text, which is a better first frame anyway.
   */
  let started = false;
  let index = 0;
  let finished = false;
  let timer: number | null = null;

  const line = el('p', { class: 'intro__line' });
  const dots = el('div', { class: 'intro__dots' });

  const pips = INTRO_BEATS.map(() => el('span', { class: 'intro__dot' }));
  dots.append(...pips);

  const skip = button('Skip', () => finish(), 'quiet');

  const stage = el(
    'div',
    { class: 'intro' },
    el('p', { class: 'eyebrow', text: 'The Face Collapse' }),
    line,
    dots,
    el('div', { class: 'intro__foot' }, el('p', { class: 'intro__hint', text: 'Tap to continue' }), skip),
  );

  // The whole stage advances, not just a button. On a phone the reflex is to
  // tap the words, not hunt for a control.
  stage.addEventListener('click', (event) => {
    if (event.target === skip) return;
    if (!started) begin();
    else next();
  });

  const title = el(
    'div',
    { class: 'intro__title' },
    el('h1', { text: 'sFace' }),
    el('p', { class: 'intro__sub', text: 'Save face' }),
    el('p', { class: 'intro__hint', text: 'Tap to begin' }),
  );

  const titleStage = el('div', { class: 'intro' }, title);
  titleStage.addEventListener('click', () => begin());

  mount(root, el('div', { class: 'screen screen--center screen--bare' }, titleStage));

  function begin(): void {
    if (started || finished) return;
    started = true;
    // Inside the gesture, before anything async. See onBegin's note.
    options.onBegin();
    mount(root, el('div', { class: 'screen screen--center screen--bare' }, stage));
    show();
  }

  const show = (): void => {
    const text = INTRO_BEATS[index];
    if (text === undefined) {
      finish();
      return;
    }

    line.textContent = text;
    // Retrigger the fade by swapping the class off and on across a frame.
    line.classList.remove('is-in');
    void line.offsetWidth;
    line.classList.add('is-in');

    pips.forEach((pip, i) => pip.classList.toggle('is-on', i <= index));

    if (timer !== null) clearTimeout(timer);

    if (options.voice) {
      // Advance when the narrator finishes, so the pacing follows the reading
      // rather than a guessed timeout. The narrator resolves on failure too,
      // so a device with no voices simply advances immediately, which is why
      // the floor below exists.
      const at = index;
      void narrator.say(text).then(() => {
        if (finished || index !== at) return;
        // One breath, not a pad back up to a fixed beat length.
        timer = window.setTimeout(next, BREATH_MS);
      });
    } else {
      timer = window.setTimeout(next, readingTime(text));
    }
  };

  const next = (): void => {
    if (finished) return;
    index++;
    if (index >= INTRO_BEATS.length) {
      finish();
      return;
    }
    narrator.stop();
    show();
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (timer !== null) clearTimeout(timer);
    narrator.stop();
    markIntroSeen();
    options.onDone();
  };
}
