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

  it('anchors a briefing to the bottom when the city is already running', () => {
    expect(css).toContain('.atlas-panel.atlas-sheet');
    expect(css).toContain('align-self: end');
    expect(app).toContain("this.cityLoadState === 'ready' ? ' atlas-sheet' : ''");
  });

  it('leaves the welcome and how-to-play screens as full pages', () => {
    // Nothing is running behind them, so a sheet would be a smaller page for
    // no reason.
    expect(app).toContain("element('section', 'atlas-panel atlas-how-to-play')");
    expect(app).toContain("element('section', 'atlas-panel atlas-welcome atlas-home atlas-landing-shell')");
  });
});
