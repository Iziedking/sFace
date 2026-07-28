/**
 * The ghost trace codec and the squad that plays it back.
 *
 * A trace is data fetched from the network and fed straight into the renderer,
 * so the decoder is a trust boundary. Half of this file is about what happens
 * when it is handed something wrong: truncated, hostile, from a future version,
 * or simply not base64. Every one of those has to produce a missing squadmate
 * rather than an exception in the middle of somebody's run.
 *
 * The other half is about fidelity. A ghost that drifts into a hill reads as a
 * broken game even though nothing is actually wrong, so the round trip has to
 * land within a fraction of the ship it draws.
 */

import { describe, expect, it } from 'vitest';

import {
  GhostRecorder,
  GhostTrack,
  decodeTrace,
  encodeTrace,
  SAMPLE_HZ,
  MAX_FRAMES,
  type GhostFrame,
} from '../src/game/ghost';
import { Squad, MAX_SQUAD } from '../src/game/squad';
import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../src/game/terrain';
import type { PlayerCommand } from '../src/game/player';

const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function frame(overrides: Partial<GhostFrame> = {}): GhostFrame {
  return {
    x: 1234.5,
    y: 567.25,
    angle: 1.2,
    firing: false,
    down: false,
    carrying: 0,
    ...overrides,
  };
}

describe('trace codec', () => {
  it('round trips a position within a fraction of a ship', () => {
    const original = [
      frame({ x: 0, y: 0 }),
      frame({ x: WORLD_WIDTH, y: WORLD_HEIGHT }),
      frame({ x: 5000.4, y: 321.9 }),
    ];

    const decoded = decodeTrace(encodeTrace(original));
    expect(decoded).not.toBeNull();

    for (let i = 0; i < original.length; i++) {
      // The ship is 34 units across, so a quarter of a unit is invisible.
      expect(decoded![i]!.x).toBeCloseTo(original[i]!.x, 0);
      expect(decoded![i]!.y).toBeCloseTo(original[i]!.y, 0);
    }
  });

  it('round trips flags and the carried count', () => {
    const original = [
      frame({ firing: true, down: false, carrying: 3 }),
      frame({ firing: false, down: true, carrying: 0 }),
      frame({ firing: true, down: true, carrying: 5 }),
    ];

    const decoded = decodeTrace(encodeTrace(original))!;

    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]!.firing).toBe(original[i]!.firing);
      expect(decoded[i]!.down).toBe(original[i]!.down);
      expect(decoded[i]!.carrying).toBe(original[i]!.carrying);
    }
  });

  it('round trips angles all the way round the circle', () => {
    const angles = [-Math.PI, -1, 0, 1, 3, Math.PI, Math.PI * 1.99];
    const decoded = decodeTrace(encodeTrace(angles.map((angle) => frame({ angle }))))!;

    for (let i = 0; i < angles.length; i++) {
      // Angles are one byte, so a step is about 1.4 degrees. Compare as unit
      // vectors, since 0 and 2pi are the same heading but not the same number.
      const want = angles[i]!;
      const got = decoded[i]!.angle;
      expect(Math.cos(got)).toBeCloseTo(Math.cos(want), 1);
      expect(Math.sin(got)).toBeCloseTo(Math.sin(want), 1);
    }
  });

  it('handles an empty trace', () => {
    expect(decodeTrace(encodeTrace([]))).toEqual([]);
  });

  it('stays inside a size a phone will happily post', () => {
    const full = Array.from({ length: MAX_FRAMES }, () => frame());
    const encoded = encodeTrace(full);
    // A full 90 second run should be well under 32 kB, which is the cap the
    // service enforces. If this ever fails the format grew and the server
    // limit needs to grow with it.
    expect(encoded.length).toBeLessThan(32_000);
  });
});

describe('the decoder refuses bad data instead of throwing', () => {
  const cases: Array<[string, string]> = [
    ['empty string', ''],
    ['not base64', 'this is definitely not base64 !!!'],
    ['too short for a header', 'AAA='],
    ['valid base64, wrong magic', Buffer.from([1, 1, 20, 0, 0, 1]).toString('base64')],
    ['right magic, wrong version', Buffer.from([0x5f, 99, 20, 0, 0, 1]).toString('base64')],
    ['right version, wrong sample rate', Buffer.from([0x5f, 1, 60, 0, 0, 1]).toString('base64')],
    // Header claims one frame, body carries none.
    ['truncated body', Buffer.from([0x5f, 1, 20, 0, 0, 1]).toString('base64')],
    // Header claims more frames than a run can hold.
    ['absurd frame count', Buffer.from([0x5f, 1, 20, 0, 0xff, 0xff]).toString('base64')],
  ];

  for (const [name, payload] of cases) {
    it(`returns null for ${name}`, () => {
      expect(decodeTrace(payload)).toBeNull();
    });
  }

  it('survives a byte flipped anywhere in a real trace', () => {
    const encoded = encodeTrace(Array.from({ length: 50 }, (_, i) => frame({ x: i * 100 })));

    for (let i = 0; i < encoded.length; i += 7) {
      const corrupted =
        encoded.slice(0, i) + (encoded[i] === 'A' ? 'B' : 'A') + encoded.slice(i + 1);
      // Either it decodes to something, or it returns null. It never throws.
      expect(() => decodeTrace(corrupted)).not.toThrow();
    }
  });
});

