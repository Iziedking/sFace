export type AtlasPaymentConfigReason = 'disabled' | 'missing-recipient' | 'fixture-recipient' | 'invalid-recipient' | 'invalid-amount';

export interface AtlasTestnetPaymentConfig {
  enabled: boolean;
  reason: AtlasPaymentConfigReason | null;
  network: 'testalbatross';
  recipient: string | null;
  valueLuna: number;
  itemId: 'harbor-lantern';
  minimumConfirmations: 3;
}

export function createAtlasTestnetPaymentConfig(input: { enabled: boolean; recipient?: string; valueLuna?: string | number; minimumConfirmations?: number }): AtlasTestnetPaymentConfig {
  const recipient = normalizeRecipient(input.recipient ?? '');
  const valueLuna = parseLuna(input.valueLuna ?? '');
  const base = { network: 'testalbatross' as const, recipient: recipient || null, valueLuna: valueLuna ?? 0, itemId: 'harbor-lantern' as const, minimumConfirmations: 3 as const };
  if (!input.enabled) return { ...base, enabled: false, reason: 'disabled' };
  if (!recipient) return { ...base, enabled: false, reason: 'missing-recipient' };
  if (isFixtureRecipient(recipient)) return { ...base, enabled: false, reason: 'fixture-recipient' };
  if (!isNimiqAddress(recipient)) return { ...base, enabled: false, reason: 'invalid-recipient' };
  if (valueLuna === null) return { ...base, enabled: false, reason: 'invalid-amount' };
  return { ...base, enabled: true, reason: null, valueLuna };
}

export function normalizeAtlasRecipient(value: string): string {
  return normalizeRecipient(value);
}

function normalizeRecipient(value: string): string { return value.replace(/\s/g, '').toUpperCase(); }
function isFixtureRecipient(value: string): boolean { return value === 'NQATLASLANTERNSHOP' || value === 'LOCAL_FIXTURE_RECIPIENT'; }
function isNimiqAddress(value: string): boolean { return /^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(value); }
function parseLuna(value: string | number): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
