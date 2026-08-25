import type { AtlasTool } from './types';
import type { AtlasMissionDefinition } from './world';

export type AtlasActionTool = AtlasTool | 'none';

export interface AtlasAction {
  moveX: number;
  moveY: number;
  tool: AtlasActionTool;
  interact: boolean;
  system?: 'active' | 'paused' | 'hidden';
}

export interface AtlasRuntimeRelay {
  id: string;
  x: number;
  y: number;
  knowledge: string;
  scanned: boolean;
  connected: boolean;
}

export interface AtlasRuntimeFault {
  id: string;
  x: number;
  y: number;
  radius: number;
  active: boolean;
}

export type AtlasEventType = 'paused' | 'hidden' | 'relay-scanned' | 'relay-connected' | 'fault-hit' | 'fault-shielded' | 'rescued' | 'gate-opened' | 'district-completed';

export interface AtlasEvent {
  tick: number;
  type: AtlasEventType;
  targetId: string;
}

export interface AtlasState {
  readonly mission: AtlasMissionDefinition;
  phase: 'running' | 'completed' | 'failed';
  tick: number;
  player: {
    x: number;
    y: number;
    facing: 'up' | 'down' | 'left' | 'right';
    integrity: number;
    collisionCooldown: number;
    shieldTicks: number;
    shieldCooldown: number;
  };
  relays: AtlasRuntimeRelay[];
  faults: AtlasRuntimeFault[];
  rescue: AtlasMissionDefinition['rescue'] & { rescued: boolean };
  gate: AtlasMissionDefinition['gate'] & { unlocked: boolean };
  events: AtlasEvent[];
}

export interface AtlasSnapshot {
  phase: AtlasState['phase'];
  tick: number;
  player: AtlasState['player'];
  relays: AtlasRuntimeRelay[];
  faults: AtlasRuntimeFault[];
  rescue: AtlasState['rescue'];
  gate: AtlasState['gate'];
  events: AtlasEvent[];
}

export function createAtlasState(mission: AtlasMissionDefinition): AtlasState {
  assertMission(mission);
  return {
    mission: structuredClone(mission),
    phase: 'running',
    tick: 0,
    player: { x: mission.spawn.x, y: mission.spawn.y, facing: 'right', integrity: 3, collisionCooldown: 0, shieldTicks: 0, shieldCooldown: 0 },
    relays: mission.relays.map((relay) => ({ ...relay, scanned: false, connected: false })),
    faults: mission.faults.map((fault) => ({ ...fault, active: true })),
    rescue: { ...mission.rescue, rescued: false },
    gate: { ...mission.gate, unlocked: false },
    events: [],
  };
}

export function snapshotAtlasState(state: AtlasState): AtlasSnapshot {
  return structuredClone({
    phase: state.phase,
    tick: state.tick,
    player: state.player,
    relays: state.relays,
    faults: state.faults,
    rescue: state.rescue,
    gate: state.gate,
    events: state.events,
  });
}

function assertMission(mission: AtlasMissionDefinition): void {
  if (!Number.isSafeInteger(mission.width) || !Number.isSafeInteger(mission.height) || mission.width <= 0 || mission.height <= 0) throw new Error('Atlas mission bounds are invalid.');
  for (const item of [mission.spawn, mission.rescue, mission.gate, ...mission.relays, ...mission.faults]) {
    if (!Number.isSafeInteger(item.x) || !Number.isSafeInteger(item.y) || item.x < 0 || item.y < 0 || item.x > mission.width || item.y > mission.height) throw new Error('Atlas mission object is outside integer bounds.');
  }
  const ids = [mission.rescue.id, mission.gate.id, ...mission.relays.map((item) => item.id), ...mission.faults.map((item) => item.id)];
  if (new Set(ids).size !== ids.length) throw new Error('Atlas mission object ids must be unique.');
}
