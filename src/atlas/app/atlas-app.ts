import { createAtlasState } from '../../../shared/atlas/state';
import { projectLivingWorld } from '../../../shared/atlas/living-world';
import { AtlasCameraLookController, AtlasInputController, installAtlasKeyboard, shouldHandleDirectionalClick, type AtlasDirection } from '../input';
import { createAtlasProgressStore } from '../progress';
import { AtlasRenderer } from '../render/renderer';
import { createIdleOrbit } from '../render/three/orbit';
import { ATLAS_GUIDE_REACH_METRES, createAtlasTutorial, type AtlasTutorialDirector } from '../tutorial';
import { ATLAS_PROLOGUE } from '../../../shared/atlas/prologue';
import type { AtlasRole } from '../../../shared/atlas/types';
import { LAST_LANTERN, createLastLanternState, replayLastLantern, type LastLanternAction, type LastLanternState } from '../../../shared/atlas/adventures/last-lantern';
import { ATLAS_KNOWLEDGE_BOOK, createKnowledgeBookState, gradeKnowledgeTeachBack, unlockKnowledgeFragment, type KnowledgeBookState } from '../../../shared/atlas/knowledge';
import { ATLAS_EVERGREEN_ADVENTURES, replayEvergreenAdventure, type EvergreenAction, type EvergreenAdventure, type EvergreenState } from '../../../shared/atlas/adventures/evergreen';
import { ATLAS_MAINNET_SHOP_ITEMS } from '../../../shared/atlas/shop';
import { createAtlasApiClient, type AtlasCompetitionSummary } from '../api';
import { createAtlasWalletAdapter } from '../wallet';
import { AtlasPaymentController } from './payment-controller';
import { readAtlasClientPaymentConfig } from '../payment-config';
import { dailyChallengeChoices, dailyRetryHint, evergreenTeachBackChoices, formatDailyChoice, selectDailyChallenge } from '../product-model';
import { createSemanticWorldControl } from '../ui/semantic-world-controls';
import { createAtlasToolkit, type AtlasToolkit } from '../ui/atlas-toolkit';
import { createAtlasAudio } from '../audio/atlas-audio';
import { ATLAS_HOW_TO_PLAY_PATHS, ATLAS_HOW_TO_PLAY_SNAPSHOTS, ATLAS_HOW_TO_PLAY_STEPS, ATLAS_NIMIQ_BRIDGE, ATLAS_PAYMENT_VERBS } from '../ui/how-to-play';
import { createAtlasAssetManager } from '../assets/asset-manager';
import { createAtlasKnowledgeBookView } from '../ui/knowledge-book';
import { createCompetitionView } from '../ui/competition';
import { BEACON_CORE_WORLD } from '../../../shared/atlas/districts/beacon-core-world';
import { parseAtlasAssetManifest } from '../assets/manifest';
import { AtlasLivingCityController, type AtlasLivingCityNavigation } from '../city/living-city-controller';
import { parseAtlasCityScene, type AtlasCitySceneV1 } from '../../../shared/atlas/city/types';
import type { AtlasCityPlayerState } from '../../../shared/atlas/city/player';
import { projectPayHarborPhysicalMission } from '../../../shared/atlas/city/pay-harbor-mission';
import { getAtlasWaypointGuidance } from '../../../shared/atlas/city/wayfinding';
import { createPayHarborScene } from '../scenes/pay-harbor';

const BUILDER_REPAIR_STEPS = [
  { title: 'Provider ready', prompt: 'What should initialization do before a wallet action?', answer: 'Return a provider or an honest unavailable state.', choices: ['Return a provider or an honest unavailable state.', 'Request accounts during app boot.'] },
  { title: 'Player intent', prompt: 'When may the route ask for account access?', answer: 'Only after the player chooses the wallet action.', choices: ['Only after the player chooses the wallet action.', 'Whenever the page loads.'] },
  { title: 'Approved accounts', prompt: 'What can the account step return?', answer: 'An approved address list or a clear rejection.', choices: ['An approved address list or a clear rejection.', 'A payment confirmation.'] },
  { title: 'Exact payment', prompt: 'What must the typed request preserve?', answer: 'Testnet, recipient, and integer Lunas.', choices: ['Testnet, recipient, and integer Lunas.', 'A decimal amount and a guessed recipient.'] },
  { title: 'Wallet result', prompt: 'What does the provider result prove?', answer: 'Only a lookup value until chain proof exists.', choices: ['Only a lookup value until chain proof exists.', 'That the item is already fulfilled.'] },
  { title: 'Chain confirmation', prompt: 'When may the route become verified?', answer: 'After canonical evidence reaches the confirmation threshold.', choices: ['After canonical evidence reaches the confirmation threshold.', 'As soon as a hash is returned.'] },
  { title: 'One fulfillment', prompt: 'What should happen after verification?', answer: 'Fulfill the exact order once.', choices: ['Fulfill the exact order once.', 'Create a new item on every retry.'] },
] as const;

export class AtlasApp {
  private readonly input = new AtlasInputController();
  private readonly renderer: AtlasRenderer;
  private readonly progress = createAtlasProgressStore(safeStorage());
  private readonly paymentConfig = readAtlasClientPaymentConfig();
  private readonly wallet = createAtlasWalletAdapter();
  private readonly api = createAtlasApiClient({ baseUrl: import.meta.env.VITE_API_BASE ?? '' });
  private readonly sessionActorId = getAtlasSessionActorId(safeStorage());
  private selectedRole: AtlasRole = this.progress.load().activeRole;
  private screen: 'welcome' | 'how-to-play' | 'lantern' | 'trial' | 'book' | 'daily' | 'evergreen' | 'beacon-commons' | 'pay-harbor' = 'welcome';
  private lanternState: LastLanternState = createLastLanternState('explorer', 'practice');
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
  private atlasServiceStatus: 'loading' | 'local-first' | 'unavailable' = 'loading';
  private atlasBeaconStatus: 'loading' | 'live' | 'stale' | 'unavailable' = 'loading';
  private atlasContributorCount = 0;
  private atlasCompetition: AtlasCompetitionSummary[] = [];
  private liveOrderId: string | null = null;
  private liveLookup: string | null = null;
  private paymentController: AtlasPaymentController | null = null;
  private toolkit: AtlasToolkit | null = null;
  private readonly audio = createAtlasAudio();
  private livingCity: AtlasLivingCityController | null = null;
  private livingCityHost: HTMLElement | null = null;
  /* Non-null only while the welcome screen is showing; see screenPanel. */
  private orbitStartedAt: number | null = null;
  private readonly orbit = createIdleOrbit({
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  });
  private livingCityInit: Promise<void> | null = null;
  private cityAssets: ReturnType<typeof createAtlasAssetManager> | null = null;
  private beaconScene: AtlasCitySceneV1 | null = null;
  private beaconMapSvg: SVGSVGElement | null = null;
  private beaconMapPlayer: SVGPolygonElement | null = null;
  private beaconMapTarget: SVGCircleElement | null = null;
  private cityWaypointLabel: HTMLElement | null = null;
  private cityWaypointDistance: HTMLElement | null = null;
  private cityPaceLabel: HTMLElement | null = null;
  private cityLoadState: 'loading' | 'ready' | 'unavailable' = 'loading';
  private lastCityFootstepAt = 0;
  private beaconTravelNotice = '';
  private tutorial: AtlasTutorialDirector = createAtlasTutorial({ completed: readTutorialDone() });
  private tutorialOrigin: { x: number; z: number } | null = null;
  private cityQuestStep: 'meet-guide' | 'guide-met' = 'meet-guide';
  private payHarborBuilderStation = 0;

  constructor(private readonly ui: HTMLElement, private readonly canvas: HTMLCanvasElement) {
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
    /*
     * Browsers refuse to start audio before a gesture, so the theme waits for
     * the first touch anywhere rather than trying at load and failing silently.
     * Playtested as "no background sound on start": nothing ever unlocked audio
     * outside the two screens that called unlock() themselves.
     */
    window.addEventListener('pointerdown', () => {
      this.audio.unlock();
      if (this.screen !== 'beacon-commons' && this.screen !== 'pay-harbor') this.audio.playTheme();
    }, { once: true });
    this.canvas.hidden = true;
    this.renderWelcome();
    void this.ensureLivingCity().then(() => {
      this.cityLoadState = 'ready';
      if (this.screen === 'welcome') this.renderWelcome();
    }).catch(() => {
      this.cityLoadState = 'unavailable';
      if (this.screen === 'welcome') this.renderWelcome();
    });
    void this.loadAtlasStatus();
  }

  private async loadAtlasStatus(): Promise<void> {
    const [bootstrap, beacon, competition] = await Promise.allSettled([this.api.getBootstrap(), this.api.getBeacon(), this.api.getCompetition()]);
    this.atlasServiceStatus = bootstrap.status === 'fulfilled' ? bootstrap.value.campaignMode : 'unavailable';
    if (beacon.status === 'fulfilled') {
      this.atlasBeaconStatus = beacon.value.status;
      this.atlasContributorCount = beacon.value.verifiedContributorCount;
    } else {
      this.atlasBeaconStatus = 'unavailable';
      this.atlasContributorCount = 0;
    }
    this.atlasCompetition = competition.status === 'fulfilled' ? competition.value : [];
    if (this.screen === 'welcome') this.renderWelcome();
  }

  private returnHome = (): void => {
    this.screen = 'welcome';
    this.suspended = false;
    this.canvas.hidden = true;
    this.cityLoadState = 'loading';
    this.renderWelcome();
    void this.stopLivingCity().then(() => {
      if (this.screen !== 'welcome') return;
      void this.ensureLivingCity().then(() => {
        this.cityLoadState = 'ready';
        if (this.screen === 'welcome') this.renderWelcome();
      }).catch(() => {
        this.cityLoadState = 'unavailable';
        if (this.screen === 'welcome') this.renderWelcome();
      });
    });
  };

