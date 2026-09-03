/*
 * The first run.
 *
 * A playtester who built the game said "even me playing is confused on what to
 * do". The city never taught anything: it showed an objective line and left the
 * player to discover that the circle on the left is a joystick, that the pink
 * guide is a destination, and that TALK only works within arm's reach.
 *
 * So the first run is scripted. Each step names one action, blocks until the
 * player actually performs it, and cannot be dismissed by a stray tap — there
 * is no close button, only a deliberate skip in settings. Nothing here is on a
 * timer, because a timer teaches nothing to a player who was still reading.
 *
 * The logic lives apart from the DOM so the sequence can be tested as a
 * sequence, which is the part that has to be right.
 */
export type AtlasTutorialStepId = 'walk' | 'approach' | 'talk';

/* Which control the step lifts out of the dimmed screen. */
export type AtlasTutorialSpotlight = 'joystick' | 'talk';

export interface AtlasTutorialStep {
  readonly id: AtlasTutorialStepId;
  readonly prompt: string;
  readonly spotlight: AtlasTutorialSpotlight;
}

export interface AtlasTutorialObservation {
  /* How far the player has travelled since the run began. */
  readonly metresWalked: number;
  /* Distance to the Commons guide, or Infinity while the city is still loading. */
  readonly metresToGuide: number;
  readonly hasTalked: boolean;
}

export interface AtlasTutorialDirector {
  step(): AtlasTutorialStep | null;
  /* Returns true when the observation completed a step, so the caller repaints. */
  observe(observation: AtlasTutorialObservation): boolean;
  isComplete(): boolean;
  skip(): void;
}

/*
 * The reach used by interactWithCommonsGuide.
 *
 * Exported so the app imports it rather than repeating 2.2, because a tutorial
 * that says "you have arrived" at a different distance from the one where TALK
 * starts working would teach the player that the game lies to them.
 */
export const ATLAS_GUIDE_REACH_METRES = 2.2;

/* Far enough that it cannot be satisfied by a thumb twitch. */
const WALK_PROOF_METRES = 2;

const STEPS: readonly AtlasTutorialStep[] = [
  {
    id: 'walk',
    prompt: 'Drag the circle to walk.',
    spotlight: 'joystick',
  },
  {
    id: 'approach',
    prompt: 'Walk to the pink guide.',
    spotlight: 'joystick',
  },
  {
    id: 'talk',
    prompt: 'You are close enough. Tap TALK.',
    spotlight: 'talk',
  },
];

function satisfied(step: AtlasTutorialStep, observation: AtlasTutorialObservation): boolean {
  if (step.id === 'walk') return observation.metresWalked >= WALK_PROOF_METRES;
  if (step.id === 'approach') return observation.metresToGuide <= ATLAS_GUIDE_REACH_METRES;
  return observation.hasTalked;
}

export function createAtlasTutorial(options: { readonly completed?: boolean } = {}): AtlasTutorialDirector {
  let index = options.completed === true ? STEPS.length : 0;

  return {
    step(): AtlasTutorialStep | null {
      return STEPS[index] ?? null;
    },

    observe(observation: AtlasTutorialObservation): boolean {
      const current = STEPS[index];
      if (!current) return false;
      if (!satisfied(current, observation)) return false;
      /*
       * Advance one step at a time even when a later condition is already true.
       * A player who spawns within reach of the guide still has to be told what
       * the joystick is before being told to tap TALK.
       */
      index += 1;
      return true;
    },

    isComplete(): boolean {
      return index >= STEPS.length;
    },

    skip(): void {
      index = STEPS.length;
    },
  };
}
