import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATLAS_GUIDE_REACH_METRES, createAtlasTutorial } from '../src/atlas/tutorial';

const idle = { metresWalked: 0, metresToGuide: Number.POSITIVE_INFINITY, hasTalked: false };

describe('Atlas first-run tutorial', () => {
  it('opens by teaching the control nobody is told about', () => {
    // A new player is shown a circle and left to guess. That is the whole
    // reported problem, so it is the first thing the sequence addresses.
    const tutorial = createAtlasTutorial();
    expect(tutorial.step()?.id).toBe('walk');
    expect(tutorial.step()?.spotlight).toBe('joystick');
  });

  it('does not advance until the player has actually walked', () => {
    const tutorial = createAtlasTutorial();
    expect(tutorial.observe({ ...idle, metresWalked: 0.4 })).toBe(false);
    expect(tutorial.step()?.id).toBe('walk');
    expect(tutorial.observe({ ...idle, metresWalked: 2 })).toBe(true);
    expect(tutorial.step()?.id).toBe('approach');
  });

  it('calls the guide reached at exactly the distance TALK starts working', () => {
    /*
     * interactWithCommonsGuide refuses outside ATLAS_GUIDE_REACH_METRES. If the
     * tutorial said "you have arrived" any earlier, it would tell the player to
     * tap a button that then refuses them.
     */
    const tutorial = createAtlasTutorial();
    tutorial.observe({ ...idle, metresWalked: 2 });
    expect(tutorial.observe({ ...idle, metresToGuide: ATLAS_GUIDE_REACH_METRES + 0.1 })).toBe(false);
    expect(tutorial.observe({ ...idle, metresToGuide: ATLAS_GUIDE_REACH_METRES })).toBe(true);
    expect(tutorial.step()?.id).toBe('talk');
    expect(tutorial.step()?.spotlight).toBe('talk');
  });

  it('finishes only once the player has talked, and then stays finished', () => {
    const tutorial = createAtlasTutorial();
    tutorial.observe({ ...idle, metresWalked: 2 });
    tutorial.observe({ ...idle, metresToGuide: 1 });
    expect(tutorial.isComplete()).toBe(false);
    expect(tutorial.observe({ ...idle, hasTalked: true })).toBe(true);
    expect(tutorial.isComplete()).toBe(true);
    expect(tutorial.step()).toBeNull();
    expect(tutorial.observe({ ...idle, metresWalked: 99 })).toBe(false);
  });

  it('still teaches the joystick to a player who spawns beside the guide', () => {
    // Advancing more than one step per observation would skip the only
    // explanation of how to move.
    const tutorial = createAtlasTutorial();
    tutorial.observe({ metresWalked: 50, metresToGuide: 0.2, hasTalked: true });
    expect(tutorial.step()?.id).toBe('approach');
  });

  it('never runs again once it has been completed', () => {
    expect(createAtlasTutorial({ completed: true }).step()).toBeNull();
    expect(createAtlasTutorial({ completed: true }).isComplete()).toBe(true);
  });

  it('can be skipped deliberately', () => {
    const tutorial = createAtlasTutorial();
    tutorial.skip();
    expect(tutorial.isComplete()).toBe(true);
  });

  it('shares one reach constant with the interaction it describes', () => {
    // Two copies of 2.2 would drift, and the tutorial would start lying.
    const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
    expect(app).toContain("this.isNearBeaconAnchor(player, 'mission-guide', ATLAS_GUIDE_REACH_METRES)");
  });
});

describe('Atlas tutorial overlay', () => {
  const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
  const sheet = readFileSync(new URL('../src/atlas/ui/shell/kit.css', import.meta.url), 'utf8');

  it('marks the ancestors of the spotlight so the control is not dimmed by its own parent', () => {
    /*
     * .atlas-controls carries z-index 2 and so opens a stacking context: a
     * scrim plus z-index cannot lift the joystick out of it, and opacity on a
     * parent cannot be undone by a child. The dimming therefore skips the path
     * to the spotlight and dims siblings at each level instead.
     */
    expect(app).toContain("node.classList.add('atlas-spotlight-path')");
    expect(sheet).toContain('.atlas-spotlight-path > *:not(.atlas-spotlight-path):not(.atlas-spotlight)');
  });

  it('has no dismiss control', () => {
    // A tutorial a confused player can close by accident is not a tutorial.
    const start = app.indexOf('private applyTutorialStep(');
    const body = app.slice(start, app.indexOf('private tutorialStepNumber('));
    expect(body).not.toMatch(/actionButton|ghostButton|Skip|Close/);
  });

  it('darkens the world with a filter rather than an overlay', () => {
    expect(sheet).toContain('#atlas-city-stage.is-tutorial-dimmed');
    expect(app).toContain("classList.toggle('is-tutorial-dimmed'");
  });

  it('remembers completion outside the progress store', () => {
    // Clearing game progress should not force an experienced player back
    // through the tutorial.
    expect(app).toContain("const TUTORIAL_DONE_KEY = 'sface.atlas.tutorial.v1'");
    expect(app).toMatch(/function writeTutorialDone[\s\S]{0,220}catch/);
  });
});