  private screenNav(context: string): HTMLElement {
    const nav = element('nav', 'atlas-screen-nav');
    nav.setAttribute('aria-label', 'Atlas navigation');
    const home = actionButton('Atlas home', this.returnHome, 'Return to NIM Atlas home');
    const location = element('span', '', `${this.selectedRole.toUpperCase()} / ${context.toUpperCase()}`);
    nav.append(home, location);
    return nav;
  }

  private openHowToPlay = (): void => {
    this.screen = 'how-to-play';
    this.renderHowToPlay();
  };

  private renderHowToPlay(): void {
    this.ui.replaceChildren();
    this.renderer.drawHarbor('street', this.selectedRole);
    const panel = this.screenPanel('atlas-how-to-play');
    panel.setAttribute('aria-label', 'How to play NIM Atlas');
    panel.append(
      this.screenNav('How to play'),
      element('p', 'atlas-eyebrow', 'SFACE / NIM ATLAS'),
      element('h1', '', 'Four moves. One changed district.'),
      element('p', 'atlas-guide-lead', 'Choose a path, help a real need, and leave the network better than you found it.'),
    );

    const steps = element('ol', 'atlas-step-rail');
    for (const step of ATLAS_HOW_TO_PLAY_STEPS) {
      const item = element('li', 'atlas-step-card');
      item.append(element('span', 'atlas-step-number', step.number), element('p', 'atlas-step-label', step.label), element('h2', '', step.title), element('p', '', step.copy));
      steps.append(item);
    }
    panel.append(steps);

    const paths = element('section', 'atlas-guide-section');
    paths.append(element('p', 'atlas-eyebrow', 'YOUR ROLE'), element('div', 'atlas-path-grid'));
    const pathGrid = paths.lastElementChild!;
    for (const path of ATLAS_HOW_TO_PLAY_PATHS) {
      const card = element('article', 'atlas-path-card');
      card.append(element('p', 'atlas-step-label', path.label), element('h2', '', path.title), element('p', '', path.copy));
      pathGrid.append(card);
    }
    panel.append(paths);

    const bridge = element('section', 'atlas-guide-section atlas-bridge-section');
    bridge.append(element('p', 'atlas-eyebrow', 'WHY NIMIQ IS IN THE GAME'), element('p', 'atlas-guide-note', 'The lesson is the action: every safe payment step has a visible consequence.'));
    const bridgeList = element('dl', 'atlas-nimiq-bridge');
    for (const row of ATLAS_NIMIQ_BRIDGE) bridgeList.append(element('dt', '', row.label), element('dd', '', row.meaning));
    bridge.append(bridgeList, element('p', 'atlas-verb-line', ATLAS_PAYMENT_VERBS.join('  /  ')));
    panel.append(bridge);

    const snapshots = element('section', 'atlas-guide-section');
    snapshots.append(element('p', 'atlas-eyebrow', 'SEE THE LOOP'), element('div', 'atlas-snapshot-grid'));
    const snapshotGrid = snapshots.lastElementChild!;
    for (const snapshot of ATLAS_HOW_TO_PLAY_SNAPSHOTS) {
      const figure = element('figure', 'atlas-snapshot');
      const image = document.createElement('img');
      image.src = snapshot.src;
      image.alt = snapshot.alt;
      image.loading = 'lazy';
      image.decoding = 'async';
      figure.append(image, element('figcaption', '', snapshot.caption));
      snapshotGrid.append(figure);
    }
    panel.append(snapshots);

    const deeper = document.createElement('details');
    deeper.className = 'atlas-guide-details';
    deeper.append(element('summary', '', 'Open the deeper NIM guide'));
    deeper.append(element('p', '', 'Want the builder-level version? The Knowledge Book turns each verb into a playable rule.'), externalLink('Read Nimiq Provider API', 'https://nimiq.dev/mini-apps/api-reference/nimiq-provider'), externalLink('Read Nimiq Mini Apps', 'https://nimiq.dev/mini-apps/'));
    panel.append(deeper, actionButton('Enter the living city', this.openBeaconCommons, 'Enter Beacon Commons and meet Mara'));
    this.ui.append(panel);
  }

  private startGarden = (): void => this.openBeaconCommons();

  private renderWelcome(): void {
    this.ui.replaceChildren();
    this.canvas.hidden = true;
    const panel = this.screenPanel('atlas-welcome atlas-home atlas-landing-shell');
    if (this.orbit.active) this.orbitStartedAt = performance.now();
    panel.setAttribute('aria-label', 'NIM Atlas game landing page');
    if (this.cityLoadState !== 'ready') {
      panel.append(this.renderLandingSplash());
      this.ui.append(panel);
      return;
    }
    const eyebrow = element('p', 'atlas-eyebrow', 'NIM ATLAS / BEACON COMMONS');
    const heading = element('h1', '', 'Explore Nimiq. Build what survives.');
    const tagline = element('p', 'atlas-tagline', 'Learn how Nimiq works by walking through a living city, meeting its people, and making the right move.');
    const identity = element('p', 'atlas-identity', 'Sface is a Nimiq Pay Mini App game. NIM Atlas is the network you repair by playing.');
    const loop = element('ol', 'atlas-learning-loop');
    for (const step of [
      ['01', 'WALK', 'Find the signal.'],
      ['02', 'USE', 'Make the right NIM move.'],
      ['03', 'SEE CHANGE', 'Watch the district respond.'],
    ]) {
      const item = element('li', 'atlas-learning-step');
      item.append(element('span', 'atlas-learning-number', step[0]), element('strong', '', step[1]), element('small', '', step[2]));
      loop.append(item);
    }
    const mission = element('div', 'atlas-mission-card');
    mission.append(
      element('strong', '', '60-SECOND RUN / Meet Mara'),
      element('p', '', 'Mara needs one safe NIM payment route. Restore it, carry the lantern, relight the harbor. Choose a path, meet the Commons guide, and learn why each move matters.'),
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
      button.setAttribute('aria-pressed', String(this.selectedRole === role.id));
      roleButtons.append(button);
    }
    const activeRole = ATLAS_PROLOGUE.roles.find((role) => role.id === this.selectedRole)!;
    roles.append(roleButtons, element('p', 'atlas-role-description', activeRole.description));
    const promise = element('p', 'atlas-quiet', this.selectedRole === 'builder' ? 'Builder: repair, predict, verify.' : 'Explorer: inspect, approve, confirm.');
    const start = actionButton('Start 60-second run', this.openBeaconCommons, 'Start the 60-second NIM Atlas run and Meet Mara');
    start.classList.add('atlas-start');
    // Only `start` keeps the signal colour. Everything else here is a ghost, so
    // a first-time player has exactly one obvious next move. Three identical
    // orange buttons is not a hierarchy, it is three ways of saying "maybe".
    const howToPlay = ghostButton('How to play', this.openHowToPlay, 'Read how to play NIM Atlas');
    const book = ghostButton('Open Living Knowledge Book', this.openKnowledgeBook, 'Open Living Knowledge Book');
    const daily = ghostButton('Play today\'s Atlas puzzle', this.openDailyPuzzle, 'Play today\'s Atlas puzzle');
    const districts = ghostButton('Walk the District Atlas', this.openEvergreen, 'Walk the evergreen District Atlas');
    const primary = element('div', 'atlas-home-primary');
    primary.append(mission, roles, promise, start, howToPlay);
    const introduction = element('div', 'atlas-home-intro');
    introduction.append(eyebrow, heading, tagline, identity, loop);
    const homeGrid = element('div', 'atlas-home-grid');
    homeGrid.append(introduction, primary);
    const routes = document.createElement('details');
    routes.className = 'atlas-home-routes';
    routes.append(element('summary', '', 'More ways to learn in the city'));
    const quick = element('div', 'atlas-quick-grid');
    quick.append(daily, book, districts);
    routes.append(quick);
    const saved = this.progress.load().completedAdventureIds.includes('genesis-garden');
    panel.append(homeGrid, routes, this.renderStatusDrawer());
    if (saved) panel.append(element('p', 'atlas-saved', 'Garden seal saved on this device. You can replay it.'));
    this.ui.append(panel);
  }

  /*
   * Every screen is a sheet over a live city.
   *
   * This used to be conditional on the city being ready, which meant a screen
   * could be a full-bleed page one moment and a bottom sheet the next. The city
   * now runs from boot, so the condition is gone and the shape is constant.
   *
   * The two play shells do not come through here: they are already the
   * world-first surface everything else is being made to resemble.
   */
  private screenPanel(className: string): HTMLElement {
    // Every screen but the welcome one wants the camera following the player,
    // so stopping the drift here means no screen has to remember to.
    this.orbitStartedAt = null;
    this.audio.stopCityAmbience();
    this.audio.playTheme();
    return element('section', `atlas-panel ${className}`.trim());
  }

