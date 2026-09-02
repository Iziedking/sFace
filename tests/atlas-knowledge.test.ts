import { describe, expect, it } from 'vitest';

import {
  ATLAS_KNOWLEDGE_BOOK,
  createKnowledgeBookState,
  gradeKnowledgeTeachBack,
  referenceKnowledgeFragment,
  unlockKnowledgeFragment,
  validateKnowledgeBook,
} from '../shared/atlas/knowledge';

describe('NIM Atlas Living Knowledge Book', () => {
  it('contains sourced free-core fragments with cues, examples, failures, and review metadata', () => {
    const book = validateKnowledgeBook(ATLAS_KNOWLEDGE_BOOK, new Date('2026-09-02T12:00:00.000Z'));
    expect(book.fragments.length).toBeGreaterThanOrEqual(8);
    expect(book.fragments.every((fragment) => fragment.availability === 'free-core')).toBe(true);
    // This used to require the nimiq.dev prefix on every source. The protocol
    // and community lessons are sourced from the blog, the release notes and
    // the forum, so the check is now the allowlist rule itself rather than one
    // host that happened to cover the original ten fragments.
    const allowedHost = (url: string): boolean => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return false;
      if (parsed.hostname === 'github.com') return parsed.pathname.startsWith('/nimiq/');
      return ['nimiq.dev', 'www.nimiq.dev', 'nimiq.com', 'www.nimiq.com', 'forum.nimiq.community'].includes(parsed.hostname);
    };
    expect(book.fragments.every((fragment) => fragment.visualCue && fragment.example && fragment.failure && allowedHost(fragment.source.url))).toBe(true);
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
    expect(() => validateKnowledgeBook(stale, new Date('2026-09-02T12:00:00.000Z'))).toThrow(/stale/i);
    const malformed = structuredClone(ATLAS_KNOWLEDGE_BOOK);
    delete (malformed.fragments[0] as { failure?: string }).failure;
    expect(() => validateKnowledgeBook(malformed, new Date('2026-09-02T12:00:00.000Z'))).toThrow();
  });

  it('allows a later puzzle to reference a carried fragment and rejects unknown supersession', () => {
    const state = unlockKnowledgeFragment(createKnowledgeBookState(), 'confirm');
    expect(referenceKnowledgeFragment(state, 'confirm')?.fragment.id).toBe('confirm');
    expect(referenceKnowledgeFragment(createKnowledgeBookState(), 'confirm')).toBeNull();
    const superseded = structuredClone(ATLAS_KNOWLEDGE_BOOK);
    superseded.fragments[1]!.supersedes = 'nim';
    expect(validateKnowledgeBook(superseded, new Date('2026-09-02T12:00:00.000Z')).fragments[1]!.supersedes).toBe('nim');
    superseded.fragments[1]!.supersedes = 'missing-fragment';
    expect(() => validateKnowledgeBook(superseded, new Date('2026-09-02T12:00:00.000Z'))).toThrow(/supersedes/i);
  });
});

describe('Atlas knowledge sources', () => {
  const base = {
    id: 'probe',
    title: 'Probe fragment',
    visualCue: 'a small probe',
    summary: 'A fragment used only to exercise the source allowlist.',
    example: 'It cites one host and the validator either accepts or refuses it.',
    failure: 'Accepting an arbitrary host would let a lesson cite anything at all.',
    supersedes: null,
    availability: 'free-core' as const,
  };

  function book(url: string) {
    return {
      version: 1 as const,
      reviewedAt: '2026-09-02',
      teachBackOrder: ['ask', 'check', 'approve', 'confirm', 'unlock'] as const,
      fragments: Array.from({ length: 8 }, (_unused, index) => ({
        ...base,
        id: `probe-${index}`,
        source: { url, title: 'Probe source', reviewedAt: '2026-09-02' },
      })),
    };
  }

  const now = new Date('2026-09-02T00:00:00.000Z');

  it('accepts the Nimiq hosts the curriculum actually cites', () => {
    for (const url of [
      'https://nimiq.dev/mini-apps/',
      'https://www.nimiq.com/blog/nimiq-core-2.0.0-is-live',
      'https://github.com/nimiq/core-rs-albatross/releases/tag/v2.1.0',
      'https://forum.nimiq.community/t/phase-2-how-to-contribute-in-the-nimiq-zero-knowledge-proof-ceremony/2044',
    ]) {
      expect(() => validateKnowledgeBook(book(url), now), url).not.toThrow();
    }
  });

  it('still refuses a host nobody vouched for, and a non-Nimiq GitHub owner', () => {
    // "It is on GitHub" is not provenance. Any owner can publish a repo that
    // looks official, so the org is part of the check.
    expect(() => validateKnowledgeBook(book('https://example.com/whatever'), now)).toThrow();
    expect(() => validateKnowledgeBook(book('https://github.com/someone-else/repo'), now)).toThrow();
  });

  it('refuses plain http even on an allowed host', () => {
    expect(() => validateKnowledgeBook(book('http://nimiq.dev/mini-apps/'), now)).toThrow();
  });
});

describe('Atlas protocol and community fragments', () => {
  it('teaches the cascade concepts, not only payment mechanics', () => {
    const ids = ATLAS_KNOWLEDGE_BOOK.fragments.map((item) => item.id);
    for (const id of ['purpose', 'micro-block', 'macro-block', 'election-block', 'slots', 'light-proof', 'readiness', 'release-compatibility', 'community']) {
      expect(ids, `missing fragment ${id}`).toContain(id);
    }
  });

  it('attributes promotional claims instead of asserting them', () => {
    // Nimiq's own marketing says zero-fee, compares itself to PayPal, and
    // claims a transaction costs less energy than an email. Those are its
    // claims, not measurements this game made, so any fragment repeating one
    // has to say who is claiming it.
    for (const item of ATLAS_KNOWLEDGE_BOOK.fragments) {
      const text = `${item.summary} ${item.example} ${item.failure}`.toLowerCase();
      if (text.includes('zero-fee') || text.includes('paypal') || text.includes('than sending an email')) {
        expect(text, `unattributed claim in ${item.id}`).toMatch(/nimiq (says|states|describes|claims)|according to nimiq/);
      }
    }
  });

  it('carries a real source and review date on every fragment', () => {
    for (const item of ATLAS_KNOWLEDGE_BOOK.fragments) {
      expect(item.source.url.startsWith('https://'), `source url for ${item.id}`).toBe(true);
      expect(item.source.title.length, `source title for ${item.id}`).toBeGreaterThan(1);
      expect(item.source.reviewedAt, `review date for ${item.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
