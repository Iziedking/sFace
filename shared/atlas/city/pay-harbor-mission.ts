import type { LastLanternState, LanternPhase } from '../adventures/last-lantern';
import type { AtlasRestorationState } from '../living-world';

const BUILDER_STATION_COUNT = 6;

export interface PayHarborPhysicalMission {
  readonly phase: LanternPhase;
  readonly objective: string;
  readonly detail: string;
  readonly status: string;
  readonly targetAnchorId: string;
  readonly actionLabel: string;
  readonly restoration: AtlasRestorationState;
  readonly complete: boolean;
}

export function projectPayHarborPhysicalMission(state: LastLanternState, builderStationIndex = 0): PayHarborPhysicalMission {
  const restoration = restorationFor(state.phase);
  if (state.phase === 'street') return mission(state, restoration, 'MEET MARA AT THE HARBOR', 'Mara is waiting beside the lantern market. Follow the map and speak with her.', 'ARRIVAL / WALK TO MARA', 'mara-harbor-keeper', 'Talk');
  if (state.phase === 'shop') return mission(state, restoration, 'INSPECT THE LAST LANTERN', 'Walk to the lantern counter and inspect the object before any payment decision.', 'EXPLORER CHECK / OBJECT FIRST', 'lantern-counter', 'Inspect');
  if (state.phase === 'selected' && state.role === 'builder') return mission(state, restoration, 'REPAIR THE PAYMENT ROUTE', 'Use the harbor workbench to predict each safe provider and confirmation boundary.', 'BUILDER PATH / WORKBENCH READY', 'builder-workbench', 'Open workbench');
  if (state.phase === 'selected') return mission(state, restoration, 'REVIEW THE PAYMENT REQUEST', 'Move to the review desk and check the network, recipient, integer Lunas, and confirmation rule.', 'EXPLORER PATH / VERIFY BEFORE APPROVAL', 'payment-review', 'Review');
  if (state.phase === 'review') return mission(state, restoration, 'CONFIRM THE SAFE PAYMENT', state.mode === 'practice' ? 'Practice mode uses deterministic local evidence. It creates no payment, score, or reward claim.' : 'Approve only the exact TestAlbatross request, then wait for canonical confirmation.', 'PAYMENT REVIEW / AUTHORITY NOT YET PROVEN', 'payment-review', state.mode === 'practice' ? 'Confirm practice' : 'Pay with Nimiq Pay');
  if (state.phase === 'confirming') return mission(state, restoration, 'WAIT FOR CANONICAL CONFIRMATION', 'The wallet result alone does not restore the harbor. Check authoritative chain evidence.', 'CONFIRMING / ROUTE STILL CLOSED', 'payment-review', state.mode === 'practice' ? 'Confirm practice' : 'Check confirmation');
  if (state.phase === 'verified') return mission(state, restoration, 'PICK UP THE RELAY COMPONENT', 'The payment rule is verified. Collect the component before approaching the installations.', 'VERIFIED / PICKUP ENABLED', 'relay-pickup', 'Pick up');
  if (state.phase === 'fulfilled' && state.role === 'builder' && builderStationIndex < BUILDER_STATION_COUNT) {
    const station = Math.max(0, builderStationIndex) + 1;
    return mission(state, restoration, 'INSTALL THE HARBOR RELAY', `Carry the component to station ${station}. Each installation follows the authorized physical route.`, `BUILDER INSTALL ${station} OF ${BUILDER_STATION_COUNT}`, `station-${station}-install`, `Install ${station}/${BUILDER_STATION_COUNT}`);
  }
  if (state.phase === 'fulfilled') return mission(state, restoration, 'LIGHT THE HARBOR TOWER', 'Carry the verified component to the tower. The market and ferry change only after this final action.', 'COMPONENT CARRIED / TOWER AHEAD', 'celebration-harbor-tower', 'Light tower');
  return mission(state, restoration, 'PAY HARBOR RESTORED', 'The lantern route is open, the market is active, and the ferry is moving. Return to Beacon Commons when ready.', 'MISSION COMPLETE / PROGRESS SAVED', 'beacon-return-gate', 'Return', true);
}

function restorationFor(phase: LanternPhase): AtlasRestorationState {
  if (phase === 'tower-lit') return 'restored';
  if (phase === 'confirming') return 'confirming';
  return 'waiting';
}

function mission(
  state: LastLanternState,
  restoration: AtlasRestorationState,
  objective: string,
  detail: string,
  status: string,
  targetAnchorId: string,
  actionLabel: string,
  complete = false,
): PayHarborPhysicalMission {
  return { phase: state.phase, objective, detail, status, targetAnchorId, actionLabel, restoration, complete };
}
