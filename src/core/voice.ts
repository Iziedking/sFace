/**
 * The narrator.
 *
 * Built on the browser's own speech synthesis, which is the right call here:
 * no audio file to download, no third party, no cost, and it reads whatever
 * the story file says rather than a recording that goes stale the moment the
 * copy changes.
 *
 * **The text is the story. The voice is decoration.** Every beat is on screen
 * before it is spoken and stays there after. Speech synthesis is genuinely
 * unreliable in the wild: some Android WebViews ship no voices at all, iOS
 * refuses to start outside a user gesture and sometimes stops on a
 * backgrounded tab, and a few browsers reject a long utterance silently. All
 * of that is survivable when the voice is an enhancement. None of it is
 * survivable if the story only exists as audio.
 *
 * Two quirks worth knowing, because both cost an hour to find:
 *
 *   1. `getVoices()` is empty on first call in most browsers and fills in
 *      asynchronously, announced by a `voiceschanged` event that some browsers
 *      fire late and others never fire at all. So we poll briefly and then
 *      give up rather than wait forever.
 *   2. Chrome stops speaking after roughly fifteen seconds unless something
 *      pokes it. The usual fix is a resume timer, which is exactly as silly as
 *      it sounds and is why one is here.
 */

const MAX_VOICE_WAIT_MS = 1500;
const KEEPALIVE_MS = 10_000;

/**
 * Voices, best first.
 *
 * The aim is calm and level rather than bright and helpful. Named voices are
 * tried first because the generic default on Windows is unusually flat even
 * by the standards of this API.
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

let cachedVoice: SpeechSynthesisVoice | null | undefined;

async function pickVoice(): Promise<SpeechSynthesisVoice | null> {
  if (cachedVoice !== undefined) return cachedVoice;
  if (!voiceAvailable()) {
    cachedVoice = null;
    return null;
  }

  const voices = await waitForVoices();
  if (voices.length === 0) {
    // No voices does not mean speech will fail. Some engines still speak with
    // the platform default when no voice is set, so leave it unset and try.
    cachedVoice = null;
    return null;
  }

  for (const wanted of PREFERRED) {
    const match = voices.find((v) => v.name.includes(wanted));
    if (match) {
      cachedVoice = match;
      return match;
    }
  }

  cachedVoice =
    voices.find((v) => v.lang.startsWith('en') && v.localService) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    voices[0] ??
    null;

  return cachedVoice;
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }

    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', done);
      clearInterval(poll);
      clearTimeout(giveUp);
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener('voiceschanged', done);
    // Some browsers never fire the event. Poll as well, briefly.
    const poll = setInterval(() => {
      if (window.speechSynthesis.getVoices().length > 0) done();
    }, 100);
    const giveUp = setTimeout(done, MAX_VOICE_WAIT_MS);
  });
}

export class Narrator {
  private keepalive: number | null = null;
  private speaking = false;
  private muted = false;

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
   * It never rejects. A narrator that throws would take the intro sequence
   * down with it, and the intro has to survive a device with no voices.
   */
  async say(text: string): Promise<void> {
    if (this.muted || !voiceAvailable()) return;

    this.stop();

    const voice = await pickVoice();
    if (this.muted) return;

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.speaking = false;
        this.stopKeepalive();
        resolve();
      };

      try {
        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang ?? 'en-GB';
        // Slower and lower than default. The default cadence reads as a
        // screen reader, which is exactly the wrong register for this.
        utterance.rate = 0.94;
        utterance.pitch = 0.85;
        utterance.volume = 1;

        utterance.addEventListener('end', finish);
        utterance.addEventListener('error', finish);

        this.speaking = true;
        window.speechSynthesis.speak(utterance);
        this.startKeepalive();

        // Belt and braces: if the engine never fires end or error, do not
        // leave the intro waiting on it forever. Roughly reading speed.
        const ceiling = 2000 + text.length * 90;
        setTimeout(finish, ceiling);
      } catch {
        finish();
      }
    });
  }

  stop(): void {
    this.stopKeepalive();
    this.speaking = false;
    if (!voiceAvailable()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Nothing to cancel.
    }
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Chrome stops after ~15s of a single utterance unless nudged. */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepalive = window.setInterval(() => {
      if (!this.speaking) return;
      try {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      } catch {
        // Not supported here, which is fine: those engines do not stall.
      }
    }, KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepalive !== null) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
  }
}

export const narrator = new Narrator();
