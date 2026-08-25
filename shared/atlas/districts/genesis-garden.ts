import type { AtlasState } from '../state';
import type { AtlasMissionDefinition, AtlasPoint } from '../world';

export const GENESIS_GARDEN_MISSION: AtlasMissionDefinition = Object.freeze({
  id: 'genesis-garden-intro',
  districtId: 'genesis-garden',
  width: 45_000,
  height: 20_000,
  spawn: { x: 2_000, y: 10_000 },
  relays: [{ id: 'address-stone', x: 11_000, y: 10_000, knowledge: 'Nimiq amounts use integer Lunas. 1 NIM equals exactly 100000 Lunas.' }],
  faults: [
    { id: 'stale-address-vine', x: 6_500, y: 10_000, radius: 700 },
    { id: 'broken-checksum-hedge', x: 18_000, y: 8_000, radius: 620 },
    { id: 'misrouted-signpost', x: 31_000, y: 12_500, radius: 680 },
  ],
  rescue: { id: 'harbor-keeper-mara', name: 'Mara', x: 26_000, y: 8_500 },
  gate: { id: 'genesis-gate', x: 40_000, y: 10_000 },
  requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
} satisfies AtlasMissionDefinition);

export interface GenesisObjective {
  short: string;
  detail: string;
  target: AtlasPoint;
  action: 'move' | 'scanner' | 'relay-tether' | 'interact' | 'trial';
}

export function genesisObjective(state: AtlasState): GenesisObjective {
  const relay = state.relays[0]!;
  if (!relay.scanned) return { short: 'Find the Address Stone', detail: 'Follow the orange path. Use Scan when the stone begins to glow.', target: relay, action: 'scanner' };
  if (!relay.connected) return { short: 'Reconnect the address path', detail: 'Use Relay Tether beside the scanned Address Stone.', target: relay, action: 'relay-tether' };
  if (!state.rescue.rescued) return { short: 'Meet Mara', detail: 'Follow the restored path and help Mara reopen the harbor route.', target: state.rescue, action: 'interact' };
  if (state.phase !== 'completed') return { short: 'Enter Genesis Gate', detail: 'The gate is open. Reach it and use Enter.', target: state.gate, action: 'interact' };
  return { short: 'Open the Builder Trial', detail: 'Use what you found to restore the Garden seal.', target: state.gate, action: 'trial' };
}
