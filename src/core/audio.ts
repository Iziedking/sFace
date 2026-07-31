/**
 * Tiny WebAudio blips. No files, no library, nothing to download.
 *
 * Every sound here is an oscillator and a gain envelope, which keeps the whole
 * audio layer under a hundred lines and the bundle free of assets. It will not
 * win a sound design award and it does not need to.
 *
 * Two constraints shape this file. Mobile browsers refuse to start an
 * AudioContext outside a user gesture, so nothing is created until the first
 * tap. And the preference is persisted, because a game inside a wallet that
 * forgets you muted it is a game you mute once and then delete.
 */

const STORAGE_KEY = 'sface.sound';

type Voice =
  | 'shoot'
  | 'hit'
  | 'kill'
  | 'rescue'
  | 'extract'
  | 'down'
  | 'ui'
  | 'cache'
  | 'relic'
  | 'refill';

interface Recipe {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  gain: number;
}

const RECIPES: Record<Voice, Recipe> = {
  shoot: { type: 'square', from: 620, to: 300, duration: 0.06, gain: 0.05 },
  hit: { type: 'square', from: 220, to: 120, duration: 0.08, gain: 0.07 },
  kill: { type: 'sawtooth', from: 340, to: 60, duration: 0.22, gain: 0.09 },
  rescue: { type: 'triangle', from: 520, to: 880, duration: 0.18, gain: 0.09 },
  extract: { type: 'triangle', from: 660, to: 1320, duration: 0.35, gain: 0.1 },
  down: { type: 'sawtooth', from: 280, to: 50, duration: 0.6, gain: 0.12 },
  ui: { type: 'sine', from: 440, to: 660, duration: 0.09, gain: 0.06 },
  // Picking something up rises; being hurt falls. That is the only rule the
  // whole set follows and it is enough to tell them apart without looking.
  cache: { type: 'triangle', from: 700, to: 1040, duration: 0.14, gain: 0.08 },
  relic: { type: 'triangle', from: 560, to: 1560, duration: 0.42, gain: 0.11 },
  refill: { type: 'sine', from: 480, to: 760, duration: 0.12, gain: 0.06 },
};

/**
 * What a run event sounds like.
 *
 * Driving audio off the event stream rather than off scattered call sites is
 * what fixed the two that were missing: a kill and a rescue both already
 * emitted an event and neither made a sound, because nothing was listening.
 * Anything the simulation reports now has one place to be heard.
 */
const EVENT_VOICE: Record<string, Voice | null> = {
  kill: 'kill',
  freed: 'rescue',
  extracted: 'rescue',
  cache: 'cache',
  relic: 'relic',
  refill: 'refill',
  // Already played from the damage watcher, which knows whether it was us.
  hit: null,
  lost: null,
  pickupLine: null,
};

export function voiceForEvent(kind: string): Voice | null {
  return EVENT_VOICE[kind] ?? null;
}

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = readPreference();
  /** Cheap rate limit, so a held fire button is not a hundred oscillators. */
  private lastPlayed = new Map<Voice, number>();

  get on(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    } catch {
      // Private mode. The preference simply does not survive the session.
    }
    if (this.master) this.master.gain.value = this.enabled ? 1 : 0;
    return this.enabled;
  }

  /**
   * Stop making noise because the app is no longer on screen.
   *
   * Suspending the whole context rather than muting the gain, so nothing is
   * scheduled while the app is away and the browser can release the audio
   * hardware. Muting alone leaves an active context, which on a phone is what
   * keeps the media session alive and stops other apps taking it back.
   *
   * The enabled preference is untouched: this is about where the app is, not
   * about what the player asked for.
   */
  silence(): void {
    if (!this.ctx) return;
    void this.ctx.suspend().catch(() => {
      // Some WebViews refuse. The gain below is the fallback.
    });
    if (this.master) this.master.gain.value = 0;
  }

  /** Come back, if the player still wants sound at all. */
  wake(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    if (this.master) this.master.gain.value = this.enabled ? 1 : 0;
  }

  /** Call from a real tap. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }

    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;

      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 1 : 0;
      this.master.connect(this.ctx.destination);
    } catch {
      // No audio in this WebView. The game is fully playable without it.
      this.ctx = null;
    }
  }

  /**
   * How loud the effects sit against the music.
   *
   * The recipes below are a mix, not absolute levels: shoot is quieter than
   * kill because a shot should be, and that relationship is right. What was
   * wrong is where the whole set sat. A shot peaked at 0.05 while the theme ran
   * at 0.34, so the loudest thing the player does was a fifth of the loudest
   * thing the game does on its own, and firing simply disappeared under it.
   *
   * One number here rather than editing eleven recipes, so the balance between
   * sounds survives any future change to how loud they are as a group.
   */
  private static readonly LEVEL = 2.1;

  play(voice: Voice): void {
    if (!this.enabled || !this.ctx || !this.master) return;

    const now = this.ctx.currentTime;
    const previous = this.lastPlayed.get(voice) ?? -1;
    if (now - previous < 0.04) return;
    this.lastPlayed.set(voice, now);

    const recipe = RECIPES[voice];
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = recipe.type;
    osc.frequency.setValueAtTime(recipe.from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, recipe.to), now + recipe.duration);

    /*
     * Headroom holds because the 40ms guard above is per voice.
     *
     * A bomb killing five attackers on one frame is one kill sound, not five,
     * so the worst realistic stack is several DIFFERENT voices at once: a shot,
     * a hit, a kill and a pickup comes to about 0.61 against the master's
     * ceiling of one. Peaks are brief on top of that, since every recipe decays
     * inside 0.6s.
     */
    gain.gain.setValueAtTime(recipe.gain * Audio.LEVEL, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + recipe.duration);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + recipe.duration + 0.02);
  }
}

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const audio = new Audio();
export type { Voice };
