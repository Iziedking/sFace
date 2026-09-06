import type { AtlasRole } from '../types';
import { ATLAS_LANTERN_PRICE_LUNA } from '../economy';

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

export const LAST_LANTERN_STATE_VERSION = 1 as const;

export interface LastLanternPersistedState {
  version: typeof LAST_LANTERN_STATE_VERSION;
  state: LastLanternState;
}

export const LAST_LANTERN = Object.freeze({
  id: 'last-lantern',
  recipient: 'NQATLASLANTERNSHOP',
  priceLuna: ATLAS_LANTERN_PRICE_LUNA,
  minimumConfirmations: 3,
  request: {
    itemId: 'harbor-lantern',
    network: 'testalbatross',
    recipient: 'NQATLASLANTERNSHOP',
    valueLuna: ATLAS_LANTERN_PRICE_LUNA,
  } satisfies LanternPaymentRequest,
});

export const LAST_LANTERN_CONVERSATION_MILESTONES = Object.freeze({
  arrival: 'arrived-pay-harbor',
  shop: 'lantern-inspected',
  payment: 'payment-verified',
  restoration: 'harbor-restored',
} as const);

export type LastLanternConversationMilestone = typeof LAST_LANTERN_CONVERSATION_MILESTONES[keyof typeof LAST_LANTERN_CONVERSATION_MILESTONES];

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

/**
 * Copies the mission into a versioned envelope suitable for browser storage.
 * The copy is deliberate: UI rendering must never be able to mutate the
 * in-memory authority while a storage adapter is serialising it.
 */
export function serializeLastLanternState(state: LastLanternState): LastLanternPersistedState {
  return { version: LAST_LANTERN_STATE_VERSION, state: cloneLastLanternState(state) };
}

/**
 * Restores only a structurally valid journey. Live and competitive journeys
 * are always fail-closed: a saved verified/fulfilled state returns to
 * confirmation, so a refresh can never mint an item or reopen the harbor.
 */
