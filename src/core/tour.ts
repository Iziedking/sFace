/**
 * The first run, explained while it is happening.
 *
 * ## Why this is not the guide screen
 *
 * ui/controls.ts is a good guide and it is behind a button, and a guide behind
 * a button is read by people who already like the game. The first run is where
 * somebody decides whether there is a game here at all, and until this existed
 * it opened with a ship, a gun and no statement anywhere on screen about which
 * key does what.
 *
 * The brief card is not that statement either. It says what the stage is, which
 * is the other question, and it is read before anybody has touched the thing it
 * describes. hints.ts already makes this argument for the stage rules; this is
 * the same argument one level down, for the controls themselves.
 *
 * ## Do it, and the step goes away
 *
 * Every step names one action and clears when the player performs it. Nothing
 * here is timed and nothing has to be read: a player who was already moving
 * clears the move step before they have finished the sentence, which is the
 * correct outcome. The steps that cannot be detected reliably carry a timeout
 * so nobody is ever held on one.
 *
 * ## Why this file is DOM-free
 *
 * Same reason game/ is. The machine is the part with rules in it, so it is the
 * part worth testing, and it is only testable if it can run without a canvas, a
 * document or a device. ui/tour.ts draws what this returns and owns none of the
 * decisions.
 *
 * The device is passed in rather than read here for the same reason. A phone
 * player being told about WASD learns nothing and concludes the game was not
 * built for them, so the copy has to vary, and a machine that reads the
 * environment to decide its own copy cannot be tested against either one.
 */

export type TourStepId =
  | 'move'
  | 'fire'
  | 'free'
  | 'buys'
  | 'extract'
  | 'pause'
  | 'cell'
  | 'car'
  | 'panel'
  | 'gate';

/**
 * Which control the pointer should indicate, if any.
 *
 * Named by role, not by coordinate. ui/tour.ts resolves these against
 * core/pads.ts, which is the one place a button's position is decided, so a pad
 * that moves takes the pointer with it.
 */
export type TourTarget = 'move' | 'fire' | 'slots' | 'use' | 'pause' | null;

export interface TourStep {
  id: TourStepId;
  /** Two or three words. Read at a glance, mid-fight. */
  title: string;
  /** The instruction, in the device's own terms. One sentence where possible. */
  say: string;
  target: TourTarget;
  /**
   * The keys to draw as caps, on a keyboard only.
   *
   * A phone gets a ring drawn over the actual button instead, because it has
   * one and pointing at it is unambiguous. A keyboard has no such thing on
   * screen, so the keys themselves have to be the picture.
   */
  keys: readonly string[];
}

/**
 * How the player is holding this.
 *
 * Three cases rather than two, because the two touch schemes genuinely have
 * different controls: "anywhere on the left half" and "the ring, bottom left"
 * are not the same instruction, and core/scheme.ts already knows which is in
 * force. Telling a pads player to drag anywhere would be describing a game they
 * did not choose.
 */
export type TourDevice = 'keys' | 'thumbs' | 'pads';

/** Everything the machine needs to know about this step of the run. */
export interface TourObservation {
  /** The move command is asking for something. */
  moving: boolean;
  /** A round left the gun this step. */
  fired: boolean;
  /** Somebody came loose this step. */
  freed: boolean;
  /** A slot was pressed and something happened. */
  bought: boolean;
  /** The cheapest buy is affordable right now. */
  canAfford: boolean;
  /** Close enough to extraction that pointing at it is pointless. */
  nearExtraction: boolean;
  /** A cell is close enough to breach. */
  cellInReach: boolean;
  /** A car is close enough to get into. */
  carInReach: boolean;
  /** Behind the wheel. */
  driving: boolean;
  /** A stage six panel is open in front of the player. */
  panelOpen: boolean;
  /** A stage seven gate is asking. */
  gateOpen: boolean;
}

/**
 * The order, and it is an order rather than a menu.
 *
 * Move before fire before rescue is how the run itself goes, and the last two
 * are the ones a player only needs once they have survived long enough to have
 * money and a destination.
 */
const SEQUENCE: readonly TourStepId[] = ['move', 'fire', 'free', 'buys', 'extract', 'pause'];

/**
 * The verbs that belong to particular stages.
 *
 * Not in the sequence, because most runs never see them. Each one arrives when
 * its thing is actually on screen, which is the moment it means anything, and
 * never arrives at all on a stage that does not have one.
 */
const CONTEXTUAL: readonly TourStepId[] = ['cell', 'car', 'panel', 'gate'];

/** Seconds of asking for movement before the step counts as understood. */
const MOVE_SECONDS = 0.4;

/**
 * How long a step waits before giving up and moving on.
 *
 * Only the steps that cannot be cleared by a definite action have one. Buying
 * needs money the player may not have yet, extraction is a place they may be
 * nowhere near, and neither is a reason to hold the rest of the tour.
 */
