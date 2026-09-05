// The local app and contract verification tests consume these rules. These
// practice records are not server-verified runs or financial entitlements.
export const HARBOR_CONTRACT_KINDS = ['market', 'ferry', 'workshop'] as const;
export type HarborContractKind = typeof HARBOR_CONTRACT_KINDS[number];

export interface HarborContract {
  readonly id: string;
  readonly day: string;
  readonly kind: HarborContractKind;
  readonly title: string;
  readonly cargo: string;
  readonly pickup: string;
  readonly delivery: string;
  readonly need: string;
  readonly question: string;
  readonly choices: readonly { id: string; label: string }[];
  readonly answer: string;
  readonly retry: string;
  readonly outcome: string;
}

export interface HarborContractRun {
  readonly day: string;
  readonly kind: HarborContractKind;
  readonly step: 0 | 1 | 2;
  readonly mistakes: number;
}

export interface HarborContractRecord {
  readonly id: string;
  readonly stars: number;
}

export interface HarborContractProgress {
  readonly version: 1;
  readonly opened: boolean;
  readonly active: HarborContractRun | null;
  readonly records: readonly HarborContractRecord[];
  readonly stocked: readonly HarborContractKind[];
}

export const HARBOR_REVIEW_ANCHOR = 'payment-review';
export const HARBOR_BOARD_ANCHOR = 'mara-harbor-keeper';
const MAX_RECORDS = 84;

export function emptyHarborContracts(): HarborContractProgress {
  return { version: 1, opened: false, active: null, records: [], stocked: [] };
}

export function harborContractsForDay(day: string): readonly HarborContract[] {
  assertDay(day);
  const seed = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const valueLuna = [10_000, 20_000, 50_000][((seed % 3) + 3) % 3]!;
  const variants: Omit<HarborContract, 'id' | 'day' | 'kind'>[] = [
    {
      title: 'Keep the bakery stocked', cargo: 'flour parcel', pickup: 'relay-pickup', delivery: 'conversation-market',
      need: 'The baker has customers waiting. Collect the flour parcel and check the practice order before delivering it.',
      question: `The baker ordered ${valueLuna / 100_000} NIM of flour. The payment form uses Lunas. Which amount matches the order?`,
      choices: [{ id: 'exact', label: `${valueLuna.toLocaleString('en-US')} Lunas` }, { id: 'extra', label: `${(valueLuna * 10).toLocaleString('en-US')} Lunas` }],
      answer: 'exact', retry: `One NIM is 100,000 Lunas. This order needs ${valueLuna.toLocaleString('en-US')} Lunas. The larger amount would overpay.`,
      outcome: 'Flour delivered. The baker can keep serving the night market.',
    },
    {
      title: 'Check the ferry receipt', cargo: 'receipt folder', pickup: 'ferry-boarding', delivery: 'relay-pickup',
      need: 'A ferry delivery has a payment reference but no confirmation yet. Collect its paperwork and check it at the desk.',
      question: 'This practice receipt has a transaction hash, but payment is still unconfirmed. Should the merchant release the parcel?',
      choices: [{ id: 'release', label: 'Release it: a hash is enough' }, { id: 'wait', label: 'Wait for matching confirmed payment' }],
      answer: 'wait', retry: 'A hash helps find a transaction. It does not by itself show that this order was paid. Check confirmation before releasing goods.',
      outcome: 'Receipt checked. You caught the missing confirmation before a parcel could be released too early.',
    },
    {
      title: 'Deliver the workshop order', cargo: 'tool parcel', pickup: 'builder-workbench', delivery: 'lantern-counter',
      need: 'The lantern keeper needs a tool parcel. Pick it up at the workshop, then compare the payment recipient with the order.',
      question: 'The practice order names the lantern shop. The payment request names the workshop instead. What should you do?',
      choices: [{ id: 'send', label: 'Approve it: both are in the harbor' }, { id: 'correct', label: 'Get the correct recipient before approving' }],
      answer: 'correct', retry: 'Being in the same town does not make two recipients interchangeable. Match the intended recipient before approving.',
      outcome: 'Tools delivered. The lantern keeper can maintain the market lights.',
    },
  ];
  return HARBOR_CONTRACT_KINDS.map((kind, index) => {
    const variant = variants[index]!;
    // The date changes board order and choice order without changing fairness
    // between players using the same local practice contract.
    const choices = seed % 2 === 0 ? variant.choices : [...variant.choices].reverse();
    return { ...variant, choices, id: `${day}:${kind}`, day, kind };
  }).sort((a, b) => ((HARBOR_CONTRACT_KINDS.indexOf(a.kind) + seed) % 3) - ((HARBOR_CONTRACT_KINDS.indexOf(b.kind) + seed) % 3));
}

