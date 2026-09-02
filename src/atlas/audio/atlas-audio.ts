import type { LanternEvidenceSource, LanternPhase } from '../../../shared/atlas/adventures/last-lantern';

export type AtlasAudioBus = 'ambience' | 'events' | 'interface' | 'voice';
export type AtlasAudioCue = 'harbor-waiting-ambience' | 'harbor-restored-ambience' | 'payment-pending' | 'payment-confirmed' | 'beacon-confirmation' | 'city-footstep' | 'city-interaction';

export interface AtlasAudioBackend {
  unlock(): void;
  play(cue: AtlasAudioCue, bus: AtlasAudioBus, loop: boolean): void;
  stop(cue: AtlasAudioCue): void;
  setVolume(bus: AtlasAudioBus, value: number): void;
  visualCue(cue: AtlasAudioCue): void;
  narrate?(text: string, locale: string): void;
  destroy(): void;
}

export interface AtlasAudioState {
  phase: LanternPhase;
  evidenceSource?: LanternEvidenceSource;
}

const WAITING_PHASES = new Set<LanternPhase>(['street', 'shop', 'selected', 'review']);

export function createAtlasAudio(backend: AtlasAudioBackend = createWebAudioBackend()): AtlasAudio {
  return new AtlasAudio(backend);
}

export class AtlasAudio {
  private unlocked = false;
  private current: AtlasAudioState | null = null;

  constructor(private readonly backend: AtlasAudioBackend) {}

  unlock(): void {
    if (this.unlocked) return;
    try {
      this.backend.unlock();
      this.unlocked = true;
      if (this.current) this.sync(null, this.current);
    } catch {
      this.unlocked = false;
    }
  }

  setState(next: AtlasAudioState): void {
    const previous = this.current;
    this.current = { ...next };
    if (this.unlocked) this.sync(previous, next);
  }

  setVolume(bus: AtlasAudioBus, value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Atlas audio volume must be between 0 and 1.');
    this.backend.setVolume(bus, value);
  }

  playWorldCue(cue: 'city-footstep' | 'city-interaction'): void {
    if (!this.unlocked) return;
    this.playCue(cue, cue === 'city-footstep' ? 'interface' : 'events', false);
  }

  narrate(text: string, locale: string): void {
    if (!this.unlocked || !text.trim()) return;
    try { this.backend.narrate?.(text, locale); } catch { /* Voice is optional and never blocks play. */ }
  }

  destroy(): void {
    for (const cue of ['harbor-waiting-ambience', 'payment-pending', 'harbor-restored-ambience'] as const) this.stopCue(cue);
    this.backend.destroy();
    this.current = null;
    this.unlocked = false;
  }

  private sync(previous: AtlasAudioState | null, next: AtlasAudioState): void {
    const wasWaiting = previous ? WAITING_PHASES.has(previous.phase) : false;
    const isWaiting = WAITING_PHASES.has(next.phase);
    if (isWaiting && !wasWaiting) this.playCue('harbor-waiting-ambience', 'ambience', true);
    if (!isWaiting) this.stopCue('harbor-waiting-ambience');

    const wasConfirming = previous?.phase === 'confirming';
    if (next.phase === 'confirming' && !wasConfirming) this.playCue('payment-pending', 'events', true);
    if (next.phase !== 'confirming') this.stopCue('payment-pending');

    const serverConfirmed = next.phase === 'verified' && next.evidenceSource === 'server-verified';
    const previouslyServerConfirmed = previous?.phase === 'verified' && previous.evidenceSource === 'server-verified';
    if (serverConfirmed && !previouslyServerConfirmed) this.playCue('payment-confirmed', 'events', false);

    if (next.phase === 'tower-lit' && previous?.phase !== 'tower-lit') {
      this.playCue('harbor-restored-ambience', 'ambience', true);
      this.playCue('beacon-confirmation', 'events', false);
    }
    if (next.phase !== 'tower-lit') this.stopCue('harbor-restored-ambience');
  }

  private playCue(cue: AtlasAudioCue, bus: AtlasAudioBus, loop: boolean): void {
    try {
      this.backend.play(cue, bus, loop);
    } catch {
      // The visual cue remains the honest fallback when decode or playback fails.
    } finally {
      this.backend.visualCue(cue);
    }
  }

  private stopCue(cue: AtlasAudioCue): void {
    try {
      this.backend.stop(cue);
    } catch {
      // Cleanup is best effort in a browser that has already reclaimed audio.
    }
  }
}

interface ToneRecipe { from: number; to: number; duration: number; }

const TONES: Record<AtlasAudioCue, ToneRecipe> = {
  'harbor-waiting-ambience': { from: 164, to: 196, duration: 0.7 },
  'harbor-restored-ambience': { from: 220, to: 440, duration: 0.9 },
  'payment-pending': { from: 196, to: 180, duration: 0.24 },
  'payment-confirmed': { from: 440, to: 660, duration: 0.2 },
  'beacon-confirmation': { from: 660, to: 990, duration: 0.35 },
  'city-footstep': { from: 105, to: 78, duration: 0.08 },
  'city-interaction': { from: 330, to: 520, duration: 0.18 },
};

function createWebAudioBackend(): AtlasAudioBackend {
  let context: AudioContext | null = null;
  const buses = new Map<AtlasAudioBus, GainNode>();
  const volumes: Record<AtlasAudioBus, number> = { ambience: 0.25, events: 0.7, interface: 0.5, voice: 0.85 };

  return {
    unlock: () => {
      if (context) return;
      const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return;
      context = new Constructor();
      for (const bus of ['ambience', 'events', 'interface', 'voice'] as const) {
        const gain = context.createGain();
        gain.gain.value = volumes[bus];
        gain.connect(context.destination);
        buses.set(bus, gain);
      }
    },
    play: (cue, bus) => {
      if (!context) return;
      const output = buses.get(bus);
      if (!output) return;
      const now = context.currentTime;
      const recipe = TONES[cue];
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = cue === 'payment-pending' || cue === 'city-footstep' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(recipe.from, now);
      oscillator.frequency.exponentialRampToValueAtTime(recipe.to, now + recipe.duration);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + recipe.duration);
      oscillator.connect(gain);
      gain.connect(output);
      oscillator.start(now);
      oscillator.stop(now + recipe.duration + 0.02);
    },
    stop: () => undefined,
    setVolume: (bus, value) => {
      volumes[bus] = value;
      const gain = buses.get(bus);
      if (gain) gain.gain.value = value;
    },
    narrate: (text, locale) => {
      const synth = globalThis.speechSynthesis;
      const Utterance = globalThis.SpeechSynthesisUtterance;
      if (!synth || !Utterance) return;
      synth.cancel();
      const utterance = new Utterance(text);
      utterance.lang = locale;
      utterance.rate = 0.92;
      utterance.pitch = 1.02;
      const voice = synth.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith(locale.toLowerCase().split('-')[0]!));
      if (voice) utterance.voice = voice;
      synth.speak(utterance);
    },
    visualCue: () => undefined,
    destroy: () => {
      globalThis.speechSynthesis?.cancel();
      if (context) void context.close().catch(() => undefined);
      context = null;
      buses.clear();
    },
  };
}