describe('recording a run', () => {
  it('samples at the trace rate off the run clock, not the frame rate', () => {
    const run = new RunState(practiceMission('2026-07-28'));
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;
    const recorder = new GhostRecorder();

    // Three seconds of simulation at 60Hz.
    for (let i = 0; i < 180; i++) {
      step(run, 1 / 60, IDLE);
      recorder.sample(run);
    }

    // Three seconds at 20Hz is 60 frames, give or take the boundary.
    expect(recorder.length).toBeGreaterThanOrEqual(3 * SAMPLE_HZ - 1);
    expect(recorder.length).toBeLessThanOrEqual(3 * SAMPLE_HZ + 1);
  });

  it('does not run past the length of a run however long it is sampled', () => {
    const run = new RunState(practiceMission('2026-07-28'));
    const recorder = new GhostRecorder();

    for (let i = 0; i < 60 * 200; i++) {
      run.time += 1 / 60;
      recorder.sample(run);
    }

    expect(recorder.length).toBeLessThanOrEqual(MAX_FRAMES);
  });

  it('produces a trace that replays the path it recorded', () => {
    const run = new RunState(practiceMission('2026-07-28'));
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;
    const recorder = new GhostRecorder();

    const flying: PlayerCommand = {
      moveX: 1, moveY: -0.3, aimX: 4000, aimY: 400, firing: true,
    };

    const path: Array<{ t: number; x: number; y: number }> = [];
    for (let i = 0; i < 60 * 10; i++) {
      step(run, 1 / 60, flying);
      recorder.sample(run);
      if (i % 60 === 0) path.push({ t: run.time, x: run.player.x, y: run.player.y });
    }

    const track = new GhostTrack(decodeTrace(recorder.encode())!);

    for (const point of path) {
      const pose = track.at(point.t);
      expect(pose).not.toBeNull();
      // Within a ship's width of where the player actually was. Interpolating
      // between 20Hz samples of a moving ship is where the slack goes.
      expect(Math.abs(pose!.x - point.x)).toBeLessThan(34);
      expect(Math.abs(pose!.y - point.y)).toBeLessThan(34);
    }
  });

  it('resets cleanly between runs', () => {
    const run = new RunState(practiceMission('2026-07-28'));
    const recorder = new GhostRecorder();
    for (let i = 0; i < 120; i++) {
      step(run, 1 / 60, IDLE);
      recorder.sample(run);
    }
    expect(recorder.length).toBeGreaterThan(0);

    recorder.reset();
    expect(recorder.length).toBe(0);
  });
});

describe('playback', () => {
  const frames = [
    frame({ x: 0, y: 100 }),
    frame({ x: 200, y: 100 }),
    frame({ x: 400, y: 100 }),
  ];

  it('interpolates between samples', () => {
    const track = new GhostTrack(decodeTrace(encodeTrace(frames))!);
    const halfway = track.at(0.5 / SAMPLE_HZ);
    expect(halfway!.x).toBeGreaterThan(50);
    expect(halfway!.x).toBeLessThan(150);
  });

  it('holds the last pose rather than vanishing when the recording ends', () => {
    const track = new GhostTrack(decodeTrace(encodeTrace(frames))!);
    const after = track.at(500);
    expect(after).not.toBeNull();
    expect(after!.x).toBeCloseTo(400, 0);
  });

  it('has nothing to show for an empty recording', () => {
    expect(new GhostTrack([]).at(1)).toBeNull();
  });
});

describe('the squad', () => {
  const frames = [frame({ x: 100 }), frame({ x: 200 })];

  it('holds ghosts and live players in the same shape', () => {
    const squad = new Squad(() => 1000);
    squad.addGhost('g1', 'Pilot AAAA', 4200, frames);
    squad.addLive('l1', 'Pilot BBBB');
    squad.pushLive('l1', frame({ x: 900, y: 300 }));
    squad.update(0, 1 / 60);

    const sources = squad.members.map((m) => m.source).sort();
    expect(sources).toEqual(['ghost', 'live']);
  });

  it('caps how many ships a phone has to draw', () => {
    const squad = new Squad(() => 1000);
    for (let i = 0; i < MAX_SQUAD + 4; i++) {
      squad.addGhost(`g${i}`, `Pilot ${i}`, 100, frames);
    }
    expect(squad.size).toBe(MAX_SQUAD);
  });

  it('evicts a ghost to make room for someone actually playing', () => {
    const squad = new Squad(() => 1000);
    for (let i = 0; i < MAX_SQUAD; i++) {
      squad.addGhost(`g${i}`, `Pilot ${i}`, 100, frames);
    }
    expect(squad.addLive('live', 'Pilot LIVE')).toBe(true);
    expect(squad.size).toBe(MAX_SQUAD);
    expect(squad.has('live')).toBe(true);
  });

  it('drops a live player who has gone quiet', () => {
    let now = 1000;
    const squad = new Squad(() => now);
    squad.addLive('l1', 'Pilot BBBB');
    squad.pushLive('l1', frame());
    squad.update(0, 1 / 60);
    expect(squad.size).toBe(1);

    now += 10_000;
    squad.update(0, 1 / 60);
    expect(squad.size).toBe(0);
  });

  it('ignores poses for anyone it is not tracking', () => {
    const squad = new Squad(() => 1000);
    squad.pushLive('stranger', frame());
    expect(squad.size).toBe(0);
  });

  it('will not let a live pose overwrite a ghost', () => {
    const squad = new Squad(() => 1000);
    squad.addGhost('g1', 'Pilot AAAA', 4200, frames);
    squad.pushLive('g1', frame({ x: 9999 }));
    squad.update(0, 1 / 60);

    // The ghost still plays its own recording.
    expect(squad.members[0]!.pose!.x).toBeCloseTo(100, 0);
  });

  it('places a joining live player immediately rather than sliding them in', () => {
    const squad = new Squad(() => 1000);
    squad.addLive('l1', 'Pilot BBBB');
    squad.pushLive('l1', frame({ x: 4000, y: 500 }));
    squad.update(0, 1 / 60);

    expect(squad.members[0]!.pose!.x).toBeCloseTo(4000, 0);
  });
});
