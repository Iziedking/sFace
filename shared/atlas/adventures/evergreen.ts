import type { AtlasRole, AtlasSource } from '../types';
import type { AtlasMissionDefinition } from '../world';

export type EvergreenDistrictId = 'light-forest' | 'albatross-causeway' | 'validator-peaks' | 'builder-city' | 'beacon-core';

export interface EvergreenAdventure {
  id: string;
  districtId: EvergreenDistrictId;
  title: string;
  humanNeed: string;
  location: string;
  problem: string;
  consequence: { before: string; after: string; visible: string };
  explorerAction: string;
  builderMirror: string;
  fragments: string[];
  teachBack: string[];
  sources: AtlasSource[];
  mission: AtlasMissionDefinition;
}

export interface EvergreenAction {
  type: 'observe' | 'act' | 'teach-back';
  role?: AtlasRole;
  answer?: string;
}

export interface EvergreenState {
  phase: 'arrival' | 'observed' | 'acted' | 'completed';
  role: AtlasRole | null;
  consequence: string;
  fragmentsCarried: string[];
  teachBack: string[];
}

const reviewedAt = '2026-08-25';
const source = (url: string, title: string): AtlasSource => ({ url, title, reviewedAt });
const provider = source('https://nimiq.dev/mini-apps/api-reference/nimiq-provider', 'Nimiq Provider API');
const miniApps = source('https://nimiq.dev/mini-apps/', 'Nimiq Mini Apps');
const lightClient = source('https://nimiq.dev/web-client/concepts/how-the-light-client-works', 'How the Nimiq light client works');
const transactions = source('https://nimiq.dev/learn/transactions', 'Nimiq transactions');
const receipt = source('https://nimiq.dev/rpc/methods/get-transaction-by-hash', 'Get transaction by hash');
const protocol = source('https://nimiq.dev/protocol/', 'Nimiq proof-of-stake protocol');
const client = source('https://nimiq.dev/web-client/reference/classes/client', 'Nimiq Client reference');

function mission(id: string, districtId: EvergreenDistrictId, spawnX: number, relayX: number, rescueX: number, gateX: number): AtlasMissionDefinition {
  return {
    id,
    districtId,
    width: 28_000,
    height: 14_000,
    spawn: { x: spawnX, y: 7_000 },
    relays: [{ id: `${id}-relay`, x: relayX, y: 7_000, knowledge: 'Observe first, then act on an evidence-backed network view.' }],
    faults: [{ id: `${id}-fault`, x: Math.floor((relayX + rescueX) / 2), y: 7_000, radius: 400 }],
    rescue: { id: `${id}-neighbor`, name: 'A neighbor', x: rescueX, y: 7_000 },
    gate: { id: `${id}-gate`, x: gateX, y: 7_000 },
    requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
  };
}

