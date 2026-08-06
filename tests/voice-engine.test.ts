/**
 * Telling a voice that works from one that only says it does.
 *
 * The splitting side of the narrator is covered in voice.test.ts. This file is
 * about whether the engine behind it produces any sound at all, which is a
 * separate question and the one that made the wallet silent.
 *
 * Reported as the narrator working on a PC and in a mobile browser and doing
 * nothing inside Nimiq Pay. The awkward part is that no feature test catches
 * it: `speechSynthesis` is present in every WebView whether or not the host has
 * a voice behind it, so the API answers yes and the speaking produces silence.
 *
 * With only `end` and `error` listeners, an engine that quietly ignores an
 * utterance is indistinguishable from one that finished instantly. That left
 * two bad outcomes depending on which way the host failed: the opening racing
 * past in silence, or a line sitting on a watchdog sized for a slow voice
 * reading a long sentence, which is about thirteen seconds a beat.
 *
 * A `start` listener is the missing piece, and these tests stand in for the
 * three engines: one that speaks, one that refuses, and one that does nothing
 * at all without ever saying so.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A speech engine that can be told how to misbehave. */
function fakeEngine(mode: 'speaks' | 'errors' | 'ignores') {
  const utterances: FakeUtterance[] = [];

  class FakeUtterance {
    text: string;
    voice: unknown = null;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    private listeners = new Map<string, Array<() => void>>();

    constructor(text: string) {
      this.text = text;
      utterances.push(this);
    }

    addEventListener(kind: string, fn: () => void): void {
      const list = this.listeners.get(kind) ?? [];
      list.push(fn);
      this.listeners.set(kind, list);
    }

    fire(kind: string): void {
      for (const fn of this.listeners.get(kind) ?? []) fn();
    }
  }

  const synth = {
    speaking: false,
    pending: false,
    getVoices: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    resume: () => {},
    cancel: () => {},
    speak(utterance: FakeUtterance) {
      if (mode === 'speaks') {
        // A real engine starts within a few milliseconds, then finishes.
        setTimeout(() => utterance.fire('start'), 5);
        setTimeout(() => utterance.fire('end'), 40);
      } else if (mode === 'errors') {
        setTimeout(() => utterance.fire('error'), 5);
      }
      // 'ignores' does nothing at all, which is the WebView case.
    },
  };

  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('window', {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    // The module warms its voice list on load and polls for it, so the stand-in
    // window needs the timers warming uses as well as the ones speaking does.
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  });

  return { utterances };
}

/** A narrator built after the globals are in place, so it sees this engine. */
async function narratorFor(mode: 'speaks' | 'errors' | 'ignores') {
  const engine = fakeEngine(mode);
  vi.resetModules();
  const { Narrator } = await import('../src/core/voice');
  return { narrator: new Narrator(), ...engine };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('an engine that really speaks', () => {
  it('is recognised as audible', async () => {
    const { narrator } = await narratorFor('speaks');
    expect(narrator.engineState).toBe('unknown');

    await narrator.say('Still early.');
    expect(narrator.engineState).toBe('audible');
  });
});

describe('an engine that refuses', () => {
  it('is recognised as silent rather than as a fast reader', async () => {
    const { narrator } = await narratorFor('errors');

    await narrator.say('Still early.');
    expect(narrator.engineState).toBe('silent');
  });
});

describe('an engine that does nothing and says nothing', () => {
  it('is found out quickly instead of hanging on the watchdog', async () => {
    /*
     * The wallet case. The watchdog is sized for a slow voice reading a long
     * sentence, so without a probe this line would take about thirteen seconds
     * to come back with nothing having happened.
     */
    const { narrator } = await narratorFor('ignores');

    const started = Date.now();
    await narrator.say('A line long enough that the watchdog would take many seconds to fire.');
    const took = Date.now() - started;

    expect(narrator.engineState).toBe('silent');
    expect(took).toBeLessThan(3_000);
  });

  it('stops queueing once it knows', async () => {
    // Speaking into an engine that produces nothing is not free: the utterances
    // pile up in a queue the host may flush all at once later.
    const { narrator, utterances } = await narratorFor('ignores');

    await narrator.say('First line.');
    const afterFirst = utterances.length;

    await narrator.say('Second line.');
    await narrator.say('Third line.');

    expect(afterFirst).toBeGreaterThan(0);
    expect(utterances.length).toBe(afterFirst);
  });

  it('returns immediately on later lines, so pacing is the caller\'s job', async () => {
    /*
     * Which is what the opening already does: a beat that came back in no time
     * is held on screen for as long as it takes somebody to read it. See
     * renderIntro. This only has to be fast and honest.
     */
    const { narrator } = await narratorFor('ignores');
    await narrator.say('First line.');

    const started = Date.now();
    await narrator.say('Second line.');
    expect(Date.now() - started).toBeLessThan(200);
  });
});
