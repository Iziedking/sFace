import { describe, expect, it } from 'vitest';
import { createRouteRun, routeLesson, ROUTE_LESSONS, type RouteRun } from '../shared/atlas/adventures/route-rescue';
import { routeChapterKicker } from '../src/atlas/ui/route-rescue';

/*
 * All seven chapters play on one 3D scene, which is a deliberate scope call.
 * The cost of it is that two different pieces of UI name the player's location,
 * and they used to do it from two different places: the mission card had a
 * hardcoded ladder of chapter names, and the living-city topbar was a constant
 * reading "BEACON COMMONS / LIVING CITY". A player in chapter 2 therefore saw
 * "BEACON COMMONS" sitting directly above a card headed "LIGHT FOREST".
 *
 * Both now derive the name from `routeLesson`. These tests pin that, because
 * the failure is silent: nothing throws, the app just tells the player two
 * different things about where they are.
 */

function runAt(chapter: number): RouteRun {
  return { ...createRouteRun('explorer'), chapter };
}

describe('chapter labels', () => {
  it('names every chapter from the lesson, never from a second copy', () => {
    for (let chapter = 0; chapter < ROUTE_LESSONS.length; chapter += 1) {
      const run = runAt(chapter);
      const kicker = routeChapterKicker(run);
      expect(kicker, `chapter ${chapter} kicker`).toContain(routeLesson(run).name.toUpperCase());
      expect(kicker).toMatch(new RegExp(`^CHAPTER ${chapter + 1} / `));
    }
  });

  it('is what the living-city topbar shows, so the two agree', () => {
    // atlas-app.ts builds the topbar as `${routeLesson(run).name.toUpperCase()} / LIVING CITY`.
    for (let chapter = 0; chapter < ROUTE_LESSONS.length; chapter += 1) {
      const run = runAt(chapter);
      const topbar = `${routeLesson(run).name.toUpperCase()} / LIVING CITY`;
      expect(routeChapterKicker(run)).toContain(topbar.replace(' / LIVING CITY', ''));
    }
  });

  it('keeps the seven chapter names distinct and in the story order', () => {
    const names = ROUTE_LESSONS.map((lesson) => lesson.name);
    expect(names).toEqual([
      'Genesis Garden',
      'Light Forest',
      'Pay Harbor',
      'Albatross Causeway',
      'Validator Peaks',
      'Builder City',
      'Beacon Core',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('falls back to the practice line rather than inventing a chapter name', () => {
    expect(routeChapterKicker(runAt(ROUTE_LESSONS.length))).toContain('no NIM sent');
  });
});
