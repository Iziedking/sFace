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
  provenance.textContent = run.chapter === 0 ? 'CHAPTER 1 / GENESIS GARDEN / HELP THE PARCEL FIND ITS HOME' : `Practice · no NIM sent · ${run.chapter + 1}/7 · ${run.role}`;
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
        ? run.role === 'builder' ? 'Finding Nimiq Pay does not give the app permission to pay. Check the practice request before approving it.' : 'Check who gets the NIM, how much they get, and the network before approving this practice payment.'
        : `Investigate: ${lesson.need} Check the scope and authority before testing the apparent signal.`;
      button(`${run.recipientChecked ? '✓ ' : ''}${run.chapter === 0 ? 'SCAN DESTINATION / Beacon Lantern Shop' : ROUTE_CHECKS[run.chapter]![0]}`, 'check-recipient', run.recipientChecked);
      button(`${run.amountChecked ? '✓ ' : ''}${run.chapter === 0 ? 'SCAN AMOUNT / 0.1 NIM = 10,000 Lunas' : ROUTE_CHECKS[run.chapter]![1]}`, 'check-amount', run.amountChecked);
      button(run.chapter === 0 ? 'ASSEMBLE AND SEND PARCEL' : run.chapter < 2 ? 'Approve practice request' : 'Authorize this practice check', 'approve-practice', false, !(run.recipientChecked && run.amountChecked));
      break;
    case 'signal':
      detail.textContent = run.chapter === 0
        ? 'Mara gave permission. The parcel still needs a current route record before it can leave.'
        : `The display looks successful: “${lesson.weak}”. Is the route ready?`;
      button(run.chapter === 0 ? 'FOLLOW THE PARCEL SIGNAL' : 'Try opening the route', 'try-signal');
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
        : 'At the plaza station, compare the practice records. Which one supports this route?';
      break;
    case 'verified':
      detail.textContent = run.chapter === 0
        ? 'The current record matches the destination and 0.1 NIM. Carry the checked parcel route to the garden gate.'
        : `${lesson.evidence}. Practice record accepted. Take the checked relay to the Pay Harbor gate and install it.`;
      if (run.chapter === 0) button('DELIVER THE CHECKED PARCEL', 'install');
      break;
    case 'restored':
      detail.textContent = run.chapter === 0
        ? 'The parcel found its home. Place the first Beacon thread on the garden post.'
        : `${lesson.result} ${lesson.question}`;
      if (run.chapter === 0) button('PLACE THE FIRST BEACON THREAD', 'teach-back');
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
        : run.chapter < 6 ? 'Route restored. The next investigation is available at the Commons training relay; Pay Harbor remains open for the delivery adventure.' : 'Seven lessons practiced. Your local journal remembers the investigation; verified rewards still require the separate server-checked challenge.';
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
    : run.chapter < 2
      ? 'Practice payment: Ivo has a cargo order for 0.1 NIM, written as 10,000 Lunas. Match the order, recipient, amount and current network record.'
      : `Practice evidence B: ${routeWorld(run).chapter.evidence} Record A only supports the apparent claim. Record C has been withdrawn and must be checked again.`;
  panel.append(record);
  for (const [label, action] of [
    [run.chapter === 0 ? 'A / Mara approved the request. Permission only.' : `Record A · ${lesson.weak}`, 'weak-evidence'],
    [run.chapter === 0 ? 'B / Current record matches destination, amount, and network.' : `Record B · ${lesson.evidence}`, 'match-evidence'],
    [run.chapter === 0 ? 'C / Old record withdrawn after the route changed.' : 'Record C · withdrawn after a simulated reorganization', 'reorg-evidence'],
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
  ['Order: Ivo cargo delivery · local practice', 'Request: exact recipient, integer Lunas and network'],
  ['Scope: transaction inclusion in the current canonical branch', 'Authority: the required finality evidence, not speed'],
  ['Scope: the route claim made by one validator', 'Authority: protocol-validated consensus'],
  ['Scope: the route proof and its consensus reference', 'Authority: verify the proof, not the download size'],
  ['Scope: exact shop order and requested consequence', 'Authority: server checks canonical evidence'],
  ['Scope: six completed route lessons', 'Authority: separate consent, verification and fulfillment'],
];
