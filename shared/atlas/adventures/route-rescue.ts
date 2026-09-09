import { ATLAS_DISTRICT_WORLDS } from '../districts/registry';
import type { AtlasRestorationState } from '../living-world';
import type { AtlasMissionProgress } from '../mission-director';

export type RouteStage = 'arrive' | 'request' | 'signal' | 'refused' | 'evidence' | 'verified' | 'restored' | 'complete';
export type RouteAction = 'talk' | 'check-recipient' | 'check-amount' | 'check-block' | 'approve-practice' | 'try-signal' | 'follow-trail' | 'follow-stale-trail' | 'compare-requests' | 'advance-receipt' | 'trust-early-receipt' | 'collect-validator' | 'trust-single-validator' | 'inspect-browser' | 'trust-browser' | 'verify-server' | 'connect-beacon-seal' | 'rush-beacon' | 'investigate' | 'weak-evidence' | 'reorg-evidence' | 'match-evidence' | 'install' | 'wrong-answer' | 'teach-back' | 'next';
export interface RouteRun {
  readonly version: 1;
  readonly role: 'explorer' | 'builder';
  readonly chapter: number;
  readonly stage: RouteStage;
  readonly recipientChecked: boolean;
  readonly amountChecked: boolean;
  readonly blockChecked: boolean;
  readonly trailNode: 0 | 1 | 2 | 3;
  readonly duplicateReviewed: boolean;
  readonly duplicateRejected: boolean;
  readonly receiptStep: 0 | 1 | 2 | 3 | 4;
  readonly validatorVotes: 0 | 1 | 2 | 3;
  readonly browserClaimSeen: boolean;
  readonly serverVerified: boolean;
  readonly beaconSeals: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly notice: string;
  readonly actions: readonly RouteAction[];
}

// This ledger is deliberately local practice. It cannot produce a payment
// receipt, competitive score, reward entitlement or wallet request.
export function createRouteRun(role: RouteRun['role']): RouteRun {
  return { version: 1, role, chapter: 0, stage: 'arrive', recipientChecked: false, amountChecked: false, blockChecked: false, trailNode: 0, duplicateReviewed: false, duplicateRejected: false, receiptStep: 0, validatorVotes: 0, browserClaimSeen: false, serverVerified: false, beaconSeals: 0, notice: '', actions: [] };
}

export const BEACON_SEALS = ['ASK', 'CHECK', 'APPROVE', 'CONFIRM', 'VERIFY', 'UNLOCK'] as const;

