import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);

const ROLE_TOKENS = [
  '--atlas-paper',
  '--atlas-raised',
  '--atlas-ink',
  '--atlas-muted',
  '--atlas-label',
  '--atlas-label-dim',
  '--atlas-signal',
  '--atlas-signal-deep',
  '--atlas-warn',
  '--atlas-verified',
  '--atlas-selected',
  '--atlas-explorer',
  '--atlas-builder',
  '--atlas-inert',
];

describe('Atlas design tokens', () => {
  it('declares every role token', () => {
    for (const token of ROLE_TOKENS) {
      expect(rootBlock, `missing ${token}`).toContain(`${token}:`);
    }
  });

  it('names tokens by role rather than by colour', () => {
    // --atlas-blue was used as a selection ring, which nobody could guess from
    // the name. A token named for its colour cannot tell you where it belongs,
    // so it ends up everywhere.
    for (const colourName of ['--atlas-orange', '--atlas-red', '--atlas-green', '--atlas-blue']) {
      expect(css, `${colourName} is named for its colour`).not.toContain(colourName);
    }
  });

  it('keeps every hex literal inside :root', () => {
    // 22 hex literals behind 11 tokens is how a palette rots. Anything outside
    // :root is a colour no one can change in one place.
    const outsideRoot = css.replace(rootBlock, '');
    const strays = [...outsideRoot.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
    expect(strays, `hex literals outside :root: ${[...new Set(strays)].join(', ')}`).toHaveLength(0);
  });

  it('keeps every rgba colour inside :root too', () => {
    // The hex rule above never caught these, so six alphas of the old cream
    // and the old signal orange sat in the HUD untokenized. Alpha belongs at
    // the use site via rgb(var(--token) / <alpha>); the channels do not.
    const outsideRoot = css.replace(rootBlock, '');
    const strays = [...outsideRoot.matchAll(/rgba?\(\s*\d+[\s,]/g)].map((match) => match[0]);
    expect(strays, `${strays.length} rgba literals outside :root`).toHaveLength(0);
  });

  it('publishes channel triples so alpha can vary without a new colour', () => {
    for (const token of ['--atlas-paper-rgb', '--atlas-ink-rgb', '--atlas-signal-rgb', '--atlas-explorer-rgb', '--atlas-shadow-rgb']) {
      expect(rootBlock, `missing ${token}`).toContain(`${token}:`);
      expect(rootBlock).toMatch(new RegExp(`${token}:\\s*\\d+ \\d+ \\d+`));
    }
  });

  it('provides one shared screen-reader utility', () => {
    expect(css).toContain('.sr-only');
  });

  it('focuses with the selection token and honours reduced motion', () => {
    expect(css).toContain('focus-visible');
    expect(css).toContain('var(--atlas-selected)');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('reserves the verified token for settled state only', () => {
    // Marking anything unconfirmed as verified would teach the exact habit the
    // curriculum exists to break.
    expect(rootBlock).toContain('--atlas-verified');
  });
});

describe('Atlas action hierarchy and briefing sheets', () => {
  const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');

  it('gives secondary actions a ghost variant instead of the signal colour', () => {
    expect(css).toContain('.atlas-primary.atlas-ghost');
    expect(app).toContain('function ghostButton');
    for (const secondary of ['How to play', 'Open Living Knowledge Book', 'Walk the District Atlas']) {
      expect(app, `${secondary} should be a ghost`).toContain(`ghostButton('${secondary}'`);
    }
  });

  it('keeps exactly one signal-coloured action on the welcome screen', () => {
    const welcome = app.slice(app.indexOf('private renderWelcome'), app.indexOf('private renderLandingSplash'));
    // Two calls to actionButton survive here and only one of them is orange.
    // The role picker calls it too, then immediately replaces className with
    // atlas-role, so it never wears the signal colour. That override is the
    // load-bearing line, so it is asserted rather than assumed.
    expect(welcome).toContain('button.className = `atlas-role atlas-role-${role.id}');
    expect([...welcome.matchAll(/\bactionButton\(/g)]).toHaveLength(2);
    // Everything else offered on this screen is explicitly a ghost.
    expect([...welcome.matchAll(/\bghostButton\(/g)].length).toBeGreaterThanOrEqual(4);
  });

  it('anchors every screen to the bottom so the city stays visible above it', () => {
    // Was: a sheet only when the city was ready, and full pages for welcome and
    // how-to-play because "nothing is running behind them". The city now runs
    // from boot, so a full-bleed page is always covering a live world.
    expect(css).toContain('.atlas-panel');
    expect(css).toContain('align-self: end');
    expect(app).toContain('private screenPanel(');
    expect(app).not.toContain("this.cityLoadState === 'ready' ? ' atlas-sheet' : ''");
  });

  it('builds all seven panel screens through the shared sheet helper', () => {
    for (const screen of [
      'renderWelcome', 'renderHowToPlay', 'renderDailyPuzzle', 'renderEvergreen',
      'renderKnowledgeBook', 'renderLantern', 'renderBuilderRepair',
    ]) {
      const start = app.indexOf(`private ${screen}(`);
      expect(start, `${screen} is missing`).toBeGreaterThan(-1);
      const body = app.slice(start, start + 2600);
      expect(body, `${screen} does not use screenPanel`).toContain('this.screenPanel(');
    }
  });

  it('leaves the two play shells alone', () => {
    // These are already the world-first surface everything else is being made
    // to resemble. Turning them into sheets would sheet the game itself.
    for (const screen of ['renderBeaconCommons', 'renderPayHarbor']) {
      const start = app.indexOf(`private ${screen}(`);
      const body = app.slice(start, start + 2600);
      expect(body, `${screen} should not be a sheet`).not.toContain('this.screenPanel(');
      expect(body).toContain('atlas-living-city-play-shell');
    }
  });

  it('leaves room for the world above every sheet', () => {
    const start = css.indexOf('\n.atlas-panel {') + 1;
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/max-height:\s*min\(6\dsvh/);
  });
});

describe('Atlas surfaces speak the kit', () => {
  it('gives panels glass and a radius instead of a hard ink offset', () => {
    const panel = css.slice(css.indexOf('.atlas-panel {'), css.indexOf('}', css.indexOf('.atlas-panel {')));
    expect(panel).toContain('var(--atlas-radius)');
    expect(panel).toContain('backdrop-filter');
    expect(panel).not.toMatch(/box-shadow:\s*\d+px \d+px 0/);
  });

  it('makes the primary action a pill that still presses', () => {
    // Anchored to a line start: '.atlas-primary {' also matches inside
    // '.atlas-quick-grid .atlas-primary {', which is a size override, not the
    // rule that defines the control.
    const start = css.indexOf('\n.atlas-primary {') + 1;
    const primary = css.slice(start, css.indexOf('}', start));
    expect(primary).toContain('var(--atlas-radius-pill)');
    expect(css).toContain('.atlas-primary:active');
    expect(css).toMatch(/\.atlas-primary:active\s*\{[^}]*translate/);
  });

  it('retires the monospace micro-labels', () => {
    // 9 to 11px uppercase mono eyebrows are the loudest generic-dashboard tell
    // in the build. Mono stays reserved for evidence a player can go and check.
    const microLabels = [...css.matchAll(/font:\s*\d+\s+(?:8|9|10|11)px\/[^;]*monospace/g)];
    expect(microLabels, `${microLabels.length} monospace micro-labels remain`).toHaveLength(0);
  });
});