export function activeHarborContract(progress: HarborContractProgress): HarborContract | null {
  const run = progress.active;
  return run ? harborContractsForDay(run.day).find((contract) => contract.kind === run.kind)! : null;
}

export function harborContractTarget(progress: HarborContractProgress): string {
  const contract = activeHarborContract(progress);
  if (!contract || !progress.active) return HARBOR_BOARD_ANCHOR;
  return progress.active.step === 0 ? contract.pickup : progress.active.step === 1 ? HARBOR_REVIEW_ANCHOR : contract.delivery;
}

export function startHarborContract(progress: HarborContractProgress, day: string, kind: HarborContractKind): HarborContractProgress {
  if (!progress.opened) throw new Error('Light the harbor tower before taking a contract.');
  if (progress.active) throw new Error('Finish or put aside your current contract first.');
  if (!harborContractsForDay(day).some((contract) => contract.kind === kind)) throw new Error('Unknown harbor contract.');
  return { ...progress, active: { day, kind, step: 0, mistakes: 0 } };
}

export function advanceHarborContract(progress: HarborContractProgress, anchorId: string, choiceId?: string): HarborContractProgress {
  const run = progress.active;
  const contract = activeHarborContract(progress);
  if (!run || !contract) throw new Error('No harbor contract is active.');
  if (anchorId !== harborContractTarget(progress)) throw new Error('Reach the marked contract stop first.');
  if (run.step === 1) {
    if (!contract.choices.some((choice) => choice.id === choiceId)) throw new Error('Choose how to handle this order.');
    if (choiceId !== contract.answer) return { ...progress, active: { ...run, mistakes: Math.min(999, run.mistakes + 1) } };
    return { ...progress, active: { ...run, step: 2 } };
  }
  if (choiceId !== undefined) throw new Error('This stop does not ask for a decision.');
  if (run.step === 0) return { ...progress, active: { ...run, step: 1 } };
  const stars = harborContractStars(run.mistakes);
  const previous = progress.records.find((record) => record.id === contract.id);
  const records = [
    ...progress.records.filter((record) => record.id !== contract.id),
    { id: contract.id, stars: Math.max(stars, previous?.stars ?? 0) },
  ].sort((a, b) => b.id.localeCompare(a.id)).slice(0, MAX_RECORDS);
  return { ...progress, active: null, records, stocked: [...new Set([...progress.stocked, contract.kind])] };
}

export function harborContractStars(mistakes: number): number {
  return Math.max(1, 3 - mistakes);
}

export function restoreHarborContracts(value: unknown): HarborContractProgress {
  if (!isRecord(value) || value.version !== 1 || typeof value.opened !== 'boolean'
    || !Array.isArray(value.records) || value.records.length > MAX_RECORDS
    || !Array.isArray(value.stocked) || value.stocked.length > 3) throw new Error('Harbor save is invalid.');
  const records: HarborContractRecord[] = value.records.map((record: unknown) => {
    if (!isRecord(record) || typeof record.id !== 'string' || !Number.isInteger(record.stars)
      || Number(record.stars) < 1 || Number(record.stars) > 3) throw new Error('Harbor result is invalid.');
    const [day, kind, extra] = record.id.split(':');
    assertDay(day ?? '');
    if (!isKind(kind) || extra !== undefined) throw new Error('Harbor result id is invalid.');
    return { id: record.id, stars: Number(record.stars) };
  });
  const stocked: HarborContractKind[] = value.stocked.map((kind: unknown) => {
    if (!isKind(kind)) throw new Error('Harbor supply marker is invalid.');
    return kind;
  });
  if (new Set(records.map((r) => r.id)).size !== records.length || new Set(stocked).size !== stocked.length) throw new Error('Harbor save contains duplicate results.');
  let active: HarborContractRun | null = null;
  if (value.active !== null) {
    const run = value.active;
    if (!isRecord(run) || typeof run.day !== 'string' || !isKind(run.kind)
      || (run.step !== 0 && run.step !== 1 && run.step !== 2)
      || !Number.isInteger(run.mistakes) || Number(run.mistakes) < 0 || Number(run.mistakes) > 999) throw new Error('Harbor contract save is invalid.');
    assertDay(run.day);
    active = { day: run.day, kind: run.kind, step: run.step, mistakes: Number(run.mistakes) };
  }
  if (!value.opened && (active || records.length || stocked.length)) throw new Error('Closed harbor cannot contain contracts.');
  return { version: 1, opened: value.opened, active, records, stocked };
}

function assertDay(day: string): void {
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== day) throw new Error('Harbor contract date is invalid.');
}

function isKind(value: unknown): value is HarborContractKind {
  return value === 'market' || value === 'ferry' || value === 'workshop';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
