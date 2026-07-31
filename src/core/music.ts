/**
 * The music bed and the results sting.
 *
 * Separate from core/audio.ts on purpose. That file is synthesised blips with
 * no assets and no network; this one is two real files, one of which is 2.7 MB,
 * and the two have completely different failure modes. Mixing them would mean
 * a slow download could take the gunfire with it.
 *
 * ## Why an audio element and not the Web Audio API
 *
 * Web Audio wants the whole buffer decoded before it can play a note, which
 * for a 2.7 MB track on mobile data is several seconds of nothing followed by
 * a spike of memory. An `<audio>` element streams: it starts when it has
 * enough and keeps fetching. For a background loop that is strictly better,
 * and it costs the fine-grained mixing we do not need.
 *
 * `preload="none"` matters. Without it the browser starts pulling the track
 * during boot, competing with the mission fetch and the ghost traces for
 * bandwidth on exactly the connection least able to spare it. Nothing is
 * requested until the player has tapped and we actually intend to play.
 *
 * ## The unlock
 *
 * iOS and mobile Chrome refuse `play()` outside a user gesture, and the
 * permission attaches to the element, not the page. So the first real tap
 * calls play-then-pause on both elements while muted, which is the standard
 * trick to mark them as user-initiated. After that they can be started from
 * anywhere.
 */

const THEME_SRC = '/audio/theme.mp3';
const STING_SRC = '/audio/sting.mp3';

/**
 * Under a run, where it is the least important thing playing.
 *
 * It was 0.34, which is louder than every effect in the game, so shooting,
 * hits and rescues all sat underneath the soundtrack. That is backwards: the
 * theme is there to carry the run, and the moment the player does something the
 * thing they did should be the thing they hear.
 *
 * Halved rather than removed. A run with no bed under it feels thin, and the
 * effects were raised to meet this in the same change, so the gap between them
 * is now wider than the number alone suggests.
 */
const RUN_VOLUME = 0.17;
/** Under a menu, where the player is reading rather than flying. */
const MENU_VOLUME = 0.16;
const STING_VOLUME = 0.5;
const FADE_MS = 600;

const STORAGE_KEY = 'sface.music';

class Music {
  private theme: HTMLAudioElement | null = null;
  private sting: HTMLAudioElement | null = null;
  private unlocked = false;
  private enabled = readPreference();
  private fade: number | null = null;
  private settle: number | null = null;
  private wanted = 0;
  /**
   * Set the moment anything asks for playback.
   *
   * The unlock does play-then-pause, and the pause arrives in a promise
   * callback a tick or two later. If a real play() happens in between, that
   * late pause silently kills it and the music never starts, with no error
   * anywhere. This flag is what lets the unlock know it has been overtaken.
   */
  private playRequested = false;
  /** What was playing when the app was suspended, so resume can restore it. */
  private wasPlaying = false;

  get on(): boolean {
    return this.enabled;
  }

  /** Development only. Lets a test assert levels instead of guessing. */
  get state(): { enabled: boolean; playing: boolean; volume: number; at: number } {
    return {
      enabled: this.enabled,
      playing: Boolean(this.theme && !this.theme.paused),
      volume: this.theme ? Math.round(this.theme.volume * 100) / 100 : 0,
      at: this.theme ? Math.round(this.theme.currentTime * 10) / 10 : 0,
    };
  }

  /**
   * Call from a real tap, once. Creates the elements and marks them as
   * user-initiated so they can be started later from anywhere.
   */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;

    this.theme = build(THEME_SRC, true);
    this.sting = build(STING_SRC, false);

