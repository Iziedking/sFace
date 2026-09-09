import { BEACON_SEALS, routeLesson, routeWorld, type RouteAction, type RouteRun } from '../../../shared/atlas/adventures/route-rescue';

export function createRouteCard(run: RouteRun, act: (action: RouteAction) => void): HTMLElement {
  const lesson = routeLesson(run);
  const card = document.createElement('section');
  card.className = 'atlas-route-card';
  card.dataset.chapter = String(run.chapter);
  card.setAttribute('aria-label', 'Route investigation');
  const heading = document.createElement('h2');
  heading.textContent = run.chapter === 0 ? 'The Wrong House' : `${lesson.name} relay`;
  const provenance = document.createElement('p');
  provenance.className = 'atlas-route-provenance';
  provenance.textContent = run.chapter === 0
    ? 'CHAPTER 1 / GENESIS GARDEN / HELP THE PARCEL FIND ITS HOME'
    : run.chapter === 1
      ? 'CHAPTER 2 / LIGHT FOREST / FOLLOW THE FRESH SIGNAL'
      : run.chapter === 2
      ? 'CHAPTER 3 / PAY HARBOR / CATCH THE DUPLICATE'
      : run.chapter === 3
        ? 'CHAPTER 4 / ALBATROSS CAUSEWAY / MOVE THE RECEIPT CLOCK'
      : run.chapter === 4
        ? 'CHAPTER 5 / VALIDATOR PEAKS / BUILD CONSENSUS'
      : run.chapter === 5
        ? 'CHAPTER 6 / BUILDER CITY / PROTECT THE UNLOCK'
      : run.chapter === 6
        ? 'CHAPTER 7 / BEACON CORE / ASSEMBLE THE SIX SEALS'
      : `Practice · no NIM sent · ${run.chapter + 1}/7 · ${run.role}`;
  const detail = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'atlas-route-choices';
  const button = (label: string, action: RouteAction, checked = false, disabled = false) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    if (checked) control.setAttribute('aria-pressed', 'true');
    control.disabled = disabled;
    control.onclick = () => act(action);
    actions.append(control);
  };
  switch (run.stage) {
    case 'arrive':
      detail.textContent = run.chapter === 0
        ? 'A child is waiting for a birthday parcel. Move to Mara and open the request table.'
        : `${lesson.need} Follow the marker and ask Mara what happened.`;
      break;
    case 'request':
      detail.textContent = run.chapter === 0
        ? 'Scan the two route fragments, then assemble the parcel request. The correct home lights when the route is readable.'
        : run.chapter === 1
        ? 'The forest path is bright, but the view may be old. Read the provider, consensus signal and latest block before you promise a safe route.'
        : run.chapter === 2
        ? 'Two lantern requests are waiting. Read both before anything is released. One is exact. One is a duplicate replay.'
        : run.chapter === 3
        ? 'Sana is waiting with medicine. Read the sender, recipient and amount before the receipt clock starts.'
        : run.chapter === 4
        ? 'Tavi has one validator report. Climb the peak and gather independent agreement before reopening the route.'
        : run.chapter === 5
        ? 'Noor built a kiosk that shows a green browser badge. Inspect the claim, then let the server decide whether the shop may unlock.'
        : run.chapter === 6
        ? 'The city has six repaired routes. Move to the Beacon keeper and assemble them without collapsing their jobs together.'
        : `Investigate: ${lesson.need} Check the scope and authority before testing the apparent signal.`;
      if (run.chapter === 1) {
        button(`${run.recipientChecked ? '✓ ' : ''}READ PROVIDER STATUS / ready`, 'check-recipient', run.recipientChecked);
        button(`${run.amountChecked ? '✓ ' : ''}READ CONSENSUS SIGNAL / current`, 'check-amount', run.amountChecked);
        button(`${run.blockChecked ? '✓ ' : ''}READ LATEST BLOCK / height 4812`, 'check-block', run.blockChecked);
      } else if (run.chapter === 2) {
        button(`${run.recipientChecked ? '✓ ' : ''}OPEN REQUEST A / Beacon Lantern Shop / 0.1 NIM`, 'check-recipient', run.recipientChecked);
        button(`${run.amountChecked ? '✓ ' : ''}OPEN REQUEST B / duplicate replay / changed route`, 'check-amount', run.amountChecked);
      } else {
        button(`${run.recipientChecked ? '✓ ' : ''}${run.chapter === 0 ? 'SCAN DESTINATION / Beacon Lantern Shop' : ROUTE_CHECKS[run.chapter]![0]}`, 'check-recipient', run.recipientChecked);
        button(`${run.amountChecked ? '✓ ' : ''}${run.chapter === 0 ? 'SCAN AMOUNT / 0.1 NIM = 10,000 Lunas' : ROUTE_CHECKS[run.chapter]![1]}`, 'check-amount', run.amountChecked);
      }
      button(run.chapter === 0 ? 'ASSEMBLE AND SEND PARCEL' : run.chapter === 1 ? 'OPEN THE FRESH TRAIL' : run.chapter === 2 ? 'COMPARE THE TWO LANTERN REQUESTS' : run.chapter === 3 ? 'START THE RECEIPT CLOCK' : run.chapter === 4 ? 'OPEN THE CONSENSUS CLIMB' : run.chapter === 5 ? 'OPEN THE KIOSK CHECK' : run.chapter === 6 ? 'OPEN THE SIX-SEAL ASSEMBLY' : run.chapter < 2 ? 'Approve practice request' : 'Authorize this practice check', 'approve-practice', false, run.chapter === 1 ? !(run.recipientChecked && run.amountChecked && run.blockChecked) : !(run.recipientChecked && run.amountChecked));
      break;
    case 'signal':
      detail.textContent = run.chapter === 0
        ? 'Mara gave permission. The parcel still needs a current route record before it can leave.'
        : run.chapter === 1
        ? `The canopy is blinking. Follow the fresh signal in order: node ${Math.min(3, run.trailNode + 1)} of 3. A cached branch leads nowhere.`
        : run.chapter === 2
        ? 'A duplicate replay is trying to use the harbor route twice. Compare the two requests before the lantern moves.'
        : run.chapter === 3
        ? `Receipt clock: ${RECEIPT_STATES[Math.min(3, run.receiptStep)]}. A hash is not safe delivery. Move through each state.`
        : run.chapter === 4
        ? `Consensus climb: ${run.validatorVotes} of 3 validators agree. One voice can be wrong; gather the route together.`
        : run.chapter === 5
        ? run.browserClaimSeen ? 'The browser says paid. Now ask the server to verify the exact order before the kiosk opens.' : 'A green browser badge says “paid”. Inspect how the client can be wrong before you trust it.'
        : run.chapter === 6
        ? `Six-seal assembly: ${run.beaconSeals} of 6 connected. Next seal: ${BEACON_SEALS[Math.min(5, run.beaconSeals)] ?? 'complete'}. Keep ASK, CHECK, APPROVE, CONFIRM, VERIFY and UNLOCK distinct.`
        : `The display looks successful: “${lesson.weak}”. Is the route ready?`;
      if (run.chapter === 1) {
        button(`FOLLOW THE FRESH TRAIL / ${FADING_TRAIL_NODES[Math.min(2, run.trailNode)] ?? 'route board'}`, 'follow-trail');
        button('CHASE THE STALE TRAIL / cached branch', 'follow-stale-trail');
      } else if (run.chapter === 2) button('COMPARE THE TWO LANTERN REQUESTS', 'compare-requests');
      else if (run.chapter === 3) {
        button(`ADVANCE THE RECEIPT CLOCK / ${RECEIPT_STATES[Math.min(3, run.receiptStep)]}`, 'advance-receipt');
        button('TRUST THE EARLY RECEIPT', 'trust-early-receipt');
      }
      else if (run.chapter === 4) {
        button(`CHECK THE NEXT VALIDATOR / ${Math.min(3, run.validatorVotes + 1)} OF 3`, 'collect-validator');
        button('TRUST ONE VALIDATOR', 'trust-single-validator');
      }
      else if (run.chapter === 5) {
        button(`${run.browserClaimSeen ? '✓ ' : ''}INSPECT THE BROWSER CLAIM / local display`, 'inspect-browser', run.browserClaimSeen);
        button('VERIFY ON THE SERVER / canonical order', 'verify-server', false, !run.browserClaimSeen);
        button('TRUST THE GREEN BADGE', 'trust-browser');
      }
      else if (run.chapter === 6) {
        button(`CONNECT THE NEXT BEACON SEAL / ${BEACON_SEALS[Math.min(5, run.beaconSeals)] ?? 'COMPLETE'}`, 'connect-beacon-seal');
        button('RUSH THE BEACON', 'rush-beacon');
      }
      else button(run.chapter === 0 ? 'FOLLOW THE PARCEL SIGNAL' : 'Try opening the route', 'try-signal');
      break;
    case 'refused':
      detail.textContent = run.chapter === 0
        ? 'The route stopped. Approval is permission, not proof that the parcel arrived. Find the current route record.'
        : `Route held. ${routeWorld(run).chapter.refutation}`;
      button(run.chapter === 0 ? 'SCAN THE ROUTE BOARD' : 'Find the evidence station', 'investigate');
      break;
    case 'evidence':
      detail.textContent = run.chapter === 0
        ? 'One record is a message. One is current. One was withdrawn. Choose the record that matches the destination and amount.'
        : run.chapter === 1
        ? 'The fresh view agrees with the route board. Choose the record that matches the latest block, not the cached branch.'
        : run.chapter === 2
        ? run.duplicateRejected ? 'The duplicate is blocked. Accept only the original request with the exact recipient, amount and network.' : 'Compare the requests, reject the duplicate replay, then accept the original once.'
        : run.chapter === 3
        ? 'The receipt has reached finality. Choose the record that proves it, not the lookup or fast inclusion.'
        : run.chapter === 4
        ? 'Three independent validators agree. Choose the consensus record, not the loudest single report.'
        : run.chapter === 5
        ? 'The server has checked the exact order against canonical evidence. Choose the server record, not the browser badge.'
        : run.chapter === 6
        ? 'All six seals are connected. Choose the record that keeps consent, verification and fulfillment linked but separate.'
        : 'At the plaza station, compare the practice records. Which one supports this route?';
      break;
    case 'verified':
      detail.textContent = run.chapter === 0
        ? 'The current record matches the destination and 0.1 NIM. Carry the checked parcel route to the garden gate.'
        : run.chapter === 2
        ? 'The exact lantern request is the only one that survived review. Deliver one verified lantern to the harbor tower.'
        : run.chapter === 3
        ? 'The medicine route is final. Carry the verified receipt to the ferry gate.'
        : run.chapter === 4
        ? 'The route has shared agreement. Carry the consensus record to the peak relay.'
        : run.chapter === 5
        ? 'The server verified the order. Carry the authority record to the kiosk terminal.'
        : run.chapter === 6
        ? 'The complete chain is intact. Carry the assembled Beacon record to the core terminal.'
        : `${lesson.evidence}. Practice record accepted. Take the checked relay to the Pay Harbor gate and install it.`;
      if (run.chapter === 0) button('DELIVER THE CHECKED PARCEL', 'install');
      else if (run.chapter === 2) button('DELIVER ONE VERIFIED LANTERN', 'install');
      else if (run.chapter === 3) button('RELEASE THE MEDICINE', 'install');
      else if (run.chapter === 4) button('REOPEN THE SHARED ROUTE', 'install');
      else if (run.chapter === 5) button('UNLOCK THE KIOSK', 'install');
      else if (run.chapter === 6) button('RESTORE THE BEACON CORE', 'install');
      break;
    case 'restored':
      detail.textContent = run.chapter === 0
        ? 'The parcel found its home. Place the first Beacon thread on the garden post.'
        : run.chapter === 1
        ? 'The clinic route is visible again. Light the canopy so families can follow it home.'
        : run.chapter === 2
        ? 'The harbor accepted one exact request. Release the lantern and reopen the night route.'
        : run.chapter === 3
        ? 'The medicine is safe to release. Open the ferry route and continue the lesson.'
        : run.chapter === 4
        ? 'The shared route is open again. Teach the city why several independent validators beat one confident voice.'
        : run.chapter === 5
        ? 'The kiosk is open. Teach the city why the browser presents a result, but the server verifies the payment before fulfillment.'
        : run.chapter === 6
        ? 'The Beacon is restored. Teach the whole loop: Ask, Check, Approve, Confirm, Verify, Unlock.'
        : `${lesson.result} ${lesson.question}`;
      if (run.chapter === 0) button('PLACE THE FIRST BEACON THREAD', 'teach-back');
      else if (run.chapter === 1) button('LIGHT THE CLINIC CANOPY', 'teach-back');
      else if (run.chapter === 2) button('RELEASE ONE VERIFIED LANTERN', 'teach-back');
      else if (run.chapter === 3) button('OPEN THE MEDICINE FERRY', 'teach-back');
      else if (run.chapter === 4) button('TEACH CONSENSUS AT THE PEAK', 'teach-back');
      else if (run.chapter === 5) button('TEACH THE KIOSK RULE', 'teach-back');
      else if (run.chapter === 6) button('TEACH THE COMPLETE BEACON LOOP', 'teach-back');
      else {
        // Alternate placement so memorizing the first button cannot finish the cascade.
        if (run.chapter % 2 === 0) button(lesson.wrong, 'wrong-answer');
        button(lesson.answer, 'teach-back');
        if (run.chapter % 2 !== 0) button(lesson.wrong, 'wrong-answer');
      }
      break;
    case 'complete':
      detail.textContent = run.chapter === 0
        ? 'The first Beacon thread is lit. Mara can now take the next route toward Pay Harbor.'
        : run.chapter === 1
        ? 'The forest relay is restored. The next route leads to Pay Harbor.'
        : run.chapter === 2
        ? 'The harbor is open. The next route carries the medicine across Albatross Causeway.'
        : run.chapter === 3
        ? 'The causeway is safe. The next route climbs to Validator Peaks.'
        : run.chapter === 4
        ? 'Validator agreement restored the shared route. The next investigation enters Builder City.'
        : run.chapter === 5
        ? 'Builder City is open. The final route leads to Beacon Core.'
        : run.chapter < 6 ? 'Route restored. The next investigation is available at the Commons training relay.' : 'All six routes now reinforce one another. The Beacon is alive, and Atlas can guide the next season.';
      if (run.chapter < 6) button('Investigate the next relay', 'next');
      break;
  }
  card.append(provenance, heading, detail, actions);
  const disclosure = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'What this teaches';
  const explanation = document.createElement('p');
  explanation.textContent = run.role === 'builder' ? routeWorld(run).chapter.builderRepair : routeWorld(run).chapter.explorerAction;
  disclosure.append(summary, explanation);
  card.append(disclosure);
  if (run.notice) {
    const status = document.createElement('p');
    status.className = 'atlas-route-notice';
    status.setAttribute('role', 'status');
    status.textContent = run.notice;
    card.append(status);
  }
  return card;
}

