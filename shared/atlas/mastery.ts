import type { AtlasAssistance } from './types';
import type { AtlasEventType, AtlasSnapshot } from './state';

export const ATLAS_MASTERY_MAX = Object.freeze({
  knowledge: 4_000,
  execution: 3_000,
  safety: 1_500,
  efficiency: 1_500,
  total: 10_000,
});

export interface AtlasMasteryDefinition {
  requiredKnowledgeEvents: readonly AtlasEventType[];
  completionEvent: AtlasEventType;
  optimalTicks: number;
}

export const ATLAS_MASTERY_DEFAULT_DEFINITION: AtlasMasteryDefinition = Object.freeze({
  requiredKnowledgeEvents: ['relay-scanned', 'relay-connected', 'rescued', 'gate-opened'] as const,
  completionEvent: 'district-completed' as const,
  optimalTicks: 30,
});

export interface AtlasMasteryBreakdown {
  knowledge: number;
  execution: number;
  safety: number;
  efficiency: number;
  total: number;
}

export function calculateAtlasMastery(snapshot: AtlasSnapshot, definition: AtlasMasteryDefinition): AtlasMasteryBreakdown {
  assertDefinition(definition);
  const eventTypes = new Set(snapshot.events.map((event) => event.type));
  const required = new Set(definition.requiredKnowledgeEvents);
  const known = [...required].filter((event) => eventTypes.has(event)).length;
  const knowledge = Math.floor(ATLAS_MASTERY_MAX.knowledge * known / Math.max(1, required.size));
  const execution = snapshot.phase === 'completed' && eventTypes.has(definition.completionEvent) ? ATLAS_MASTERY_MAX.execution : 0;
  const faultHits = snapshot.events.filter((event) => event.type === 'fault-hit').length;
  const safety = Math.max(0, ATLAS_MASTERY_MAX.safety - faultHits * 500);
  const ticks = Math.max(0, snapshot.tick);
  const efficiency = Math.min(ATLAS_MASTERY_MAX.efficiency, Math.floor(ATLAS_MASTERY_MAX.efficiency * definition.optimalTicks / Math.max(definition.optimalTicks, ticks)));
  const total = Math.min(ATLAS_MASTERY_MAX.total, knowledge + execution + safety + efficiency);
  return { knowledge, execution, safety, efficiency, total };
}

export function isAtlasMasteryPrizeEligible(assistance: AtlasAssistance): boolean {
  return assistance === 'none';
}

function assertDefinition(definition: AtlasMasteryDefinition): void {
  if (!Number.isSafeInteger(definition.optimalTicks) || definition.optimalTicks <= 0) throw new Error('Atlas mastery optimal ticks are invalid.');
  if (definition.requiredKnowledgeEvents.length === 0 || new Set(definition.requiredKnowledgeEvents).size !== definition.requiredKnowledgeEvents.length) throw new Error('Atlas mastery knowledge events are invalid.');
}
