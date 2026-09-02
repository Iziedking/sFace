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

/**
 * The cascade fragments were read on this date, from the blog posts, release
 * notes and forum thread cited on each one. Kept separate from REVIEWED_AT so
 * neither group of fragments claims a verification date it did not get.
 *
 * validateKnowledgeBook refuses a source older than 120 days, so this expires
 * around 2026-12-30. That is deliberate: it forces the protocol facts to be
 * re-read rather than aging quietly into folklore. Any test validating the real
 * book must pass a fixed now, or it will start failing on that date with no
 * code change.
 */
const CASCADE_REVIEWED_AT = '2026-09-01';
const official = (url: string, title: string, reviewedAt: string) => ({ url, title, reviewedAt });

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
    fragment('purpose', 'Nimiq states its purpose', 'open hand holding a coin', 'Nimiq describes itself as universal money for independent individuals, and says its apps stay free of tech jargon so that anyone can use them.', 'Nimiq says a transaction takes less energy than sending an email, and that is its claim rather than a measurement this game made.', 'Repeating a project marketing line as a measured fact teaches a player to trust a slogan instead of checking one.', 'https://www.nimiq.com/', 'Nimiq', CASCADE_REVIEWED_AT),
    fragment('micro-block', 'Micro blocks are fast', 'a single quick ferry', 'A micro block carries user transactions, and creating and sharing one can take less than a second.', 'A crossing shows up almost immediately after it is submitted.', 'Fast inclusion in a micro block is not finality, and treating it as final is the error the causeway exists to correct.', 'https://github.com/nimiq/developer-center/blob/main/learn/protocol/glossary.md', 'Nimiq protocol glossary', CASCADE_REVIEWED_AT),
    fragment('macro-block', 'Macro blocks finalize', 'a harbor gate closing', 'A macro block marks the start and end of batches and finalizes every transaction in the batch it closes.', 'The causeway counts as settled once the macro block closing its batch exists.', 'Reporting a micro block as settled skips the only step that made it final.', 'https://github.com/nimiq/developer-center/blob/main/learn/protocol/glossary.md', 'Nimiq protocol glossary', CASCADE_REVIEWED_AT),
    fragment('election-block', 'Election blocks change the validators', 'a rotating beacon', 'An election block is the macro block that ends an epoch and selects the next validator set. The other macro blocks are checkpoint blocks and provide finality only.', 'Nimiq Core v2.0.0 activated at the first election block after the readiness threshold was met.', 'Assuming the validator set is fixed forever misses the one place it is allowed to change.', 'https://github.com/nimiq/developer-center/blob/main/learn/protocol/glossary.md', 'Nimiq protocol glossary', CASCADE_REVIEWED_AT),
    fragment('slots', 'Agreement is counted in slots', 'two thirds of a ring lit', 'A macro block must be voted for by at least two thirds of all active slots, using Tendermint.', 'One validator answering is a witness. Two thirds of active slots agreeing is the network.', 'Trusting the first validator that replies mistakes a single report for an agreement.', 'https://github.com/nimiq/developer-center/blob/main/learn/protocol/glossary.md', 'Nimiq protocol glossary', CASCADE_REVIEWED_AT),
    fragment('light-proof', 'A proof can replace the chain', 'a lantern the size of a seed', 'A Nimiq light client verifies using a recursive zero-knowledge proof of the macro block header chain. Roughly 400 to 500 kB is enough, and the size does not grow as the chain grows.', 'A phone can check the chain without trusting a server and without storing the history.', 'Believing you must either trust a server or download everything is what pushes a wallet back toward a custodian.', 'https://www.nimiq.com/blog/zero-knowledge-proofs-and-nano-nodes/', 'Zero knowledge proofs and nano nodes', CASCADE_REVIEWED_AT),
    fragment('readiness', 'Signaling is not activation', 'a gauge below its mark', 'A Nimiq protocol upgrade activates once validators representing 80 percent of staked NIM have signaled readiness, at the next election block after the threshold is reached. Until then nothing on the network changes.', 'For Core v2.0.0 the window opened 2026-08-10, 88.48 percent of active slots and 87.48 percent of active stake signaled across 28 validators, and it activated 2026-08-19 after about 35 hours.', 'Reading a readiness signal as an activated upgrade is the same error as reading a transaction hash as a settled payment.', 'https://www.nimiq.com/blog/hard-fork-phase-1-is-now-open', 'Hard fork phase 1 is now open', CASCADE_REVIEWED_AT),
    fragment('release-compatibility', 'Not every release splits the chain', 'two ferries on one route', 'Some releases change consensus and some do not. Nimiq core-rs-albatross v2.1.0, released 2026-08-31, carried security fixes and stated it is backwards compatible with previous v2.X.X releases.', 'A node operator reads whether a release is consensus-breaking before deciding how urgently to update.', 'Treating every release as interchangeable can leave a node outside consensus without anyone noticing.', 'https://github.com/nimiq/core-rs-albatross/releases/tag/v2.1.0', 'core-rs-albatross v2.1.0 release notes', CASCADE_REVIEWED_AT),
    fragment('community', 'Strangers made the proof possible', 'many hands around one lantern', 'Nimiq is maintained by a foundation board and product teams, funded projects apply to a community fund, the roadmap is co-authored on the public forum, and community members contributed randomness to the zero-knowledge proof ceremony the light client depends on.', 'A phone can verify this chain in about half a megabyte because many people each contributed a secret that nobody else knows.', 'Describing an open network as the work of one company hides the people its security actually rests on.', 'https://forum.nimiq.community/t/phase-2-how-to-contribute-in-the-nimiq-zero-knowledge-proof-ceremony/2044', 'Nimiq zero-knowledge proof ceremony, phase 2', CASCADE_REVIEWED_AT),
  ],
};