  private renderLandingSplash(): HTMLElement {
    const splash = element('div', 'atlas-landing-splash');
    const state = this.cityLoadState === 'unavailable';
    splash.append(
      element('p', 'atlas-eyebrow', 'SFACE / NIM ATLAS'),
      element('h1', '', state ? 'Reconnect the city.' : 'Entering Beacon Commons.'),
      element('p', 'atlas-splash-copy', state ? 'The 3D city did not finish loading. Your learning path is safe; try the city link again.' : 'A living NIM Atlas district is getting ready around you.'),
    );
    const steps = element('div', 'atlas-splash-steps');
    for (const label of ['CITY', 'PLAYER', 'PEOPLE']) {
      const step = element('span', 'atlas-splash-step', label);
      step.dataset.state = state ? 'waiting' : 'loading';
      steps.append(step);
    }
    splash.append(steps);
    if (state) {
      const retry = actionButton('Retry city link', () => {
        this.cityLoadState = 'loading';
        this.renderWelcome();
        void this.ensureLivingCity().then(() => {
          this.cityLoadState = 'ready';
          if (this.screen === 'welcome') this.renderWelcome();
        }).catch(() => {
          this.cityLoadState = 'unavailable';
          if (this.screen === 'welcome') this.renderWelcome();
        });
      }, 'Retry loading the Beacon Commons city');
      retry.classList.add('atlas-splash-retry');
      splash.append(retry);
    }
    return splash;
  }

