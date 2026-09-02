import type { AtlasPassportProof } from '../../../shared/atlas/types';

export interface AtlasPassportView {
  version: 1;
  maskedWallet: string | null;
  districtSeals: readonly AtlasPassportProof['districtSeals'][number][];
  recipeIds: readonly string[];
  verifiedExpeditionCount: number;
}

export function createAtlasPassportView(proof: AtlasPassportProof | null): AtlasPassportView {
  return {
    version: 1,
    maskedWallet: proof ? maskWallet(proof.maskedAddress) : null,
    districtSeals: proof ? [...proof.districtSeals] : [],
    recipeIds: proof ? [...proof.recipeIds] : [],
    verifiedExpeditionCount: proof ? proof.expeditionRunIds.length : 0,
  };
}

function maskWallet(address: string): string {
  if (address.length <= 8) return '••••';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
