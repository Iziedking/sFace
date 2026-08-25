import type { AtlasAssistance, AtlasCompetitiveTicket, AtlasPlayerProgressV2, AtlasRole } from './types';

const VALID_ASSISTANCE = new Set<AtlasAssistance>(['none', 'free-hint', 'purchased-hint', 'answer-reveal', 'debug']);

export function createAtlasPlayerProgress(): AtlasPlayerProgressV2 {
  return {
    version: 2,
    activeRole: 'explorer',
    completedAdventureIds: [],
    completedTrialIds: [],
    knowledgeFragmentIds: [],
    expansionPageIds: [],
    inventoryItemIds: [],
    assistance: [],
    mastery: 0,
  };
}

export function switchAtlasRole(progress: AtlasPlayerProgressV2, role: AtlasRole): AtlasPlayerProgressV2 {
  return { ...progress, activeRole: role };
}

export function addAtlasAssistance(progress: AtlasPlayerProgressV2, assistance: Exclude<AtlasAssistance, 'none'>): AtlasPlayerProgressV2 {
  return { ...progress, assistance: [...new Set([...progress.assistance, assistance])] };
}

export function isAtlasPrizeEligible(progress: AtlasPlayerProgressV2): boolean {
  return progress.assistance.length === 0 || progress.assistance.every((item) => item === 'none' || item === 'free-hint');
}

export function pinAtlasCompetitiveTicket(
  ticket: Omit<AtlasCompetitiveTicket, 'campaignHash' | 'curriculumHash' | 'rulesetHash'>,
  hashes: Pick<AtlasCompetitiveTicket, 'campaignHash' | 'curriculumHash' | 'rulesetHash'>,
): AtlasCompetitiveTicket {
  for (const hash of Object.values(hashes)) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Competitive ticket content hash is invalid.');
  }
  return { ...ticket, ...hashes };
}

export function migrateAtlasPlayerProgress(value: unknown): AtlasPlayerProgressV2 {
  if (!isRecord(value) || typeof value.version !== 'number') throw new Error('Atlas progress version is missing.');
  if (value.version === 1) {
    return {
      ...createAtlasPlayerProgress(),
      completedAdventureIds: uniqueStrings(value.completedDistricts),
      completedTrialIds: uniqueStrings(value.completedTrials),
    };
  }
  if (value.version !== 2) throw new Error(`Unknown Atlas progress version: ${value.version}.`);
  return {
    version: 2,
    activeRole: value.activeRole === 'builder' ? 'builder' : 'explorer',
    completedAdventureIds: uniqueStrings(value.completedAdventureIds),
    completedTrialIds: uniqueStrings(value.completedTrialIds),
    knowledgeFragmentIds: uniqueStrings(value.knowledgeFragmentIds),
    expansionPageIds: uniqueStrings(value.expansionPageIds),
    inventoryItemIds: uniqueStrings(value.inventoryItemIds),
    assistance: uniqueStrings(value.assistance).filter((item): item is AtlasAssistance => VALID_ASSISTANCE.has(item as AtlasAssistance)),
    mastery: typeof value.mastery === 'number' && Number.isFinite(value.mastery) ? Math.max(0, Math.floor(value.mastery)) : 0,
  };
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && /^[a-z0-9-]{1,80}$/.test(item)))] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
