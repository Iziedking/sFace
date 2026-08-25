import { genesisObjective, GENESIS_GARDEN_MISSION, type GenesisObjective } from '../../shared/atlas/districts/genesis-garden';
import { createAtlasState, type AtlasState } from '../../shared/atlas/state';
import { stepAtlas } from '../../shared/atlas/step';
import { AtlasInputController, installAtlasKeyboard, type AtlasDirection } from './input';
import { createAtlasProgressStore } from './progress';
import { AtlasRenderer } from './render/renderer';
import { gradeGenesisTrial } from './trials/genesis';
import { ATLAS_PROLOGUE } from '../../shared/atlas/prologue';
import type { AtlasRole } from '../../shared/atlas/types';
import { LAST_LANTERN, createLastLanternState, replayLastLantern, type LastLanternAction, type LastLanternState } from '../../shared/atlas/adventures/last-lantern';
import { ATLAS_KNOWLEDGE_BOOK, createKnowledgeBookState, gradeKnowledgeTeachBack, unlockKnowledgeFragment, type KnowledgeBookState } from '../../shared/atlas/knowledge';
import { ATLAS_DAILY_CHALLENGES } from '../../shared/atlas/daily';
import { ATLAS_EVERGREEN_ADVENTURES, replayEvergreenAdventure, type EvergreenAction, type EvergreenAdventure, type EvergreenState } from '../../shared/atlas/adventures/evergreen';
import { ATLAS_MAINNET_SHOP_ITEMS } from '../../shared/atlas/shop';
import { createAtlasApiClient } from './api';
import { createAtlasWalletAdapter } from './wallet';
import { executeAtlasPayment, AtlasPaymentError } from './payment-flow';
import { readAtlasClientPaymentConfig } from './payment-config';

const TICK_MS = 1_000 / 30;

const BUILDER_REPAIR_STEPS = [
  { title: 'Provider ready', prompt: 'What should initialization do before a wallet action?', answer: 'Return a provider or an honest unavailable state.', choices: ['Return a provider or an honest unavailable state.', 'Request accounts during app boot.'] },
  { title: 'Player intent', prompt: 'When may the route ask for account access?', answer: 'Only after the player chooses the wallet action.', choices: ['Only after the player chooses the wallet action.', 'Whenever the page loads.'] },
  { title: 'Approved accounts', prompt: 'What can the account step return?', answer: 'An approved address list or a clear rejection.', choices: ['An approved address list or a clear rejection.', 'A payment confirmation.'] },
  { title: 'Exact payment', prompt: 'What must the typed request preserve?', answer: 'Testnet, recipient, and integer Lunas.', choices: ['Testnet, recipient, and integer Lunas.', 'A decimal amount and a guessed recipient.'] },
  { title: 'Wallet result', prompt: 'What does the provider result prove?', answer: 'Only a lookup value until chain proof exists.', choices: ['Only a lookup value until chain proof exists.', 'That the item is already fulfilled.'] },
  { title: 'Chain confirmation', prompt: 'When may the route become verified?', answer: 'After canonical evidence reaches the confirmation threshold.', choices: ['After canonical evidence reaches the confirmation threshold.', 'As soon as a hash is returned.'] },
  { title: 'One fulfillment', prompt: 'What should happen after verification?', answer: 'Fulfill the exact order once.', choices: ['Fulfill the exact order once.', 'Create a new item on every retry.'] },
] as const;

class AtlasApp {
  private state: AtlasState = createAtlasState(GENESIS_GARDEN_MISSION);
  private readonly input = new AtlasInputController();
  private readonly renderer: AtlasRenderer;
  private readonly progress = createAtlasProgressStore(safeStorage());
  private readonly paymentConfig = readAtlasClientPaymentConfig();
  private readonly wallet = createAtlasWalletAdapter();
  private readonly api = createAtlasApiClient();
  private readonly sessionActorId = getAtlasSessionActorId(safeStorage());
  private selectedRole: AtlasRole = this.progress.load().activeRole;
  private screen: 'welcome' | 'lantern' | 'playing' | 'trial' | 'book' | 'daily' | 'evergreen' | 'complete' = 'welcome';
  private lanternState: LastLanternState = createLastLanternState('explorer', 'practice');
  private lastFrame = 0;
  private accumulator = 0;
  private suspended = false;
  private builderStep = 0;
  private builderNotice = '';
  private knowledgeState: KnowledgeBookState = createKnowledgeBookState();
  private bookOpen = true;
  private teachBackStep = 0;
  private teachBackNotice = '';
  private dailyNotice = '';
  private evergreenAdventure: EvergreenAdventure = ATLAS_EVERGREEN_ADVENTURES[0]!;
  private evergreenActions: EvergreenAction[] = [];
  private evergreenState: EvergreenState = replayEvergreenAdventure(this.evergreenAdventure, []);
  private evergreenNotice = '';
  private paymentNotice = '';
  private paymentBusy = false;
  private liveOrderId: string | null = null;
  private liveLookup: string | null = null;
  private objectiveHeading: HTMLElement | null = null;
  private objectiveDetail: HTMLElement | null = null;
  private integrityStatus: HTMLElement | null = null;
  private actionButton: HTMLButtonElement | null = null;

  constructor(private readonly ui: HTMLElement, canvas: HTMLCanvasElement) {
    this.renderer = new AtlasRenderer(canvas);
    installAtlasKeyboard(window, this.input);
    window.addEventListener('resize', this.resize);
    window.addEventListener('blur', () => this.suspend('paused'));
    window.addEventListener('focus', this.resume);
    document.addEventListener('visibilitychange', this.visibility);
   this.resize();
  }

