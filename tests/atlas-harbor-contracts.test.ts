import { describe, expect, it } from 'vitest';
import { activeHarborContract, advanceHarborContract, emptyHarborContracts, harborContractsForDay, harborContractTarget, restoreHarborContracts, startHarborContract, type HarborContractProgress, type HarborContractKind } from '../shared/atlas/harbor-contracts';
import { createHarborContractStore } from '../src/atlas/harbor-contract-store';
import { projectHarborContractMission, harborContractDialogue } from '../src/atlas/ui/harbor-contracts';

const day = '2026-09-04';
const opened = (): HarborContractProgress => ({ ...emptyHarborContracts(), opened: true });
function finish(progress: HarborContractProgress, kind: HarborContractKind, mistakes = 0, date = day): HarborContractProgress {
  let state = startHarborContract(progress, date, kind);
  const contract = activeHarborContract(state)!;
  state = advanceHarborContract(state, contract.pickup);
  for (let i = 0; i < mistakes; i++) state = advanceHarborContract(state, harborContractTarget(state), contract.choices.find((choice) => choice.id !== contract.answer)!.id);
  state = advanceHarborContract(state, harborContractTarget(state), contract.answer);
  return advanceHarborContract(state, contract.delivery);
}

describe('local harbor contracts', () => {
  it('requires the tower unlock and physical stop order', () => {
    expect(() => startHarborContract(emptyHarborContracts(), day, 'market')).toThrow();
    const state = startHarborContract(opened(), day, 'market');
    expect(() => startHarborContract(state, day, 'ferry')).toThrow();
    expect(() => advanceHarborContract(state, 'conversation-market')).toThrow();
    expect(state.active?.step).toBe(0);
  });
  it('supports all three routes with saved ratings and distinct supplies', () => {
    let state = opened();
    for (const kind of ['market', 'ferry', 'workshop'] as const) state = finish(state, kind);
    expect(state.stocked).toEqual(['market', 'ferry', 'workshop']);
    expect(state.records.map((record) => record.stars)).toEqual([3, 3, 3]);
    expect(state.active).toBeNull();
  });
  it('retries improve best ratings without duplicating rewards or supplies', () => {
    let state = finish(opened(), 'market', 2);
    expect(state.records[0]?.stars).toBe(1);
    state = finish(state, 'market');
    state = finish(state, 'market', 4);
    expect(state.records).toHaveLength(1);
    expect(state.records[0]?.stars).toBe(3);
    expect(state.stocked).toEqual(['market']);
  });
  it('keeps the accepted order across midnight and reload', () => {
    let state = startHarborContract(opened(), day, 'market');
    state = advanceHarborContract(state, harborContractTarget(state));
    const restored = restoreHarborContracts(JSON.parse(JSON.stringify(state)));
    expect(activeHarborContract(restored)?.day).toBe(day);
    expect(activeHarborContract(restored)?.question).toBe(activeHarborContract(state)?.question);
    expect(projectHarborContractMission(restored).actionLabel).toBe('Check order');
    expect(() => advanceHarborContract(restored, harborContractTarget(restored), 'unknown')).toThrow();
  });
  it('bounds completed records while preserving permanent supply markers', () => {
    let state = opened();
    for (let i = 0; i < 90; i++) state = finish(state, 'market', 0, new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
    expect(state.records).toHaveLength(84);
    expect(state.stocked).toEqual(['market']);
    expect(restoreHarborContracts(state)).toEqual(state);
  });
  it('rejects invalid dates, malformed saves and duplicate records', () => {
    expect(() => harborContractsForDay('2026-02-30')).toThrow();
    expect(() => restoreHarborContracts({ ...opened(), active: { day, kind: 'market', step: 3, mistakes: 0 } })).toThrow();
    const state = finish(opened(), 'market');
    expect(() => restoreHarborContracts({ ...state, records: [...state.records, ...state.records] })).toThrow();
  });
  it('round-trips checkpoints and returns independent snapshots', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const store = createHarborContractStore(storage);
    const state = startHarborContract(opened(), day, 'ferry');
    store.save(state);
    expect(createHarborContractStore(storage).snapshot()).toEqual(state);
    expect(store.snapshot()).not.toBe(store.snapshot());
  });
  it('keeps play working and reports corrupt or unavailable storage', () => {
    const corrupt = createHarborContractStore({ getItem: () => '{', setItem: () => undefined });
    expect(corrupt.notice()).toContain('could not be loaded');
    const store = createHarborContractStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
    store.save(startHarborContract(opened(), day, 'market'));
    expect(store.snapshot().active?.kind).toBe('market');
    expect(store.notice()).toContain('session only');
  });
  it('projects explicit practice guidance and selectable dialogue actions', () => {
    expect(projectHarborContractMission(opened()).status).toContain('LOCAL PRACTICE');
    const dialogue = harborContractDialogue('Choose a job', [{ id: 'close', label: 'Keep exploring' }]);
    expect(dialogue.choices[0]?.id).toBe('close');
    expect(dialogue.knowledgeFragmentId).toBeNull();
  });
});
