import { emptyHarborContracts, restoreHarborContracts, type HarborContractProgress } from '../../shared/atlas/harbor-contracts';

export const HARBOR_CONTRACT_STORAGE_KEY = 'sface-harbor-contracts-v1';
interface HarborStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createHarborContractStore(storage: HarborStorage) {
  let current = emptyHarborContracts();
  let notice = '';
  try {
    const raw = storage.getItem(HARBOR_CONTRACT_STORAGE_KEY);
    if (raw !== null) {
      if (raw.length > 32_000) throw new Error('Harbor save is too large.');
      current = restoreHarborContracts(JSON.parse(raw));
    }
  } catch {
    notice = 'Your harbor save could not be loaded. This session starts with a fresh contract board.';
  }
  return {
    snapshot: (): HarborContractProgress => structuredClone(current),
    notice: (): string => notice,
    save(next: HarborContractProgress): void {
      current = restoreHarborContracts(next);
      try {
        storage.setItem(HARBOR_CONTRACT_STORAGE_KEY, JSON.stringify(current));
        notice = '';
      } catch {
        notice = 'Storage is unavailable. Your contract progress lasts for this session only.';
      }
    },
  };
}