  boot(): void {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => undefined);
    this.renderer.draw(this.state, genesisObjective(this.state));
    this.renderWelcome();
  }

  private startGarden = (): void => {
    this.state = createAtlasState(GENESIS_GARDEN_MISSION);
    this.screen = 'playing';
    this.renderPlaying();
    this.lastFrame = performance.now();
    this.accumulator = 0;
    requestAnimationFrame(this.frame);
  };

  private frame = (timestamp: number): void => {
    if (this.screen !== 'playing') return;
    const elapsed = Math.min(200, timestamp - this.lastFrame);
    this.lastFrame = timestamp;
    if (!this.suspended) {
      this.accumulator += elapsed;
      while (this.accumulator >= TICK_MS && this.state.phase === 'running') {
        stepAtlas(this.state, this.input.sample());
        this.accumulator -= TICK_MS;
      }
    }
    const objective = genesisObjective(this.state);
    this.renderer.draw(this.state, objective);
    this.updateHud(objective);
    requestAnimationFrame(this.frame);
  };

  private renderWelcome(): void {
    this.ui.replaceChildren();
    const panel = element('section', 'atlas-panel atlas-welcome');
    const eyebrow = element('p', 'atlas-eyebrow', 'SFACE / NIM ATLAS');
    const heading = element('h1', '', 'Welcome to NIM Atlas');
    const tagline = element('p', 'atlas-tagline', 'Explore the network. Build what survives.');
    const identity = element('p', 'atlas-identity', 'Sface is a Nimiq Pay Mini App game where you explore NIM Atlas, learn the payment network, and build what survives.');
    const mission = element('div', 'atlas-mission-card');
    mission.append(
      element('strong', '', 'Meet Mara / Pay Harbor'),
      element('p', '', 'Mara keeps the harbor market alive. Its lantern is out, and she needs one safe NIM payment route restored before the evening market opens.'),
    );
    const roles = element('div', 'atlas-role-choice');
    roles.append(element('strong', '', 'CHOOSE YOUR FIRST PATH'));
    const roleButtons = element('div', 'atlas-role-buttons');
    for (const role of ATLAS_PROLOGUE.roles) {
      const button = actionButton(role.title, () => {
        this.selectedRole = role.id;
        this.progress.setRole(role.id);
        this.renderWelcome();
      }, `Choose ${role.title} path`);
      button.className = `atlas-role atlas-role-${role.id}${this.selectedRole === role.id ? ' is-selected' : ''}`;
      roleButtons.append(button, element('p', 'atlas-role-description', role.description));
    }
    roles.append(roleButtons);
    const promise = element('p', 'atlas-quiet', 'Play the full learning path without a wallet. Nimiq Pay is the live payment gate when you choose to restore the harbor.');
    const start = actionButton('Meet Mara', this.startLantern, 'Meet Mara in Pay Harbor');
    const book = actionButton('Open Living Knowledge Book', this.openKnowledgeBook, 'Open Living Knowledge Book');
    const daily = actionButton('Play today\'s Atlas puzzle', this.openDailyPuzzle, 'Play today\'s Atlas puzzle');
    const districts = actionButton('Walk the District Atlas', this.openEvergreen, 'Walk the evergreen District Atlas');
    const saved = this.progress.load().completedAdventureIds.includes('genesis-garden');
    panel.append(eyebrow, heading, tagline, identity, mission, roles, promise, start, book, daily, districts, this.renderLeaderboards(), this.renderBeaconStatus(), this.renderShopCatalog());
    if (saved) panel.append(element('p', 'atlas-saved', 'Garden seal saved on this device. You can replay it.'));
    this.ui.append(panel);
  }

  private renderBeaconStatus(): HTMLElement {
    const section = element('section', 'atlas-beacon');
    section.setAttribute('aria-label', 'Network Beacon');
    section.append(
      element('strong', '', 'NETWORK BEACON'),
      element('p', 'atlas-beacon-status', 'UNAVAILABLE / SERVER PROJECTION'),
      element('p', 'atlas-quiet', 'No verified community progress yet'),
      element('p', 'atlas-quiet', 'District systems will change only after the server projects verified eligible best daily deltas.'),
    );
    const systems = element('div', 'atlas-beacon-systems');
    for (const district of ['GENESIS GARDEN', 'LIGHT FOREST', 'PAY HARBOR', 'ALBATROSS CAUSEWAY', 'VALIDATOR PEAKS', 'BUILDER CITY']) {
      systems.append(element('span', 'atlas-beacon-system', district));
    }
    section.append(systems);
    return section;
  }

  private renderShopCatalog(): HTMLElement {
    const section = element('section', 'atlas-shop');
    section.setAttribute('aria-label', 'Optional mainnet shop');
    section.append(
      element('strong', '', 'MAINNET EXPANSIONS'),
      element('p', 'atlas-shop-lock', 'OWNER APPROVAL REQUIRED'),
      element('p', 'atlas-quiet', 'Purchases stay disabled in the browser and in testnet mode. Core adventures, knowledge, and reward paths remain free.'),
    );
    const items = element('div', 'atlas-shop-items');
    for (const item of ATLAS_MAINNET_SHOP_ITEMS) {
      const card = element('article', 'atlas-shop-card');
      card.append(element('strong', '', item.type.replace('-', ' ').toUpperCase()), element('small', '', `${item.priceLuna.toLocaleString()} Lunas / MAINNET`));
      const locked = actionButton('Locked', () => undefined, `Mainnet ${item.id} is locked`);
      locked.disabled = true;
      locked.classList.add('atlas-shop-locked');
      card.append(locked);
      items.append(card);
    }
    section.append(items);
    return section;
  }

  private renderLeaderboards(): HTMLElement {
    const board = element('section', 'atlas-leaderboards');
    board.setAttribute('aria-label', 'Verified Atlas leaderboards');
    board.append(element('strong', '', 'VERIFIED PLAY / SEPARATE PATHS'), element('p', 'atlas-quiet', 'Explorer and Builder scores are ranked separately. The public board never invents a score or reward.' ));
    const tracks = element('div', 'atlas-leaderboard-grid');
    for (const title of ['EXPLORER LEADERBOARD', 'BUILDER LEADERBOARD']) {
      const card = element('article', 'atlas-leaderboard-card');
      card.append(element('strong', '', title), element('p', '', 'No verified scores yet'), element('small', '', 'Server-verified runs appear here after replay checks.'));
      tracks.append(card);
    }
    board.append(tracks);
    return board;
  }

  private startLantern = (): void => {
    this.lanternState = createLastLanternState(this.selectedRole, this.paymentConfig.enabled ? 'live' : 'practice');
    this.paymentNotice = '';
    this.liveOrderId = null;
    this.liveLookup = null;
    this.screen = 'lantern';
    this.renderLantern();
  };

  private openKnowledgeBook = (): void => {
    this.screen = 'book';
    this.bookOpen = true;
    this.teachBackStep = 0;
    this.teachBackNotice = '';
    this.renderKnowledgeBook();
  };

  private openDailyPuzzle = (): void => {
    this.screen = 'daily';
    this.dailyNotice = '';
    this.renderDailyPuzzle();
  };

  private renderDailyPuzzle(): void {
    this.ui.replaceChildren();
    const challenge = ATLAS_DAILY_CHALLENGES[0]!;
    const panel = element('section', 'atlas-panel atlas-daily');
    panel.setAttribute('aria-label', 'Daily Atlas puzzle');
    panel.append(
      element('p', 'atlas-eyebrow', 'DAILY ATLAS PUZZLE'),
      element('h1', '', 'Make the lantern exact'),
      element('p', 'atlas-book-sequence', 'LEARN / SOLVE / VERIFY'),
      element('p', 'atlas-trial-copy', challenge.prompt),
      element('p', 'atlas-lantern-mode', 'FREE CORE / ONE LOCAL PRACTICE ATTEMPT'),
    );
    const choices = element('div', 'atlas-daily-choices');
    for (const answer of ['120000', '1200000', '12000000']) choices.append(actionButton(`${Number(answer).toLocaleString()} Lunas`, () => {
      this.dailyNotice = answer === challenge.answer ? 'Correct locally. Reward share appears only after server verification.' : 'Not yet. Return to the Knowledge Book and check the Luna conversion.';
      this.renderDailyPuzzle();
    }, `Answer ${Number(answer).toLocaleString()} Lunas`));
    panel.append(choices);
    if (this.dailyNotice) panel.append(element('p', this.dailyNotice.startsWith('Correct') ? 'atlas-builder-success' : 'atlas-lantern-error', this.dailyNotice));
    panel.append(actionButton('Return to Mara', this.startLantern, 'Return to Mara'));
    this.ui.append(panel);
  }

  private openEvergreen = (): void => {
    this.screen = 'evergreen';
    this.evergreenAdventure = ATLAS_EVERGREEN_ADVENTURES[0]!;
    this.evergreenActions = [];
    this.evergreenState = replayEvergreenAdventure(this.evergreenAdventure, []);
    this.evergreenNotice = '';
    this.renderEvergreen();
  };

  private chooseEvergreen = (adventure: EvergreenAdventure): void => {
    this.evergreenAdventure = adventure;
    this.evergreenActions = [];
    this.evergreenState = replayEvergreenAdventure(adventure, []);
    this.evergreenNotice = '';
    this.renderEvergreen();
  };

  private advanceEvergreen = (action: EvergreenAction): void => {
    try {
      const actions = [...this.evergreenActions, action];
      this.evergreenState = replayEvergreenAdventure(this.evergreenAdventure, actions);
      this.evergreenActions = actions;
      this.evergreenNotice = '';
    } catch (error) {
      this.evergreenNotice = error instanceof Error ? error.message : 'That district step could not continue.';
    }
    this.renderEvergreen();
  };

  private renderEvergreen(): void {
    this.ui.replaceChildren();
    const panel = element('section', 'atlas-panel atlas-evergreen');
    panel.setAttribute('aria-label', 'Evergreen District Atlas');
    panel.append(
      element('p', 'atlas-eyebrow', 'DISTRICT ATLAS / EVERGREEN ADVENTURES'),
      element('h1', '', 'Walk the living network'),
      element('p', 'atlas-trial-copy', 'Meet a human need, use a Nimiq concept in the world, see the consequence, then teach the rule back without the Book.'),
      element('p', 'atlas-book-sequence', 'ENCOUNTER / ACT / CONSEQUENCE / TRANSFER / TEACH-BACK'),
    );
    const map = element('div', 'atlas-district-list');
    for (const adventure of ATLAS_EVERGREEN_ADVENTURES) {
      const card = element('article', `atlas-district-card${adventure.id === this.evergreenAdventure.id ? ' is-selected' : ''}`);
      card.append(element('strong', '', adventure.title), element('p', '', adventure.humanNeed), element('small', '', `${adventure.location} / ${adventure.districtId.toUpperCase()}`));
      card.append(actionButton(adventure.id === this.evergreenAdventure.id ? 'District selected' : `Enter ${adventure.districtId}`, () => this.chooseEvergreen(adventure), `Enter ${adventure.title}`));
      map.append(card);
    }
    panel.append(map);
    const adventure = this.evergreenAdventure;
    const journey = element('div', 'atlas-evergreen-journey');
    journey.append(element('p', 'atlas-trial-context', `${adventure.title.toUpperCase()} / ${this.evergreenState.phase.toUpperCase()}`), element('p', 'atlas-trial-copy', adventure.problem), element('p', 'atlas-builder-boundary', `VISIBLE CONSEQUENCE: ${this.evergreenState.consequence} ${adventure.consequence.visible}`));
    if (this.evergreenState.phase === 'arrival') {
      journey.append(actionButton('Observe the problem', () => this.advanceEvergreen({ type: 'observe' }), 'Observe the district problem'));
    } else if (this.evergreenState.phase === 'observed') {
      journey.append(element('p', 'atlas-evergreen-role', this.selectedRole === 'builder' ? `BUILDER MIRROR: ${adventure.builderMirror}` : `EXPLORER ACTION: ${adventure.explorerAction}`));
      journey.append(actionButton(this.selectedRole === 'builder' ? 'Run Builder repair' : 'Take Explorer action', () => this.advanceEvergreen({ type: 'act', role: this.selectedRole }), `Run ${this.selectedRole} action`));
    } else if (this.evergreenState.phase === 'acted') {
      const step = this.evergreenState.teachBack.length + 1;
      const answer = adventure.teachBack[this.evergreenState.teachBack.length]!;
      journey.append(element('p', 'atlas-evergreen-role', `TRANSFER / TEACH-BACK ${step} OF ${adventure.teachBack.length}: explain the next rule in your own route.`), actionButton(answer.toUpperCase(), () => this.advanceEvergreen({ type: 'teach-back', answer }), `Teach back ${answer}`));
    } else {
      journey.append(element('div', 'atlas-builder-success', `DISTRICT RESTORED / ${adventure.consequence.after}`), element('p', 'atlas-quiet', 'This local seal records learning only. Server verification is required before any score, rank, or reward claim.'));
    }
    if (this.evergreenNotice) journey.append(element('p', 'atlas-lantern-error', this.evergreenNotice));
    panel.append(journey, actionButton('Open Living Knowledge Book', this.openKnowledgeBook, 'Open Living Knowledge Book'), actionButton('Return to Mara', this.startLantern, 'Return to Mara'));
    this.ui.append(panel);
  }

  private closeBookForTeachBack = (): void => {
    this.bookOpen = false;
    this.teachBackStep = 0;
    this.teachBackNotice = '';
    this.renderKnowledgeBook();
  };

  private collectKnowledge = (id: string): void => {
    this.knowledgeState = unlockKnowledgeFragment(this.knowledgeState, id);
    this.renderKnowledgeBook();
  };

  private answerTeachBack = (id: string): void => {
    const expected = ATLAS_KNOWLEDGE_BOOK.teachBackOrder[this.teachBackStep];
    if (id !== expected) {
      this.teachBackNotice = 'That answer skips an authority boundary. The Book is closed, so reason from the harbor journey.';
      this.renderKnowledgeBook();
      return;
    }
    this.teachBackStep += 1;
    this.teachBackNotice = '';
    if (this.teachBackStep === ATLAS_KNOWLEDGE_BOOK.teachBackOrder.length) {
      const result = gradeKnowledgeTeachBack([...ATLAS_KNOWLEDGE_BOOK.teachBackOrder]);
      if (result.correct) this.progress.completeTrial('knowledge-teach-back');
      this.teachBackNotice = 'Teach-back complete. You rebuilt Ask, Check, Approve, Confirm, Unlock without the Book.';
    }
    this.renderKnowledgeBook();
  };

  private renderKnowledgeBook(): void {
    this.ui.replaceChildren();
    const panel = element('section', 'atlas-panel atlas-book');
    panel.setAttribute('aria-label', 'Living Knowledge Book');
    panel.append(
      element('p', 'atlas-eyebrow', 'LIVING KNOWLEDGE BOOK'),
      element('h1', '', 'Carry the rules, not the jargon'),
      element('p', 'atlas-trial-copy', 'Fragments are tools for the adventure. Learn a rule, use it in a route, then close the Book and teach it back.'),
      element('p', 'atlas-book-sequence', 'ASK / CHECK / APPROVE / CONFIRM / UNLOCK'),
      element('p', 'atlas-lantern-mode', this.bookOpen ? 'FREE CORE / NO PRIZE ADVANTAGE' : 'BOOK CLOSED / TEACH-BACK'),
    );
    if (this.bookOpen) {
      const list = element('div', 'atlas-book-list');
      for (const fragment of ATLAS_KNOWLEDGE_BOOK.fragments) {
        const card = element('article', 'atlas-book-card');
        const collected = this.knowledgeState.fragmentIds.includes(fragment.id);
        card.append(element('strong', '', `${fragment.title}${collected ? ' / COLLECTED' : ''}`), element('p', '', fragment.summary), element('p', 'atlas-book-example', `TRY IT: ${fragment.example}`), element('p', 'atlas-book-failure', `IF MISSED: ${fragment.failure}`));
        card.append(actionButton(collected ? 'Fragment carried' : 'Carry fragment', () => this.collectKnowledge(fragment.id), `Carry ${fragment.title} fragment`));
        list.append(card);
      }
      panel.append(list, actionButton('Close Book and start teach-back', this.closeBookForTeachBack, 'Close Book and start teach-back'));
    } else if (this.teachBackStep >= ATLAS_KNOWLEDGE_BOOK.teachBackOrder.length) {
      panel.append(element('div', 'atlas-builder-success', 'TEACH-BACK COMPLETE / KNOWLEDGE ACTIVE'), element('p', 'atlas-quiet', this.teachBackNotice), actionButton('Open Book again', this.openKnowledgeBook, 'Open Living Knowledge Book again'), actionButton('Return to Mara', this.startLantern, 'Return to Mara'));
    } else {
      const stepId = ATLAS_KNOWLEDGE_BOOK.teachBackOrder[this.teachBackStep]!;
      panel.append(element('p', 'atlas-builder-progress', `TEACH-BACK STEP ${this.teachBackStep + 1} OF 5 / NAME THE NEXT MOVE`), element('p', 'atlas-trial-copy', `Mara presents a new payment route. Which principle comes next: ${stepId.toUpperCase()}?`));
      const choices = element('div', 'atlas-book-choices');
      for (const choice of ATLAS_KNOWLEDGE_BOOK.teachBackOrder) choices.append(actionButton(choice.toUpperCase(), () => this.answerTeachBack(choice), `Answer ${choice}`));
      panel.append(choices);
      if (this.teachBackNotice) panel.append(element('p', 'atlas-lantern-error', this.teachBackNotice));
    }
    this.ui.append(panel);
  }

  private advanceLantern = (action: LastLanternAction): void => {
    try {
      replayLastLantern([action], this.lanternState);
      if (this.lanternState.phase === 'tower-lit') {
        this.progress.completeDistrict('pay-harbor');
        this.progress.completeTrial('last-lantern');
      }
    } catch (error) {
      this.renderLantern(error instanceof Error ? error.message : 'The practice step could not continue.');
      return;
    }
    this.renderLantern();
  };

  private renderLantern(notice = ''): void {
    this.ui.replaceChildren();
    const panel = element('section', 'atlas-panel atlas-lantern');
    panel.setAttribute('aria-label', 'The Last Lantern local practice');
    panel.append(
      element('p', 'atlas-eyebrow', 'PAY HARBOR / THE LAST LANTERN'),
      element('h1', '', 'Keep the harbor open'),
      element('p', 'atlas-trial-copy', this.selectedRole === 'builder' ? 'Repair Mara\'s payment route: provider request, exact Lunas, then authoritative confirmation.' : 'Walk through Mara\'s shop, review a NIM payment, and carry the lantern to the harbor tower.'),
       element('p', 'atlas-lantern-mode', this.paymentConfig.enabled ? 'LIVE TESTNET MODE / NIMIQ PAY + SERVER CONFIRMATION' : 'PRACTICE MODE / PLAYABLE WITHOUT A WALLET'),
       element('p', 'atlas-payment-path', this.paymentConfig.enabled ? 'NIMIQ PAY IS THE LIVE PAYMENT GATE. Review the exact TestAlbatross request, approve it in Nimiq Pay, then ask Atlas to confirm canonical chain evidence before the harbor unlocks.' : 'This browser build is safe practice mode. Nimiq Pay is configured only when the deployment supplies a real TestAlbatross recipient and RPC-backed reconciliation.'),
    );
    const status = element('div', 'atlas-lantern-status');
    status.setAttribute('role', 'status');
    status.append(element('strong', '', lanternHeading(this.lanternState.phase)), element('p', '', lanternDetail(this.lanternState.phase)));
    panel.append(status);
    if (notice) panel.append(element('p', 'atlas-lantern-error', notice));
    if (this.paymentNotice) panel.append(element('p', this.paymentNotice.startsWith('Confirmed') ? 'atlas-builder-success' : 'atlas-quiet', this.paymentNotice));
    if (this.lanternState.phase === 'review' || this.lanternState.phase === 'confirming') {
      const requestValue = this.currentLanternRequest();
      const request = element('dl', 'atlas-payment-review');
      request.append(
        element('dt', '', 'NETWORK'), element('dd', '', requestValue.network),
        element('dt', '', 'RECIPIENT'), element('dd', '', requestValue.recipient),
        element('dt', '', 'AMOUNT'), element('dd', '', `${requestValue.valueLuna.toLocaleString()} Lunas`),
      );
      panel.append(request);
    }
    const action = this.lanternActionButton();
    if (action) panel.append(action);
    if (this.lanternState.phase === 'tower-lit') {
      panel.append(element('p', 'atlas-quiet', 'The verified lantern event changed the world: lights on, ferries moving, market open.'));
      panel.append(actionButton('Continue to Genesis Garden', this.startGarden, 'Continue to Genesis Garden'));
    }
    this.ui.append(panel);
  }

  private lanternActionButton(): HTMLButtonElement | null {
    const phase = this.lanternState.phase;
    if (phase === 'street') return actionButton('Enter Pay Harbor shop', () => this.advanceLantern({ type: 'enter-shop' }), 'Enter Pay Harbor shop');
    if (phase === 'shop') return actionButton('Inspect the harbor lantern', () => this.advanceLantern({ type: 'select-lantern' }), 'Inspect the harbor lantern');
    if (phase === 'selected') return actionButton('Review payment request', () => this.advanceLantern({ type: 'review-request', request: this.currentLanternRequest() }), 'Review payment request');
    if (phase === 'review' && this.lanternState.mode === 'live') return this.paymentButton('Pay with Nimiq Pay', this.payWithNimiqPay, 'Pay with Nimiq Pay on TestAlbatross');
    if (phase === 'confirming' && this.lanternState.mode === 'live') return this.paymentButton('Check authoritative confirmation', this.reconcileLiveOrder, 'Check authoritative payment confirmation');
    if (phase === 'review' || phase === 'confirming') return actionButton('Simulate verified confirmation', () => this.advanceLantern({ type: 'receive-evidence', source: 'local-simulation', evidence: { txHash: 'practice-only', network: LAST_LANTERN.request.network, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna, canonical: true, success: true, confirmations: LAST_LANTERN.minimumConfirmations } }), 'Simulate verified confirmation');
    if (phase === 'verified') return actionButton('Carry lantern to tower', () => this.advanceLantern({ type: 'fulfill-lantern' }), 'Carry lantern to tower');
    if (phase === 'fulfilled') return actionButton('Light the harbor tower', () => this.advanceLantern({ type: 'reach-tower' }), 'Light the harbor tower');
    return null;
  }

  private currentLanternRequest() {
    return this.paymentConfig.enabled
      ? { itemId: 'harbor-lantern' as const, network: 'testalbatross' as const, recipient: this.paymentConfig.recipient!, valueLuna: this.paymentConfig.valueLuna }
      : { ...LAST_LANTERN.request };
  }

  private paymentButton(label: string, action: () => void, ariaLabel: string): HTMLButtonElement {
    const button = actionButton(label, action, ariaLabel);
    button.disabled = this.paymentBusy;
    return button;
  }

  private payWithNimiqPay = async (): Promise<void> => {
    if (this.paymentBusy || !this.paymentConfig.enabled) return;
    this.paymentBusy = true;
    this.paymentNotice = 'Opening Nimiq Pay after your explicit approval action...';
    this.renderLantern();
    try {
      const result = await executeAtlasPayment({
        actorId: this.sessionActorId,
        itemId: 'harbor-lantern',
        recipient: this.paymentConfig.recipient!,
        valueLuna: this.paymentConfig.valueLuna,
        idempotencyKey: `last-lantern-${this.sessionActorId}`,
        wallet: this.wallet,
        api: this.api,
      });
      this.liveOrderId = result.order.id;
      this.liveLookup = result.lookup;
      this.advanceLantern({ type: 'await-evidence' });
      this.paymentNotice = 'Approval received. The provider lookup is submitted; it is not payment proof. Ask Atlas to confirm the chain.';
      await this.reconcileLiveOrder();
    } catch (error) {
      this.paymentNotice = error instanceof AtlasPaymentError ? `${error.stage.toUpperCase()}: ${error.message}` : 'The mobile payment could not continue. Review the request and retry.';
      this.renderLantern();
    } finally {
      this.paymentBusy = false;
      this.renderLantern();
    }
  };

  private reconcileLiveOrder = async (): Promise<void> => {
    if (!this.liveOrderId) {
      this.paymentNotice = 'Approve the reviewed request first; no order is waiting for confirmation.';
      this.renderLantern();
      return;
    }
    try {
      const order = await this.api.reconcileOrder(this.liveOrderId);
      if (order.status !== 'fulfilled') {
        this.paymentNotice = 'Still waiting for canonical confirmation. The lantern stays locked until the server observes it.';
        this.renderLantern();
        return;
      }
      const evidence = order.chainEvidence;
      if (!isAtlasChainEvidence(evidence) || !this.liveLookup) {
        this.paymentNotice = 'The server returned fulfillment without usable evidence. The harbor remains locked.';
        this.renderLantern();
        return;
      }
      this.paymentNotice = 'Confirmed by canonical chain evidence. The harbor can unlock.';
      this.advanceLantern({ type: 'receive-evidence', source: 'server-verified', evidence: { txHash: this.liveLookup, network: evidence.network, recipient: evidence.recipient, valueLuna: evidence.valueLuna, canonical: evidence.canonical, success: evidence.success, confirmations: evidence.confirmations } });
    } catch (error) {
      this.paymentNotice = error instanceof Error ? error.message : 'The server could not reconcile the payment yet.';
      this.renderLantern();
    }
  };

  private renderPlaying(): void {
    this.ui.replaceChildren();
    const shell = element('section', 'atlas-play-shell');
    shell.setAttribute('aria-label', 'Genesis Garden adventure');
    const topbar = element('header', 'atlas-topbar');
    const brand = element('div', 'atlas-brand');
    brand.append(element('span', '', 'NIM ATLAS'), element('small', '', '01 / 06 • GENESIS GARDEN'));
    this.integrityStatus = element('div', 'atlas-integrity', 'INTEGRITY 3/3');
    this.integrityStatus.setAttribute('role', 'status');
    const pause = actionButton('Pause', this.togglePause, 'Pause Genesis Garden');
    pause.className = 'atlas-pause';
    topbar.append(brand, this.integrityStatus, pause);

    const objective = element('div', 'atlas-objective');
    objective.setAttribute('aria-live', 'polite');
    objective.append(element('span', '', 'YOU ARE HERE / GENESIS GARDEN / 1 OF 6'));
    objective.append(element('p', 'atlas-loop', `MISSION LOOP: MEET MARA / ${this.selectedRole.toUpperCase()} PATH / LEARN UNITS`));
    this.objectiveHeading = element('strong', '', '');
    this.objectiveDetail = element('p', '', '');
    objective.append(this.objectiveHeading, this.objectiveDetail);

    const controls = element('div', 'atlas-controls');
    const movement = element('div', 'atlas-movement');
    movement.setAttribute('aria-label', 'Movement controls');
    movement.append(
      this.movementButton('Up', 'up', '↑'),
      this.movementButton('Left', 'left', '←'),
      this.movementButton('Down', 'down', '↓'),
      this.movementButton('Right', 'right', '→'),
    );
    const actions = element('div', 'atlas-actions');
    const shield = actionButton('Shield', () => this.input.triggerTool('shield-pulse'), 'Use Shield Pulse');
    shield.className = 'atlas-tool atlas-shield';
    this.actionButton = actionButton('Scan', this.contextAction, 'Use Scanner');
    this.actionButton.className = 'atlas-tool atlas-context-action';
    actions.append(shield, this.actionButton);
    controls.append(movement, actions);
    const keys = element('p', 'atlas-key-hint', 'Move: arrows or WASD   Scan: Q   Tether: E   Shield: Shift   Help: Space');
    shell.append(topbar, objective, controls, keys);
    this.ui.append(shell);
    this.updateHud(genesisObjective(this.state));
  }

  private contextAction = (): void => {
    const objective = genesisObjective(this.state);
    if (objective.action === 'scanner') this.input.triggerTool('scanner');
    else if (objective.action === 'relay-tether') this.input.triggerTool('relay-tether');
    else if (objective.action === 'interact') this.input.triggerInteract();
    else if (objective.action === 'trial') this.openTrial();
  };

  private updateHud(objective: GenesisObjective): void {
    if (this.objectiveHeading) this.objectiveHeading.textContent = objective.short;
    if (this.objectiveDetail) this.objectiveDetail.textContent = objective.detail;
    if (this.integrityStatus) this.integrityStatus.textContent = `INTEGRITY ${this.state.player.integrity}/3`;
    if (this.actionButton) {
      const labels: Record<GenesisObjective['action'], string> = { move: 'Move', scanner: 'Scan', 'relay-tether': 'Tether', interact: this.state.rescue.rescued ? 'Enter' : 'Help Mara', trial: 'Builder Trial' };
      const toolLabels: Record<GenesisObjective['action'], string> = { move: 'Move toward destination', scanner: 'Use Scanner', 'relay-tether': 'Use Relay Tether', interact: this.state.rescue.rescued ? 'Enter Genesis Gate' : 'Help Mara reopen the harbor route', trial: 'Open Builder Trial' };
      this.actionButton.textContent = labels[objective.action];
      this.actionButton.setAttribute('aria-label', toolLabels[objective.action]);
    }
  }

  private openTrial = (): void => {
    this.screen = 'trial';
    this.builderStep = 0;
    this.builderNotice = '';
    if (this.selectedRole === 'builder') this.renderBuilderRepair();
    else this.renderTrial();
  };

  private renderBuilderRepair(): void {
    this.ui.replaceChildren();
    const panel = element('section', 'atlas-panel atlas-builder-repair');
    panel.setAttribute('aria-label', 'Builder repair practice');
    panel.append(
      element('p', 'atlas-eyebrow', 'BUILDER REPAIR / PAYMENT PATH'),
      element('p', 'atlas-trial-context', 'BUILDER TRIAL 1 OF 6 / YOU ARE HERE: GENESIS GARDEN RESTORED'),
      element('h1', '', 'Repair the route Mara can trust'),
      element('p', 'atlas-trial-copy', 'Predict each observation before running the repair. Each tile is a typed operation, never executable code.'),
      element('p', 'atlas-lantern-mode', 'SIMULATED LOOKUP / NO PAYMENT'),
    );
    const boundary = element('p', 'atlas-builder-boundary', 'No arbitrary code runs here. The server grades the same allowlisted sequence for competitive proof.');
    panel.append(boundary);
    if (this.builderStep >= BUILDER_REPAIR_STEPS.length) {
      panel.append(element('div', 'atlas-builder-success', 'REPAIR COMPLETE / LOCAL RECIPE UNLOCKED'));
      const recipe = document.createElement('pre');
      recipe.className = 'atlas-builder-recipe';
      recipe.textContent = 'provider-init → user intent → accounts → exact payment → lookup → chain confirmation → one fulfillment';
      panel.append(recipe, element('p', 'atlas-quiet', 'This local seal does not create a wallet proof, score, rank, or reward claim.'));
      panel.append(actionButton('Install Builder seal', this.completeBuilderRepair, 'Install local Builder repair seal'));
      this.ui.append(panel);
      return;
    }
    const current = BUILDER_REPAIR_STEPS[this.builderStep]!;
    const progress = element('p', 'atlas-builder-progress', `REPAIR STEP ${this.builderStep + 1} OF ${BUILDER_REPAIR_STEPS.length}`);
    const card = element('div', 'atlas-builder-step');
    card.append(element('strong', '', current.title), element('p', '', current.prompt));
    const choices = document.createElement('div');
    choices.className = 'atlas-builder-choices';
    for (const choice of current.choices) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'builder-prediction';
      input.value = choice;
      label.append(input, document.createTextNode(choice));
      choices.append(label);
    }
    const feedback = element('p', this.builderNotice ? 'atlas-lantern-error' : 'atlas-quiet', this.builderNotice);
    const submit = actionButton('Lock prediction and run tile', () => {
      const selected = card.querySelector<HTMLInputElement>('input:checked')?.value;
      if (selected !== current.answer) {
        this.builderNotice = 'That prediction would cross the wrong authority boundary. Read the tile and try again.';
        this.renderBuilderRepair();
        return;
      }
      this.builderNotice = '';
      this.builderStep += 1;
      this.renderBuilderRepair();
    }, `Lock prediction for ${current.title}`);
    card.append(choices, feedback, submit);
    panel.append(progress, card);
    this.ui.append(panel);
  }

  private completeBuilderRepair = (): void => {
    this.progress.completeDistrict('pay-harbor');
    this.progress.completeTrial('harbor-repair-v1');
    this.screen = 'complete';
    this.ui.replaceChildren();
    const panel = element('section', 'atlas-panel atlas-complete');
    panel.append(
      element('p', 'atlas-eyebrow', 'PAY HARBOR / REPAIR VERIFIED LOCALLY'),
      element('div', 'atlas-seal', 'B'),
      element('h1', '', 'Mara can trust the route'),
      element('p', 'atlas-tagline', 'You predicted the provider, intent, account, payment, lookup, confirmation, and one-time fulfillment boundaries.'),
      element('p', 'atlas-quiet', 'The Explorer and Builder paths converge on the same harbor state. No wallet or fabricated rank was created.'),
      actionButton('Replay Builder repair', this.startGarden, 'Replay Builder repair'),
    );
    this.ui.append(panel);
  };

  private renderTrial(): void {
    this.ui.replaceChildren();
    const panel = element('section', 'atlas-panel atlas-trial');
    panel.append(
      element('p', 'atlas-eyebrow', 'BUILDER TRIAL / LUNA LENS'),
      element('p', 'atlas-trial-context', 'Builder Trial 1 of 6 / YOU ARE HERE: GENESIS GARDEN RESTORED'),
      element('h1', '', 'Give Mara the exact units'),
      element('p', 'atlas-trial-copy', 'You helped Mara reopen the route and entered the gate. Now convert 12 NIM into Lunas, the smallest Nimiq unit.'),
    );
    const form = document.createElement('form');
    form.className = 'atlas-answer-grid';
    for (const [value, label] of [['120_000', '120,000 Lunas'], ['1_200_000', '1,200,000 Lunas'], ['12_000_000', '12,000,000 Lunas']] as const) {
      const choice = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'luna-answer';
      input.value = value;
      choice.append(input, document.createTextNode(label));
      form.append(choice);
    }
    const feedback = element('div', 'atlas-trial-feedback');
    feedback.setAttribute('role', 'status');
    const submit = actionButton('Check route', () => {
      const selected = form.querySelector<HTMLInputElement>('input:checked')?.value ?? '';
      const result = gradeGenesisTrial(selected);
      feedback.replaceChildren(element('p', result.correct ? 'is-correct' : 'is-wrong', result.explanation));
      if (!result.correct) return;
      const source = document.createElement('a');
      source.href = result.sourceUrl;
      source.target = '_blank';
      source.rel = 'noreferrer';
      source.textContent = 'Official Nimiq Provider API';
      const recipe = document.createElement('pre');
      recipe.textContent = result.recipe;
      const seal = actionButton('Install Garden seal', this.completeGarden, 'Install Genesis Garden seal');
      feedback.append(source, recipe, seal);
      submit.disabled = true;
    }, 'Check Luna answer');
    panel.append(form, submit, feedback);
    this.ui.append(panel);
  }

  private completeGarden = (): void => {
    this.progress.completeDistrict('genesis-garden');
    this.progress.completeTrial('luna-lens');
    this.screen = 'complete';
    this.ui.replaceChildren();
    const panel = element('section', 'atlas-panel atlas-complete');
    panel.append(
      element('p', 'atlas-eyebrow', 'GENESIS GARDEN / RESTORED'),
      element('div', 'atlas-seal', 'N'),
      element('h1', '', 'The first path holds'),
      element('p', 'atlas-tagline', 'You restored an address route, protected it from faults, and converted NIM into exact Lunas.'),
      element('div', 'atlas-next-map', 'NEXT DISTRICT   LIGHT FOREST   CONSENSUS PATHS'),
      element('p', 'atlas-quiet', 'Your Garden seal is saved locally. No wallet or fabricated rank was created.'),
      actionButton('Replay Genesis Garden', this.startGarden, 'Replay Genesis Garden'),
    );
    this.ui.append(panel);
  };

  private togglePause = (): void => {
    if (this.suspended) this.resume();
    else this.suspend('paused');
  };

  private suspend(system: 'paused' | 'hidden'): void {
    if (this.screen !== 'playing' || this.suspended) return;
    this.input.setSystem(system);
    stepAtlas(this.state, this.input.sample());
    this.suspended = true;
    if (this.objectiveDetail) this.objectiveDetail.textContent = system === 'hidden' ? 'Paused while NIM Atlas is hidden.' : 'Paused. Press Pause again to continue.';
  }

  private resume = (): void => {
    this.suspended = false;
    this.input.setSystem('active');
    this.lastFrame = performance.now();
  };

  private visibility = (): void => {
    if (document.hidden) this.suspend('hidden');
    else this.resume();
  };

  private resize = (): void => {
    this.renderer.resize();
    this.renderer.draw(this.state, genesisObjective(this.state));
  };

  private movementButton(label: string, direction: AtlasDirection, glyph: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `atlas-move atlas-move-${direction}`;
    button.textContent = glyph;
    button.setAttribute('aria-label', `Move ${label.toLowerCase()}`);
    const press = (event: PointerEvent): void => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); this.input.setDirection(direction, true); };
    const release = (): void => this.input.setDirection(direction, false);
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('click', () => { this.input.setDirection(direction, true); window.setTimeout(() => this.input.setDirection(direction, false), 120); });
    return button;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}

