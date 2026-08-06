/**
 * Losing somebody you were carrying.
 *
 * Freeing people used to be a thing you did to a level rather than a thing you
 * then had to protect: once somebody was in the chain they were banked, and the
 * rest of the run was about your own hull. A game named after saving people
 * should be able to lose one.
 *
 * The whole design rests on one word in the request: not easy to kill. So these
 * tests are mostly about how hard it is, because a mechanic that turns a
 * firefight into a coin flip would be worse than not having it. Losing somebody
 * has to feel like a mistake you made, never like a dice roll you lost.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { FACE_DAMAGE_SHARE, damageFace, faceHurt } from '../src/game/face';
import { FACE_MAX_HEALTH, PLAYER_MAX_HEALTH, RunState } from '../src/game/state';
import { ENEMY_BULLET_DAMAGE } from '../src/game/bullet';
import { step } from '../src/game/update';
import type { PlayerCommand } from '../src/game/player';

const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function withFollower() {
  const state = new RunState(practiceMission('2026-08-06'), 'sidearm', 1);
  const face = state.faces[0]!;
  face.caged = false;
  face.state = 'following';
  face.slot = 0;
  return { state, face };
}

/** Rounds it takes to put somebody down with no let up. */
function hitsToKill(): number {
  const { state, face } = withFollower();

  let hits = 0;
  while (face.state === 'following' && hits < 200) {
    damageFace(state, face, ENEMY_BULLET_DAMAGE);
    hits++;
  }
  return hits;
}

describe('how hard they are to kill', () => {
  it('takes more to drop than the player takes', () => {
    /*
     * The number that decides whether this is fair. They are not the thing
     * being aimed at, so most of what reaches them is a graze, and they should
     * outlast the ship rather than being the soft part of it.
     */
    const player = Math.ceil(PLAYER_MAX_HEALTH / ENEMY_BULLET_DAMAGE);
    expect(hitsToKill()).toBeGreaterThan(player);
  });

  it('shrugs off a stray round', () => {
    // One shot in a crossfire must never be the start of losing a run.
    const { state, face } = withFollower();
    damageFace(state, face, ENEMY_BULLET_DAMAGE);

    expect(face.state).toBe('following');
    expect(face.health).toBeGreaterThan(FACE_MAX_HEALTH * 0.9);
  });

  it('takes only a share of what a round carries', () => {
    const { state, face } = withFollower();
    damageFace(state, face, 100);

    expect(FACE_MAX_HEALTH - face.health).toBeCloseTo(100 * FACE_DAMAGE_SHARE, 5);
  });
});

describe('recovering', () => {
  it('comes back once the shooting stops', () => {
    /*
     * This is what makes "sustained" mean something. Without it, damage taken
     * across a whole run adds up and somebody dies to the last round of an
     * unrelated fight minutes later.
     */
    const { state, face } = withFollower();
    for (let i = 0; i < 6; i++) damageFace(state, face, ENEMY_BULLET_DAMAGE);
    const hurt = face.health;

    for (let i = 0; i < 60 * 6; i++) step(state, 1 / 60, IDLE);

    expect(face.health).toBeGreaterThan(hurt);
    expect(face.health).toBe(FACE_MAX_HEALTH);
  });

  it('does not start recovering the instant fire stops', () => {
    // A delay is what leaves a window in which sustained fire still works.
    const { state, face } = withFollower();
    damageFace(state, face, ENEMY_BULLET_DAMAGE * 4);
    const hurt = face.health;

    for (let i = 0; i < 60; i++) step(state, 1 / 60, IDLE);
    expect(face.health).toBe(hurt);
  });

  it('can still be killed through the recovery by not letting up', () => {
    const { state, face } = withFollower();

    for (let i = 0; i < 400 && face.state === 'following'; i++) {
      damageFace(state, face, ENEMY_BULLET_DAMAGE);
      step(state, 1 / 60, IDLE);
    }

    expect(face.state).toBe('lost');
  });
});

describe('who can be hurt', () => {
  it('leaves somebody still trapped alone', () => {
    /*
     * A person dying before the player reached them is a run lost to something
     * nobody could prevent, and on a stage whose pass condition counts
     * extractions it could make the level unwinnable on arrival.
     */
    const state = new RunState(practiceMission('2026-08-06'), 'sidearm', 1);
    const face = state.faces[0]!;
    face.state = 'trapped';

    damageFace(state, face, 10_000);

    expect(face.state).toBe('trapped');
    expect(face.health).toBe(FACE_MAX_HEALTH);
    expect(state.phase).toBe('flying');
  });

  it('leaves somebody already extracted alone', () => {
    const { state, face } = withFollower();
    face.state = 'extracted';

    damageFace(state, face, 10_000);
    expect(state.phase).toBe('flying');
  });
});

describe('what losing one costs', () => {
  it('ends the run', () => {
    // The people are the objective, so losing one is losing. Same rule the
    // convoy cargo already follows.
    const { state, face } = withFollower();
    damageFace(state, face, 10_000);

    expect(face.state).toBe('lost');
    expect(state.phase).toBe('died');
  });

  it('says who it was', () => {
    // Events are collected on the run rather than delivered to a listener.
    const { state, face } = withFollower();
    damageFace(state, face, 10_000);

    const said = state.events
      .filter((e) => e.kind === 'lost')
      .map((e) => e.text ?? '');
    expect(said.some((t) => t.includes(face.name))).toBe(true);
  });
});

describe('the hull over their head', () => {
  it('is hidden while they are untouched', () => {
    // Six bars saying nothing on almost every frame is clutter, not feedback.
    const { face } = withFollower();
    expect(faceHurt(face)).toBe(false);
  });

  it('appears once they have taken something', () => {
    const { state, face } = withFollower();
    damageFace(state, face, ENEMY_BULLET_DAMAGE);
    expect(faceHurt(face)).toBe(true);
  });

  it('goes away again when they recover', () => {
    // The bar refilling and then leaving is how the player learns that breaking
    // the line of fire worked.
    const { state, face } = withFollower();
    damageFace(state, face, ENEMY_BULLET_DAMAGE);

    for (let i = 0; i < 60 * 6; i++) step(state, 1 / 60, IDLE);
    expect(faceHurt(face)).toBe(false);
  });
});
