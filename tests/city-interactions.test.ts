import { describe, expect, it } from 'vitest';
import { ATLAS_FACING_DOT_THRESHOLD, ATLAS_INTERACTION_RANGE_METERS, ATLAS_JOYSTICK_DEAD_ZONE, applyJoystickDeadZone, cameraRelativeJoystick, chooseEligibleInteraction } from '../shared/atlas/city/interactions';
import { AtlasInteractionController } from '../src/atlas/city/interaction-controller';

describe('mobile city interactions', () => {
  it('uses the approved joystick dead zone and clamps camera-relative movement', () => {
    expect(ATLAS_JOYSTICK_DEAD_ZONE).toBe(0.12);
    expect(applyJoystickDeadZone({ x: 0.05, y: 0 })).toEqual({ x: 0, y: 0 });
    const movement = cameraRelativeJoystick({ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 });
    expect(movement.x).toBeCloseTo(0.7071, 4);
    expect(movement.y).toBeCloseTo(0.7071, 4);
  });

  it('chooses the nearest visible eligible target deterministically', () => {
    const targets = [
      { id: 'far', action: 'travel' as const, position: { x: 1.7, y: 0 }, enabled: true, occluded: false, facingDot: ATLAS_FACING_DOT_THRESHOLD },
      { id: 'near', action: 'talk' as const, position: { x: 1.2, y: 0 }, enabled: true, occluded: false, facingDot: 0.8 },
      { id: 'blocked', action: 'inspect' as const, position: { x: 0.1, y: 0 }, enabled: true, occluded: true, facingDot: 1 },
    ];
    expect(chooseEligibleInteraction({ x: 0, y: 0 }, targets)?.id).toBe('near');
    expect(ATLAS_INTERACTION_RANGE_METERS).toBe(1.8);
  });

  it('does not submit twice while an interaction is held', () => {
    const controller = new AtlasInteractionController();
    const target = [{ id: 'lantern-counter', action: 'inspect' as const, position: { x: 1, y: 0 }, enabled: true, occluded: false, facingDot: 1 }];
    expect(controller.trigger({ x: 0, y: 0 }, target)).toEqual({ targetId: 'lantern-counter', action: 'inspect' });
    expect(controller.trigger({ x: 0, y: 0 }, target)).toBeNull();
    controller.release();
    expect(controller.trigger({ x: 0, y: 0 }, target)?.action).toBe('inspect');
  });
});
