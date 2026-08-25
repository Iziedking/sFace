import type { AtlasMissionDefinition } from '../world';

/** Historical prototype retained for audit and migration context. It is not public navigation. */
export const COURIER_ADA_GENESIS_PROTOTYPE: AtlasMissionDefinition = Object.freeze({
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
  rescue: { id: 'courier-ada', name: 'Courier Ada', x: 26_000, y: 8_500 },
  gate: { id: 'genesis-gate', x: 40_000, y: 10_000 },
  requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
} satisfies AtlasMissionDefinition);
