export type AtlasDistrictId =
  | 'genesis-garden'
  | 'light-forest'
  | 'pay-harbor'
  | 'albatross-causeway'
  | 'validator-peaks'
  | 'builder-city'
  | 'beacon-core';

export type AtlasRole = 'explorer' | 'builder';
export type AtlasNetwork = 'testalbatross' | 'mainalbatross';
export type AtlasAssistance = 'none' | 'free-hint' | 'purchased-hint' | 'answer-reveal' | 'debug';
export type AtlasManifestKind = 'campaign' | 'adventure' | 'knowledge' | 'season' | 'shop';

export type AtlasTool = 'scanner' | 'relay-tether' | 'shield-pulse';
export type AtlasCapability = 'local' | 'provider-read' | 'wallet-sign' | 'server-read' | 'testnet-send' | 'mainnet-send';
export type AtlasOperation =
  | 'nim-luna-convert'
  | 'validate-address'
  | 'provider-init'
  | 'consensus-status'
  | 'block-number'
  | 'list-accounts'
  | 'sign-challenge'
  | 'prepare-basic-payment'
  | 'inspect-transaction-receipt'
  | 'explain-confirmations'
  | 'inspect-validator'
  | 'prepare-delegation'
  | 'send-testnet-payment'
  | 'send-mainnet-payment'
  | 'map-provider-capabilities'
  | 'compose-mini-app-flow'
  | 'install-beacon-component';

export interface AtlasSource {
  url: string;
  title: string;
  reviewedAt: string;
}

export interface AtlasRecipe {
  language: 'typescript';
  code: string;
}

export interface AtlasTrial {
  id: string;
  title: string;
  objective: string;
  operation: AtlasOperation;
  capability: AtlasCapability;
  enabled: boolean;
  ownerGate: boolean;
  source: AtlasSource;
  acceptedObservation: string;
  explanation: string;
  recipe: AtlasRecipe;
}

export interface AtlasEncounter {
  id: string;
  title: string;
  objective: string;
  tool: AtlasTool;
  knowledge: string;
}

export interface AtlasDistrict {
  id: AtlasDistrictId;
  title: string;
  summary: string;
  accent: string;
  encounters: AtlasEncounter[];
  trials: AtlasTrial[];
}

export interface AtlasFinale {
  id: 'beacon-core';
  title: string;
  summary: string;
  requiredDistricts: AtlasDistrictId[];
  encounters: AtlasEncounter[];
  trials: AtlasTrial[];
}

export interface AtlasExpeditionDefinition {
  id: string;
  title: string;
  districtIds: AtlasDistrictId[];
  lessonTrialIds: string[];
  ruleset: 'atlas-expedition-1';
}

export interface AtlasPlayerProgressV2 {
  version: 2;
  activeRole: AtlasRole;
  completedAdventureIds: string[];
  completedTrialIds: string[];
  knowledgeFragmentIds: string[];
  expansionPageIds: string[];
  inventoryItemIds: string[];
  assistance: AtlasAssistance[];
  mastery: number;
}

export interface AtlasPublishedManifest<T> {
  kind: AtlasManifestKind;
  version: number;
  contentHash: string;
  reviewedAt: string;
  supersedes?: string;
  content: T;
}

export interface AtlasCompetitiveTicket {
  ticketId: string;
  actorId: string;
  walletAddress: string;
  role: AtlasRole;
  seasonId: string;
  challengeId: string;
  seed: string;
  campaignHash: string;
  curriculumHash: string;
  rulesetHash: string;
  expiresAt: number;
}

export interface AtlasCurriculum {
  version: 1;
  reviewedAt: string;
  districts: AtlasDistrict[];
  finale: AtlasFinale;
  expeditions: AtlasExpeditionDefinition[];
}

export interface AtlasPassportProof {
  actorId: string;
  maskedAddress: string;
  districtSeals: AtlasDistrictId[];
  verifiedTrialIds: string[];
  recipeIds: string[];
  expeditionRunIds: string[];
  updatedAt: number;
}

export interface AtlasBeaconSystem {
  districtId: AtlasDistrictId;
  repairTotal: number;
  target: number;
  stage: number;
}

export interface AtlasBeaconSnapshot {
  version: 1;
  projectionVersion: number;
  systems: AtlasBeaconSystem[];
  verifiedContributorCount: number;
  lastUpdatedAt: number;
}
