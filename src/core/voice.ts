/**
 * The narrator.
 *
 * Built on the browser's own speech synthesis: no audio file to download, no
 * third party, no cost, and it reads whatever the story file says rather than a
 * recording that goes stale the moment the copy changes.
 *
 * **The text is the story. The voice is decoration.** Every beat is on screen
 * before it is spoken and stays there after. Speech synthesis is genuinely
 * unreliable in the wild, and all of that is survivable when the voice is an
 * enhancement. None of it is survivable if the story only exists as audio.
 *
 * ## The five faults that made it stutter, and what replaced them
 *
 * Reported as breaking sometimes, not speaking sometimes, and picking up
 * sometimes. That is three symptoms of five separate causes:
 *
 *   1. `say()` awaited voice discovery before calling `speak()`. On iOS speech
 *      must begin inside the user gesture that triggered it, and an await
 *      spends that gesture, so the first line was silent on iPhone every time.
 *      Voices are now warmed in the background and read synchronously; if they
 *      are not ready the line is spoken with the platform default rather than
 *      waited for.
 *   2. `cancel()` ran immediately before every `speak()`, including when nothing
 *      was speaking. In Chrome a cancel followed straight away by a speak can
 *      wedge the engine so the new utterance never starts. Cancel now happens
 *      only when something is actually talking, and the next utterance waits a
 *      tick for the engine to settle.
 *   3. Chrome stops after roughly fifteen seconds of one utterance. The old fix
 *      was a `pause()`/`resume()` timer, a hack that itself produces audible
 *      breaks mid-sentence. Long text is now split into sentences and spoken in
 *      sequence, so no single utterance is long enough to hit the limit and the
 *      hack is gone.
 *   4. The safety timeout resolved the promise but left the engine talking, so
 *      the intro advanced and cancelled the line mid-word. The watchdog now
 *      stops the speech it gave up on, and clears when a line ends normally.
 *   5. Nothing guarded against two `say()` calls overlapping, so a fast skip
 *      left two lines fighting. A generation counter makes a superseded line
 *      resolve quietly instead.
 */

const MAX_VOICE_WAIT_MS = 1500;

/**
 * Longest utterance we will hand the engine in one piece.
 *
 * Comfortably under the point where Chrome gives up. Sentences longer than this
 * are split further on clause boundaries rather than mid-word.
 */
const MAX_CHUNK = 160;

/** Time for the engine to settle after a cancel before speaking again. */
const AFTER_CANCEL_MS = 60;

/**
 * Voices, best first.
 *
 * The aim is calm and level rather than bright and helpful. Named voices are
 * tried first because the generic default on Windows is unusually flat even by
 * the standards of this API.
 */
const PREFERRED = [
  'Google UK English Male',
  'Microsoft Ryan Online',
  'Daniel',
  'Google US English',
  'Microsoft Guy Online',
  'Alex',
];

export function voiceAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Resolved voice, or null for "use the platform default".
 *
 * Read synchronously by `say()`. Undefined means discovery has not finished,
 * which is treated exactly like null: speak now with whatever the platform
 * gives us. A slightly worse voice on the first line is a far better outcome
 * than silence on the first line.
 */
let cachedVoice: SpeechSynthesisVoice | null | undefined;

function choose(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  for (const wanted of PREFERRED) {
    const match = voices.find((v) => v.name.includes(wanted));
    if (match) return match;
  }
  return (
    voices.find((v) => v.lang.startsWith('en') && v.localService) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    voices[0] ??
    null
  );
}

/**
 * Start looking for a voice, without blocking anything.
 *
 * Called once at module load. `getVoices()` is empty on first call in most
 * browsers and fills in asynchronously, announced by a `voiceschanged` event
 * that some browsers fire late and others never fire at all, so this polls as
 * well and gives up rather than waiting forever.
 */
function warmVoices(): void {
  if (!voiceAvailable()) {
    cachedVoice = null;
    return;
  }

  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) {
    cachedVoice = choose(immediate);
    return;
  }

  let settled = false;
  const done = (): void => {
    if (settled) return;
    settled = true;
    window.speechSynthesis.removeEventListener('voiceschanged', done);
    window.clearInterval(poll);
    window.clearTimeout(giveUp);
    cachedVoice = choose(window.speechSynthesis.getVoices());
  };

  window.speechSynthesis.addEventListener('voiceschanged', done);
  const poll = window.setInterval(() => {
    if (window.speechSynthesis.getVoices().length > 0) done();
  }, 100);
  const giveUp = window.setTimeout(done, MAX_VOICE_WAIT_MS);
}

if (typeof window !== 'undefined') warmVoices();

/**
 * Break a line into pieces no engine will choke on.
 *
 * Sentence ends first, because a pause between sentences is natural and one
 * mid-clause is not. Anything still too long is split on commas, and only then
 * on words, so the seams always land where a human would breathe.
 */
export function chunk(text: string, max = MAX_CHUNK): string[] {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length === 0) return [];
  if (clean.length <= max) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const out: string[] = [];
  let buffer = '';

  const flush = (): void => {
    const trimmed = buffer.trim();
    if (trimmed) out.push(trimmed);
    buffer = '';
  };

  for (const sentence of sentences) {
    if (sentence.trim().length === 0) continue;

    if (buffer.length + sentence.length <= max) {
      buffer += sentence;
      continue;
    }

    flush();

    if (sentence.length <= max) {
      buffer = sentence;
      continue;
    }

    for (const part of splitLong(sentence, max)) out.push(part);
  }

  flush();
  return out;
}

