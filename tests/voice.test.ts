/**
 * Splitting narration into utterances an engine will actually finish.
 *
 * Chrome stops after roughly fifteen seconds of a single utterance. The old
 * workaround was a pause/resume timer, which produced the audible breaks the
 * narrator was reported for. Splitting removes the need for it entirely, so the
 * splitter has to be right: never lose a word, never exceed the ceiling, and
 * always break where a person would breathe.
 */

import { describe, expect, it } from 'vitest';

import { chunk } from '../src/core/voice';

const MAX = 160;

describe('chunking a line', () => {
  it('leaves a short line alone', () => {
    expect(chunk('In 2026 crypto did not crash. It lost face.')).toEqual([
      'In 2026 crypto did not crash. It lost face.',
    ]);
  });

  it('returns nothing for nothing', () => {
    expect(chunk('')).toEqual([]);
    expect(chunk('   ')).toEqual([]);
  });

  it('never hands the engine more than it can finish', () => {
    const long =
      'The market fell and kept falling, and every account that had spent a year telling everybody they were early went very quiet indeed. ' +
      'What was left was the people with nothing to lose, setting the terms for everyone else, and a timeline that had stopped arguing about anything except who to blame. ' +
      'Somebody has to go in there and get them out before the whole thing is filed under failure.';

    for (const piece of chunk(long)) {
      expect(piece.length).toBeLessThanOrEqual(MAX);
    }
  });

  it('loses no words', () => {
    // The property that matters most: a splitter that drops a clause would
    // silently change the story.
    const text =
      'Nobody drew this level. The worst performer in the top hundred becomes the stage, its real chart is the ground, and the fear index sets the odds for everyone playing that day.';
    const rejoined = chunk(text).join(' ').replace(/\s+/g, ' ');
    expect(rejoined).toBe(text.replace(/\s+/g, ' '));
  });

  it('breaks between sentences rather than inside them', () => {
    const text = `${'a'.repeat(120)}. ${'b'.repeat(120)}.`;
    const pieces = chunk(text);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.endsWith('.')).toBe(true);
  });

  it('splits a single overlong sentence on its commas', () => {
    // No sentence end to use, so the seams have to fall on clause boundaries.
    const text = `${'x'.repeat(90)}, ${'y'.repeat(90)}, ${'z'.repeat(90)}`;
    const pieces = chunk(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX);
  });

  it('handles a single word longer than the ceiling without hanging', () => {
    const pieces = chunk('z'.repeat(400));
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.join('')).toContain('z');
  });

  it('collapses whitespace so the engine does not pause on line breaks', () => {
    expect(chunk('one\n\n  two   three')).toEqual(['one two three']);
  });
});