export function recoverLastLanternState(input: unknown, role: AtlasRole, mode: LanternMode): LastLanternState | null {
  if (!isRecord(input) || input.version !== LAST_LANTERN_STATE_VERSION || !isRecord(input.state)) return null;
  const state = parsePersistedState(input.state);
  if (!state || state.role !== role || state.mode !== mode) return null;
  if (mode === 'practice') return state;
  if (state.phase === 'verified' || state.phase === 'fulfilled' || state.phase === 'tower-lit') {
    if (!state.request) return null;
    const pending = createLastLanternState(role, mode);
    pending.phase = 'confirming';
    pending.request = { ...state.request };
    return pending;
  }
  return state;
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
  // Live prices come from deployment configuration and are checked against
  // the server order. The fixed price belongs only to the replayable lesson.
  if (!Number.isSafeInteger(request.valueLuna) || request.valueLuna <= 0
    || (mode !== 'live' && request.valueLuna !== LAST_LANTERN.priceLuna)) throw new Error('Lantern request Luna amount is wrong.');
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

function cloneLastLanternState(state: LastLanternState): LastLanternState {
  return {
    mode: state.mode,
    role: state.role,
    phase: state.phase,
    inventoryItemIds: [...state.inventoryItemIds],
    request: state.request ? { ...state.request } : null,
    evidence: state.evidence ? { ...state.evidence } : null,
    fulfillmentCount: state.fulfillmentCount,
    world: { ...state.world },
  };
}

function parsePersistedState(value: Record<string, unknown>): LastLanternState | null {
  const phase = value.phase;
  const role = value.role;
  const mode = value.mode;
  const inventory = value.inventoryItemIds;
  const world = value.world;
  if (!isLanternPhase(phase) || !isRole(role) || !isLanternMode(mode) || !Array.isArray(inventory) || !inventory.every((item) => typeof item === 'string')) return null;
  const fulfillmentCount = value.fulfillmentCount;
  if (typeof fulfillmentCount !== 'number' || !Number.isSafeInteger(fulfillmentCount) || fulfillmentCount < 0 || !isRecord(world)) return null;
  if (typeof world.lightsOn !== 'boolean' || typeof world.ferriesRunning !== 'boolean' || !isNpcSchedule(world.npcSchedule) || !isMusic(world.music) || typeof world.pathsOpen !== 'boolean') return null;

  const request = value.request === null ? null : parsePersistedRequest(value.request);
  if (value.request !== null && !request) return null;
  const evidence = value.evidence === null ? null : parsePersistedEvidence(value.evidence);
  if (value.evidence !== null && !evidence) return null;
  const state: LastLanternState = {
    mode,
    role,
    phase,
    inventoryItemIds: [...inventory],
    request,
    evidence,
    fulfillmentCount,
    world: {
      lightsOn: world.lightsOn,
      ferriesRunning: world.ferriesRunning,
      npcSchedule: world.npcSchedule,
      music: world.music,
      pathsOpen: world.pathsOpen,
    },
  };
  if (!isCoherentPersistedState(state)) return null;
  return state;
}

function parsePersistedRequest(value: unknown): LanternPaymentRequest | null {
  if (!isRecord(value) || value.itemId !== LAST_LANTERN.request.itemId || !isLanternNetwork(value.network) || typeof value.recipient !== 'string' || typeof value.valueLuna !== 'number' || !Number.isSafeInteger(value.valueLuna) || value.valueLuna <= 0) return null;
  return { itemId: value.itemId, network: value.network, recipient: value.recipient, valueLuna: value.valueLuna };
}

function parsePersistedEvidence(value: unknown): LanternEvidence | null {
  if (!isRecord(value) || typeof value.txHash !== 'string' || value.txHash.length === 0 || !isLanternNetwork(value.network) || typeof value.recipient !== 'string' || typeof value.valueLuna !== 'number' || !Number.isSafeInteger(value.valueLuna) || value.valueLuna <= 0 || typeof value.canonical !== 'boolean' || typeof value.success !== 'boolean' || typeof value.confirmations !== 'number' || !Number.isSafeInteger(value.confirmations) || value.confirmations < 0) return null;
  return { txHash: value.txHash, network: value.network, recipient: value.recipient, valueLuna: value.valueLuna, canonical: value.canonical, success: value.success, confirmations: value.confirmations };
}

function isCoherentPersistedState(state: LastLanternState): boolean {
  const fresh = createLastLanternState(state.role, state.mode);
  if (state.phase === 'street' || state.phase === 'shop' || state.phase === 'selected') {
    return state.request === null && state.evidence === null && state.fulfillmentCount === 0 && state.inventoryItemIds.length === 0 && JSON.stringify(state.world) === JSON.stringify(fresh.world);
  }
  if (!state.request || !isRequestAllowedForMode(state.request, state.mode)) return false;
  if (state.phase === 'review' || state.phase === 'confirming') {
    return state.evidence === null && state.fulfillmentCount === 0 && state.inventoryItemIds.length === 0 && JSON.stringify(state.world) === JSON.stringify(fresh.world);
  }
  if (!state.evidence) return false;
  try { assertEvidence(state.request, state.evidence); } catch { return false; }
  if (state.phase === 'verified') return state.fulfillmentCount === 0 && state.inventoryItemIds.length === 0 && JSON.stringify(state.world) === JSON.stringify(fresh.world);
  if (state.phase === 'fulfilled') return state.fulfillmentCount === 1 && state.inventoryItemIds.length === 1 && state.inventoryItemIds[0] === 'harbor-lantern' && JSON.stringify(state.world) === JSON.stringify(fresh.world);
  return state.fulfillmentCount === 1 && state.inventoryItemIds.length === 1 && state.inventoryItemIds[0] === 'harbor-lantern' && JSON.stringify(state.world) === JSON.stringify({ lightsOn: true, ferriesRunning: true, npcSchedule: 'market-open', music: 'harbor-theme', pathsOpen: true });
}

function isRequestAllowedForMode(request: LanternPaymentRequest, mode: LanternMode): boolean {
  try { assertRequest(request, mode); return true; } catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isRole(value: unknown): value is AtlasRole { return value === 'explorer' || value === 'builder'; }
function isLanternMode(value: unknown): value is LanternMode { return value === 'practice' || value === 'live' || value === 'competitive'; }
function isLanternPhase(value: unknown): value is LanternPhase { return value === 'street' || value === 'shop' || value === 'selected' || value === 'review' || value === 'confirming' || value === 'verified' || value === 'fulfilled' || value === 'tower-lit'; }
function isLanternNetwork(value: unknown): value is LanternNetwork { return value === 'testalbatross' || value === 'mainalbatross'; }
function isNpcSchedule(value: unknown): value is LastLanternState['world']['npcSchedule'] { return value === 'closed' || value === 'market-open'; }
function isMusic(value: unknown): value is LastLanternState['world']['music'] { return value === 'quiet' || value === 'harbor-theme'; }

function requirePhase(state: LastLanternState, phases: LanternPhase[]): void {
  if (!phases.includes(state.phase)) throw new Error(`Lantern action is invalid in phase ${state.phase}.`);
}