const TIMEOUT: Partial<Record<TourStepId, number>> = {
  buys: 14,
  extract: 20,
  pause: 8,
  cell: 12,
  car: 12,
  panel: 12,
  gate: 12,
};

/**
 * The tour will not start a contextual step before this one has cleared.
 *
 * A player still working out which key moves the ship does not need to be told
 * about car doors. The three verbs above this line are the game; everything
 * after is a stage having an opinion.
 */
const CONTEXT_AFTER: TourStepId = 'free';

/** Longest the whole thing may occupy, however badly it is going. */
export const TOUR_CEILING_SECONDS = 150;

const TITLES: Record<TourStepId, string> = {
  move: 'MOVE',
  fire: 'SHOOT',
  free: 'GET THEM OUT',
  buys: 'SPEND WHAT YOU TAKE',
  extract: 'GET OUT',
  pause: 'THAT IS THE WHOLE GAME',
  cell: 'THAT ONE IS LOCKED UP',
  car: 'THERE IS A CAR',
  panel: 'READ IT',
  gate: 'THE GATE IS SHUT',
};

/**
 * What each step says, per device.
 *
 * Written as the action, not as encouragement, the same rule hints.ts follows.
 * "Drag the left half" is something to do; "try moving around" is noise on top
 * of a fight.
 */
const SAY: Record<TourStepId, Record<TourDevice, string>> = {
  move: {
    keys: 'W A S D, or the arrow keys.',
    thumbs: 'Left thumb, anywhere on the left half. Drag where you want to go.',
    pads: 'The ring in the bottom left corner. Push it where you want to go.',
  },
  fire: {
    keys: 'The mouse aims on its own. Click, or press space, to fire.',
    thumbs: 'Right thumb, anywhere on the right half. Drag to aim, and it fires while you hold.',
    pads: 'The big button, bottom right. Hold it.',
  },
  free: {
    keys: 'Fly straight into one of them. They come loose and fall in behind you.',
    thumbs: 'Fly straight into one of them. They come loose and fall in behind you.',
    pads: 'Fly straight into one of them. They come loose and fall in behind you.',
  },
  buys: {
    keys: '1 2 3 4 buy and use in one press. A charge, a bomb, a patch, a boost.',
    thumbs: 'The four buttons along the bottom. One tap buys and uses it.',
    pads: 'The four small buttons beside the trigger. One tap buys and uses it.',
  },
  extract: {
    keys: 'The pad at the far end. Everyone still behind you gets out with you.',
    thumbs: 'The pad at the far end. Everyone still behind you gets out with you.',
    pads: 'The pad at the far end. Everyone still behind you gets out with you.',
  },
  pause: {
    keys: 'Esc pauses, and the whole guide is one tap from there. Good luck.',
    thumbs: 'The button up top pauses, and the whole guide is one tap from there. Good luck.',
    pads: 'The button up top pauses, and the whole guide is one tap from there. Good luck.',
  },
  cell: {
    keys: 'Bars mean flying into it does nothing. Stand next to it and press 1.',
    thumbs: 'Bars mean flying into it does nothing. Stand next to it and tap CHARGE.',
    pads: 'Bars mean flying into it does nothing. Stand next to it and tap CHARGE.',
  },
  car: {
    keys: 'Press E to get in. Twice your speed, and heard from twice as far.',
    thumbs: 'Tap E to get in. Twice your speed, and heard from twice as far.',
    pads: 'Tap E to get in. Twice your speed, and heard from twice as far.',
  },
  panel: {
    keys: 'Four posts that genuinely went out today. 1 2 3 4 pick the one that explains it.',
    thumbs: 'Four posts that genuinely went out today. Those four buttons are the answers now.',
    pads: 'Four posts that genuinely went out today. Those four buttons are the answers now.',
  },
  gate: {
    keys: 'No weapon opens a gate. Answering it is the only key.',
    thumbs: 'No weapon opens a gate. Answering it is the only key.',
    pads: 'No weapon opens a gate. Answering it is the only key.',
  },
};

/** Drawn as caps on a keyboard. Nothing here is shown on a phone. */
const KEYS: Record<TourStepId, readonly string[]> = {
  move: ['W', 'A', 'S', 'D'],
  fire: ['CLICK', 'SPACE'],
  free: [],
  buys: ['1', '2', '3', '4'],
  extract: [],
  pause: ['ESC'],
  cell: ['1'],
  car: ['E'],
  panel: ['1', '2', '3', '4'],
  gate: ['1', '2', '3', '4'],
};

const TARGET: Record<TourStepId, TourTarget> = {
  move: 'move',
  fire: 'fire',
  free: null,
  buys: 'slots',
  extract: null,
  pause: 'pause',
  cell: 'slots',
  car: 'use',
  panel: 'slots',
  gate: 'slots',
};

/**
 * The tour, as a state machine over one run.
 *
 * Fed a fixed timestep and an observation, exactly like the simulation, so it
 * behaves the same whether the display is running at 60Hz or 144Hz and so a
 * paused run does not burn through it.
 */
