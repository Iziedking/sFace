import type { AtlasQualityTier } from './types';
import { QUALITY_PROFILES } from './quality';

export type AtlasCitizenRole =
  | 'nimiq-team-guide'
  | 'nimiq-team-builder'
  | 'community-explorer'
  | 'community-merchant'
  | 'community-repairer'
  | 'community-traveller';

export type AtlasCitizenActivity = 'walking' | 'jogging' | 'talking' | 'queueing' | 'trading' | 'repairing' | 'carrying' | 'planning' | 'celebrating';
export type AtlasRestorationReaction = 'neutral' | 'watching' | 'helping' | 'celebrating';

export interface AtlasCitizenDefinition {
  readonly id: string;
  readonly role: AtlasCitizenRole;
  readonly spawnAnchorId: string;
  readonly pathIds: readonly string[];
  readonly conversationPairId?: string;
  readonly missionCritical?: boolean;
}

export interface AtlasCitizenPresentation {
  readonly id: string;
  readonly role: AtlasCitizenRole;
  readonly visible: boolean;
  readonly active: boolean;
  readonly pathId: string;
  readonly activity: AtlasCitizenActivity;
  readonly conversationPartnerId?: string;
  readonly animationPhase: number;
  readonly restorationReaction: AtlasRestorationReaction;
  readonly updateIntervalTicks: 1 | 6 | 30;
}

export const CROWD_UPDATE_INTERVALS = {
  near: 1,
  medium: 6,
  far: 30,
} as const;

export const BEACON_COMMONS_CROWD: readonly AtlasCitizenDefinition[] = [
  { id: 'guide', role: 'nimiq-team-guide', spawnAnchorId: 'npc-spawn-01', pathIds: ['walk-main-street', 'conversation-loop'], conversationPairId: 'guide-market', missionCritical: true },
  { id: 'merchant1', role: 'community-merchant', spawnAnchorId: 'npc-spawn-02', pathIds: ['queue-market'], conversationPairId: 'guide-market' },
  { id: 'customer2', role: 'community-explorer', spawnAnchorId: 'npc-spawn-03', pathIds: ['queue-market'], conversationPairId: 'guide-market' },
  { id: 'customer3', role: 'community-explorer', spawnAnchorId: 'npc-spawn-04', pathIds: ['queue-market'] },
  { id: 'customer4', role: 'community-traveller', spawnAnchorId: 'npc-spawn-05', pathIds: ['walk-main-street'] },
  { id: 'builder5', role: 'nimiq-team-builder', spawnAnchorId: 'npc-spawn-06', pathIds: ['queue-builder-yard'], conversationPairId: 'builder-yard', missionCritical: true },
  { id: 'builder6', role: 'community-repairer', spawnAnchorId: 'npc-spawn-07', pathIds: ['queue-builder-yard'], conversationPairId: 'builder-yard' },
  { id: 'carrier7', role: 'community-traveller', spawnAnchorId: 'npc-spawn-08', pathIds: ['walk-main-street'] },
  { id: 'carrier8', role: 'community-explorer', spawnAnchorId: 'npc-spawn-09', pathIds: ['walk-main-street'] },
  { id: 'team9', role: 'nimiq-team-guide', spawnAnchorId: 'npc-spawn-10', pathIds: ['conversation-loop'], conversationPairId: 'team-pavilion' },
  { id: 'team10', role: 'nimiq-team-builder', spawnAnchorId: 'npc-spawn-11', pathIds: ['conversation-loop'], conversationPairId: 'team-pavilion' },
  { id: 'team11', role: 'community-repairer', spawnAnchorId: 'npc-spawn-12', pathIds: ['conversation-loop'] },
  { id: 'traveller12', role: 'community-traveller', spawnAnchorId: 'npc-spawn-01', pathIds: ['walk-main-street'] },
  { id: 'traveller13', role: 'community-traveller', spawnAnchorId: 'npc-spawn-02', pathIds: ['walk-main-street', 'walk-outer-ring'] },
  { id: 'walker14', role: 'community-explorer', spawnAnchorId: 'npc-spawn-03', pathIds: ['conversation-loop'] },
  { id: 'walker15', role: 'community-explorer', spawnAnchorId: 'npc-spawn-04', pathIds: ['walk-main-street', 'walk-outer-ring'] },
  { id: 'builder16', role: 'community-repairer', spawnAnchorId: 'npc-spawn-06', pathIds: ['queue-builder-yard', 'walk-outer-ring'] },
];

export interface AtlasCrowdScheduleInput {
  readonly districtId: string;
  readonly daySeed: string;
  readonly restorationState: 'waiting' | 'confirming' | 'restored';
  readonly qualityTier: AtlasQualityTier;
  readonly tick: number;
}

export function scheduleCrowd(input: AtlasCrowdScheduleInput, roster: readonly AtlasCitizenDefinition[] = BEACON_COMMONS_CROWD): readonly AtlasCitizenPresentation[] {
  const profile = QUALITY_PROFILES[input.qualityTier];
  const ordered = [...roster].sort((left, right) => Number(Boolean(right.missionCritical)) - Number(Boolean(left.missionCritical)) || left.id.localeCompare(right.id));
  return ordered.map((citizen, index) => {
    const hash = stableHash(`${input.districtId}:${input.daySeed}:${citizen.id}`);
    const visible = citizen.missionCritical || index < profile.visibleNpcs;
    const active = visible && (citizen.missionCritical || index < profile.activeNpcs);
    const pathId = citizen.missionCritical ? citizen.pathIds[0] : citizen.pathIds[hash % citizen.pathIds.length];
    const activity = activityFor(citizen.role, hash, input.restorationState);
    return {
      id: citizen.id,
      role: citizen.role,
      visible,
      active,
      pathId,
      activity,
      conversationPartnerId: citizen.conversationPairId,
      // The simulation clock is applied by the motion projection. Keeping this
      // phase stable avoids counting time twice on long city paths.
      animationPhase: (hash % 360) / 360,
      restorationReaction: reactionFor(input.restorationState, citizen.role),
      updateIntervalTicks: active ? (index < 6 ? 1 : 6) : 30,
    };
  });
}

function activityFor(role: AtlasCitizenRole, hash: number, restorationState: AtlasCrowdScheduleInput['restorationState']): AtlasCitizenActivity {
  if (restorationState === 'restored' && (role === 'community-repairer' || role === 'nimiq-team-builder')) return hash % 2 === 0 ? 'celebrating' : 'repairing';
  const activities: Record<AtlasCitizenRole, readonly AtlasCitizenActivity[]> = {
    'nimiq-team-guide': ['talking', 'planning'],
    'nimiq-team-builder': ['planning', 'repairing'],
    'community-explorer': ['walking', 'talking'],
    'community-merchant': ['trading', 'queueing'],
    'community-repairer': ['repairing', 'carrying'],
    'community-traveller': ['walking', 'carrying', 'walking', 'jogging'],
  };
  const options = activities[role];
  return options[hash % options.length];
}

function reactionFor(state: AtlasCrowdScheduleInput['restorationState'], role: AtlasCitizenRole): AtlasRestorationReaction {
  if (state === 'restored') return role === 'community-repairer' || role === 'nimiq-team-builder' ? 'celebrating' : 'helping';
  if (state === 'confirming') return 'watching';
  return 'neutral';
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}
