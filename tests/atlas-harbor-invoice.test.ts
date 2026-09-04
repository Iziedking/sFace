import { describe, expect, it } from 'vitest';
import { harborInvoiceLesson } from '../src/atlas/conversations/harbor-invoice';
import { LAST_LANTERN } from '../shared/atlas/adventures/last-lantern';

describe('harbor invoice decision', () => {
  it.each([10_000, 100_000])('uses the current %i Luna order without modifying it', (valueLuna) => {
    const request = Object.freeze({ ...LAST_LANTERN.request, valueLuna });
    const display = harborInvoiceLesson(request);
    expect(display.choices.find((choice) => choice.id === 'correct')?.label).toBe(`One lantern: ${valueLuna / 100_000} NIM`);
    expect(display.choices.find((choice) => choice.id === 'duplicate')?.label).toBe(`Two lanterns: ${valueLuna / 100_000 * 2} NIM`);
    expect(request.valueLuna).toBe(valueLuna);
    expect(display.knowledgeFragmentId).toBeNull();
  });

  it('explains the duplicate and lets the player try the same bill again', () => {
    const display = harborInvoiceLesson({ ...LAST_LANTERN.request, valueLuna: 10_000 }, true);
    expect(display.subtitle).toContain('two lanterns');
    expect(display.subtitle).toContain('0.1 NIM');
    expect(display.choices.map((choice) => choice.id)).toEqual(['duplicate', 'correct']);
  });
});