function lanternHeading(phase: LastLanternState['phase']): string {
  return {
    street: 'Walk to the shop',
    shop: 'Inspect the lantern',
    selected: 'Check what the shop is asking',
    review: 'Review before approval',
    confirming: 'Waiting for confirmation',
    verified: 'Payment verified',
    fulfilled: 'Carry the lantern',
    'tower-lit': 'Harbor reopened',
  }[phase];
}

function lanternDetail(phase: LastLanternState['phase']): string {
  return {
    street: 'Mara is waiting at the Pay Harbor shop.',
    shop: 'The lantern is a real item in this practice scene. Inspect it to see the request.',
    selected: 'A safe payment has a network, recipient, and exact integer Luna amount.',
    review: 'Confirm the three lines before a wallet would ever be asked to approve.',
    confirming: 'A transaction hash alone is not proof. Keep waiting for authoritative evidence.',
    verified: 'The simulated evidence matches. Now the lantern is yours to carry.',
    fulfilled: 'Take the item to the tower. This is the first functional inventory item.',
    'tower-lit': 'One verified event changed the harbor state.',
  }[phase];
}

function actionButton(label: string, action: () => void, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'atlas-primary';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', action);
  return button;
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    const key = 'sface-atlas-storage-check';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return localStorage;
  } catch {
    const values = new Map<string, string>();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  }
}

function getAtlasSessionActorId(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  const key = 'sface-atlas-checkout-session';
  const existing = storage.getItem(key);
  if (existing && /^atlas-session-[a-z0-9-]{8,80}$/.test(existing)) return existing;
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const value = `atlas-session-${suffix}`;
  storage.setItem(key, value);
  return value;
}

function isAtlasChainEvidence(value: unknown): value is { network: 'testalbatross'; recipient: string; valueLuna: number; canonical: true; success: true; confirmations: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  const valueLuna = evidence.valueLuna;
  const confirmations = evidence.confirmations;
  if (evidence.network !== 'testalbatross' || typeof evidence.recipient !== 'string' || typeof valueLuna !== 'number' || !Number.isSafeInteger(valueLuna) || valueLuna <= 0 || evidence.canonical !== true || evidence.success !== true || typeof confirmations !== 'number' || !Number.isSafeInteger(confirmations) || confirmations < 3) return false;
  return true;
}

const ui = document.querySelector<HTMLElement>('#ui');
const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (ui && canvas) new AtlasApp(ui, canvas).boot();