export function createEvidenceChoices(run: RouteRun, act: (action: RouteAction) => void): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'atlas-route-choices';
  const lesson = routeLesson(run);
  const record = document.createElement('p');
  record.textContent = run.chapter === 0
    ? 'The parcel is 0.1 NIM, written as 10,000 Lunas. Scan the record that matches its destination and amount.'
    : run.chapter === 1
      ? 'The canopy is at block 4812. Match the provider, consensus signal and latest block before the path opens.'
      : run.chapter === 2
      ? 'Two requests mention the same lantern. The duplicate changes the route. Reject it, then accept the exact original.'
      : run.chapter === 3
      ? 'Receipt clock: lookup, inclusion, confirmation, finality. Choose the record that proves finality.'
      : run.chapter === 4
      ? 'Three validator reports are visible. Choose the record that represents independent agreement, not a single claim.'
      : run.chapter === 5
      ? 'The browser badge is only a presentation. Choose the server record that proves this exact order before unlocking the kiosk.'
      : run.chapter === 6
      ? 'The six seals are ASK, CHECK, APPROVE, CONFIRM, VERIFY and UNLOCK. Select the chain that keeps consent, verification and fulfillment distinct.'
      : run.chapter < 2
      ? 'Practice payment: Ivo has a cargo order for 0.1 NIM, written as 10,000 Lunas. Match the order, recipient, amount and current network record.'
      : `Practice evidence B: ${routeWorld(run).chapter.evidence} Record A only supports the apparent claim. Record C has been withdrawn and must be checked again.`;
  panel.append(record);
  for (const [label, action] of [
    [run.chapter === 0 ? 'A / Mara approved the request. Permission only.' : run.chapter === 1 ? 'A / Cached canopy view from block 4809.' : run.chapter === 2 ? 'ACCEPT THE EXACT REQUEST / A / Beacon Lantern Shop / 0.1 NIM / current network.' : run.chapter === 3 ? 'A / Lookup received. A hash is a starting point, not delivery proof.' : run.chapter === 4 ? 'A / One validator reports success. One report is not consensus.' : run.chapter === 5 ? 'A / Browser badge says paid. The client can display a claim without proof.' : run.chapter === 6 ? 'A / One green browser signal controls the whole Beacon.' : `Record A · ${lesson.weak}`, run.chapter === 2 ? 'match-evidence' : 'weak-evidence'],
    [run.chapter === 0 ? 'B / Current record matches destination, amount, and network.' : run.chapter === 1 ? 'B / Fresh provider, consensus and block 4812 agree.' : run.chapter === 2 ? `${run.duplicateRejected ? '✓ DUPLICATE BLOCKED' : 'REJECT THE DUPLICATE'} / B / same order, changed recipient or network.` : run.chapter === 3 ? 'B / Finality reached for the exact medicine route.' : run.chapter === 4 ? 'B / Three independent validators agree on the same route.' : run.chapter === 5 ? 'B / Server verified canonical evidence for the exact order.' : run.chapter === 6 ? 'B / Consent, verification and fulfillment stay separate and point to the same request.' : `Record B · ${lesson.evidence}`, run.chapter === 2 ? 'reorg-evidence' : 'match-evidence'],
    [run.chapter === 0 ? 'C / Old record withdrawn after the route changed.' : run.chapter === 1 ? 'C / Bright signal with no current consensus.' : run.chapter === 2 ? 'C / Old request: already fulfilled and cannot be reused.' : run.chapter === 3 ? 'C / Fast inclusion with no finality.' : run.chapter === 4 ? 'C / Two reports are stale and cannot establish the current route.' : run.chapter === 5 ? 'C / Local paid flag asks to unlock without server proof.' : run.chapter === 6 ? 'C / Six disconnected signals are treated as one proof.' : 'Record C · withdrawn after a simulated reorganization', run.chapter === 2 ? 'weak-evidence' : 'reorg-evidence'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => act(action);
    panel.append(button);
  }
  return panel;
}

const ROUTE_CHECKS: readonly (readonly [string, string])[] = [
  ['Who gets the NIM: Beacon Lantern Shop', 'Amount: 0.1 NIM = 10,000 Lunas'],
  ['Provider: local light view ready', 'Consensus: current signal agrees with the view'],
  ['Order: Ivo cargo delivery · local practice', 'Request: exact recipient, integer Lunas and network'],
  ['Scope: transaction inclusion in the current canonical branch', 'Authority: the required finality evidence, not speed'],
  ['Scope: the route claim made by one validator', 'Authority: protocol-validated consensus'],
  ['Scope: exact shop order and requested consequence', 'Authority: server checks canonical evidence'],
  ['Scope: six completed route lessons', 'Authority: separate consent, verification and fulfillment'],
];

const FADING_TRAIL_NODES = ['provider view', 'consensus signal', 'latest block'] as const;
const RECEIPT_STATES = ['LOOKUP RECEIVED', 'INCLUSION SEEN', 'CONFIRMATIONS GROWING', 'FINALITY READY'] as const;
