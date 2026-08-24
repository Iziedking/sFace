import {
  RELAY_COURSE_WIDTH,
  RELAY_INITIAL_INTEGRITY,
} from './constants';
import type { RelayMission, RelayMissionGate, RelayMissionHazard, RelayMissionNode } from './mission';
import type { RelayRuleset } from './types';

export type RelayMissionForState = RelayMission;
export type RelayRunPhase = 'running' | 'finished';
export type RelayNodeStatus = 'available' | 'carried' | 'banked' | 'dropped';

export interface RelayRuntimeNode extends RelayMissionNode {
  status: RelayNodeStatus;
}

export interface RelayPodState {
  x: number;
  y: number;
  integrity: number;
  collisionCooldown: number;
}

export interface RelayState {
  readonly seedHex: string;
  readonly ruleset: RelayRuleset['version'];
  readonly nodes: RelayRuntimeNode[];
  readonly gates: RelayMissionGate[];
  readonly hazards: RelayMissionHazard[];
  readonly pod: RelayPodState;
  phase: RelayRunPhase;
  completedTicks: number;
  carrying: number;
  carryingRisk: number;
  bankedNodes: number;
  damageTaken: number;
  droppedNodes: number;
  bestChain: number;
  currentChain: number;
  riskBonusCount: number;
}

export function createRelayState(mission: RelayMissionForState): RelayState {
  return {
    seedHex: mission.seedHex,
    ruleset: mission.ruleset,
    nodes: mission.nodes.map((node) => ({ ...node, status: 'available' })),
    gates: mission.gates.map((gate) => ({ ...gate })),
    hazards: mission.hazards.map((hazard) => ({ ...hazard })),
    pod: {
      x: Math.floor(RELAY_COURSE_WIDTH / 2),
      y: 0,
      integrity: RELAY_INITIAL_INTEGRITY,
      collisionCooldown: 0,
    },
    phase: 'running',
    completedTicks: 0,
    carrying: 0,
    carryingRisk: 0,
    bankedNodes: 0,
    damageTaken: 0,
    droppedNodes: 0,
    bestChain: 0,
    currentChain: 0,
    riskBonusCount: 0,
  };
}