/**
 * The review date defaults to the book's own date so the ten original
 * fragments keep saying, truthfully, when they were last checked. A fragment
 * added later passes its own date instead. Bumping the shared constant would
 * have been one character and would have claimed every existing fragment was
 * re-verified on a day nobody looked at it.
 */
function fragment(id: string, title: string, visualCue: string, summary: string, example: string, failure: string, url: string, sourceTitle: string, reviewedAt: string = REVIEWED_AT): KnowledgeFragment {
  return { id, title, visualCue, summary, example, failure, supersedes: null, availability: 'free-core', source: official(url, sourceTitle, reviewedAt) };
}

/**
 * The hosts a lesson is allowed to cite.
 *
 * The list is closed rather than open because a curriculum that can cite any
 * URL can be made to teach anything, and this product's entire claim is about
 * evidence. It was originally nimiq.dev only, which was right until the
 * curriculum grew past the Mini App docs: the protocol and community lessons
 * are sourced from the blog, the release notes and the forum, and none of
 * those live on nimiq.dev.
 *
 * GitHub is narrowed to the nimiq organisation, because "it is on GitHub" is
 * not provenance. Anyone can publish a repository that looks official.
 */
const ALLOWED_SOURCE_HOSTS = new Set(['nimiq.dev', 'www.nimiq.dev', 'nimiq.com', 'www.nimiq.com', 'forum.nimiq.community']);

function isAllowedSourceUrl(value: string): boolean {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname === 'github.com') return parsed.pathname.startsWith('/nimiq/');
  return ALLOWED_SOURCE_HOSTS.has(parsed.hostname);
}

const sourceSchema = z.object({ url: z.string().url().refine(isAllowedSourceUrl), title: z.string().min(2).max(120), reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const fragmentSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(3).max(100), visualCue: z.string().min(3).max(100), summary: z.string().min(10).max(300), example: z.string().min(10).max(300), failure: z.string().min(10).max(300), supersedes: z.string().regex(/^[a-z0-9-]+$/).nullable(), availability: z.enum(['free-core', 'purchased-expansion']), source: sourceSchema }).strict();
const bookSchema = z.object({ version: z.literal(1), reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fragments: z.array(fragmentSchema).min(8), teachBackOrder: z.tuple([z.literal('ask'), z.literal('check'), z.literal('approve'), z.literal('confirm'), z.literal('unlock')]) }).strict();

export function validateKnowledgeBook(value: unknown, now = new Date()): KnowledgeBook {
  const book = bookSchema.parse(value) as KnowledgeBook;
  const ids = new Set(book.fragments.map((item) => item.id));
  if (ids.size !== book.fragments.length) throw new Error('Knowledge fragment ids must be unique.');
  for (const item of book.fragments) {
    if (item.supersedes && (!ids.has(item.supersedes) || item.supersedes === item.id)) throw new Error(`Knowledge fragment supersedes an unknown or itself: ${item.id}`);
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

export function referenceKnowledgeFragment(state: KnowledgeBookState, id: string): { fragment: KnowledgeFragment; assistance: 'none' } | null {
  const fragment = ATLAS_KNOWLEDGE_BOOK.fragments.find((item) => item.id === id);
  if (!fragment || !state.fragmentIds.includes(id)) return null;
  return { fragment: structuredClone(fragment), assistance: 'none' };
}

export function gradeKnowledgeTeachBack(answerOrder: string[], answerReveal = false): { correct: boolean; completedStepIds: string[]; assistance: AtlasAssistance } {
  const expected = ATLAS_KNOWLEDGE_BOOK.teachBackOrder;
  const correct = answerOrder.length === expected.length && answerOrder.every((value, index) => value === expected[index]);
  return { correct, completedStepIds: correct ? [...expected] : [], assistance: answerReveal ? 'answer-reveal' : 'none' };
}
