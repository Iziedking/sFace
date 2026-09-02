import type { KnowledgeBook, KnowledgeBookState } from '../../../shared/atlas/knowledge';
import { referenceKnowledgeFragment } from '../../../shared/atlas/knowledge';

export interface AtlasKnowledgeBookView {
  version: 1;
  mode: 'open' | 'closed';
  carriedFragmentIds: readonly string[];
  availableReferenceIds: readonly string[];
  teachBackOrder: readonly string[];
}

export function createAtlasKnowledgeBookView(book: KnowledgeBook, state: KnowledgeBookState, mode: 'open' | 'closed' = 'open'): AtlasKnowledgeBookView {
  return {
    version: 1,
    mode,
    carriedFragmentIds: [...state.fragmentIds],
    availableReferenceIds: book.fragments.filter((fragment) => referenceKnowledgeFragment(state, fragment.id)).map((fragment) => fragment.id),
    teachBackOrder: [...book.teachBackOrder],
  };
}