export const ROUTE_LESSONS = [
  { name: 'Genesis Garden', citizen: 'Mara', need: 'Mara wants to pay 0.1 NIM for a harbor lantern, but the delivery route is stuck.', weak: 'Mara approved the payment', evidence: 'The current network record matches the shop, order and 0.1 NIM amount', question: 'Why did the shop wait after Mara approved?', answer: 'Approval gives permission. A matching current network record proves the payment.', wrong: 'Approval alone means the shop received the payment.', result: 'The shop releases the lantern. The first route is open.' },
  { name: 'Light Forest', citizen: 'Nia the network observer', need: 'Nia needs the clinic path lit before her family walks home through the forest.', weak: 'The canopy flashed green', evidence: 'A fresh provider view agrees with consensus and the latest block', question: 'Which trail is safe to follow?', answer: 'Follow provider readiness, consensus and the latest block in order.', wrong: 'The brightest cached branch is safe.', result: 'Nia verifies a living view on a light device. The forest relay wakes.' },
  { name: 'Pay Harbor', citizen: 'Ivo the ferryman', need: 'Ivo has a transaction hash, but cannot safely release the ferry cargo.', weak: 'The lookup returned a hash', evidence: 'Canonical transaction: correct recipient, Lunas and network', question: 'What lets Ivo release the cargo?', answer: 'Verified transaction details, not the hash alone.', wrong: 'Any transaction hash proves the cargo was paid for.', result: 'Ivo releases the cargo. Harbor deliveries resume.' },
  { name: 'Albatross Causeway', citizen: 'Sana the courier', need: 'Sana saw a fast block, but the route monitor still warns of a possible reorganization.', weak: 'A micro block includes the transaction', evidence: 'Canonical inclusion with the required finality evidence', question: 'Does a fast micro block finish the check?', answer: 'No. Check canonical inclusion and the required finality.', wrong: 'Fast inclusion always means finality.', result: 'Sana crosses with confirmed supplies. The causeway signal holds.' },
  { name: 'Validator Peaks', citizen: 'Tavi the route maintainer', need: 'One validator says the route is ready. Tavi needs agreement before reopening it.', weak: 'One validator reports success', evidence: 'Protocol-validated consensus evidence', question: 'Whose statement can Tavi trust on its own?', answer: 'No single statement replaces verified consensus evidence.', wrong: 'One familiar validator is enough.', result: 'Tavi restores the shared route after checking consensus.' },
  { name: 'Builder City', citizen: 'Noor the shop builder', need: 'Noor sees a green browser badge, but the shop server has not accepted payment evidence.', weak: 'The browser display says paid', evidence: 'Server verification of canonical evidence for this order', question: 'Who decides whether the shop unlocks?', answer: 'The server verifies evidence; the browser presents the result.', wrong: 'A local paid flag authorizes fulfillment.', result: 'Noor repairs the authority boundary. The shop opens safely.' },
  { name: 'Beacon Core', citizen: 'The beacon keeper', need: 'Six routes work separately. The keeper must connect them without turning a guess into authority.', weak: 'All six parts look green', evidence: 'Separate intent, verification and consequence linked by the exact request', question: 'What keeps the whole network trustworthy?', answer: 'Keep consent, verification and fulfillment separate and linked.', wrong: 'Combine all green signals into one success flag.', result: 'The beacon joins six independently checked routes. The city is connected.' },
] as const;

// The world registry keeps the original protocol cascade for the 3D scenes.
// The playable story order is human-first: Genesis, Light Forest, Pay Harbor,
// Causeway, Peaks, Builder City, then the Beacon finale.
const ROUTE_WORLD_INDICES: readonly number[] = [0, 4, 1, 2, 3, 5, 6];

export function routeLesson(run: RouteRun) { return ROUTE_LESSONS[run.chapter]!; }
export function routeWorld(run: RouteRun) { return ATLAS_DISTRICT_WORLDS[ROUTE_WORLD_INDICES[run.chapter]!]!; }

export function routeTarget(run: RouteRun): string {
  if (run.stage === 'evidence') return 'community-plaza';
  if (run.stage === 'verified') return 'travel-pay-harbor';
  return 'mission-guide';
}

export function routeRestoration(run: RouteRun): AtlasRestorationState {
  return run.stage === 'restored' || run.stage === 'complete' ? 'restored' : run.stage === 'verified' ? 'confirming' : 'waiting';
}

export function routeProgress(run: RouteRun): AtlasMissionProgress {
  const stages: readonly RouteStage[] = ['arrive', 'request', 'signal', 'refused', 'evidence', 'verified', 'restored', 'complete'];
  const index = stages.indexOf(run.stage);
  return { reachedNeed: index > 0, attempted: index >= 3, evidenceGathered: index >= 5, installed: index >= 6, taughtBack: index === 7 };
}

