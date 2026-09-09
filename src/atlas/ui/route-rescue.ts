import { routeLesson, routeWorld, type RouteAction, type RouteRun } from '../../../shared/atlas/adventures/route-rescue';

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
      button(run.chapter === 0 ? 'ASSEMBLE AND SEND PARCEL' : run.chapter === 1 ? 'OPEN THE FRESH TRAIL' : run.chapter === 2 ? 'COMPARE THE TWO LANTERN REQUESTS' : run.chapter < 2 ? 'Approve practice request' : 'Authorize this practice check', 'approve-practice', false, run.chapter === 1 ? !(run.recipientChecked && run.amountChecked && run.blockChecked) : !(run.recipientChecked && run.amountChecked));
      break;
    case 'signal':
      detail.textContent = run.chapter === 0
        ? 'Mara gave permission. The parcel still needs a current route record before it can leave.'
        : run.chapter === 1
        ? `The canopy is blinking. Follow the fresh signal in order: node ${Math.min(3, run.trailNode + 1)} of 3. A cached branch leads nowhere.`
        : run.chapter === 2
        ? 'A duplicate replay is trying to use the harbor route twice. Compare the two requests before the lantern moves.'
        : `The display looks successful: “${lesson.weak}”. Is the route ready?`;
      if (run.chapter === 1) {
        button(`FOLLOW THE FRESH TRAIL / ${FADING_TRAIL_NODES[Math.min(2, run.trailNode)] ?? 'route board'}`, 'follow-trail');
        button('CHASE THE STALE TRAIL / cached branch', 'follow-stale-trail');
      } else if (run.chapter === 2) button('COMPARE THE TWO LANTERN REQUESTS', 'compare-requests');
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
        : 'At the plaza station, compare the practice records. Which one supports this route?';
      break;
    case 'verified':
      detail.textContent = run.chapter === 0
        ? 'The current record matches the destination and 0.1 NIM. Carry the checked parcel route to the garden gate.'
        : run.chapter === 2
        ? 'The exact lantern request is the only one that survived review. Deliver one verified lantern to the harbor tower.'
        : `${lesson.evidence}. Practice record accepted. Take the checked relay to the Pay Harbor gate and install it.`;
      if (run.chapter === 0) button('DELIVER THE CHECKED PARCEL', 'install');
      else if (run.chapter === 2) button('DELIVER ONE VERIFIED LANTERN', 'install');
      break;
    case 'restored':
      detail.textContent = run.chapter === 0
        ? 'The parcel found its home. Place the first Beacon thread on the garden post.'
        : run.chapter === 1
        ? 'The clinic route is visible again. Light the canopy so families can follow it home.'
        : run.chapter === 2
        ? 'The harbor accepted one exact request. Release the lantern and reopen the night route.'
        : `${lesson.result} ${lesson.question}`;
      if (run.chapter === 0) button('PLACE THE FIRST BEACON THREAD', 'teach-back');
      else if (run.chapter === 1) button('LIGHT THE CLINIC CANOPY', 'teach-back');
      else if (run.chapter === 2) button('RELEASE ONE VERIFIED LANTERN', 'teach-back');
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
        : run.chapter < 6 ? 'Route restored. The next investigation is available at the Commons training relay.' : 'Seven lessons practiced. Your local journal remembers the investigation; verified rewards still require the separate server-checked challenge.';
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
    : run.chapter < 2
      ? 'Practice payment: Ivo has a cargo order for 0.1 NIM, written as 10,000 Lunas. Match the order, recipient, amount and current network record.'
      : `Practice evidence B: ${routeWorld(run).chapter.evidence} Record A only supports the apparent claim. Record C has been withdrawn and must be checked again.`;
  panel.append(record);
  for (const [label, action] of [
    [run.chapter === 0 ? 'A / Mara approved the request. Permission only.' : run.chapter === 1 ? 'A / Cached canopy view from block 4809.' : run.chapter === 2 ? 'ACCEPT THE EXACT REQUEST / A / Beacon Lantern Shop / 0.1 NIM / current network.' : `Record A · ${lesson.weak}`, run.chapter === 2 ? 'match-evidence' : 'weak-evidence'],
    [run.chapter === 0 ? 'B / Current record matches destination, amount, and network.' : run.chapter === 1 ? 'B / Fresh provider, consensus and block 4812 agree.' : run.chapter === 2 ? `${run.duplicateRejected ? '✓ DUPLICATE BLOCKED' : 'REJECT THE DUPLICATE'} / B / same order, changed recipient or network.` : `Record B · ${lesson.evidence}`, run.chapter === 2 ? 'reorg-evidence' : 'match-evidence'],
    [run.chapter === 0 ? 'C / Old record withdrawn after the route changed.' : run.chapter === 1 ? 'C / Bright signal with no current consensus.' : run.chapter === 2 ? 'C / Old request: already fulfilled and cannot be reused.' : 'Record C · withdrawn after a simulated reorganization', run.chapter === 2 ? 'weak-evidence' : 'reorg-evidence'],
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
