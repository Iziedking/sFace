import { describe, expect, it } from 'vitest';
import {
  ATLAS_EXPEDITION_MAX_TICKS,
  createDailyExpedition,
  replayAtlasExpedition,
  validateAtlasExpeditionTrace,
  type AtlasExpeditionAction,
} from '../shared/atlas/expedition';
import { createAtlasExpeditionController } from '../src/atlas/app/expedition-controller';

function action(overrides: Partial<AtlasExpeditionAction> = {}): AtlasExpeditionAction {
  return { moveX: 0, moveY: 0, tool: 'none', interact: false, scan: false, contextTool: 'none', system: 'active', ...overrides };
}

function walk(from: { x: number; y: number }, to: { x: number; y: number }): AtlasExpeditionAction[] {
  const actions: AtlasExpeditionAction[] = [];
  let x = from.x;
  let y = from.y;
  while (Math.abs(to.x - x) > 20 || Math.abs(to.y - y) > 20) {
    const moveX = Math.sign(to.x - x) * 127;
    const moveY = Math.sign(to.y - y) * 127;
    actions.push(action({ moveX, moveY }));
    x += Math.sign(to.x - x) * 16;
    y += Math.sign(to.y - y) * 16;
  }
  return actions;
}

describe('NIM Atlas Daily Field Expedition', () => {
  it('moves from brief through loadout, traverse, diagnose, extract, teach-back, and completion', () => {
    const definition = createDailyExpedition('2026-08-26');
    const controller = createAtlasExpeditionController(definition);
    expect(controller.state().phase).toBe('brief');
    controller.prepare('scanner');
    expect(controller.state().phase).toBe('prepare');
    controller.start();
    expect(controller.state().phase).toBe('running');

    for (const movement of walk(definition.spawn, definition.relay)) controller.step(movement);
    controller.step(action({ scan: true, tool: 'scanner', contextTool: 'scanner' }));
    for (const movement of walk(definition.relay, definition.fault)) controller.step(movement);
    controller.step(action({ tool: 'shield-pulse', contextTool: 'shield-pulse' }));
    controller.diagnose();
    for (const movement of walk(definition.fault, definition.extract)) controller.step(movement);
    controller.extract();
    controller.teachBack(definition.teachBackAnswer);

    expect(controller.state().phase).toBe('completed');
    expect(controller.trace().contentHash).toBe(definition.contentHash);
    expect(replayAtlasExpedition(definition, controller.trace()).phase).toBe('completed');
  });

  it('pauses without advancing the simulation and fails cleanly at timeout', () => {
    const definition = createDailyExpedition('2026-08-26');
    const controller = createAtlasExpeditionController(definition);
    controller.prepare('scanner');
    controller.start();
    controller.step(action({ system: 'paused', moveX: 127 }));
    expect(controller.state().tick).toBe(0);
    for (let index = 0; index < ATLAS_EXPEDITION_MAX_TICKS; index += 1) controller.step(action());
    expect(controller.state().phase).toBe('failed');
    expect(controller.state().failure).toBe('timeout');
  });

  it('varies presentation deterministically by date', () => {
    const first = createDailyExpedition('2026-08-26');
    const same = createDailyExpedition('2026-08-26');
    const next = createDailyExpedition('2026-08-27');
    expect(same).toEqual(first);
    expect(next.id).not.toBe(first.id);
    expect(next.title).not.toBe(first.title);
  });

  it('rejects forged, malformed, out-of-range, oversized, and hash-mismatched traces before replay', () => {
    const definition = createDailyExpedition('2026-08-26');
    const valid = { definitionId: definition.id, contentHash: definition.contentHash, rulesetHash: definition.rulesetHash, loadout: 'scanner' as const, actions: [action()], teachBackAnswer: null };
    expect(validateAtlasExpeditionTrace(definition, valid)).toBe(true);
    expect(() => validateAtlasExpeditionTrace(definition, { ...valid, contentHash: 'forged' })).toThrow(/hash/i);
    expect(() => validateAtlasExpeditionTrace(definition, { ...valid, actions: [{ ...action(), moveX: Number.NaN }] })).toThrow(/movement/i);
    expect(() => validateAtlasExpeditionTrace(definition, { ...valid, actions: [{ ...action(), position: { x: -1, y: 1 } }] })).toThrow(/position/i);
    expect(() => validateAtlasExpeditionTrace(definition, { ...valid, actions: Array.from({ length: ATLAS_EXPEDITION_MAX_TICKS + 1 }, () => action()) })).toThrow(/tick/i);
    expect(() => validateAtlasExpeditionTrace(definition, { ...valid, actions: Array.from({ length: 20_001 }, () => action()) })).toThrow(/trace/i);
  });
});
