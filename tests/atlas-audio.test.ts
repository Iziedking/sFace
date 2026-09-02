import { describe, expect, it } from 'vitest';

import { createAtlasAudio, type AtlasAudioBackend, type AtlasAudioState } from '../src/atlas/audio/atlas-audio';

function fakeBackend() {
  const events: Array<{ type: string; cue?: string; bus?: string; loop?: boolean; value?: number }> = [];
  const backend: AtlasAudioBackend = {
    unlock: () => { events.push({ type: 'unlock' }); },
    play: (cue, bus, loop) => { events.push({ type: 'play', cue, bus, loop }); },
    stop: (cue) => { events.push({ type: 'stop', cue }); },
    setVolume: (bus, value) => { events.push({ type: 'volume', bus, value }); },
    visualCue: (cue) => { events.push({ type: 'visual', cue }); },
    destroy: () => { events.push({ type: 'destroy' }); },
  };
  return { backend, events };
}

const state = (phase: AtlasAudioState['phase'], evidenceSource?: AtlasAudioState['evidenceSource']): AtlasAudioState => ({ phase, evidenceSource });

describe('NIM Atlas adaptive audio', () => {
  it('does not emit audio before a user gesture unlocks the backend', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.setState(state('street'));
    audio.setState(state('confirming'));
    expect(fake.events).toEqual([]);
    audio.unlock();
    expect(fake.events.some((event) => event.type === 'unlock')).toBe(true);
  });

  it('keeps provider lookup silent and uses one pending pulse during confirming', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.setState(state('review'));
    audio.setState(state('confirming'));
    audio.setState(state('confirming'));
    expect(fake.events.filter((event) => event.type === 'play' && event.cue === 'payment-confirmed')).toHaveLength(0);
    expect(fake.events.filter((event) => event.type === 'play' && event.cue === 'payment-pending')).toHaveLength(1);
  });

  it('plays confirmation only for server evidence and never for local practice evidence', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.setState(state('verified', 'local-simulation'));
    audio.setState(state('review'));
    audio.setState(state('verified', 'server-verified'));
    expect(fake.events.filter((event) => event.type === 'play' && event.cue === 'payment-confirmed')).toHaveLength(1);
  });

  it('adds restoration layers only after tower-lit and mirrors every sound with a visual cue', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.unlock();
    audio.setState(state('review'));
    audio.setState(state('tower-lit', 'server-verified'));
    const played = fake.events.filter((event) => event.type === 'play');
    expect(played.some((event) => event.cue === 'harbor-restored-ambience' && event.bus === 'ambience' && event.loop)).toBe(true);
    expect(played.some((event) => event.cue === 'beacon-confirmation' && event.bus === 'events')).toBe(true);
    expect(fake.events.filter((event) => event.type === 'visual')).toHaveLength(played.length);
  });

  it('keeps ambience, events, and interface volume buses independent', () => {
    const fake = fakeBackend();
    const audio = createAtlasAudio(fake.backend);
    audio.setVolume('ambience', 0.2);
    audio.setVolume('events', 0.8);
    audio.setVolume('interface', 0.4);
    expect(fake.events.filter((event) => event.type === 'volume')).toEqual([
      { type: 'volume', bus: 'ambience', value: 0.2 },
      { type: 'volume', bus: 'events', value: 0.8 },
      { type: 'volume', bus: 'interface', value: 0.4 },
    ]);
  });
});
