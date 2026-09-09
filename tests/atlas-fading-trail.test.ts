import { describe, expect, it } from 'vitest';
import { createRouteRun, replayRouteRun, routeLesson, stepRouteRun } from '../shared/atlas/adventures/route-rescue';

describe('Light Forest fading trail', () => {
  it('places Light Forest directly after Genesis Garden in the story route', () => {
    const chapterOne = replayRouteRun('explorer', [
      'talk', 'check-recipient', 'check-amount', 'approve-practice', 'try-signal', 'investigate',
      'match-evidence', 'install', 'teach-back', 'next',
    ]);
    expect(chapterOne.chapter).toBe(1);
    expect(routeLesson(chapterOne).name).toBe('Light Forest');
  });

  it('requires the fresh provider, consensus and block trail in order', () => {
    const genesis = ['talk', 'check-recipient', 'check-amount', 'approve-practice', 'try-signal', 'investigate', 'match-evidence', 'install', 'teach-back', 'next'] as const;
    let run = replayRouteRun('explorer', [...genesis, 'talk', 'check-recipient', 'check-amount', 'check-block', 'approve-practice']);
    expect(run.stage).toBe('signal');
    expect(run.trailNode).toBe(0);

    expect(stepRouteRun(run, 'follow-stale-trail')).toMatchObject({ stage: 'signal', trailNode: 0 });
    run = stepRouteRun(run, 'follow-trail');
    expect(run.trailNode).toBe(1);
    run = stepRouteRun(run, 'follow-trail');
    expect(run.trailNode).toBe(2);
    run = stepRouteRun(run, 'follow-trail');
    expect(run).toMatchObject({ stage: 'evidence', trailNode: 3 });
  });

  it('does not let a partial Light Forest request open the trail', () => {
    const genesis = ['talk', 'check-recipient', 'check-amount', 'approve-practice', 'try-signal', 'investigate', 'match-evidence', 'install', 'teach-back', 'next'] as const;
    const run = replayRouteRun('builder', [...genesis, 'talk', 'check-recipient', 'check-amount', 'approve-practice']);
    expect(run).toMatchObject({ stage: 'request', blockChecked: false });
    expect(run.notice).toContain('provider, consensus and latest block');
    expect(stepRouteRun(createRouteRun('explorer'), 'follow-trail')).toEqual(createRouteRun('explorer'));
  });

  it('makes Pay Harbor reject a duplicate before accepting the exact lantern request', () => {
    const genesis = ['talk', 'check-recipient', 'check-amount', 'approve-practice', 'try-signal', 'investigate', 'match-evidence', 'install', 'teach-back', 'next'] as const;
    const forest = ['talk', 'check-recipient', 'check-amount', 'check-block', 'approve-practice', 'follow-trail', 'follow-trail', 'follow-trail', 'match-evidence', 'install', 'teach-back', 'next'] as const;
    let run = replayRouteRun('explorer', [...genesis, ...forest, 'talk', 'check-recipient', 'check-amount', 'approve-practice', 'compare-requests']);
    expect(run).toMatchObject({ chapter: 2, stage: 'evidence', duplicateReviewed: true, duplicateRejected: false });
    expect(stepRouteRun(run, 'match-evidence')).toMatchObject({ stage: 'evidence', duplicateRejected: false });
    run = stepRouteRun(run, 'reorg-evidence');
    expect(run).toMatchObject({ stage: 'evidence', duplicateRejected: true });
    run = stepRouteRun(run, 'match-evidence');
    expect(run.stage).toBe('verified');
  });

  it('keeps the Albatross ferry closed until the receipt reaches finality', () => {
    const genesis = ['talk', 'check-recipient', 'check-amount', 'approve-practice', 'try-signal', 'investigate', 'match-evidence', 'install', 'teach-back', 'next'] as const;
    const forest = ['talk', 'check-recipient', 'check-amount', 'check-block', 'approve-practice', 'follow-trail', 'follow-trail', 'follow-trail', 'match-evidence', 'install', 'teach-back', 'next'] as const;
    const harbor = ['talk', 'check-recipient', 'check-amount', 'approve-practice', 'compare-requests', 'reorg-evidence', 'match-evidence', 'install', 'teach-back', 'next'] as const;
    let run = replayRouteRun('builder', [...genesis, ...forest, ...harbor, 'talk', 'check-recipient', 'check-amount', 'approve-practice']);
    expect(run).toMatchObject({ chapter: 3, stage: 'signal', receiptStep: 0 });
    expect(stepRouteRun(run, 'trust-early-receipt')).toMatchObject({ stage: 'signal', receiptStep: 0 });
    run = stepRouteRun(run, 'advance-receipt');
    expect(run.receiptStep).toBe(1);
    run = stepRouteRun(run, 'advance-receipt');
    expect(run.receiptStep).toBe(2);
    run = stepRouteRun(run, 'advance-receipt');
    expect(run.receiptStep).toBe(3);
    run = stepRouteRun(run, 'advance-receipt');
    expect(run).toMatchObject({ stage: 'evidence', receiptStep: 4 });
    expect(stepRouteRun(run, 'match-evidence').stage).toBe('verified');
  });
});
