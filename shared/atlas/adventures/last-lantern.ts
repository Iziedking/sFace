import type { AtlasRole } from '../types';

export type LanternNetwork = 'testalbatross' | 'mainalbatross';
export type LanternPhase = 'street' | 'shop' | 'selected' | 'review' | 'confirming' | 'verified' | 'fulfilled' | 'tower-lit';
export type LanternEvidenceSource = 'local-simulation' | 'server-verified';
export type LanternMode = 'practice' | 'live' | 'competitive';

export interface LanternPaymentRequest {
  itemId: 'harbor-lantern';
  network: LanternNetwork;
  recipient: string;
  valueLuna: number;
}

export interface LanternEvidence {
  txHash: string;
  network: LanternNetwork;
  recipient: string;
  valueLuna: number;
  canonical: boolean;
  success: boolean;
  confirmations: number;
}

export interface LastLanternState {
  mode: LanternMode;
  role: AtlasRole;
  phase: LanternPhase;
  inventoryItemIds: string[];
  request: LanternPaymentRequest | null;
  evidence: LanternEvidence | null;
  fulfillmentCount: number;
  world: {
    lightsOn: boolean;
    ferriesRunning: boolean;
    npcSchedule: 'closed' | 'market-open';
    music: 'quiet' | 'harbor-theme';
    pathsOpen: boolean;
  };
}

export const LAST_LANTERN = Object.freeze({
  id: 'last-lantern',
  recipient: 'NQATLASLANTERNSHOP',
  priceLuna: 100_000,
  minimumConfirmations: 3,
  request: {
    itemId: 'harbor-lantern',
    network: 'testalbatross',
    recipient: 'NQATLASLANTERNSHOP',
    valueLuna: 100_000,
  } satisfies LanternPaymentRequest,
});

export type LastLanternAction =
  | { type: 'enter-shop' }
  | { type: 'select-lantern' }
  | { type: 'review-request'; request: LanternPaymentRequest }
  | { type: 'receive-evidence'; evidence: LanternEvidence; source: LanternEvidenceSource }
  | { type: 'await-evidence' }
  | { type: 'fulfill-lantern' }
  | { type: 'reach-tower' };

export function createLastLanternState(role: AtlasRole, mode: LastLanternState['mode'] = 'practice'): LastLanternState {
  return {
    mode,
    role,
    phase: 'street',
    inventoryItemIds: [],
    request: null,
    evidence: null,
    fulfillmentCount: 0,
    world: { lightsOn: false, ferriesRunning: false, npcSchedule: 'closed', music: 'quiet', pathsOpen: false },
  };
}

export function replayLastLantern(actions: LastLanternAction[], state = createLastLanternState('explorer')): LastLanternState {
  for (const action of actions) applyLastLanternAction(state, action);
  return state;
}

function applyLastLanternAction(state: LastLanternState, action: LastLanternAction): void {
  if (action.type === 'enter-shop') {
    requirePhase(state, ['street']);
    state.phase = 'shop';
    return;
  }
  if (action.type === 'select-lantern') {
    requirePhase(state, ['shop']);
    state.phase = 'selected';
    return;
  }
  if (action.type === 'review-request') {
    requirePhase(state, ['selected', 'review']);
    assertRequest(action.request, state.mode);
    state.request = { ...action.request };
    state.phase = 'review';
    return;
  }
  if (action.type === 'receive-evidence') {
    requirePhase(state, ['review', 'confirming']);
    if (state.mode !== 'practice' && action.source !== 'server-verified') throw new Error('Live fulfillment requires server-verified evidence.');
    if (!Number.isSafeInteger(action.evidence.confirmations) || action.evidence.confirmations < LAST_LANTERN.minimumConfirmations) {
      state.phase = 'confirming';
      throw new Error('Lantern payment is still confirming.');
    }
    assertEvidence(state.request, action.evidence);
    state.evidence = { ...action.evidence };
    state.phase = 'verified';
    return;
  }
  if (action.type === 'await-evidence') {
    requirePhase(state, ['review', 'confirming']);
    state.phase = 'confirming';
    return;
  }
  if (action.type === 'fulfill-lantern') {
    if (state.phase === 'fulfilled' || state.phase === 'tower-lit') throw new Error('Lantern fulfillment is duplicate.');
    requirePhase(state, ['verified']);
    if (state.fulfillmentCount !== 0 || state.inventoryItemIds.includes('harbor-lantern')) throw new Error('Lantern fulfillment is duplicate.');
    state.fulfillmentCount += 1;
    state.inventoryItemIds.push('harbor-lantern');
    state.phase = 'fulfilled';
    return;
  }
  requirePhase(state, ['fulfilled']);
  if (!state.inventoryItemIds.includes('harbor-lantern')) throw new Error('The harbor tower requires the lantern inventory item.');
  state.phase = 'tower-lit';
  state.world = { lightsOn: true, ferriesRunning: true, npcSchedule: 'market-open', music: 'harbor-theme', pathsOpen: true };
}

function assertRequest(request: LanternPaymentRequest, mode: LanternMode): void {
  if (request.network !== LAST_LANTERN.request.network) throw new Error('Lantern request network is wrong.');
  if (mode === 'practice' && request.recipient !== LAST_LANTERN.recipient) throw new Error('Lantern request recipient is wrong.');
  if (mode === 'live' && (request.recipient === LAST_LANTERN.recipient || !isNimiqAddress(request.recipient))) throw new Error('Lantern request recipient is wrong.');
  if (mode === 'competitive' && request.recipient !== LAST_LANTERN.recipient && !isNimiqAddress(request.recipient)) throw new Error('Lantern request recipient is wrong.');
  if (request.valueLuna !== LAST_LANTERN.priceLuna) throw new Error('Lantern request Luna amount is wrong.');
  if (request.itemId !== LAST_LANTERN.request.itemId) throw new Error('Lantern item is unknown.');
}

function isNimiqAddress(value: string): boolean { return /^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(value.replace(/\s/g, '').toUpperCase()); }

function assertEvidence(request: LanternPaymentRequest | null, evidence: LanternEvidence): void {
  if (!request) throw new Error('Lantern payment request is missing.');
  if (evidence.network !== request.network) throw new Error('Lantern evidence network is wrong.');
  if (evidence.recipient !== request.recipient) throw new Error('Lantern evidence recipient is wrong.');
  if (evidence.valueLuna !== request.valueLuna) throw new Error('Lantern evidence Luna amount is wrong.');
  if (!evidence.canonical || !evidence.success) throw new Error('Lantern evidence is not canonical and successful.');
  if (!Number.isSafeInteger(evidence.confirmations) || evidence.confirmations < LAST_LANTERN.minimumConfirmations) throw new Error('Lantern payment is still confirming.');
}

function requirePhase(state: LastLanternState, phases: LanternPhase[]): void {
  if (!phases.includes(state.phase)) throw new Error(`Lantern action is invalid in phase ${state.phase}.`);
}
