import { describe, expect, it } from 'vitest';

import {
  ATLAS_KNOWLEDGE_BOOK,
  createKnowledgeBookState,
  gradeKnowledgeTeachBack,
  unlockKnowledgeFragment,
  validateKnowledgeBook,
} from '../shared/atlas/knowledge';

describe('NIM Atlas Living Knowledge Book', () => {
  it('contains sourced free-core fragments with cues, examples, failures, and review metadata', () => {
    const book = validateKnowledgeBook(ATLAS_KNOWLEDGE_BOOK, new Date('2026-08-25T12:00:00.000Z'));
    expect(book.fragments.length).toBeGreaterThanOrEqual(8);
    expect(book.fragments.every((fragment) => fragment.availability === 'free-core')).toBe(true);
    expect(book.fragments.every((fragment) => fragment.visualCue && fragment.example && fragment.failure && fragment.source.url.startsWith('https://nimiq.dev/'))).toBe(true);
  });

  it('separates free fragments, purchased expansion, and assistance provenance', () => {
    let state = createKnowledgeBookState();
    state = unlockKnowledgeFragment(state, 'luna');
    expect(state.fragmentIds).toEqual(['luna']);
    expect(state.expansionPageIds).toEqual([]);
    expect(state.hintIds).toEqual([]);
    const paid = unlockKnowledgeFragment(state, 'expansion-confirmation-depth');
    expect(paid).toEqual(state);
  });

  it('grades Ask, Check, Approve, Confirm, Unlock in a new scenario with the Book closed', () => {
    expect(gradeKnowledgeTeachBack(['ask', 'check', 'approve', 'confirm', 'unlock'])).toEqual({ correct: true, completedStepIds: ['ask', 'check', 'approve', 'confirm', 'unlock'], assistance: 'none' });
    expect(gradeKnowledgeTeachBack(['ask', 'approve', 'check', 'confirm', 'unlock'])).toMatchObject({ correct: false, assistance: 'none' });
    expect(gradeKnowledgeTeachBack(['ask', 'check', 'approve', 'confirm', 'unlock'], true)).toMatchObject({ correct: true, assistance: 'answer-reveal' });
  });

  it('rejects stale or malformed fragments', () => {
    const stale = structuredClone(ATLAS_KNOWLEDGE_BOOK);
    stale.fragments[0]!.source.reviewedAt = '2025-01-01';
    expect(() => validateKnowledgeBook(stale, new Date('2026-08-25T12:00:00.000Z'))).toThrow(/stale/i);
    const malformed = structuredClone(ATLAS_KNOWLEDGE_BOOK);
    delete (malformed.fragments[0] as { failure?: string }).failure;
    expect(() => validateKnowledgeBook(malformed, new Date('2026-08-25T12:00:00.000Z'))).toThrow();
  });
});
