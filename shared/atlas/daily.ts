import { z } from 'zod';

export type DailyTheme = 'money' | 'permission' | 'evidence' | 'network';
export type DailyGuard = 'none' | 'payment' | 'consensus' | 'validator-distribution';

export interface AtlasDailyChallenge {
  id: string;
  day: number;
  theme: DailyTheme;
  title: string;
  prompt: string;
  answer: string;
  lessonFragmentIds: string[];
  guard: DailyGuard;
  source: { url: string; title: string; reviewedAt: string };
}

const REVIEWED_AT = '2026-08-25';
const provider = { url: 'https://nimiq.dev/mini-apps/api-reference/nimiq-provider', title: 'Nimiq Provider API', reviewedAt: REVIEWED_AT };
const miniApps = { url: 'https://nimiq.dev/mini-apps/', title: 'Nimiq Mini Apps', reviewedAt: REVIEWED_AT };
const transactions = { url: 'https://nimiq.dev/learn/transactions', title: 'Nimiq transactions', reviewedAt: REVIEWED_AT };
const protocol = { url: 'https://nimiq.dev/protocol/', title: 'Nimiq proof-of-stake protocol', reviewedAt: REVIEWED_AT };

function challenge(day: number, theme: DailyTheme, title: string, prompt: string, answer: string, lessonFragmentIds: string[], guard: DailyGuard, source: AtlasDailyChallenge['source']): AtlasDailyChallenge {
  return { id: `daily-${String(day).padStart(2, '0')}`, day, theme, title, prompt, answer, lessonFragmentIds, guard, source };
}

export const ATLAS_DAILY_CHALLENGES: AtlasDailyChallenge[] = [
  challenge(1, 'money', 'Lantern units', 'Convert 12 NIM into Lunas.', '1200000', ['nim', 'luna'], 'none', provider),
  challenge(2, 'permission', 'Quiet boot', 'Which action should wait for player intent?', 'accounts', ['ask'], 'none', miniApps),
  challenge(3, 'evidence', 'Hash is a clue', 'What does a provider transaction result represent first?', 'lookup', ['transaction'], 'none', provider),
  challenge(4, 'network', 'Fresh canopy', 'What does an established consensus reading tell you?', 'usable-view', ['confirm'], 'none', protocol),
  challenge(5, 'money', 'Exact harbor request', 'Which Luna amount belongs in the 1 NIM lantern request?', '100000', ['luna', 'check'], 'payment', provider),
  challenge(6, 'permission', 'Consent line', 'Who decides whether a wallet action is approved?', 'player', ['approve', 'custody'], 'none', provider),
  challenge(7, 'evidence', 'Sender check', 'Which evidence field catches a payer substitution?', 'sender', ['check', 'confirm'], 'none', transactions),
  challenge(8, 'network', 'Height is not payment', 'What can a block height order?', 'network-view', ['transaction'], 'none', provider),
  challenge(9, 'network', 'Canopy reading', 'What should happen when consensus evidence is stale?', 'retry', ['confirm'], 'consensus', protocol),
  challenge(10, 'money', 'No rounding', 'How should a Luna amount be represented?', 'integer', ['luna'], 'none', provider),
  challenge(11, 'permission', 'Address request', 'When should account access be requested?', 'intent', ['ask', 'custody'], 'none', miniApps),
  challenge(12, 'evidence', 'Canonical route', 'Which word means the observed transaction belongs to the canonical chain?', 'canonical', ['confirm'], 'none', transactions),
  challenge(13, 'network', 'Validator horizon', 'What is safer for a network health view?', 'distributed', ['confirm'], 'validator-distribution', protocol),
  challenge(14, 'money', 'Recipient compass', 'What must match before payment approval?', 'recipient', ['address', 'check'], 'none', provider),
  challenge(15, 'permission', 'Key custody', 'Where should the private key remain?', 'wallet', ['custody'], 'none', miniApps),
  challenge(16, 'evidence', 'Success flag', 'What does a successful provider reply still need?', 'confirmation', ['approve', 'confirm'], 'none', transactions),
  challenge(17, 'network', 'Validator variety', 'Why observe more than one validator?', 'security', ['confirm'], 'validator-distribution', protocol),
  challenge(18, 'money', 'Safe multiplication', 'What prevents decimal drift in a payment?', 'integer-arithmetic', ['luna'], 'none', provider),
  challenge(19, 'permission', 'Read before ask', 'Which provider capability can be read without spending?', 'consensus', ['ask'], 'none', provider),
  challenge(20, 'evidence', 'Unknown is honest', 'What should a missing RPC observation become?', 'unknown', ['transaction', 'confirm'], 'none', transactions),
  challenge(21, 'network', 'Consensus pause', 'What is the honest response to an unavailable network view?', 'local-practice', ['ask', 'confirm'], 'consensus', protocol),
  challenge(22, 'money', 'One item', 'How many lanterns can one verified order fulfill?', 'one', ['unlock'], 'none', provider),
  challenge(23, 'permission', 'Explicit approval', 'What is a wallet approval?', 'consent', ['approve'], 'none', miniApps),
  challenge(24, 'evidence', 'Value match', 'Which field prevents an underpayment from fulfilling?', 'value', ['check', 'confirm'], 'none', transactions),
  challenge(25, 'network', 'Distribution signal', 'What does validator concentration represent?', 'risk-signal', ['confirm'], 'validator-distribution', protocol),
  challenge(26, 'money', 'NIM language', 'Which unit is the native currency name?', 'nim', ['nim'], 'none', provider),
  challenge(27, 'permission', 'Device is not identity', 'What can a device identifier be used for?', 'rate-limit', ['custody'], 'none', miniApps),
  challenge(28, 'evidence', 'Unlock after proof', 'What changes the harbor world?', 'verified-evidence', ['confirm', 'unlock'], 'none', transactions),
];

const sourceSchema = z.object({ url: z.string().url().refine((url) => { const parsed = new URL(url); return parsed.protocol === 'https:' && (parsed.hostname === 'nimiq.dev' || parsed.hostname === 'www.nimiq.dev'); }), title: z.string().min(3).max(120), reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const challengeSchema = z.object({ id: z.string().regex(/^daily-\d{2}$/), day: z.number().int().min(1).max(28), theme: z.enum(['money', 'permission', 'evidence', 'network']), title: z.string().min(3).max(100), prompt: z.string().min(10).max(240), answer: z.string().min(1).max(80), lessonFragmentIds: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1).max(6), guard: z.enum(['none', 'payment', 'consensus', 'validator-distribution']), source: sourceSchema }).strict();

export function validateDailyManifest(value: unknown, now = new Date()): AtlasDailyChallenge[] {
  const parsed = z.array(challengeSchema).length(28).parse(value) as AtlasDailyChallenge[];
  if (new Set(parsed.map((item) => item.id)).size !== 28 || parsed.some((item, index) => item.day !== index + 1)) throw new Error('Daily challenge ids and days must be unique and ordered.');
  for (const item of parsed) {
    const reviewed = Date.parse(`${item.source.reviewedAt}T00:00:00.000Z`);
    if (!Number.isFinite(reviewed) || reviewed > now.getTime() || now.getTime() - reviewed > 120 * 24 * 60 * 60 * 1_000) throw new Error(`Daily source is stale: ${item.id}`);
  }
  return structuredClone(parsed);
}
