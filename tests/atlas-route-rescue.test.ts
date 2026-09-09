import { describe, expect, it } from 'vitest';
import { createRouteRun, recoverRouteRun, replayRouteRun, routeLesson, routeRestoration, stepRouteRun, type RouteAction } from '../shared/atlas/adventures/route-rescue';

const repair: RouteAction[] = ['talk', 'check-recipient', 'check-amount', 'approve-practice', 'try-signal', 'investigate', 'match-evidence', 'install', 'teach-back'];
const lightForestRepair: RouteAction[] = ['talk', 'check-recipient', 'check-amount', 'check-block', 'approve-practice', 'follow-trail', 'follow-trail', 'follow-trail', 'match-evidence', 'install', 'teach-back'];
const payHarborRepair: RouteAction[] = ['talk', 'check-recipient', 'check-amount', 'approve-practice', 'compare-requests', 'reorg-evidence', 'match-evidence', 'install', 'teach-back'];
const repairForChapter = (chapter: number): RouteAction[] => chapter === 1 ? lightForestRepair : chapter === 2 ? payHarborRepair : repair;
describe('local route investigation', () => {
  for (const role of ['explorer', 'builder'] as const) {
    it(`${role} completes all seven distinct chapters through replay`, () => {
      const actions = Array.from({ length: 7 }, (_, i) => [...repairForChapter(i), ...(i < 6 ? ['next' as const] : [])]).flat();
      const completed = replayRouteRun(role, actions);
      expect(completed).toMatchObject({ chapter: 6, stage: 'complete', role });
      expect(recoverRouteRun(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
    });
  }
  it('cannot skip inspection, refusal, evidence or installation', () => {
    const initial = createRouteRun('explorer');
    for (const action of ['install', 'match-evidence', 'teach-back', 'next'] as const) expect(stepRouteRun(initial, action)).toBe(initial);
    const unchecked = replayRouteRun('explorer', ['talk', 'approve-practice']);
    expect(unchecked.stage).toBe('request');
    const refused = replayRouteRun('explorer', repair.slice(0, 5));
    expect(refused.stage).toBe('refused');
    expect(routeRestoration(refused)).toBe('waiting');
    expect(stepRouteRun(refused, 'match-evidence')).toBe(refused);
  });
  it('keeps reorg and weak evidence closed, and allows recovery', () => {
    const evidence = replayRouteRun('builder', repair.slice(0, 6));
    for (const action of ['weak-evidence', 'reorg-evidence'] as const) {
      const rejected = stepRouteRun(evidence, action);
      expect(routeRestoration(rejected)).toBe('waiting');
      expect(rejected.stage).toBe('evidence');
      expect(stepRouteRun(rejected, 'install')).toBe(rejected);
      expect(routeRestoration(stepRouteRun(rejected, 'match-evidence'))).toBe('confirming');
    }
  });
  it('requires teach-back and does not accept forged saved state', () => {
    const restored = replayRouteRun('explorer', repair.slice(0, 8));
    expect(stepRouteRun(restored, 'wrong-answer').stage).toBe('restored');
    expect(stepRouteRun(restored, 'next')).toBe(restored);
    expect(recoverRouteRun({ ...restored, stage: 'complete', chapter: 6 })).toEqual(restored);
    expect(recoverRouteRun({ version: 1, role: 'explorer', actions: ['install'] })).toBeNull();
    expect(recoverRouteRun({ version: 1, role: 'explorer', actions: ['send-nim'] })).toBeNull();
    expect(recoverRouteRun({ version: 2, role: 'explorer', actions: [] })).toBeNull();
  });
  it('does not strand learners after repeated mistakes or repeated inspections', () => {
    let run = replayRouteRun('explorer', ['talk']);
    for (let i = 0; i < 300; i += 1) {
      run = stepRouteRun(run, 'approve-practice');
      run = stepRouteRun(run, 'check-recipient');
    }
    run = stepRouteRun(run, 'check-amount');
    for (const action of repair.slice(3, 6)) run = stepRouteRun(run, action);
    for (let i = 0; i < 300; i += 1) {
      run = stepRouteRun(run, 'weak-evidence');
      run = stepRouteRun(run, 'reorg-evidence');
    }
    expect(recoverRouteRun(run)).toEqual(run);
    for (const action of repair.slice(6, 8)) run = stepRouteRun(run, action);
    for (let i = 0; i < 300; i += 1) run = stepRouteRun(run, 'wrong-answer');
    run = stepRouteRun(run, 'teach-back');
    expect(run.stage).toBe('complete');
    expect(run.actions.length).toBeLessThan(30);
    expect(recoverRouteRun(run)).toEqual(run);
  });

  it('introduces the first payment lesson without unexplained protocol language', () => {
    const first = routeLesson(createRouteRun('explorer'));
    expect(first.need).toContain('0.1 NIM');
    expect(first.evidence).toContain('current network record');
    expect(first.answer).toContain('permission');
    expect(first.answer).not.toContain('canonical');
  });
});
