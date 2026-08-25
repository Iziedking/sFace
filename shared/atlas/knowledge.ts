import { z } from 'zod';

import type { AtlasAssistance } from './types';

export type KnowledgeAvailability = 'free-core' | 'purchased-expansion';

export interface KnowledgeFragment {
  id: string;
  title: string;
  visualCue: string;
  summary: string;
  example: string;
  failure: string;
  supersedes: string | null;
  availability: KnowledgeAvailability;
  source: { url: string; title: string; reviewedAt: string };
}

export interface KnowledgeBook {
  version: 1;
  reviewedAt: string;
  fragments: KnowledgeFragment[];
  teachBackOrder: ['ask', 'check', 'approve', 'confirm', 'unlock'];
}

export interface KnowledgeBookState {
  version: 1;
  fragmentIds: string[];
  expansionPageIds: string[];
  hintIds: string[];
  assistance: AtlasAssistance;
}

const REVIEWED_AT = '2026-08-25';
const official = (url: string, title: string) => ({ url, title, reviewedAt: REVIEWED_AT });

export const ATLAS_KNOWLEDGE_BOOK: KnowledgeBook = {
  version: 1,
  reviewedAt: REVIEWED_AT,
  teachBackOrder: ['ask', 'check', 'approve', 'confirm', 'unlock'],
  fragments: [
    fragment('nim', 'NIM is the native unit', 'orange NIM spark', 'NIM is the native currency used across the Nimiq network.', 'The shop prices a lantern in NIM, then the request uses its smallest integer unit.', 'Treating NIM as a generic points balance hides the real payment boundary.', 'https://nimiq.dev/', 'Nimiq'),
    fragment('luna', 'Lunas are exact units', '100000 tick marks', 'One NIM equals 100,000 Lunas, so transaction values use safe integer arithmetic.', '12 NIM becomes 1,200,000 Lunas.', 'Using floating point or a guessed conversion can change the amount.', 'https://nimiq.dev/mini-apps/api-reference/nimiq-provider', 'Nimiq Provider API'),
    fragment('address', 'Addresses name destinations', 'four-corner address stone', 'A validated user-friendly address identifies the account that should receive a payment.', 'Check the recipient in the request and again in the wallet prompt.', 'A substituted recipient can send a valid payment to the wrong place.', 'https://nimiq.dev/web-client/getting-started', 'Nimiq Web Client getting started'),
    fragment('ask', 'Ask for one capability', 'small keyhole', 'A Mini App asks for only the capability required by the next player-chosen action.', 'Initialize for a read, then request accounts only when the player chooses a wallet action.', 'Asking for accounts at boot creates an unexplained prompt and weakens consent.', 'https://nimiq.dev/mini-apps/', 'Nimiq Mini Apps'),
    fragment('approve', 'Approval is consent', 'open hand beside a wallet', 'A wallet approval records the player decision to authorize a reviewed action.', 'The player checks the recipient and integer Lunas before approving.', 'Approval is not proof that the transaction was included or confirmed.', 'https://nimiq.dev/mini-apps/api-reference/nimiq-provider', 'Nimiq Provider API'),
    fragment('custody', 'Keys stay in the wallet', 'locked keyhole', 'The Mini App asks the wallet to act while private keys remain under wallet control.', 'The game can request a user-confirmed signature without receiving a private key.', 'A device identifier or browser callback cannot replace wallet-controlled identity.', 'https://nimiq.dev/mini-apps/', 'Nimiq Mini Apps'),
    fragment('transaction', 'A payment has a lifecycle', 'three linked harbor buoys', 'A payment can be requested, submitted, included, confirming, or unknown before it is verified.', 'A provider lookup starts reconciliation; it does not complete the order.', 'A hash-only callback can be missing, noncanonical, or unsuccessful.', 'https://nimiq.dev/learn/transactions', 'Nimiq transactions'),
    fragment('confirm', 'Confirmation needs evidence', 'shield around a block', 'The server must read canonical evidence for network, sender, recipient, value, success, and confirmations.', 'The lantern waits until the configured confirmation threshold before fulfillment.', 'A temporary RPC failure is not evidence of a failed payment or a verified one.', 'https://nimiq.dev/rpc/methods/get-transaction-by-hash', 'Get transaction by hash'),
    fragment('unlock', 'Verification changes the world', 'lit harbor tower', 'Only the verified order event can add the item and change the shared harbor state.', 'The lantern becomes inventory only once, then the tower lights.', 'Client state, rank, or a repeated callback cannot create a second fulfillment.', 'https://nimiq.dev/mini-apps/', 'Nimiq Mini Apps'),
  ],
};

function fragment(id: string, title: string, visualCue: string, summary: string, example: string, failure: string, url: string, sourceTitle: string): KnowledgeFragment {
  return { id, title, visualCue, summary, example, failure, supersedes: null, availability: 'free-core', source: official(url, sourceTitle) };
}

const sourceSchema = z.object({ url: z.string().url().refine((url) => { const parsed = new URL(url); return parsed.protocol === 'https:' && (parsed.hostname === 'nimiq.dev' || parsed.hostname === 'www.nimiq.dev'); }), title: z.string().min(2).max(120), reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const fragmentSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(3).max(100), visualCue: z.string().min(3).max(100), summary: z.string().min(10).max(300), example: z.string().min(10).max(300), failure: z.string().min(10).max(300), supersedes: z.string().regex(/^[a-z0-9-]+$/).nullable(), availability: z.enum(['free-core', 'purchased-expansion']), source: sourceSchema }).strict();
const bookSchema = z.object({ version: z.literal(1), reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fragments: z.array(fragmentSchema).min(8), teachBackOrder: z.tuple([z.literal('ask'), z.literal('check'), z.literal('approve'), z.literal('confirm'), z.literal('unlock')]) }).strict();

export function validateKnowledgeBook(value: unknown, now = new Date()): KnowledgeBook {
  const book = bookSchema.parse(value) as KnowledgeBook;
  if (new Set(book.fragments.map((item) => item.id)).size !== book.fragments.length) throw new Error('Knowledge fragment ids must be unique.');
  for (const item of book.fragments) {
    const reviewed = Date.parse(`${item.source.reviewedAt}T00:00:00.000Z`);
    if (!Number.isFinite(reviewed) || reviewed > now.getTime() || now.getTime() - reviewed > 120 * 24 * 60 * 60 * 1_000) throw new Error(`Knowledge source is stale: ${item.id}`);
  }
  return structuredClone(book);
}

export function createKnowledgeBookState(): KnowledgeBookState { return { version: 1, fragmentIds: [], expansionPageIds: [], hintIds: [], assistance: 'none' }; }

export function unlockKnowledgeFragment(state: KnowledgeBookState, id: string): KnowledgeBookState {
  const fragment = ATLAS_KNOWLEDGE_BOOK.fragments.find((item) => item.id === id);
  if (!fragment || fragment.availability !== 'free-core') return structuredClone(state);
  return { ...state, fragmentIds: [...new Set([...state.fragmentIds, id])] };
}

export function gradeKnowledgeTeachBack(answerOrder: string[], answerReveal = false): { correct: boolean; completedStepIds: string[]; assistance: AtlasAssistance } {
  const expected = ATLAS_KNOWLEDGE_BOOK.teachBackOrder;
  const correct = answerOrder.length === expected.length && answerOrder.every((value, index) => value === expected[index]);
  return { correct, completedStepIds: correct ? [...expected] : [], assistance: answerReveal ? 'answer-reveal' : 'none' };
}
