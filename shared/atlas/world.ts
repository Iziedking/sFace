import type { AtlasDistrictId, AtlasTool } from './types';

export interface AtlasPoint {
  x: number;
  y: number;
}

export interface AtlasRelayDefinition extends AtlasPoint {
  id: string;
  knowledge: string;
}

export interface AtlasFaultDefinition extends AtlasPoint {
  id: string;
  radius: number;
}

export interface AtlasMissionDefinition {
  id: string;
  districtId: AtlasDistrictId;
  width: number;
  height: number;
  spawn: AtlasPoint;
  relays: AtlasRelayDefinition[];
  faults: AtlasFaultDefinition[];
  rescue: AtlasPoint & { id: string; name: string };
  gate: AtlasPoint & { id: string };
  requiredTools: AtlasTool[];
}

export const ATLAS_CORE_FIXTURE: AtlasMissionDefinition = Object.freeze({
  id: 'core-fixture',
  districtId: 'genesis-garden',
  width: 2_500,
  height: 1_200,
  spawn: { x: 0, y: 0 },
  relays: [{ id: 'address-relay', x: 1_000, y: 0, knowledge: '1 NIM equals 100000 Lunas.' }],
  faults: [{ id: 'stale-route', x: 100, y: 0, radius: 80 }],
  rescue: { id: 'courier', name: 'Courier Ada', x: 1_500, y: 0 },
  gate: { id: 'garden-gate', x: 2_000, y: 0 },
  requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
} satisfies AtlasMissionDefinition);
