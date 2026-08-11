/**
 * The first-play tour, which is the only explanation of the controls that
 * reaches somebody who did not go looking for one.
 *
 * The constraint worth pinning is that no step can trap a player. Every one of
 * them either clears on an action the player is being asked to perform, or
 * gives up on its own, and the whole thing has a ceiling. A tutorial that holds
 * somebody on a step they cannot satisfy is worse than no tutorial: it is a
 * game that has stopped responding.
 *
 * The second constraint is ordering. The three verbs every stage shares come
 * before anything a particular stage has an opinion about, because a player
 * still working out which key moves the ship does not need to be told about
 * car doors.
 */

import { describe, expect, it } from 'vitest';

import { Tour, TOUR_CEILING_SECONDS, deviceFor, type TourObservation } from '../src/core/tour';

const STEP = 1 / 60;

/** Nothing is happening, which is the state most of these start from. */
function idle(): TourObservation {
  return {
    moving: false,
    fired: false,
    freed: false,
    bought: false,
    canAfford: false,
    nearExtraction: false,
    cellInReach: false,
    carInReach: false,
    driving: false,
    panelOpen: false,
    gateOpen: false,
  };
}

/** Run the tour forward, with the same observation every step. */
function hold(tour: Tour, seconds: number, obs: TourObservation = idle()): void {
  for (let t = 0; t < seconds; t += STEP) tour.observe(STEP, obs);
}

/**
 * One step, and only one.
 *
 * The event-shaped observations are true for exactly one step of the run: a
 * purchase resolves once, a round leaves the gun once. Holding one true for a
 * fifth of a second is not a thing the loop can do, and a test that does it is
 * testing a situation that cannot occur.
 */
function pulse(tour: Tour, obs: Partial<TourObservation>): void {
  tour.observe(STEP, { ...idle(), ...obs });
}