export class Tour {
  private queue: TourStepId[];
  private readonly shown = new Set<TourStepId>();
  /** A stage verb that has taken over from the queue for the moment. */
  private interrupt: TourStepId | null = null;
  private elapsed = 0;
  private moved = 0;
  private total = 0;
  private over = false;

  constructor(private readonly device: TourDevice) {
    this.queue = [...SEQUENCE];
  }

  get finished(): boolean {
    return this.over;
  }

  /** How many steps this tour will show at least, for the 03/06 counter. */
  get length(): number {
    return SEQUENCE.length;
  }

  /** Which of the base steps is being worked on, 1-based, for the counter. */
  get position(): number {
    const id = this.queue[0];
    if (!id) return SEQUENCE.length;
    const at = SEQUENCE.indexOf(id);
    return at < 0 ? SEQUENCE.length : at + 1;
  }

  get current(): TourStep | null {
    if (this.over) return null;
    const id = this.interrupt ?? this.queue[0];
    if (!id) return null;

    return {
      id,
      title: TITLES[id],
      say: SAY[id][this.device],
      target: TARGET[id],
      keys: this.device === 'keys' ? KEYS[id] : [],
    };
  }

  /** The player asked for it to stop. It does not come back. */
  skip(): void {
    this.over = true;
  }

  /**
   * One step of the run, and its consequences for the tour.
   *
   * Order matters here: the current step is given its chance to clear before a
   * stage verb is allowed to interrupt, so an action that satisfies both is
   * counted as progress rather than being swallowed by an interruption.
   */
  observe(dt: number, obs: TourObservation): void {
    if (this.over) return;

    this.total += dt;
    if (this.total >= TOUR_CEILING_SECONDS) {
      this.over = true;
      return;
    }

    this.elapsed += dt;
    if (obs.moving) this.moved += dt;

    const id = this.interrupt ?? this.queue[0];
    if (!id) {
      this.over = true;
      return;
    }

    if (this.clears(id, obs)) {
      this.advance();
      return;
    }

    const timeout = TIMEOUT[id];
    if (timeout !== undefined && this.elapsed >= timeout) {
      this.advance();
      return;
    }

    this.maybeInterrupt(obs);
  }

  /** Move to the next step, and end the tour when there is not one. */
  private advance(): void {
    if (this.interrupt !== null) {
      // A stage verb hands control back to whatever it took it from, rather
      // than consuming a base step. Being shown a car does not mean you have
      // been shown where the extraction pad is.
      this.interrupt = null;
    } else {
      this.queue.shift();
    }

    this.elapsed = 0;
    this.moved = 0;

    if (this.queue.length === 0) this.over = true;
  }

  private clears(id: TourStepId, obs: TourObservation): boolean {
    switch (id) {
      case 'move':
        return this.moved >= MOVE_SECONDS;
      case 'fire':
        return obs.fired;
      case 'free':
        return obs.freed;
      case 'buys':
        /*
         * Cleared by spending, or by the step being pointless.
         *
         * A player with no scrip yet is being shown four buttons they cannot
         * press, and holding them on that step until the timeout teaches them
         * that the tour does not respond. So an empty purse clears it early and
         * the buys are explained again by the pulse on the button itself the
         * first time one becomes affordable. See render/hud.ts.
         */
        return obs.bought || (!obs.canAfford && this.elapsed >= 5);
      case 'extract':
        return obs.nearExtraction;
      case 'pause':
        return false;
      case 'cell':
        return obs.bought || !obs.cellInReach;
      case 'car':
        return obs.driving;
      case 'panel':
        return !obs.panelOpen;
      case 'gate':
        return !obs.gateOpen;
      default:
        return false;
    }
  }

  /**
   * Let a stage verb cut in, once, when its thing is in front of the player.
   *
   * Held back until the three verbs every stage shares have been cleared. A
   * player still working out which key moves the ship does not need to be told
   * about car doors, and a tour that interrupts itself reads as noise rather
   * than as instruction.
   */
  private maybeInterrupt(obs: TourObservation): void {
    if (this.interrupt !== null) return;
    if (this.queue.includes(CONTEXT_AFTER)) return;

    for (const id of CONTEXTUAL) {
      if (this.shown.has(id)) continue;
      if (!triggered(id, obs)) continue;

      this.shown.add(id);
      this.interrupt = id;
      this.elapsed = 0;
      return;
    }
  }
}

function triggered(id: TourStepId, obs: TourObservation): boolean {
  switch (id) {
    case 'cell':
      return obs.cellInReach;
    case 'car':
      return obs.carInReach && !obs.driving;
    case 'panel':
      return obs.panelOpen;
    case 'gate':
      return obs.gateOpen;
    default:
      return false;
  }
}

/** Which set of words this device gets. Kept here so the copy has one owner. */
export function deviceFor(touch: boolean, pads: boolean): TourDevice {
  if (!touch) return 'keys';
  return pads ? 'pads' : 'thumbs';
}
