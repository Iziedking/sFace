import { describe, expect, it } from 'vitest';

import { createRelayAppState, relayAppReducer, type RelayAppState } from '../src/relay/app-state';

function transition(state: RelayAppState, event: Parameters<typeof relayAppReducer>[1]): RelayAppState {
  return relayAppReducer(state, event);
}

describe('Relay practice screen state machine', () => {
  it('moves from boot to Today, countdown, running, and practice result without wallet state', () => {
    let state = createRelayAppState();
    expect(state.screen).toBe('boot');
    state = transition(state, { type: 'PRACTICE_READY', missionDate: '2026-08-24' });
    expect(state.screen).toBe('today');
    state = transition(state, { type: 'RESCUE_NOW' });
    expect(state.screen).toBe('countdown');
    state = transition(state, { type: 'COUNTDOWN_TICK', value: 0 });
    expect(state.screen).toBe('running');
    state = transition(state, { type: 'PRACTICE_FINISHED', score: 120, completedTicks: 1_350 });
    expect(state.screen).toBe('practice-result');
    expect(state.result).toEqual({ score: 120, completedTicks: 1_350 });
  });

  it('pauses on interruption and resumes practice without changing the authoritative phase', () => {
    let state = createRelayAppState('running');
    state = transition(state, { type: 'PAUSE', reason: 'visibility' });
    expect(state).toMatchObject({ screen: 'paused', pauseReason: 'visibility' });
    state = transition(state, { type: 'RESUME' });
    expect(state.screen).toBe('running');
  });

  it('keeps result visible before authorization and models retryable versus hard failures', () => {
    let state = createRelayAppState('practice-result');
    state = transition(state, { type: 'AUTHORIZE' });
    expect(state.screen).toBe('authorization');
    state = transition(state, { type: 'AUTH_DECLINED' });
    expect(state.screen).toBe('practice-result');
    state = transition(state, { type: 'SUBMIT_RETRYABLE', message: 'offline' });
    expect(state.screen).toBe('retryable-failure');
    state = transition(state, { type: 'SUBMIT_REJECTED', message: 'trace invalid' });
    expect(state.screen).toBe('hard-rejection');
  });

  it('distinguishes a ticket-bound competitive run from practice and renders its verified result', () => {
    let state = createRelayAppState('practice-result');
    state = transition(state, { type: 'AUTHORIZE' });
    state = transition(state, { type: 'COMPETITIVE_READY' });
    expect(state).toMatchObject({ screen: 'countdown', runKind: 'competitive' });
    state = transition(state, { type: 'COUNTDOWN_TICK', value: 0 });
    expect(state).toMatchObject({ screen: 'running', runKind: 'competitive' });
    state = transition(state, { type: 'SUBMITTING' });
    expect(state.screen).toBe('submitting');
    state = transition(state, { type: 'SUBMIT_VERIFIED', score: 400, completedTicks: 1_350 });
    expect(state).toMatchObject({ screen: 'verified-result', result: { score: 400, completedTicks: 1_350 } });
  });
});
