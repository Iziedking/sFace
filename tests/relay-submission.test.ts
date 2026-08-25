import { describe, expect, it } from 'vitest';

import { createPendingRunStore } from '../src/relay/pending-runs';
import { RelayInputSampler } from '../src/relay/input/sampler';
import { mapTouchToSteer } from '../src/relay/input/touch';
import { createRelayRunPayload, RelayTraceRecorder, submitCompletedRelayRun } from '../src/relay/submission';

describe('Relay competitive browser submission', () => {
  it('records all authoritative ticks into canonical contiguous segments', () => {
    const recorder = new RelayTraceRecorder({
      missionDate: '2026-08-25',
      seedCommitment: 'a'.repeat(64),
      ticketId: 'b'.repeat(32),
    });

    for (let tick = 0; tick < 10; tick += 1) recorder.record(0);
    for (let tick = 10; tick < 20; tick += 1) recorder.record(127);

    const trace = recorder.finish(1_350);
    expect(trace.segments).toEqual([
      { startTick: 0, tickCount: 10, steerX: 0, flags: 0 },
      { startTick: 10, tickCount: 10, steerX: 127, flags: 0 },
      { startTick: 20, tickCount: 1_330, steerX: 0, flags: 0 },
    ]);
  });

  it('builds exact payload bytes bound to actor, wallet, ticket, seed, and replay result', async () => {
    const recorder = new RelayTraceRecorder({
      missionDate: '2026-08-25',
      seedCommitment: 'a'.repeat(64),
      ticketId: 'b'.repeat(32),
    });
    const trace = recorder.finish(1_350);
    const result = {
      score: 250,
      bankedNodes: 0,
      damageTaken: 0,
      bestChain: 0,
      integrityRemaining: 3,
      completedTicks: 1_350,
      repairUnits: 2,
    };

    const submission = await createRelayRunPayload({
      runId: 'run-1',
      actorId: 'actor-1',
      walletAddress: 'NQ00 TEST',
      network: 'test',
      trace,
      result,
    });

    expect(submission.runId).toBe('run-1');
    expect(JSON.parse(submission.payload)).toMatchObject({
      id: 'run-1',
      actorId: 'actor-1',
      walletAddress: 'NQ00 TEST',
      network: 'test',
      ticketId: 'b'.repeat(32),
      missionDate: '2026-08-25',
      seedCommitment: 'a'.repeat(64),
      ruleset: 'relay-1',
      trace,
      result,
    });
    expect(JSON.parse(submission.payload).traceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to over-record or finish beyond the authoritative run length', () => {
    const recorder = new RelayTraceRecorder({
      missionDate: '2026-08-25',
      seedCommitment: 'a'.repeat(64),
      ticketId: 'b'.repeat(32),
    });
    for (let tick = 0; tick < 1_350; tick += 1) recorder.record(0);
    expect(() => recorder.record(0)).toThrow(/tick|length/i);
    expect(() => recorder.finish(1_351)).toThrow(/tick|length/i);
  });

  it('stores exact bytes, checks reconciliation, and sends the completed trace', async () => {
    const recorder = new RelayTraceRecorder({ missionDate: '2026-08-25', seedCommitment: 'a'.repeat(64), ticketId: 'b'.repeat(32) });
    const result = { score: 250, bankedNodes: 0, damageTaken: 0, bestChain: 0, integrityRemaining: 3, completedTicks: 1_350, repairUnits: 2 };
    let sentPayload = '';

    const receipt = await submitCompletedRelayRun({
      store: createPendingRunStore(),
      runId: 'run-2',
      actorId: 'actor-1',
      walletAddress: 'NQ00 TEST',
      network: 'test',
      trace: recorder.finish(),
      result,
      createdAt: 10,
      query: async () => null,
      send: async (payload) => { sentPayload = payload; return { runId: 'run-2', status: 'verified', result }; },
    });

    expect(JSON.parse(sentPayload)).toMatchObject({ id: 'run-2', actorId: 'actor-1', trace: { segments: [{ startTick: 0, tickCount: 1_350, steerX: 0, flags: 0 }] } });
    expect(receipt).toMatchObject({ runId: 'run-2', status: 'verified', result });
  });

  it('carries pointer, semantic button, and keyboard steering through the submitted trace', async () => {
    const sampler = new RelayInputSampler();
    const recorder = new RelayTraceRecorder({ missionDate: '2026-08-25', seedCommitment: 'a'.repeat(64), ticketId: 'b'.repeat(32) });
    sampler.setTouchSteer(mapTouchToSteer(100, 100));
    recorder.record(sampler.sample());
    sampler.setTouchSteer(-127);
    recorder.record(sampler.sample());
    sampler.setKeyboardSteer(127);
    recorder.record(sampler.sample());
    sampler.clearKeyboardSteer();
    recorder.record(sampler.sample());

    const submission = await createRelayRunPayload({
      runId: 'control-run', actorId: 'actor-1', walletAddress: 'NQ00 TEST', network: 'test', trace: recorder.finish(),
      result: { score: 0, bankedNodes: 0, damageTaken: 0, bestChain: 0, integrityRemaining: 3, completedTicks: 1_350, repairUnits: 0 },
    });

    expect(JSON.parse(submission.payload).trace.segments.slice(0, 4)).toEqual([
      { startTick: 0, tickCount: 1, steerX: 127, flags: 0 },
      { startTick: 1, tickCount: 1, steerX: -127, flags: 0 },
      { startTick: 2, tickCount: 1, steerX: 127, flags: 0 },
      { startTick: 3, tickCount: 1, steerX: -127, flags: 0 },
    ]);
  });
});
