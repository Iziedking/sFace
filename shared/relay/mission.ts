import {
  RELAY_COURSE_HEIGHT,
  RELAY_COURSE_WIDTH,
  RELAY_POD_WIDTH,
} from './constants';
import type { RelayRuleset } from './types';
import { RelayRng } from './rng';

const SECTION_COUNT = 9;
const ROUTE_MARGIN = 900;

export interface RelayMissionNode {
  id: string;
  x: number;
  y: number;
  risk: number;
}

export interface RelayMissionGate {
  id: string;
  x: number;
  y: number;
}

export interface RelayMissionHazard {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface RelayMissionSection {
  index: number;
  startX: number;
  endX: number;
  nodeIds: string[];
  gateId: string;
  hazardIds: string[];
}

export interface RelayMission {
  seedHex: string;
  ruleset: RelayRuleset['version'];
  missionDate?: string;
  seedCommitment?: string;
  nodes: RelayMissionNode[];
  gates: RelayMissionGate[];
  hazards: RelayMissionHazard[];
  sections: RelayMissionSection[];
}

function within(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function assertMissionInvariants(mission: RelayMission, ruleset: RelayRuleset): void {
  if (mission.nodes.length !== mission.sections.length * 3) throw new Error('Each section must expose three rescue nodes.');
  for (const object of [...mission.nodes, ...mission.gates, ...mission.hazards]) {
    if (!within(object.x, 0, ruleset.courseWidth) || !within(object.y, 0, ruleset.courseHeight)) {
      throw new Error('Mission object is outside course bounds.');
    }
  }
  for (const section of mission.sections) {
    if (section.endX <= section.startX) throw new Error('Mission section bounds are invalid.');
    const nodes = section.nodeIds.map((id) => mission.nodes.find((node) => node.id === id));
    const gate = mission.gates.find((item) => item.id === section.gateId);
    if (nodes.some((node) => !node) || !gate || nodes.some((node) => node!.x >= gate.x)) {
      throw new Error('Every rescue node must precede its relay gate.');
    }
    const hazards = mission.hazards.filter((hazard) => section.hazardIds.includes(hazard.id));
    if (hazards.some((hazard) => hazard.y <= ROUTE_MARGIN || hazard.y >= ruleset.courseHeight - ROUTE_MARGIN)) {
      throw new Error('Mission hazard blocks a guaranteed route.');
    }
  }
  if (mission.hazards.some((hazard) => hazard.x <= RELAY_POD_WIDTH * 2)) {
    throw new Error('Mission hazard overlaps the spawn approach.');
  }
}

export function generateRelayMission(seedHex: string, ruleset: RelayRuleset): RelayMission {
  if (!/^[0-9a-f]{64}$/.test(seedHex)) throw new Error('Relay seed must be 32-byte lowercase hexadecimal.');
  if (ruleset.version !== 'relay-1') throw new Error('Relay ruleset is unsupported.');
  const rng = new RelayRng(seedHex);
  const sectionWidth = Math.floor(RELAY_COURSE_WIDTH / SECTION_COUNT);
  const nodes: RelayMissionNode[] = [];
  const gates: RelayMissionGate[] = [];
  const hazards: RelayMissionHazard[] = [];
  const sections: RelayMissionSection[] = [];

  for (let index = 0; index < SECTION_COUNT; index += 1) {
    const startX = index * sectionWidth;
    const endX = index === SECTION_COUNT - 1 ? RELAY_COURSE_WIDTH : (index + 1) * sectionWidth;
    const nodeIds: string[] = [];
    for (let nodeIndex = 0; nodeIndex < 3; nodeIndex += 1) {
      const id = `node-${index}-${nodeIndex}`;
      nodeIds.push(id);
      nodes.push({
        id,
        x: startX + Math.floor(sectionWidth * (0.16 + nodeIndex * 0.16)),
        y: rng.int(ROUTE_MARGIN, RELAY_COURSE_HEIGHT - ROUTE_MARGIN),
        risk: rng.int(0, 2),
      });
    }

    const gateId = `gate-${index}`;
    gates.push({
      id: gateId,
      x: startX + Math.floor(sectionWidth * 0.8),
      y: rng.int(ROUTE_MARGIN, RELAY_COURSE_HEIGHT - ROUTE_MARGIN),
    });

    const hazardIds: string[] = [];
    for (let hazardIndex = 0; hazardIndex < 2; hazardIndex += 1) {
      const id = `hazard-${index}-${hazardIndex}`;
      hazardIds.push(id);
      hazards.push({
        id,
        x: startX + Math.floor(sectionWidth * (0.56 + hazardIndex * 0.1)),
        y: rng.int(ROUTE_MARGIN + 200, RELAY_COURSE_HEIGHT - ROUTE_MARGIN - 200),
        radius: 180,
      });
    }
    sections.push({ index, startX, endX, nodeIds, gateId, hazardIds });
  }

  const mission: RelayMission = {
    seedHex,
    ruleset: ruleset.version,
    nodes,
    gates,
    hazards,
    sections,
  };
  assertMissionInvariants(mission, ruleset);
  return mission;
}