  private renderBeaconStatus(): HTMLElement {
    const section = element('section', 'atlas-beacon');
    section.setAttribute('aria-label', 'Network Beacon');
    section.append(
      element('strong', '', 'NETWORK BEACON'),
      element('p', `atlas-beacon-status is-${this.atlasBeaconStatus}`, `${this.atlasBeaconStatus.toUpperCase()} / SERVER PROJECTION`),
      element('p', 'atlas-quiet', this.atlasBeaconStatus === 'live' ? `${this.atlasContributorCount.toLocaleString()} verified contributors projected by the server.` : 'Verified shared-world progress is not available in this build. No progress is being invented locally.'),
      element('p', 'atlas-quiet', `Atlas service: ${this.atlasServiceStatus}. District systems change only after the server projects verified eligible best daily deltas.`),
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
    board.append(element('strong', '', 'VERIFIED PLAY / SEPARATE PATHS'), element('p', 'atlas-quiet', 'Explorer and Builder scores are ranked separately. Public ranking is not connected in this build, so the interface shows no names, scores, or rewards.' ));
    const tracks = element('div', 'atlas-leaderboard-grid');
    if (this.atlasCompetition.length > 0) {
      board.append(createCompetitionView(this.atlasCompetition));
      return board;
    }
    for (const title of ['EXPLORER LEADERBOARD', 'BUILDER LEADERBOARD']) {
      const card = element('article', 'atlas-leaderboard-card');
      card.append(element('strong', '', title), element('p', '', 'BOARD UNAVAILABLE'), element('small', '', 'Server-verified runs will appear here only after replay checks and the leaderboard read API are enabled.'));
      tracks.append(card);
    }
    board.append(tracks);
    return board;
  }

  private renderStatusDrawer(): HTMLElement {
    const drawer = document.createElement('details');
    drawer.className = 'atlas-status-drawer';
    const summary = element('summary', '', 'Verified world, rankings, and optional expansions');
    drawer.append(summary, this.renderLeaderboards(), this.renderBeaconStatus(), this.renderShopCatalog());
    return drawer;
  }

  private openBeaconCommons = (): void => {
    this.canvas.hidden = true;
    this.audio.unlock();
    this.audio.narrate('Beacon Commons is a living city. Walk the pink route, meet the Nimiq team, and learn what each working district does.');
    this.screen = 'beacon-commons';
    this.beaconTravelNotice = '';
    this.cityQuestStep = 'meet-guide';
    this.renderBeaconCommons();
    void this.ensureLivingCity().then(() => {
      if (this.screen === 'beacon-commons') this.renderBeaconCommons();
    }).catch((error: unknown) => {
      if (this.screen !== 'beacon-commons') return;
      this.beaconTravelNotice = error instanceof Error ? error.message : 'Beacon Commons is unavailable.';
      this.renderBeaconCommons();
    });
  };

  private renderBeaconCommons(): void {
    this.ui.replaceChildren();
    const citizens = this.livingCity?.crowdSnapshot() ?? [];
    const visibleCitizens = citizens.filter((citizen) => citizen.visible).length;
    const activeCitizens = citizens.filter((citizen) => citizen.active).length;
    const shell = element('section', 'atlas-play-shell atlas-living-city-play-shell');
    shell.setAttribute('aria-label', 'Beacon Commons living city adventure');

    const topbar = element('header', 'atlas-topbar atlas-city-topbar');
    const brand = this.createCityBrand('BEACON COMMONS / LIVING CITY', 'Leave Beacon Commons and return to Atlas home');
    const population = element('div', 'atlas-integrity atlas-city-population', this.livingCity ? `${visibleCitizens} HERE / ${activeCitizens} ACTIVE` : 'CITY LOADING');
    population.setAttribute('role', 'status');
    const pause = actionButton(this.suspended ? 'Resume' : 'Pause', this.togglePause, this.suspended ? 'Resume Beacon Commons' : 'Pause Beacon Commons');
    pause.className = 'atlas-pause';
    topbar.append(brand, population, pause);

    const objective = this.cityQuestStep === 'meet-guide'
      ? {
          depth: 'glance' as const,
          objective: 'MEET THE COMMONS GUIDE',
          detail: this.beaconTravelNotice || 'Walk toward the pink guide beside the market. The Nimiq team and community are already working around you.',
          status: `${this.selectedRole.toUpperCase()} PATH / MOVE THROUGH THE CITY / TALK WHEN CLOSE`,
        }
      : {
          depth: 'glance' as const,
          objective: 'FIND THE PAY HARBOR GATE',
          detail: 'The guide marked the pink route. Follow the working district toward the transport building.',
          status: 'MISSION ACCEPTED / PAY HARBOR ROUTE OPEN',
        };
    this.toolkit = createAtlasToolkit(objective);

    const controls = element('div', 'atlas-controls atlas-city-controls');
    const movement = element('div', 'atlas-mobile-movement');
    movement.setAttribute('aria-label', 'Movement controls');
    movement.append(this.createCityJoystick());
    const accessibleDirections = element('div', 'atlas-movement atlas-movement-accessible');
    accessibleDirections.append(
      this.movementButton('Up', 'up', '\u2191'),
      this.movementButton('Left', 'left', '\u2190'),
      this.movementButton('Down', 'down', '\u2193'),
      this.movementButton('Right', 'right', '\u2192'),
    );
    movement.append(accessibleDirections);
    const actions = element('div', 'atlas-actions');
    const interact = actionButton(
      this.cityQuestStep === 'meet-guide' ? 'Talk' : 'Travel',
      this.cityQuestStep === 'meet-guide' ? this.interactWithCommonsGuide : this.travelToPayHarbor,
      this.cityQuestStep === 'meet-guide' ? 'Interact with the Commons guide' : 'Travel through the Pay Harbor gate',
    );
    interact.className = 'atlas-tool atlas-context-action';
    actions.append(interact);
    controls.append(movement, actions);
    const hint = element('p', 'atlas-key-hint', this.livingCity ? `${this.livingCity.qualityTier().toUpperCase()} PROFILE / DRAG TO WALK / FULL TILT TO RUN` : 'LOADING VERIFIED PROCEDURAL 3D ASSETS');
    const cameraCenter = actionButton('Center', () => this.livingCity?.recenterCamera(), 'Center the camera behind the player');
    cameraCenter.className = 'atlas-camera-center';
    shell.append(topbar, this.toolkit.element, this.createBeaconMap(), this.createCityWaypoint(), this.createCameraLookZone(), cameraCenter, controls, hint);
    this.applyTutorialStep(shell, movement, interact);
    this.ui.append(shell);
    this.audio.unlock();
    this.audio.stopTheme();
    this.audio.playCityAmbience();
    this.livingCity?.resize(window.innerWidth, window.innerHeight, 1);
  }

  private interactWithCommonsGuide = (): void => {
    const player = this.livingCity?.playerSnapshot();
    if (!player) {
      this.beaconTravelNotice = 'The city is still loading. Movement will unlock when the verified 3D assets are ready.';
      this.renderBeaconCommons();
      return;
    }
    if (!this.isNearBeaconAnchor(player, 'mission-guide', ATLAS_GUIDE_REACH_METRES)) {
      this.toolkit?.setDetail('Move closer to the pink guide beside the market, then talk.');
      return;
    }
    this.cityQuestStep = 'guide-met';
    this.beaconTravelNotice = '';
    this.audio.playWorldCue('city-interaction');
    this.audio.narrate('Welcome to Beacon Commons. Follow the pink route to learn how Nimiq connects people and builders.');
    this.renderBeaconCommons();
  };

  private createBeaconMap(): HTMLElement {
    const panel = element('aside', 'atlas-mini-map');
    const districtLabel = this.screen === 'pay-harbor' ? 'Pay Harbor' : 'Beacon Commons';
    panel.setAttribute('aria-label', `${districtLabel} navigation map`);
    panel.append(element('span', 'atlas-mini-map-label', 'CITY MAP'));
    const scene = this.beaconScene;
    if (!scene) {
      panel.append(element('span', 'atlas-mini-map-loading', 'LOADING'));
      return panel;
    }
    const points = scene.paths.flatMap((path) => path.points).concat(scene.anchors.map((anchor) => anchor.position));
    const minX = Math.min(...points.map((point) => point[0])) - 2;
    const maxX = Math.max(...points.map((point) => point[0])) + 2;
    const minZ = Math.min(...points.map((point) => point[2])) - 2;
    const maxZ = Math.max(...points.map((point) => point[2])) + 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${districtLabel} route network with current position`);
    for (const path of scene.paths) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', path.points.map((point) => `${point[0]},${point[2]}`).join(' '));
      line.setAttribute('class', path.purpose === 'walk' ? 'atlas-map-route' : 'atlas-map-side-route');
      svg.append(line);
    }
    for (const anchor of scene.anchors.filter((candidate) => !candidate.id.startsWith('npc-spawn-'))) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marker.setAttribute('cx', String(anchor.position[0]));
      marker.setAttribute('cy', String(anchor.position[2]));
      marker.setAttribute('r', anchor.kind === 'travel' ? '0.42' : '0.25');
      marker.setAttribute('class', anchor.kind === 'travel' ? 'atlas-map-landmark' : 'atlas-map-point');
      svg.append(marker);
    }
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    target.setAttribute('r', '0.55');
    target.setAttribute('class', 'atlas-map-target');
    const player = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    player.setAttribute('points', '-0.48,0.52 0,-0.72 0.48,0.52');
    player.setAttribute('class', 'atlas-map-player');
    svg.append(target, player);
    panel.append(svg);
    this.beaconMapSvg = svg;
    this.beaconMapPlayer = player;
    this.beaconMapTarget = target;
    this.updateBeaconMap(this.livingCity?.playerSnapshot());
    return panel;
  }

  private updateBeaconMap(player: AtlasCityPlayerState | undefined): void {
    if (player && this.beaconMapPlayer) {
      const rotationDegrees = (player.headingRadians - Math.PI) * 180 / Math.PI;
      this.beaconMapPlayer.setAttribute('transform', `translate(${player.x} ${player.z}) rotate(${rotationDegrees})`);
      const localRadius = 10.5;
      this.beaconMapSvg?.setAttribute('viewBox', `${player.x - localRadius} ${player.z - localRadius} ${localRadius * 2} ${localRadius * 2}`);
      const now = typeof performance === 'undefined' ? Date.now() : performance.now();
      const footstepInterval = player.pace === 'run' ? 175 : 320;
      if (player.moving && now - this.lastCityFootstepAt >= footstepInterval) {
        this.lastCityFootstepAt = now;
        this.audio.playWorldCue('city-footstep');
      }
      if (this.cityPaceLabel) {
        this.cityPaceLabel.textContent = player.pace === 'run' ? 'RUNNING' : player.pace === 'walk' ? 'WALKING' : 'READY';
        this.cityPaceLabel.dataset.pace = player.pace;
      }
    }
    const targetId = this.currentCityTargetAnchorId();
    const target = this.beaconScene?.anchors.find((anchor) => anchor.id === targetId);
    if (target) {
      const playerPosition = player ?? this.livingCity?.playerSnapshot();
      if (!playerPosition) return;
      this.updateCityWaypoint(playerPosition, target.position);
      if (!this.beaconMapTarget) return;
      const deltaX = target.position[0] - playerPosition.x;
      const deltaZ = target.position[2] - playerPosition.z;
      const distance = Math.hypot(deltaX, deltaZ);
      const scale = distance > 8.4 ? 8.4 / distance : 1;
      this.beaconMapTarget.setAttribute('cx', String(playerPosition.x + deltaX * scale));
      this.beaconMapTarget.setAttribute('cy', String(playerPosition.z + deltaZ * scale));
    }
  }

  private currentCityTargetAnchorId(): string {
    if (this.screen === 'pay-harbor') return projectPayHarborPhysicalMission(this.lanternState, this.payHarborBuilderStation).targetAnchorId;
    if (this.cityQuestStep === 'meet-guide') return 'mission-guide';
    return 'travel-pay-harbor';
  }

  private travelToPayHarbor = (): void => {
    const player = this.livingCity?.playerSnapshot();
    if (!player || !this.isNearBeaconAnchor(player, 'travel-pay-harbor', 3)) {
      this.toolkit?.setDetail('Follow the pink street to the tall transport building. Travel unlocks when you reach its entrance.');
      return;
    }
    this.toolkit?.setDetail('Opening the verified Pay Harbor route...');
    void this.enterPayHarbor();
  };

  private async enterPayHarbor(): Promise<void> {
    const controller = this.livingCity;
    const assets = this.cityAssets;
    if (!controller || !assets) {
      this.toolkit?.setDetail('The living city is not ready yet. Stay at the gate and try again.');
      return;
    }
    try {
      const scenePath = '/atlas/3d/v1/pay-harbor/scene.json';
      const scene = parseAtlasCityScene(JSON.parse(new TextDecoder().decode(await assets.loadBytes(scenePath))) as unknown);
      await controller.activateDistrict('pay-harbor');
      controller.setNavigation(livingCityNavigation(scene));
      this.beaconScene = scene;
      this.lanternState = createLastLanternState(this.selectedRole, this.paymentConfig.enabled ? 'live' : 'practice');
      this.paymentNotice = '';
      this.liveOrderId = null;
      this.liveLookup = null;
      this.paymentController = this.paymentConfig.enabled ? this.createPaymentController() : null;
      this.payHarborBuilderStation = 0;
      this.screen = 'pay-harbor';
      this.presentPayHarborWorld();
      this.audio.playWorldCue('city-interaction');
      this.audio.narrate('You have reached Pay Harbor. Find Mara, inspect the lantern, and verify every payment field before the city changes.');
      this.renderPayHarbor();
    } catch {
      this.toolkit?.setDetail('Pay Harbor could not open. Beacon Commons is still safe; try the gate again when the route is available.');
    }
  }

  private renderPayHarbor(): void {
    this.ui.replaceChildren();
    const mission = projectPayHarborPhysicalMission(this.lanternState, this.payHarborBuilderStation);
    const citizens = this.livingCity?.crowdSnapshot() ?? [];
    const shell = element('section', 'atlas-play-shell atlas-living-city-play-shell atlas-pay-harbor-play-shell');
    shell.setAttribute('aria-label', 'Pay Harbor living city mission');

    const topbar = element('header', 'atlas-topbar atlas-city-topbar');
    const brand = this.createCityBrand('PAY HARBOR / THE LAST LANTERN', 'Leave Pay Harbor and return to Atlas home');
    const population = element('div', 'atlas-integrity atlas-city-population', `${citizens.filter((citizen) => citizen.visible).length} HERE / ${citizens.filter((citizen) => citizen.active).length} ACTIVE`);
    population.setAttribute('role', 'status');
    const pause = actionButton(this.suspended ? 'Resume' : 'Pause', this.togglePause, this.suspended ? 'Resume Pay Harbor' : 'Pause Pay Harbor');
    pause.className = 'atlas-pause';
    topbar.append(brand, population, pause);

    this.toolkit = createAtlasToolkit({ depth: 'glance', objective: mission.objective, detail: this.paymentNotice || mission.detail, status: mission.status });
    const controls = element('div', 'atlas-controls atlas-city-controls');
    const movement = element('div', 'atlas-mobile-movement');
    movement.setAttribute('aria-label', 'Movement controls');
    movement.append(this.createCityJoystick());
    const accessibleDirections = element('div', 'atlas-movement atlas-movement-accessible');
    accessibleDirections.append(
      this.movementButton('Up', 'up', '\u2191'),
      this.movementButton('Left', 'left', '\u2190'),
      this.movementButton('Down', 'down', '\u2193'),
      this.movementButton('Right', 'right', '\u2192'),
    );
    movement.append(accessibleDirections);
    const actions = element('div', 'atlas-actions');
    const interact = actionButton(mission.actionLabel, this.interactInPayHarbor, `${mission.actionLabel}: ${mission.objective}`);
    interact.className = 'atlas-tool atlas-context-action';
    actions.append(interact);
    controls.append(movement, actions);
    const hint = element('p', 'atlas-key-hint', `${this.livingCity?.qualityTier().toUpperCase() ?? 'BALANCED'} PROFILE / FOLLOW THE MAP / ACT WHEN CLOSE`);
    const cameraCenter = actionButton('Center', () => this.livingCity?.recenterCamera(), 'Center the camera behind the player');
    cameraCenter.className = 'atlas-camera-center';
    shell.append(topbar, this.toolkit.element);
    const paymentReview = this.createCityPaymentReview();
    if (paymentReview) shell.append(paymentReview);
    shell.append(this.createBeaconMap(), this.createCityWaypoint(), this.createCameraLookZone(), cameraCenter, controls, hint);
    this.ui.append(shell);
    this.audio.unlock();
    this.audio.stopTheme();
    this.audio.playCityAmbience();
    this.livingCity?.resize(window.innerWidth, window.innerHeight, 1);
  }

  private createCityBrand(locationLabel: string, ariaLabel: string): HTMLButtonElement {
    const brand = document.createElement('button');
    brand.type = 'button';
    brand.className = 'atlas-brand';
    brand.setAttribute('aria-label', ariaLabel);
    brand.addEventListener('click', this.returnHome);
    brand.append(element('span', '', 'NIM ATLAS'), element('small', '', locationLabel));
    return brand;
  }

  private interactInPayHarbor = (): void => {
    const player = this.livingCity?.playerSnapshot();
    const mission = projectPayHarborPhysicalMission(this.lanternState, this.payHarborBuilderStation);
    if (!player || !this.isNearBeaconAnchor(player, mission.targetAnchorId, 2.4)) {
      this.toolkit?.setDetail('Follow the pink target on the city map and move closer before acting.');
      return;
    }
    if (this.lanternState.phase === 'street') return this.advancePhysicalLantern({ type: 'enter-shop' });
    if (this.lanternState.phase === 'shop') return this.advancePhysicalLantern({ type: 'select-lantern' });
    if (this.lanternState.phase === 'selected' && this.selectedRole === 'builder') {
      this.input.setSystem('paused');
      this.startBuilderRepair();
      return;
    }
    if (this.lanternState.phase === 'selected') return this.advancePhysicalLantern({ type: 'review-request', request: this.currentLanternRequest() });
    if ((this.lanternState.phase === 'review' || this.lanternState.phase === 'confirming') && this.lanternState.mode === 'practice') {
      return this.advancePhysicalLantern({ type: 'receive-evidence', source: 'local-simulation', evidence: { txHash: 'practice-only', network: LAST_LANTERN.request.network, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna, canonical: true, success: true, confirmations: LAST_LANTERN.minimumConfirmations } });
    }
    if (this.lanternState.phase === 'review') {
      void this.payWithNimiqPay();
      return;
    }
    if (this.lanternState.phase === 'confirming') {
      void this.reconcileLiveOrder();
      return;
    }
    if (this.lanternState.phase === 'verified') return this.advancePhysicalLantern({ type: 'fulfill-lantern' });
    if (this.lanternState.phase === 'fulfilled' && this.selectedRole === 'builder' && this.payHarborBuilderStation < 6) {
      this.payHarborBuilderStation += 1;
      this.audio.playWorldCue('city-interaction');
      this.renderPayHarbor();
      return;
    }
    if (this.lanternState.phase === 'fulfilled') return this.advancePhysicalLantern({ type: 'reach-tower' });
    void this.returnToBeaconCommons();
  };

  private createCityPaymentReview(): HTMLElement | null {
    if (this.lanternState.phase !== 'review' && this.lanternState.phase !== 'confirming') return null;
    const request = this.currentLanternRequest();
    const fee = this.lanternState.mode === 'practice' ? '0 Lunas / practice' : 'Quoted by Nimiq Pay';
    const total = this.lanternState.mode === 'practice' ? `${request.valueLuna.toLocaleString()} Lunas` : 'Shown before approval';
    const review = element('dl', 'atlas-city-payment-review');
    review.setAttribute('aria-label', 'Exact payment fields');
    review.append(
      element('dt', '', 'NETWORK'), element('dd', '', request.network),
      element('dt', '', 'RECIPIENT'), element('dd', '', request.recipient),
      element('dt', '', 'AMOUNT'), element('dd', '', `${request.valueLuna.toLocaleString()} Lunas`),
      element('dt', '', 'FEE'), element('dd', '', fee),
      element('dt', '', 'TOTAL'), element('dd', '', total),
    );
    return review;
  }

  private advancePhysicalLantern(action: LastLanternAction): void {
    try {
      replayLastLantern([action], this.lanternState);
      this.audio.setState({ phase: this.lanternState.phase, evidenceSource: action.type === 'receive-evidence' ? action.source : undefined });
      if (this.lanternState.phase === 'tower-lit') {
        this.progress.completeDistrict('pay-harbor');
        this.progress.completeTrial('last-lantern');
      }
      this.presentPayHarborWorld();
      this.renderPayHarbor();
    } catch (error) {
      this.toolkit?.setDetail(error instanceof Error ? error.message : 'The harbor action could not continue.');
    }
  }

  private presentPayHarborWorld(): void {
    const mission = projectPayHarborPhysicalMission(this.lanternState, this.payHarborBuilderStation);
    const restoration = mission.restoration;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.livingCity?.setInteractionPresentation({
      districtId: 'pay-harbor',
      relayCarried: this.selectedRole === 'builder' && this.lanternState.phase === 'fulfilled',
      builderStationIndex: this.payHarborBuilderStation,
      targetAnchorId: mission.targetAnchorId,
    });
    this.livingCity?.present(createPayHarborScene({ restoration, reducedMotion }).snapshot);
  }

  private async returnToBeaconCommons(): Promise<void> {
    const controller = this.livingCity;
    const assets = this.cityAssets;
    if (!controller || !assets) return;
    try {
      const scenePath = '/atlas/3d/v1/beacon-commons/scene.json';
      const scene = parseAtlasCityScene(JSON.parse(new TextDecoder().decode(await assets.loadBytes(scenePath))) as unknown);
      await controller.activateDistrict('beacon-commons');
      controller.setInteractionPresentation(undefined);
      controller.setNavigation(livingCityNavigation(scene));
      controller.present(projectLivingWorld(BEACON_CORE_WORLD, createAtlasState(BEACON_CORE_WORLD.mission), 'waiting'));
      this.beaconScene = scene;
      this.cityQuestStep = 'meet-guide';
      this.screen = 'beacon-commons';
      this.renderBeaconCommons();
    } catch {
      this.toolkit?.setDetail('Beacon Commons is temporarily unavailable. Your Pay Harbor progress is already saved.');
    }
  }

  private ensureLivingCity(): Promise<void> {
    if (this.livingCity) return Promise.resolve();
    if (!this.livingCityInit) this.livingCityInit = this.initializeLivingCity().finally(() => { this.livingCityInit = null; });
    return this.livingCityInit;
  }

  private async initializeLivingCity(): Promise<void> {
    const { createAtlasRenderer } = await import('../render/scene-graph');
    const response = await fetch('/atlas/manifests/assets-v2.json', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('The verified Beacon Commons asset manifest is unavailable.');
    const manifest = parseAtlasAssetManifest(await response.json());
    if (manifest.version !== 2) throw new Error('The Beacon Commons asset manifest is outdated.');
    const assets = createAtlasAssetManager({ load: async () => undefined, unload: async () => undefined }, { manifest, expectedManifestVersion: 2 });
    this.cityAssets = assets;
    const scenePath = '/atlas/3d/v1/beacon-commons/scene.json';
    const scene = parseAtlasCityScene(JSON.parse(new TextDecoder().decode(await assets.loadBytes(scenePath))) as unknown);
    this.beaconScene = scene;
    const host = document.createElement('div');
    host.id = 'atlas-city-stage';
    host.setAttribute('aria-hidden', 'true');
    (this.ui.parentElement ?? document.body).append(host);
    const renderer = createAtlasRenderer();
    const controller = new AtlasLivingCityController({
      renderer,
      daySeed: new Date().toISOString().slice(0, 10),
      navigation: livingCityNavigation(scene),
      sampleMovement: () => {
        const action = this.input.sample();
        return { moveX: action.moveX, moveY: action.moveY };
      },
      onFrame: ({ player }) => {
        this.updateBeaconMap(player);
        this.observeTutorial(player);
      },
      /*
       * Derived from the current screen, not from a flag each screen has to
       * remember to clear.
       *
       * The first version cleared orbitStartedAt in screenPanel, which the two
       * play shells deliberately do not call — so after visiting the welcome
       * screen the camera kept orbiting during play, overriding player-follow
       * and leaving it pointed at empty ground. Gating on the screen makes the
       * whole class of mistake impossible.
       */
      idleHeading: () => {
        if (this.screen !== 'welcome' || this.orbitStartedAt === null) return null;
        return this.orbit.headingAt((performance.now() - this.orbitStartedAt) / 1_000);
      },
    });
    try {
      await renderer.initialize(host, {
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        resolution: 1,
        qualityTier: 'balanced',
        maxPixelRatio: 1,
        assetManager: assets,
      });
      await controller.activateDistrict('beacon-commons');
      controller.present(projectLivingWorld(BEACON_CORE_WORLD, createAtlasState(BEACON_CORE_WORLD.mission), 'waiting'));
      controller.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), 1);
      controller.start();
      if (this.screen !== 'welcome' && this.screen !== 'beacon-commons') {
        await controller.destroy();
        host.remove();
        return;
      }
      this.livingCityHost = host;
      this.livingCity = controller;
    } catch (error) {
      await controller.destroy().catch(() => undefined);
      this.cityAssets = null;
      host.remove();
      throw error;
    }
  }

  private async stopLivingCity(): Promise<void> {
    const controller = this.livingCity;
    const host = this.livingCityHost;
    this.livingCity = null;
    this.livingCityHost = null;
    this.cityAssets = null;
    this.beaconScene = null;
    this.beaconMapSvg = null;
    this.beaconMapPlayer = null;
    this.beaconMapTarget = null;
    this.cityWaypointLabel = null;
    this.cityWaypointDistance = null;
    await controller?.destroy();
    host?.remove();
  }

  /*
   * Screenshot capture entry.
   *
   * The guide images in docs/shots and public/atlas/screenshots are produced by
   * scripts/shoot-atlas.mjs, and two of them document the lantern screen, which
   * is reachable only by walking to Mara in the 3D city. The capture used to
   * assume one click from home reached it; that stopped being true when the
   * welcome screen was given a single primary action pointing at Beacon
   * Commons, and the capture has been failing there ever since.
   *
   * Asking for the screen directly is honest about what the tool needs, and
   * cheaper than teaching a screenshot script to play the game. main.ts only
   * hands this out when the page is opened with ?capture=1.
   */
  openLanternForCapture(): void {
    this.startLantern();
  }

  private startLantern = (): void => {
    void this.stopLivingCity();
    this.canvas.hidden = false;
    this.audio.unlock();
    this.lanternState = createLastLanternState(this.selectedRole, this.paymentConfig.enabled ? 'live' : 'practice');
    this.audio.setState({ phase: this.lanternState.phase });
    this.paymentNotice = '';
    this.liveOrderId = null;
    this.liveLookup = null;
    this.paymentController = this.paymentConfig.enabled ? this.createPaymentController() : null;
    this.restorePaymentJourney();
    this.screen = 'lantern';
    this.renderLantern();
  };

  private createPaymentController(): AtlasPaymentController {
    const request = this.currentLanternRequest();
    if (!this.paymentConfig.enabled || request.recipient === LAST_LANTERN.recipient) throw new Error('A real TestAlbatross recipient is required for live payment.');
    return new AtlasPaymentController({
      actorId: this.sessionActorId,
      request,
      wallet: this.wallet,
      api: this.api,
      minimumConfirmations: LAST_LANTERN.minimumConfirmations,
      persistence: createPaymentPersistence(safeStorage(), `sface-atlas-payment:${this.sessionActorId}:${request.itemId}`),
    });
  }

  private restorePaymentJourney(): void {
    const state = this.paymentController?.state;
    if (!state || !state.orderId || !state.lookup || !['confirming', 'verified', 'fulfilled'].includes(state.status)) return;
    const request = this.currentLanternRequest();
    replayLastLantern([
      { type: 'enter-shop' },
      { type: 'select-lantern' },
      { type: 'review-request', request },
      { type: 'await-evidence' },
    ], this.lanternState);
    this.liveOrderId = state.orderId;
    this.liveLookup = state.lookup;
    this.paymentNotice = 'A submitted payment was restored safely. Atlas will re-check canonical evidence before unlocking the harbor.';
  }

  private openKnowledgeBook = (): void => {
    void this.stopLivingCity();
    this.screen = 'book';
    this.bookOpen = true;
    this.teachBackStep = 0;
    this.teachBackNotice = '';
    this.renderKnowledgeBook();
  };

  private openDailyPuzzle = (): void => {
    void this.stopLivingCity();
    this.screen = 'daily';
    this.dailyNotice = '';
    this.renderDailyPuzzle();
  };

  private renderDailyPuzzle(): void {
    this.ui.replaceChildren();
    const challenge = selectDailyChallenge(new Date());
    const panel = this.screenPanel('atlas-daily');
    panel.setAttribute('aria-label', 'Daily Atlas puzzle');
    panel.append(
      this.screenNav('Daily puzzle'),
      element('p', 'atlas-eyebrow', 'DAILY ATLAS PUZZLE'),
      element('h1', '', challenge.title),
      element('p', 'atlas-book-sequence', `DAY ${challenge.day} OF 28 / ${challenge.theme.toUpperCase()} / LEARN / SOLVE / VERIFY`),
      element('p', 'atlas-trial-copy', challenge.prompt),
      element('p', 'atlas-lantern-mode', 'FREE CORE / LOCAL PRACTICE / SERVER VERIFICATION REQUIRED FOR REWARDS'),
    );
    const choices = element('div', 'atlas-daily-choices');
    for (const answer of dailyChallengeChoices(challenge)) choices.append(actionButton(formatDailyChoice(answer), () => {
      this.dailyNotice = answer === challenge.answer ? 'Correct locally. Reward share appears only after server verification.' : dailyRetryHint(challenge);
      this.renderDailyPuzzle();
    }, `Answer ${formatDailyChoice(answer)}`));
    panel.append(choices);
    if (this.dailyNotice) panel.append(element('p', this.dailyNotice.startsWith('Correct') ? 'atlas-builder-success' : 'atlas-lantern-error', this.dailyNotice));
    this.ui.append(panel);
  }

  private openEvergreen = (): void => {
    void this.stopLivingCity();
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
      this.evergreenNotice = action.type === 'teach-back'
        ? 'That rule does not explain this consequence yet. Revisit what changed in the district and try again.'
        : error instanceof Error ? error.message : 'That district step could not continue.';
    }
    this.renderEvergreen();
  };

  private renderEvergreen(): void {
    this.ui.replaceChildren();
    this.renderer.drawDistrict(this.evergreenAdventure.districtId, this.evergreenState.phase === 'completed');
    const panel = this.screenPanel('atlas-evergreen');
    panel.setAttribute('aria-label', 'Evergreen District Atlas');
    panel.append(
      this.screenNav('District Atlas'),
      element('p', 'atlas-eyebrow', 'DISTRICT ATLAS / EVERGREEN ADVENTURES'),
      element('h1', '', 'Walk the living network'),
      element('p', 'atlas-trial-copy', 'Meet a human need, use a Nimiq concept in the world, see the consequence, then teach the rule back without the Book.'),
      element('p', 'atlas-book-sequence', 'ENCOUNTER / ACT / CONSEQUENCE / TRANSFER / TEACH-BACK'),
    );
    const map = element('div', 'atlas-district-tabs');
    for (const adventure of ATLAS_EVERGREEN_ADVENTURES) {
      const selected = adventure.id === this.evergreenAdventure.id;
      const tab = actionButton(adventure.districtId.replace(/-/g, ' '), () => this.chooseEvergreen(adventure), `Enter ${adventure.title}`);
      tab.className = `atlas-district-tab${selected ? ' is-selected' : ''}`;
      tab.setAttribute('aria-pressed', String(selected));
      map.append(tab);
    }
    panel.append(map);
    const adventure = this.evergreenAdventure;
    const journey = element('div', 'atlas-evergreen-journey');
    journey.append(element('p', 'atlas-trial-context', `${adventure.title.toUpperCase()} / ${this.evergreenState.phase.toUpperCase()}`), element('p', 'atlas-human-need', adventure.humanNeed), element('p', 'atlas-trial-copy', adventure.problem), element('p', 'atlas-builder-boundary', `VISIBLE CONSEQUENCE: ${this.evergreenState.consequence} ${adventure.consequence.visible}`));
    if (this.evergreenState.phase === 'arrival') {
      journey.append(actionButton('Observe the problem', () => this.advanceEvergreen({ type: 'observe' }), 'Observe the district problem'));
    } else if (this.evergreenState.phase === 'observed') {
      journey.append(element('p', 'atlas-evergreen-role', this.selectedRole === 'builder' ? `BUILDER MIRROR: ${adventure.builderMirror}` : `EXPLORER ACTION: ${adventure.explorerAction}`));
      journey.append(actionButton(this.selectedRole === 'builder' ? 'Run Builder repair' : 'Take Explorer action', () => this.advanceEvergreen({ type: 'act', role: this.selectedRole }), `Run ${this.selectedRole} action`));
    } else if (this.evergreenState.phase === 'acted') {
      const step = this.evergreenState.teachBack.length + 1;
      journey.append(element('p', 'atlas-evergreen-role', `TRANSFER / TEACH-BACK ${step} OF ${adventure.teachBack.length}: choose the rule the consequence demonstrated.`));
      const choices = element('div', 'atlas-evergreen-choices');
      for (const choice of evergreenTeachBackChoices(adventure, this.evergreenState.teachBack.length)) {
        choices.append(actionButton(choice.toUpperCase(), () => this.advanceEvergreen({ type: 'teach-back', answer: choice }), `Teach back ${choice}`));
      }
      journey.append(choices);
    } else {
      journey.append(element('div', 'atlas-builder-success', `DISTRICT RESTORED / ${adventure.consequence.after}`), element('p', 'atlas-quiet', 'This local seal records learning only. Server verification is required before any score, rank, or reward claim.'));
    }
    if (this.evergreenNotice) journey.append(element('p', 'atlas-lantern-error', this.evergreenNotice));
    panel.append(journey, actionButton('Open Living Knowledge Book', this.openKnowledgeBook, 'Open Living Knowledge Book'));
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
    const bookView = createAtlasKnowledgeBookView(ATLAS_KNOWLEDGE_BOOK, this.knowledgeState, this.bookOpen ? 'open' : 'closed');
    const panel = this.screenPanel('atlas-book');
    panel.setAttribute('aria-label', 'Living Knowledge Book');
    panel.append(
      this.screenNav('Knowledge Book'),
      element('p', 'atlas-eyebrow', 'LIVING KNOWLEDGE BOOK'),
      element('h1', '', 'Carry the rules, not the jargon'),
      element('p', 'atlas-trial-copy', 'Fragments are tools for the adventure. Learn a rule, use it in a route, then close the Book and teach it back.'),
      element('p', 'atlas-book-sequence', 'ASK / CHECK / APPROVE / CONFIRM / UNLOCK'),
      element('p', 'atlas-lantern-mode', this.bookOpen ? 'FREE CORE / NO PRIZE ADVANTAGE' : 'BOOK CLOSED / TEACH-BACK'),
    );
    if (this.bookOpen) {
      panel.append(element('p', 'atlas-book-progress', `${bookView.carriedFragmentIds.length} OF ${ATLAS_KNOWLEDGE_BOOK.fragments.length} FRAGMENTS CARRIED / ${bookView.availableReferenceIds.length} READY FOR LATER PUZZLES`));
      const list = element('div', 'atlas-book-list');
      for (const fragment of ATLAS_KNOWLEDGE_BOOK.fragments) {
        const card = document.createElement('details');
        card.className = 'atlas-book-card atlas-fragment-details';
        const collected = this.knowledgeState.fragmentIds.includes(fragment.id);
        card.append(element('summary', '', `${fragment.title}${collected ? ' / COLLECTED' : ''}`), element('p', '', fragment.summary), element('p', 'atlas-book-example', `TRY IT: ${fragment.example}`), element('p', 'atlas-book-failure', `IF MISSED: ${fragment.failure}`));
        card.append(actionButton(collected ? 'Fragment carried' : 'Carry fragment', () => this.collectKnowledge(fragment.id), `Carry ${fragment.title} fragment`));
        list.append(card);
      }
      panel.append(list, actionButton('Close Book and start teach-back', this.closeBookForTeachBack, 'Close Book and start teach-back'));
    } else if (this.teachBackStep >= ATLAS_KNOWLEDGE_BOOK.teachBackOrder.length) {
      panel.append(element('div', 'atlas-builder-success', 'TEACH-BACK COMPLETE / KNOWLEDGE ACTIVE'), element('p', 'atlas-quiet', this.teachBackNotice), actionButton('Open Book again', this.openKnowledgeBook, 'Open Living Knowledge Book again'), actionButton('Return to Mara', this.startLantern, 'Return to Mara'));
    } else {
      const stepId = ATLAS_KNOWLEDGE_BOOK.teachBackOrder[this.teachBackStep]!;
      panel.append(element('p', 'atlas-builder-progress', `TEACH-BACK STEP ${this.teachBackStep + 1} OF 5 / NAME THE NEXT MOVE`), element('p', 'atlas-trial-copy', knowledgeTeachBackPrompt(stepId)));
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
      this.audio.setState({ phase: this.lanternState.phase, evidenceSource: action.type === 'receive-evidence' ? action.source : undefined });
      if (this.lanternState.phase === 'tower-lit') {
        this.progress.completeDistrict('pay-harbor');
        this.progress.completeTrial('last-lantern');
      }
    } catch (error) {
      this.audio.setState({ phase: this.lanternState.phase, evidenceSource: action.type === 'receive-evidence' ? action.source : undefined });
      this.renderLantern(error instanceof Error ? error.message : 'The practice step could not continue.');
      return;
    }
    this.renderLantern();
  };

  private renderLantern(notice = ''): void {
    this.ui.replaceChildren();
    this.renderer.drawHarbor(this.lanternState.phase, this.selectedRole);
    const panel = this.screenPanel('atlas-lantern');
    panel.setAttribute('aria-label', 'The Last Lantern local practice');
    panel.append(
      this.screenNav('Pay Harbor'),
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
    if (phase === 'selected' && this.selectedRole === 'builder') return actionButton('Open provider workshop', this.startBuilderRepair, 'Open the Pay Harbor provider workshop');
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
    this.renderCurrentLanternSurface();
    try {
      const controller = this.paymentController ?? (this.paymentController = this.createPaymentController());
      const result = await controller.start();
      this.liveOrderId = result.orderId;
      this.liveLookup = result.lookup;
      if (result.status === 'confirming') {
        if (this.lanternState.phase === 'review') this.advanceCurrentLantern({ type: 'await-evidence' });
        this.paymentNotice = 'Approval received. The provider lookup is submitted; it is not payment proof. Ask Atlas to confirm the chain.';
        await this.reconcileLiveOrder();
      } else {
        this.paymentNotice = result.error ?? `Payment flow is ${result.status}. Review the request before retrying.`;
        this.renderCurrentLanternSurface();
      }
    } catch (error) {
      this.paymentNotice = error instanceof Error ? error.message : 'The mobile payment could not continue. Review the request and retry.';
      this.renderCurrentLanternSurface();
    } finally {
      this.paymentBusy = false;
      this.renderCurrentLanternSurface();
    }
  };

  private reconcileLiveOrder = async (): Promise<void> => {
    if (!this.liveOrderId || !this.paymentController) {
      this.paymentNotice = 'Approve the reviewed request first; no order is waiting for confirmation.';
      this.renderCurrentLanternSurface();
      return;
    }
    try {
      const result = await this.paymentController.reconcile();
      if (result.status === 'confirming') {
        this.paymentNotice = 'Still waiting for canonical confirmation. The lantern stays locked until the server observes it.';
        this.renderCurrentLanternSurface();
        return;
      }
      if (result.status !== 'verified' || !result.evidence || !this.liveLookup) {
        this.paymentNotice = 'The server returned fulfillment without usable evidence. The harbor remains locked.';
        this.renderCurrentLanternSurface();
        return;
      }
      this.paymentController.fulfill();
      this.paymentNotice = 'Confirmed by canonical chain evidence. The harbor can unlock.';
      this.advanceCurrentLantern({ type: 'receive-evidence', source: 'server-verified', evidence: { txHash: this.liveLookup, network: result.evidence.network, recipient: result.evidence.recipient, valueLuna: result.evidence.valueLuna, canonical: result.evidence.canonical, success: result.evidence.success, confirmations: result.evidence.confirmations } });
    } catch (error) {
      this.paymentNotice = error instanceof Error ? error.message : 'The server could not reconcile the payment yet.';
      this.renderCurrentLanternSurface();
    }
  };

  private renderCurrentLanternSurface(): void {
    if (this.screen === 'pay-harbor' && this.livingCity) {
      this.presentPayHarborWorld();
      this.renderPayHarbor();
      return;
    }
    this.renderLantern();
  }

  private advanceCurrentLantern(action: LastLanternAction): void {
    if (this.screen === 'pay-harbor' && this.livingCity) {
      this.advancePhysicalLantern(action);
      return;
    }
    this.advanceLantern(action);
  }

  private startBuilderRepair = (): void => {
    this.screen = 'trial';
    this.builderStep = 0;
    this.builderNotice = '';
    this.renderBuilderRepair();
  };

  private renderBuilderRepair(): void {
    this.ui.replaceChildren();
    const panel = this.screenPanel('atlas-builder-repair');
    panel.setAttribute('aria-label', 'Builder repair practice');
    panel.append(
      this.screenNav('Provider workshop'),
      element('p', 'atlas-eyebrow', 'BUILDER REPAIR / PAYMENT PATH'),
      element('p', 'atlas-trial-context', 'Builder Trial 1 of 6 / YOU ARE HERE: MARA\'S PAY HARBOR WORKSHOP'),
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
      recipe.textContent = 'provider-init \u2192 user intent \u2192 accounts \u2192 exact payment \u2192 lookup \u2192 chain confirmation \u2192 one fulfillment';
      panel.append(recipe, element('p', 'atlas-quiet', 'This local seal does not create a wallet proof, score, rank, or reward claim.'));
      panel.append(actionButton('Install repair and reopen route', this.finishBuilderRepairIntoHarbor, 'Install the local Builder repair and return to Pay Harbor'));
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

  private finishBuilderRepairIntoHarbor = (): void => {
    this.progress.completeDistrict('pay-harbor');
    this.progress.completeTrial('harbor-repair-v1');
    replayLastLantern([{ type: 'review-request', request: this.currentLanternRequest() }], this.lanternState);
    if (this.lanternState.mode === 'practice') {
      replayLastLantern([{
        type: 'receive-evidence',
        source: 'local-simulation',
        evidence: {
          txHash: 'builder-practice-only',
          network: LAST_LANTERN.request.network,
          recipient: LAST_LANTERN.recipient,
          valueLuna: LAST_LANTERN.priceLuna,
          canonical: true,
          success: true,
          confirmations: LAST_LANTERN.minimumConfirmations,
        },
      }], this.lanternState);
      this.paymentNotice = 'Workshop repair passed locally. The route is safe to fulfill in practice mode; no payment, score, or reward proof was created.';
    } else {
      this.paymentNotice = 'Workshop repair passed. Review and approve the exact TestAlbatross request in Nimiq Pay before the lantern can unlock.';
    }
    if (this.livingCity && this.beaconScene?.districtId === 'pay-harbor') {
      this.screen = 'pay-harbor';
      this.input.setSystem('active');
      this.presentPayHarborWorld();
      this.renderPayHarbor();
      return;
    }
    this.screen = 'lantern';
    this.renderLantern();
  };

  private togglePause = (): void => {
    if (this.suspended) this.resume();
    else this.suspend('paused');
  };

  private suspend(system: 'paused' | 'hidden'): void {
    if (!this.isLivingCityScreen() || this.suspended) return;
    this.input.setSystem(system);
    this.suspended = true;
    this.toolkit?.setDetail(system === 'hidden' ? 'Paused while NIM Atlas is hidden.' : 'Paused. Press Pause again to continue.');
  }

  private resume = (): void => {
    this.suspended = false;
    this.input.setSystem('active');
    if (this.screen === 'beacon-commons') this.renderBeaconCommons();
    if (this.screen === 'pay-harbor') this.renderPayHarbor();
  };

  private visibility = (): void => {
    if (document.hidden) this.suspend('hidden');
    else this.resume();
  };

  private resize = (): void => {
    this.renderer.resize();
    if (this.isLivingCityScreen()) this.livingCity?.resize(window.innerWidth, window.innerHeight, 1);
    else if (this.screen === 'evergreen') this.renderer.drawDistrict(this.evergreenAdventure.districtId, this.evergreenState.phase === 'completed');
    else this.renderer.drawHarbor(this.lanternState.phase, this.selectedRole);
  };

  private isLivingCityScreen(): boolean {
    return this.screen === 'beacon-commons' || this.screen === 'pay-harbor';
  }

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
    button.addEventListener('click', (event) => {
      if (!shouldHandleDirectionalClick(event.detail)) return;
      this.input.setDirection(direction, true);
      window.setTimeout(() => this.input.setDirection(direction, false), 120);
    });
    return button;
  }

  private createCityJoystick(): HTMLElement {
    const pad = element('div', 'atlas-joystick');
    pad.setAttribute('role', 'application');
    pad.setAttribute('aria-label', 'Movement joystick. Drag gently to walk or hold at the edge to run. Keyboard players may use arrows or WASD.');
    const thumb = element('span', 'atlas-joystick-thumb');
    const label = element('span', 'atlas-joystick-label', 'READY');
    this.cityPaceLabel = label;
    pad.append(thumb, label);
    let activePointer: number | null = null;
    const update = (event: PointerEvent): void => {
      const bounds = pad.getBoundingClientRect();
      const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.5 - 22);
      const rawX = event.clientX - (bounds.left + bounds.width * 0.5);
      const rawY = event.clientY - (bounds.top + bounds.height * 0.5);
      const distance = Math.hypot(rawX, rawY);
      const scale = distance > radius ? radius / distance : 1;
      const x = rawX * scale;
      const y = rawY * scale;
      thumb.style.transform = `translate(${x}px, ${y}px)`;
      this.input.setJoystick({ x: x / radius, y: y / radius });
    };
    const release = (event?: PointerEvent): void => {
      if (event && activePointer !== null && event.pointerId !== activePointer) return;
      activePointer = null;
      thumb.style.transform = 'translate(0, 0)';
      this.input.clearJoystick();
    };
    const handlePointer = (event: PointerEvent): void => {
      if (event.type === 'pointerdown') {
        event.preventDefault();
        activePointer = event.pointerId;
        pad.setPointerCapture?.(event.pointerId);
        update(event);
      } else if (event.type === 'pointermove') {
        if (event.pointerId === activePointer) update(event);
      } else {
        release(event);
      }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      pad.addEventListener(type, handlePointer);
    }
    return pad;
  }

  private createCameraLookZone(): HTMLElement {
    const zone = element('div', 'atlas-camera-look-zone');
    zone.setAttribute('role', 'application');
    zone.setAttribute('aria-label', 'Camera look area. Drag left or right to turn the camera around the player.');
    zone.append(element('span', 'atlas-camera-look-hint', 'DRAG TO LOOK'));
    const look = new AtlasCameraLookController();
    const release = (event: PointerEvent): void => {
      if (!look.end(event.pointerId)) return;
      zone.classList.remove('is-looking');
      this.livingCity?.setCameraControlActive(false);
    };
    const handlePointer = (event: PointerEvent): void => {
      if (event.type === 'pointerdown') {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        look.begin(event.pointerId, event.clientX);
        zone.setPointerCapture?.(event.pointerId);
        zone.classList.add('is-looking');
        this.livingCity?.setCameraControlActive(true);
      } else if (event.type === 'pointermove') {
        const yawRadians = look.move(event.pointerId, event.clientX);
        if (yawRadians !== 0) this.livingCity?.orbitCamera(yawRadians);
      } else {
        release(event);
      }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      zone.addEventListener(type, handlePointer);
    }
    zone.oncontextmenu = (event) => { event.preventDefault(); };
    return zone;
  }

  private createCityWaypoint(): HTMLElement {
    const panel = element('aside', 'atlas-city-waypoint');
    panel.setAttribute('aria-label', 'Current city waypoint');
    const kicker = element('span', 'atlas-city-waypoint-kicker', 'NEXT TARGET');
    const label = element('strong', 'atlas-city-waypoint-label', 'LOADING');
    const distance = element('span', 'atlas-city-waypoint-distance', 'FOLLOW THE MAP');
    panel.append(kicker, label, distance);
    this.cityWaypointLabel = label;
    this.cityWaypointDistance = distance;
    return panel;
  }

  private updateCityWaypoint(player: AtlasCityPlayerState, target: readonly [number, number, number]): void {
    if (!this.cityWaypointLabel || !this.cityWaypointDistance) return;
    const guidance = getAtlasWaypointGuidance(player, { x: target[0], z: target[2] });
    this.cityWaypointLabel.textContent = `${guidance.arrow} ${guidance.direction === 'ready' ? 'ACT NOW' : guidance.direction.toUpperCase()}`;
    this.cityWaypointDistance.textContent = guidance.direction === 'ready' ? 'WITHIN REACH' : `${guidance.distanceMeters.toFixed(1)}M AWAY`;
    this.cityWaypointLabel.dataset.direction = guidance.direction;
  }

  /*
   * Feeds the first-run sequence from the frame that already runs.
   *
   * Distance walked is measured from where the run started rather than summed
   * per frame, so nudging the stick back and forth cannot satisfy the step that
   * exists to prove the player found the joystick.
   */
  private observeTutorial(player: AtlasCityPlayerState | undefined): void {
    if (!player || this.tutorial.isComplete()) return;
    if (!this.tutorialOrigin) this.tutorialOrigin = { x: player.x, z: player.z };
    const guide = this.beaconScene?.anchors.find((anchor) => anchor.id === 'mission-guide');
    const changed = this.tutorial.observe({
      metresWalked: Math.hypot(player.x - this.tutorialOrigin.x, player.z - this.tutorialOrigin.z),
      metresToGuide: guide ? Math.hypot(guide.position[0] - player.x, guide.position[2] - player.z) : Number.POSITIVE_INFINITY,
      hasTalked: this.cityQuestStep !== 'meet-guide',
    });
    if (!changed) return;
    if (this.tutorial.isComplete()) writeTutorialDone();
    if (this.screen === 'beacon-commons') this.renderBeaconCommons();
  }

  /*
   * Dims the play screen down to the one control the current step teaches.
   *
   * The scrim is a sibling that swallows every tap; the spotlighted control is
   * lifted above it and keeps its own handlers, so the player performs the real
   * action rather than a rehearsal of it. There is no close button by design —
   * a tutorial a confused player can dismiss by accident is not a tutorial.
   */
  private applyTutorialStep(shell: HTMLElement, joystick: HTMLElement, interact: HTMLElement): void {
    const step = this.tutorial.step();
    this.livingCityHost?.classList.toggle('is-tutorial-dimmed', step !== null);
    if (!step) return;
    shell.classList.add('is-tutorial');
    const target = step.spotlight === 'joystick' ? joystick : interact;
    target.classList.add('atlas-spotlight');
    /*
     * Mark the ancestors between the spotlight and the shell so the dimming
     * rule can skip them. Without this the control is dimmed by its own parent,
     * and opacity on a parent cannot be undone by a child.
     */
    for (let node = target.parentElement; node && node !== shell; node = node.parentElement) {
      node.classList.add('atlas-spotlight-path');
    }
    const prompt = element('div', 'atlas-tutorial-prompt');
    prompt.setAttribute('role', 'status');
    prompt.append(element('span', '', step.prompt), element('small', '', `STEP ${this.tutorialStepNumber()} OF 3`));
    shell.append(prompt);
  }

  private tutorialStepNumber(): number {
    const step = this.tutorial.step();
    return step === null ? 3 : ['walk', 'approach', 'talk'].indexOf(step.id) + 1;
  }

  private isNearBeaconAnchor(player: { readonly x: number; readonly z: number }, anchorId: string, fallbackRadius: number): boolean {
    const anchor = this.beaconScene?.anchors.find((candidate) => candidate.id === anchorId);
    if (!anchor) return false;
    return Math.hypot(player.x - anchor.position[0], player.z - anchor.position[2]) <= Math.max(anchor.radius, fallbackRadius);
  }
}

function livingCityNavigation(scene: AtlasCitySceneV1): AtlasLivingCityNavigation {
  const player = scene.instances.find((instance) => instance.modelId === 'atlas-walker-player');
  if (!player) throw new Error('Beacon Commons is missing its player arrival point.');
  if (scene.navigation) {
    return {
      initial: { x: scene.navigation.safeSpawn[0], z: scene.navigation.safeSpawn[2], facing: 'up' },
      bounds: scene.navigation.bounds,
      colliders: scene.colliders,
      cameraHeadingRadians: scene.navigation.cameraHeadingRadians,
    };
  }
  const points = [
    ...scene.anchors.filter((anchor) => !anchor.id.startsWith('npc-spawn-')).map((anchor) => anchor.position),
    ...scene.paths.filter((path) => path.id !== 'walk-outer-ring').flatMap((path) => path.points),
  ];
  const xValues = points.map((point) => point[0]);
  const zValues = points.map((point) => point[2]);
  return {
    initial: { x: player.position[0], z: player.position[2], facing: 'up' },
    bounds: {
      minX: Math.min(...xValues) - 1.2,
      maxX: Math.max(...xValues) + 1.2,
      minZ: Math.min(...zValues) - 1.2,
      maxZ: Math.max(...zValues) + 1.2,
    },
    colliders: scene.colliders,
  };
}

/*
 * Whether the first run has already happened.
 *
 * Kept in its own key rather than in the progress store so that clearing game
 * progress does not force an experienced player back through the tutorial, and
 * so a storage failure degrades to showing it again rather than to a crash.
 */
const TUTORIAL_DONE_KEY = 'sface.atlas.tutorial.v1';

function readTutorialDone(): boolean {
  try {
    return globalThis.localStorage?.getItem(TUTORIAL_DONE_KEY) === 'done';
  } catch {
    return false;
  }
}

function writeTutorialDone(): void {
  try {
    globalThis.localStorage?.setItem(TUTORIAL_DONE_KEY, 'done');
  } catch {
    // A player in private browsing sees the tutorial again. That is a far
    // better failure than refusing to play.
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

function knowledgeTeachBackPrompt(stepId: string): string {
  const prompts: Record<string, string> = {
    ask: 'A route needs wallet access to continue. What must happen before the wallet opens?',
    check: 'Mara can see a network, recipient, and amount. What should she do before any approval?',
    approve: 'The request is exact and readable. Who must make the next decision?',
    confirm: 'The provider returned a transaction lookup. What must Atlas wait for before delivery?',
    unlock: 'Canonical evidence matches the approved request. What may safely happen once?',
  };
  return prompts[stepId] ?? 'Which authority boundary should the route apply next?';
}

function actionButton(label: string, action: () => void, ariaLabel: string): HTMLButtonElement {
  return createSemanticWorldControl({ label, ariaLabel, onActivate: action });
}

/**
 * A secondary action: same shape and same tap target, without the signal
 * colour. Orange means "this is the next thing to do", so it can only be worn
 * by one control on a screen.
 */
function ghostButton(label: string, action: () => void, ariaLabel: string): HTMLButtonElement {
  const button = actionButton(label, action, ariaLabel);
  button.classList.add('atlas-ghost');
  return button;
}

function externalLink(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'atlas-guide-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  return link;
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

function createPaymentPersistence(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string): { load: () => import('./payment-controller').AtlasPaymentControllerSnapshot | null; save: (snapshot: import('./payment-controller').AtlasPaymentControllerSnapshot) => void } {
  return {
    load: () => {
      try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) as import('./payment-controller').AtlasPaymentControllerSnapshot : null;
      } catch {
        return null;
      }
    },
    save: (snapshot) => {
      try { storage.setItem(key, JSON.stringify(snapshot)); } catch { /* A failed browser cache must never change payment authority. */ }
    },
  };
}