    // Play and immediately pause while silent. This is what actually grants
    // the element permission on iOS; nothing is audible and, with preload
    // none, nothing is downloaded either.
    for (const element of [this.theme, this.sting]) {
      if (!element) continue;
      element.volume = 0;
      const attempt = element.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt
          .then(() => {
            // Do not undo a real play() that arrived while this was pending.
            if (element === this.theme && this.playRequested) return;
            element.pause();
          })
          .catch(() => {
            // Refused anyway. Everything below degrades to silence.
          });
      }
    }
  }

  /** Start or resume the bed at the given level. Safe to call repeatedly. */
  play(level: 'run' | 'menu' = 'menu'): void {
    if (!this.enabled || !this.theme) return;

    this.playRequested = true;
    const target = level === 'run' ? RUN_VOLUME : MENU_VOLUME;

    if (this.theme.paused) {
      this.theme.volume = 0;
      void this.theme.play().catch(() => {
        // Autoplay refused or the file is missing. Silence is survivable.
      });
    }

    this.rampTo(target);
  }

  /** Drop to the menu level without stopping, so the loop stays in phase. */
  duck(): void {
    if (!this.theme || this.theme.paused) return;
    this.rampTo(MENU_VOLUME);
  }

  stop(): void {
    if (!this.theme) return;
    this.playRequested = false;
    this.rampTo(0, () => this.theme?.pause());
  }

  /**
   * Silence everything because the app is no longer on screen.
   *
   * Reported from a phone: the app was minimised and kept playing over
   * everything else. A browser tab is allowed to do that and a game has no
   * business doing it. Nothing else on a phone keeps talking after you leave it.
   *
   * Deliberately separate from `stop()`. Stop means the music is finished and
   * forgets it was ever wanted; this remembers, so coming back restores exactly
   * what was playing rather than starting the bed in a menu when the player was
   * mid-run.
   */
  suspend(): void {
    if (!this.theme) return;
    this.wasPlaying = this.playRequested && !this.theme.paused;

    // Cancel any fade in flight, or it keeps ticking against a paused element
    // and restores a volume nobody asked for when the app comes back.
    if (this.fade !== null) {
      cancelAnimationFrame(this.fade);
      this.fade = null;
    }
    if (this.settle !== null) {
      window.clearTimeout(this.settle);
      this.settle = null;
    }

    this.theme.pause();
    this.theme.volume = 0;
  }

  /** Come back to whatever was playing when the app went away. */
  resume(level: 'run' | 'menu'): void {
    if (!this.wasPlaying) return;
    this.wasPlaying = false;
    this.play(level);
  }

  /** A short hit for the results screen. Never loops, never blocks. */
  playSting(): void {
    if (!this.enabled || !this.sting) return;
    try {
      this.sting.currentTime = 0;
      this.sting.volume = STING_VOLUME;
      void this.sting.play().catch(() => {});
    } catch {
      // Seeking before enough is buffered throws on some engines.
    }
  }

  /** Returns the new state, so a caller can relabel a button. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    } catch {
      // Private mode. The preference lasts the session.
    }

    if (!this.enabled) this.stop();
    else this.play('menu');

    return this.enabled;
  }

  /**
   * Ramp rather than jump.
   *
   * A background bed that snaps between levels every time a menu opens reads
   * as a bug. This is a plain rAF interpolation because it is the only thing
   * moving, and reaching for an audio graph to fade one element would be a
   * lot of machinery for one number.
   */
  private rampTo(target: number, done?: () => void): void {
    const element = this.theme;
    if (!element) return;

    this.wanted = target;
    if (this.fade !== null) cancelAnimationFrame(this.fade);
    if (this.settle !== null) clearTimeout(this.settle);

    const from = element.volume;
    const start = performance.now();

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / FADE_MS);
      element.volume = clamp(from + (target - from) * t);

      if (t < 1 && this.wanted === target) {
        this.fade = requestAnimationFrame(tick);
      } else {
        this.fade = null;
        if (t >= 1) done?.();
      }
    };

    this.fade = requestAnimationFrame(tick);

    /*
     * A timer that guarantees the level lands even if the frame loop does not.
     *
     * requestAnimationFrame is throttled to a standstill in a backgrounded
     * tab, so a fade started just before someone switches away never finishes
     * and the volume is stuck wherever it got to. Coming back to a track
     * playing at four percent reads as broken. This snaps it home.
     */
    this.settle = window.setTimeout(() => {
      this.settle = null;
      if (this.wanted !== target) return;
      element.volume = clamp(target);
      done?.();
    }, FADE_MS + 120);
  }
}

function build(src: string, loop: boolean): HTMLAudioElement | null {
  try {
    const element = new Audio();
    // Nothing is fetched until play() is called. See the header.
    element.preload = 'none';
    element.src = src;
    element.loop = loop;
    element.volume = 0;
    return element;
  } catch {
    return null;
  }
}

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export const music = new Music();
