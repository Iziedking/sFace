import { ATLAS_CORE_FIXTURE } from '../../../shared/atlas/world';
import { canonicalAtlasActions } from '../../../shared/atlas/replay';
import { createAtlasState, snapshotAtlasState, type AtlasAction, type AtlasSnapshot } from '../../../shared/atlas/state';
import { stepAtlas } from '../../../shared/atlas/step';
import type { AtlasApiClient, AtlasCompetitiveRunResult } from '../api';
import { createAtlasCoreRunSubmission, type AtlasCoreRunRequest } from '../competitive-run';

export type AtlasCoreRunSubmissionState = 'local' | 'submitting' | 'verified' | 'offline' | 'rejected';

export interface AtlasCoreRunView {
  phase: AtlasSnapshot['phase'];
  tick: number;
  actions: number;
  score: number;
  submission: AtlasCoreRunSubmissionState;
  notice: string;
  result: AtlasCompetitiveRunResult | null;
}

export type AtlasCoreRunSubmitOptions = Omit<AtlasCoreRunRequest, 'actions'>;

/**
 * The playable core mission's single source of truth.
 *
 * Input is recorded before any network request and replayed locally through
 * the same shared step function that the server uses. A failed request leaves
 * the completed local run intact, so a player can retry without replaying the
 * mission or being told that an unverified score is a reward.
 */
export function createAtlasCoreRunController(options: { api: Pick<AtlasApiClient, 'submitCoreRun'> }) {
  let current = createAtlasState(ATLAS_CORE_FIXTURE);
  let actions: AtlasAction[] = [];
  let submission: AtlasCoreRunSubmissionState = 'local';
  let notice = '';
  let result: AtlasCompetitiveRunResult | null = null;

  function view(): AtlasCoreRunView {
    const snapshot = snapshotAtlasState(current);
    return { phase: snapshot.phase, tick: snapshot.tick, actions: actions.length, score: scoreSnapshot(snapshot), submission, notice, result: result ? structuredClone(result) : null };
  }

  return {
    state: view,
    step(action: AtlasAction): AtlasCoreRunView {
      if (current.phase !== 'running') return view();
      const nextActions = canonicalAtlasActions([...actions, action]);
      const nextAction = nextActions[nextActions.length - 1]!;
      stepAtlas(current, nextAction);
      actions = nextActions;
      submission = 'local';
      notice = '';
      result = null;
      return view();
    },
    reset(): AtlasCoreRunView {
      current = createAtlasState(ATLAS_CORE_FIXTURE);
      actions = [];
      submission = 'local';
      notice = '';
      result = null;
      return view();
    },
    async submit(input: AtlasCoreRunSubmitOptions): Promise<AtlasCoreRunView> {
      if (current.phase !== 'completed') {
        submission = 'rejected';
        notice = 'Complete the Atlas core objectives before submitting the run.';
        return view();
      }
      submission = 'submitting';
      notice = 'Sending the completed replay for server verification...';
      result = null;
      try {
        const prepared = await createAtlasCoreRunSubmission({ ...input, actions });
        const response = await options.api.submitCoreRun({ ...input, actions: prepared.actions });
        if (response.ok) {
          submission = 'verified';
          notice = 'Verified by Atlas. Your score is eligible for the competitive board.';
          result = response.value;
        } else {
          submission = isOfflineError(response.error) ? 'offline' : 'rejected';
          notice = response.error;
        }
      } catch (error) {
        submission = 'rejected';
        notice = error instanceof Error ? error.message : 'Atlas could not prepare this replay.';
      }
      return view();
    },
  };
}

function scoreSnapshot(snapshot: AtlasSnapshot): number {
  const points: Record<AtlasSnapshot['events'][number]['type'], number> = {
    paused: 0,
    hidden: 0,
    'relay-scanned': 25,
    'relay-connected': 50,
    'fault-hit': -20,
    'fault-shielded': 10,
    rescued: 100,
    'gate-opened': 100,
    'district-completed': 250,
  };
  return Math.max(0, snapshot.events.reduce((total, event) => total + points[event.type], 0));
}

function isOfflineError(error: string): boolean {
  return /unavailable|unreachable|timed out|no service configured/i.test(error);
}