describe('the first-play tour', () => {
  it('opens on movement and does not move on until the player moves', () => {
    const tour = new Tour('keys');

    expect(tour.current?.id).toBe('move');
    hold(tour, 8);
    expect(tour.current?.id).toBe('move');

    hold(tour, 0.6, { ...idle(), moving: true });
    expect(tour.current?.id).toBe('fire');
  });

  it('walks the four shared verbs in the order the run needs them', () => {
    const tour = new Tour('keys');
    const seen: string[] = [];

    const clear = (obs: Partial<TourObservation>): void => {
      seen.push(tour.current?.id ?? 'none');
      hold(tour, 0.6, { ...idle(), ...obs });
    };

    clear({ moving: true });
    clear({ fired: true });
    clear({ freed: true });
    clear({ bought: true, canAfford: true });
    clear({ nearExtraction: true });

    expect(seen).toEqual(['move', 'fire', 'free', 'buys', 'extract']);
    expect(tour.current?.id).toBe('pause');
  });

  it('ends after the last step rather than looping', () => {
    const tour = new Tour('keys');

    hold(tour, 0.6, { ...idle(), moving: true });
    hold(tour, 0.2, { ...idle(), fired: true });
    hold(tour, 0.2, { ...idle(), freed: true });
    hold(tour, 0.2, { ...idle(), bought: true });
    hold(tour, 0.2, { ...idle(), nearExtraction: true });
    expect(tour.current?.id).toBe('pause');

    // The last step is the only one nothing can satisfy, so it leaves on time.
    hold(tour, 9);
    expect(tour.finished).toBe(true);
    expect(tour.current).toBeNull();
  });

  it('does not hold a broke player on the step about spending', () => {
    const tour = new Tour('keys');

    hold(tour, 0.6, { ...idle(), moving: true });
    hold(tour, 0.2, { ...idle(), fired: true });
    hold(tour, 0.2, { ...idle(), freed: true });
    expect(tour.current?.id).toBe('buys');

    // An empty purse makes this step four buttons that cannot be pressed. It
    // gives up early rather than teaching the player that the card is stuck.
    hold(tour, 6);
    expect(tour.current?.id).toBe('extract');
  });

  it('gives up on extraction when the player is nowhere near it', () => {
    const tour = new Tour('keys');

    hold(tour, 0.6, { ...idle(), moving: true });
    hold(tour, 0.2, { ...idle(), fired: true });
    hold(tour, 0.2, { ...idle(), freed: true });
    hold(tour, 6);
    expect(tour.current?.id).toBe('extract');

    hold(tour, 21);
    expect(tour.current?.id).toBe('pause');
  });

  it('holds a stage verb back until the shared ones are done', () => {
    const tour = new Tour('keys');

    // A car is right there from the first frame, and it is not the lesson yet.
    hold(tour, 3, { ...idle(), carInReach: true });
    expect(tour.current?.id).toBe('move');

    hold(tour, 0.6, { ...idle(), moving: true, carInReach: true });
    hold(tour, 0.2, { ...idle(), fired: true, carInReach: true });
    hold(tour, 0.2, { ...idle(), freed: true, carInReach: true });

    // Now it cuts in, because the thing is in front of the player.
    hold(tour, 0.2, { ...idle(), carInReach: true });
    expect(tour.current?.id).toBe('car');
  });

  it('hands control back to the step the stage verb interrupted', () => {
    const tour = new Tour('keys');

    hold(tour, 0.6, { ...idle(), moving: true });
    hold(tour, 0.2, { ...idle(), fired: true });
    hold(tour, 0.2, { ...idle(), freed: true });
    expect(tour.current?.id).toBe('buys');

    hold(tour, 0.2, { ...idle(), carInReach: true });
    expect(tour.current?.id).toBe('car');

    // Getting in clears it, and the buys step is still owed.
    hold(tour, 0.2, { ...idle(), driving: true });
    expect(tour.current?.id).toBe('buys');
  });

  it('shows each stage verb once and not again', () => {
    const tour = new Tour('keys');

    hold(tour, 0.6, { ...idle(), moving: true });
    hold(tour, 0.2, { ...idle(), fired: true });
    hold(tour, 0.2, { ...idle(), freed: true });

    hold(tour, 0.2, { ...idle(), cellInReach: true });
    expect(tour.current?.id).toBe('cell');
    pulse(tour, { bought: true, cellInReach: true });
    expect(tour.current?.id).toBe('buys');

    // Second cell, same run. It has been explained.
    hold(tour, 2, { ...idle(), cellInReach: true });
    expect(tour.current?.id).toBe('buys');
  });

  it('lets go of a stage verb when its thing goes away', () => {
    const tour = new Tour('keys');

    hold(tour, 0.6, { ...idle(), moving: true });
    hold(tour, 0.2, { ...idle(), fired: true });
    hold(tour, 0.2, { ...idle(), freed: true });

    hold(tour, 0.2, { ...idle(), panelOpen: true });
    expect(tour.current?.id).toBe('panel');

    hold(tour, 0.2);
    expect(tour.current?.id).toBe('buys');
  });

  it('never outlasts its ceiling, however little the player does', () => {
    const tour = new Tour('keys');

    hold(tour, TOUR_CEILING_SECONDS + 1);
    expect(tour.finished).toBe(true);
  });

  it('stops for good when the player skips it', () => {
    const tour = new Tour('keys');

    tour.skip();
    expect(tour.finished).toBe(true);
    expect(tour.current).toBeNull();

    hold(tour, 5, { ...idle(), moving: true });
    expect(tour.current).toBeNull();
  });

  it('describes the device in hand rather than a keyboard by default', () => {
    const keys = new Tour('keys').current;
    const thumbs = new Tour('thumbs').current;
    const pads = new Tour('pads').current;

    expect(keys?.say).toContain('W A S D');
    // A phone player told about WASD learns nothing and concludes the game was
    // not built for them, which is the whole reason the copy varies.
    expect(thumbs?.say).not.toContain('W A S D');
    expect(pads?.say).not.toContain('W A S D');
    // And the two touch schemes are genuinely different controls.
    expect(thumbs?.say).not.toBe(pads?.say);
  });

  it('draws key caps on a keyboard and none on a phone', () => {
    expect(new Tour('keys').current?.keys).toEqual(['W', 'A', 'S', 'D']);
    expect(new Tour('thumbs').current?.keys).toEqual([]);
    expect(new Tour('pads').current?.keys).toEqual([]);
  });

  it('reads the device off the pointer and the chosen scheme', () => {
    expect(deviceFor(false, false)).toBe('keys');
    // A desktop cannot end up on pads: usingPads() already refuses it there.
    expect(deviceFor(true, false)).toBe('thumbs');
    expect(deviceFor(true, true)).toBe('pads');
  });

  it('counts up through the shared steps for the card', () => {
    const tour = new Tour('keys');

    expect(tour.position).toBe(1);
    expect(tour.length).toBe(6);

    hold(tour, 0.6, { ...idle(), moving: true });
    expect(tour.position).toBe(2);
  });
});