/** Commas, then words. Only reached by a sentence longer than the ceiling. */
function splitLong(text: string, max: number): string[] {
  const out: string[] = [];
  let buffer = '';

  for (const piece of text.split(/(?<=,)\s*/)) {
    if (buffer.length + piece.length <= max) {
      buffer += piece;
      continue;
    }
    if (buffer.trim()) out.push(buffer.trim());
    buffer = '';

    if (piece.length <= max) {
      buffer = piece;
      continue;
    }

    let words = '';
    for (const word of piece.split(' ')) {
      if (words.length + word.length + 1 > max) {
        if (words.trim()) out.push(words.trim());
        words = '';
      }
      words += (words ? ' ' : '') + word;
    }
    if (words.trim()) out.push(words.trim());
  }

  if (buffer.trim()) out.push(buffer.trim());
  return out;
}

export class Narrator {
  private speaking = false;
  /** Whether the engine has been started inside a gesture at least once. */
  private primed = false;
  private muted = false;
  /**
   * Bumped by every `say()` and every `stop()`.
   *
   * A line whose generation is stale resolves quietly rather than fighting the
   * one that replaced it, which is what stops a fast skip leaving two voices
   * talking over each other.
   */
  private generation = 0;

  get enabled(): boolean {
    return !this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
  }

  /**
   * Speak a line. Resolves when it finishes, is cut off, or fails.
   *
   * Never rejects. A narrator that throws would take the intro down with it,
   * and the intro has to survive a device with no voices at all.
   */
  /**
   * Unlock the speech engine, from inside a user gesture.
   *
   * ## Why the audio unlock was not enough
   *
   * A tap already unlocked the AudioContext, and speech was treated as though
   * that covered it. It does not: `speechSynthesis` has its own gesture rule on
   * iOS and on mobile Chrome, and the first `speak()` outside one is dropped
   * with no error and no sound. The intro then ran its full length in silence,
   * which reads as the voice being skipped.
   *
   * The first `speak()` in the opening does happen inside the tap, but only the
   * first chunk of the first line does; everything after it is awaited, so the
   * gesture is gone by then. Speaking one silent utterance here marks the engine
   * as started while the gesture is definitely still in hand, and every later
   * line inherits that.
   *
   * Safe to call repeatedly and safe to call where speech does not exist, which
   * includes the Nimiq Pay WebView. There it does nothing and the opening falls
   * back to holding each beat for as long as it takes to read.
   */
  prime(): void {
    if (this.primed || this.muted || !voiceAvailable()) return;
    this.primed = true;

    try {
      // A space rather than an empty string: some engines discard an utterance
      // with no content before it counts as having started.
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
      window.speechSynthesis.resume();
    } catch {
      // No engine here. The opening reads at its own pace instead.
    }
  }

  async say(text: string): Promise<void> {
    if (this.muted || !voiceAvailable()) return;

    const mine = ++this.generation;
    const pieces = chunk(text);
    if (pieces.length === 0) return;

    /*
     * Only cancel if something is actually talking, and give the engine a beat
     * afterwards. A cancel into an idle engine is what wedges Chrome, and a
     * speak in the same tick as a cancel is what makes the next line silent.
     */
    if (this.isEngineBusy()) {
      this.cancel();
      await wait(AFTER_CANCEL_MS);
      if (this.generation !== mine || this.muted) return;
    }

    this.speaking = true;

    for (const piece of pieces) {
      if (this.generation !== mine || this.muted) break;
      await this.speakOne(piece, mine);
    }

    if (this.generation === mine) this.speaking = false;
  }

  /** One utterance, with a watchdog that stops rather than merely gives up. */
  private speakOne(text: string, mine: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      let watchdog: number | null = null;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (watchdog !== null) window.clearTimeout(watchdog);
        resolve();
      };

      try {
        const utterance = new SpeechSynthesisUtterance(text);
        // Read synchronously. Awaiting here would spend the user gesture that
        // iOS requires speech to start inside. See the header.
        if (cachedVoice) utterance.voice = cachedVoice;
        utterance.lang = cachedVoice?.lang ?? 'en-GB';
        // Slower and lower than default. The default cadence reads as a screen
        // reader, which is exactly the wrong register for this.
        utterance.rate = 0.94;
        utterance.pitch = 0.85;
        utterance.volume = 1;

        utterance.addEventListener('end', finish);
        utterance.addEventListener('error', finish);

        window.speechSynthesis.speak(utterance);

        /*
         * Nudge it awake straight after speaking.
         *
         * Chrome leaves the engine in a paused state often enough that a queued
         * utterance sits there silently until something resumes it, and the
         * watchdog below then cancels a line that never started. Resume is a
         * no-op when it is already running.
         */
        try {
          window.speechSynthesis.resume();
        } catch {
          // Nothing to resume.
        }

        /*
         * If the engine never reports back, stop it before moving on.
         *
         * The old version resolved and left it talking, so the next line
         * cancelled this one mid-word. Generous, because overrunning the
         * estimate on a slow voice is far less damaging than cutting a line.
         */
        watchdog = window.setTimeout(
          () => {
            if (this.generation === mine) this.cancel();
            finish();
          },
          2500 + text.length * 110,
        );
      } catch {
        finish();
      }
    });
  }

  private isEngineBusy(): boolean {
    try {
      return window.speechSynthesis.speaking || window.speechSynthesis.pending;
    } catch {
      return false;
    }
  }

  private cancel(): void {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Nothing to cancel.
    }
  }

  stop(): void {
    // Bumping first is what makes any line still in flight give up quietly.
    this.generation++;
    this.speaking = false;
    if (!voiceAvailable()) return;
    this.cancel();
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const narrator = new Narrator();