export const ATLAS_EVERGREEN_ADVENTURES: EvergreenAdventure[] = [
  {
    id: 'light-forest-canopy', districtId: 'light-forest', title: 'The Canopy That Waits',
    humanNeed: 'Nia needs the night route lit before her family can safely find the forest clinic.',
    location: 'A walkable forest of light relays, canopy bridges, and a dark path home.',
    problem: 'The canopy must not light from a stale or unavailable network view.',
    consequence: { before: 'The clinic path is dark.', after: 'The navigation canopy lights from a current network view.', visible: 'A green route appears between the forest homes and clinic.' },
    explorerAction: 'Read provider readiness, consensus, and block height before reconnecting the canopy.',
    builderMirror: 'Repair the provider-read sequence so the canopy never prompts for an account just to read state.',
    fragments: ['ask', 'confirm'], teachBack: ['consensus', 'block-height'], sources: [miniApps, lightClient, provider],
    mission: mission('light-forest-canopy', 'light-forest', 1_500, 7_000, 15_000, 25_000),
  },
  {
    id: 'albatross-receipt-crossing', districtId: 'albatross-causeway', title: 'The Receipt Crossing',
    humanNeed: 'Oren needs a medicine receipt escorted across the causeway without telling the family it arrived too early.',
    location: 'A causeway with moving ferries that change state as evidence reaches finality.',
    problem: 'A provider lookup may be submitted, included, confirming, unknown, or canonical and final.',
    consequence: { before: 'The medicine ferry waits at the first span.', after: 'The receipt crosses only after the evidence agrees.', visible: 'The ferry moves and the causeway signal turns white.' },
    explorerAction: 'Sort receipt states and wait for canonical sender, recipient, value, success, and confirmations.',
    builderMirror: 'Repair the reconciliation pipeline so hash, inclusion, and finality remain separate statuses.',
    fragments: ['transaction', 'confirm'], teachBack: ['submitted', 'confirming', 'finality'], sources: [transactions, receipt, protocol],
    mission: mission('albatross-receipt-crossing', 'albatross-causeway', 1_500, 7_000, 15_000, 25_000),
  },
  {
    id: 'validator-relay-balance', districtId: 'validator-peaks', title: 'The Relay Balance',
    humanNeed: 'Tala needs the mountain relays balanced so one operator cannot become the only route for every village.',
    location: 'A walkable ridge where validator beacons and delegation trails show network shape.',
    problem: 'A network can look active while concentration leaves it less resilient.',
    consequence: { before: 'One peak carries the entire mountain signal.', after: 'Validator relays show a more distributed route.', visible: 'Three mountain beacons pulse instead of one overloaded beacon.' },
    explorerAction: 'Read validator and distribution signals without authorizing a stake change.',
    builderMirror: 'Repair the delegation blueprint so parameters are reviewed locally and never sent automatically.',
    fragments: ['confirm', 'custody'], teachBack: ['validator', 'delegation', 'distribution'], sources: [client, protocol, provider],
    mission: mission('validator-relay-balance', 'validator-peaks', 1_500, 7_000, 15_000, 25_000),
  },
  {
    id: 'builder-city-service-repair', districtId: 'builder-city', title: 'The Service Repair',
    humanNeed: 'Mara needs a neighborhood service restored so every visitor can ask clearly, recover safely, and keep their keys private.',
    location: 'A walkable city block where small services expose readable provider boundaries.',
    problem: 'A Mini App must remain useful when the provider is unavailable or a player declines.',
    consequence: { before: 'The service stalls at an unexplained wallet prompt.', after: 'The service separates local play, read access, consent, and recovery.', visible: 'The city kiosk serves offline practice and shows honest capability states.' },
    explorerAction: 'Use a service by choosing each capability only when its next action needs it.',
    builderMirror: 'Compose provider init, read, sign, and recovery with typed errors and localized privacy copy.',
    fragments: ['ask', 'approve', 'custody'], teachBack: ['local', 'consent', 'recovery'], sources: [miniApps, provider, client],
    mission: mission('builder-city-service-repair', 'builder-city', 1_500, 7_000, 15_000, 25_000),
  },
  {
    id: 'beacon-core-installation', districtId: 'beacon-core', title: 'The Beacon Installation',
    humanNeed: 'The whole Atlas community needs one shared signal that shows which systems are truly restored.',
    location: 'A central plaza where every district cable meets one community-built beacon.',
    problem: 'The beacon must compose learning, consent, replay, and evidence without inventing progress.',
    consequence: { before: 'The community plaza is dark and cannot tell practice from verified progress.', after: 'The Network Beacon activates from honest district proofs.', visible: 'Six district cables light and the plaza beacon begins its shared pulse.' },
    explorerAction: 'Transfer the complete trust lifecycle from a human payment journey into a community installation.',
    builderMirror: 'Install the same component only after every authority boundary and recovery state is represented.',
    fragments: ['ask', 'check', 'approve', 'confirm', 'unlock'], teachBack: ['ask', 'check', 'approve', 'confirm', 'unlock'], sources: [miniApps, provider, transactions, receipt, protocol],
    mission: mission('beacon-core-installation', 'beacon-core', 1_500, 7_000, 15_000, 25_000),
  },
];

export function replayEvergreenAdventure(adventure: EvergreenAdventure, actions: readonly EvergreenAction[]): EvergreenState {
  const state: EvergreenState = { phase: 'arrival', role: null, consequence: adventure.consequence.before, fragmentsCarried: [], teachBack: [] };
  for (const action of actions) {
    if (action.type === 'observe') {
      if (state.phase !== 'arrival') throw new Error('Evergreen adventure observe sequence is invalid.');
      state.phase = 'observed';
      state.fragmentsCarried = [...adventure.fragments];
      continue;
    }
    if (action.type === 'act') {
      if (state.phase !== 'observed' || !action.role) throw new Error('Evergreen adventure act sequence is invalid.');
      state.phase = 'acted';
      state.role = action.role;
      state.consequence = adventure.consequence.after;
      continue;
    }
    if (state.phase !== 'acted' || action.answer !== adventure.teachBack[state.teachBack.length]) throw new Error('Evergreen adventure teach-back is incorrect.');
    state.teachBack.push(action.answer);
    if (state.teachBack.length === adventure.teachBack.length) state.phase = 'completed';
  }
  return structuredClone(state);
}