export function stepRouteRun(run: RouteRun, action: RouteAction): RouteRun {
  let change: Partial<RouteRun> | null = null;
  const at = (stage: RouteStage) => run.stage === stage;
  switch (action) {
    case 'talk': if (at('arrive')) change = { stage: 'request' }; break;
    case 'check-recipient': if (at('request')) change = { recipientChecked: true }; break;
    case 'check-amount': if (at('request')) change = { amountChecked: true }; break;
    case 'check-block': if (at('request') && run.chapter === 1) change = { blockChecked: true }; break;
    case 'approve-practice':
      if (at('request')) change = (run.chapter === 1
        ? run.recipientChecked && run.amountChecked && run.blockChecked
        : run.recipientChecked && run.amountChecked)
        ? { stage: 'signal' }
        : { notice: run.chapter === 1 ? 'Read the provider, consensus and latest block before following the trail.' : 'Check both the recipient and the exact amount before giving permission.' };
      break;
    case 'try-signal': if (at('signal')) change = { stage: 'refused', notice: routeWorld(run).chapter.refutation }; break;
    case 'follow-trail':
      if (at('signal') && run.chapter === 1) {
        const trailNode = Math.min(3, run.trailNode + 1) as RouteRun['trailNode'];
        change = trailNode === 3
          ? { stage: 'evidence', trailNode, notice: 'The fresh view held. Inspect the route record before promising the clinic a path.' }
          : { trailNode, notice: `Fresh trail node ${trailNode} held. Follow the next signal before it fades.` };
      }
      break;
    case 'follow-stale-trail': if (at('signal') && run.chapter === 1) change = { notice: 'That branch is cached. Return to the bright signal and follow the fresh view in order.' }; break;
    case 'compare-requests': if (at('signal') && run.chapter === 2) change = { stage: 'evidence', duplicateReviewed: true, notice: 'Two lantern requests share a story. Compare the exact recipient, amount and network before releasing one.' }; break;
    case 'advance-receipt':
      if (at('signal') && run.chapter === 3) {
        const nextReceiptStep = Math.min(4, run.receiptStep + 1) as RouteRun['receiptStep'];
        change = nextReceiptStep === 4
          ? { stage: 'evidence', receiptStep: nextReceiptStep, notice: 'Finality evidence is ready. Compare the receipt before releasing the medicine.' }
          : { receiptStep: nextReceiptStep, notice: `Receipt state ${nextReceiptStep} reached. Read the next signal before releasing the medicine.` };
      }
      break;
    case 'trust-early-receipt': if (at('signal') && run.chapter === 3) change = { notice: 'Too early. A lookup or fast inclusion does not yet prove the medicine is safe to deliver.' }; break;
    case 'collect-validator':
      if (at('signal') && run.chapter === 4) {
        const validatorVotes = Math.min(3, run.validatorVotes + 1) as RouteRun['validatorVotes'];
        change = validatorVotes === 3
          ? { stage: 'evidence', validatorVotes, notice: 'Three independent validators agree. Compare the consensus record before reopening the route.' }
          : { validatorVotes, notice: `Validator ${validatorVotes} agrees. Check another independent validator before trusting the route.` };
      }
      break;
    case 'trust-single-validator': if (at('signal') && run.chapter === 4) change = { notice: 'One validator can be wrong or delayed. Gather independent agreement before reopening a shared route.' }; break;
    case 'inspect-browser': if (at('signal') && run.chapter === 5) change = { browserClaimSeen: true, notice: 'The browser display is a claim from the client. Send the exact order to the server before unlocking anything.' }; break;
    case 'trust-browser': if (at('signal') && run.chapter === 5) change = { notice: 'The green browser badge is not authority. A client can display paid without proving canonical fulfillment.' }; break;
    case 'verify-server':
      if (at('signal') && run.chapter === 5) change = run.browserClaimSeen
        ? { stage: 'evidence', serverVerified: true, notice: 'The server checked the exact order against canonical evidence. Compare the unlock record.' }
        : { notice: 'Inspect the browser claim first, then send that exact order for server verification.' };
      break;
    case 'connect-beacon-seal':
      if (at('signal') && run.chapter === 6) {
        const beaconSeals = Math.min(6, run.beaconSeals + 1) as RouteRun['beaconSeals'];
        change = beaconSeals === 6
          ? { stage: 'evidence', beaconSeals, notice: 'All six Beacon seals are assembled. Check the complete chain before restoring the core.' }
          : { beaconSeals, notice: `Beacon seal ${beaconSeals} connected. Keep consent, proof and fulfillment separate as you assemble the next one.` };
      }
      break;
    case 'rush-beacon':
      if (at('signal') && run.chapter === 6) change = { notice: 'The Beacon cannot turn one green signal into authority. Assemble all six seals in order, then check the complete chain.' };
      break;
    case 'investigate': if (at('refused')) change = { stage: 'evidence' }; break;
    case 'weak-evidence': if (at('evidence')) change = { notice: 'Route stays closed: this message makes a claim, but it does not prove the payment.' }; break;
    case 'reorg-evidence':
      if (at('evidence')) change = run.chapter === 2
        ? { duplicateRejected: true, notice: 'Duplicate request blocked. One lantern, one exact request. Now accept the original only.' }
        : { notice: 'Old record rejected: the practice network changed, so this record is no longer current. Compare the records again.' };
      break;
    case 'match-evidence':
      if (at('evidence')) change = run.chapter === 2 && !run.duplicateReviewed
        ? { notice: 'Compare both lantern requests before accepting either one.' }
        : run.chapter === 2 && !run.duplicateRejected
          ? { notice: 'Reject the duplicate request first. The exact request is safe only after the replay is blocked.' }
          : run.chapter === 3 && run.receiptStep < 4
            ? { notice: 'Wait for finality. The medicine route is not safe to release from an early receipt.' }
          : run.chapter === 4 && run.validatorVotes < 3
            ? { notice: 'Consensus is incomplete. Gather agreement from three independent validators before reopening the route.' }
          : run.chapter === 5 && !run.serverVerified
            ? { notice: 'The server has not verified this order yet. A browser display cannot unlock the kiosk.' }
          : run.chapter === 6 && run.beaconSeals < 6
            ? { notice: 'The Beacon chain is incomplete. Assemble all six seals before restoring the core.' }
          : { stage: 'verified', notice: 'Payment proof accepted. Carry the checked result to the route gate.' };
      break;
    case 'install': if (at('verified')) change = { stage: 'restored', notice: routeLesson(run).result }; break;
    case 'wrong-answer': if (at('restored')) change = { notice: 'Think about what the first signal could not prove. Try again; the restored route stays safe.' }; break;
    case 'teach-back': if (at('restored')) change = { stage: 'complete', notice: 'Lesson remembered locally. No NIM sent or reward claimed.' }; break;
    case 'next': if (at('complete') && run.chapter < ROUTE_LESSONS.length - 1) change = { chapter: run.chapter + 1, stage: 'arrive', recipientChecked: false, amountChecked: false, blockChecked: false, trailNode: 0, duplicateReviewed: false, duplicateRejected: false, receiptStep: 0, validatorVotes: 0, browserClaimSeen: false, serverVerified: false, beaconSeals: 0 }; break;
  }
  if (!change) return run;
  // Keep progression plus the current retry notice, not an unbounded mistake
  // counter. Learners can retry forever without exhausting their saved journal.
  const last = run.actions[run.actions.length - 1];
  const retry = last === 'weak-evidence' || (last === 'reorg-evidence' && run.chapter !== 2) || last === 'wrong-answer' || last === 'follow-stale-trail' || last === 'trust-early-receipt' || last === 'trust-single-validator' || last === 'trust-browser' || last === 'rush-beacon'
    || (last === 'match-evidence' && run.chapter === 3 && run.receiptStep < 4)
    || (last === 'match-evidence' && run.chapter === 4 && run.validatorVotes < 3)
    || (last === 'match-evidence' && run.chapter === 6 && run.beaconSeals < 6)
    || (last === 'approve-practice' && run.stage === 'request');
  const history = retry ? run.actions.slice(0, -1) : run.actions;
  const repeatedCheck = (action === 'check-recipient' && run.recipientChecked)
    || (action === 'check-amount' && run.amountChecked)
    || (action === 'check-block' && run.blockChecked);
  return { ...run, notice: '', ...change, actions: repeatedCheck ? history : [...history, action] };
}

export function replayRouteRun(role: RouteRun['role'], actions: readonly RouteAction[]): RouteRun {
  return actions.slice(0, 256).reduce(stepRouteRun, createRouteRun(role));
}

export function recoverRouteRun(value: unknown): RouteRun | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Record<string, unknown>;
  if (saved.version !== 1 || (saved.role !== 'explorer' && saved.role !== 'builder') || !Array.isArray(saved.actions) || saved.actions.length > 256) return null;
  if (!saved.actions.every((action) => typeof action === 'string')) return null;
  // Unknown or out-of-order events are rejected, rather than trusting saved flags.
  let run = createRouteRun(saved.role);
  for (const action of saved.actions) {
    const next = stepRouteRun(run, action as RouteAction);
    if (next === run) return null;
    run = next;
  }
  return run;
}
