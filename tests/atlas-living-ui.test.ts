import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const toolkit = readFileSync(new URL('../src/atlas/ui/atlas-toolkit.ts', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/atlas/ui/semantic-world-controls.ts', import.meta.url), 'utf8');
const competition = readFileSync(new URL('../src/atlas/ui/competition.ts', import.meta.url), 'utf8');

describe('NIM Atlas living-world browser boundary', () => {
  it('keeps the entry module as a small bootstrap', () => {
    expect(main.split(/\r?\n/).length).toBeLessThan(100);
    expect(main).toContain('new AtlasApp');
    expect(app).toContain('class AtlasApp');
  });

  it('keeps one current objective in a stable live region across toolkit depths', () => {
    expect(toolkit).toContain("'glance'");
    expect(toolkit).toContain("'tool'");
    expect(toolkit).toContain("'reference'");
    expect(toolkit).toContain("'competition'");
    expect(toolkit).toContain('dataset.atlasCurrentObjective');
    expect(toolkit).toContain("setAttribute('aria-live', 'polite')");
    expect(toolkit).toContain('textContent = next.objective');
  });

  it('creates labeled semantic controls for every world action', () => {
    expect(controls).toContain("document.createElement('button')");
    expect(controls).toContain("button.setAttribute('aria-label'");
    expect(controls).toContain("button.type = 'button'");
    expect(controls).toContain('atlas-world-control');
  });

  it('renders competition state from server summaries without invented winners or payments', () => {
    expect(competition).toContain('createCompetitionView');
    expect(competition).toContain('estimating');
    expect(competition).toContain('verified-paid');
    expect(competition).toContain('not-verified');
    expect(competition).not.toContain('winner');
    expect(app).toContain('getCompetition');
    expect(app).toContain('createCompetitionView');
  });
});

describe('Atlas city HUD wears the kit', () => {
  const sheet = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');

  it('makes the top bar controls glass capsules', () => {
    const bar = sheet.slice(sheet.indexOf('.atlas-brand, .atlas-integrity, .atlas-pause {'));
    expect(bar.slice(0, bar.indexOf('}'))).toContain('var(--atlas-radius-pill)');
  });

  it('drops the box around the objective so it reads as world text', () => {
    // In every reference game the objective is scrimmed text with a glyph, not
    // a card. The card is what makes it look like a dashboard widget.
    const toolkit = sheet.slice(sheet.indexOf('.atlas-living-city-play-shell .atlas-toolkit {'));
    const block = toolkit.slice(0, toolkit.indexOf('}'));
    expect(block).toContain('background: none');
    expect(block).toContain('var(--atlas-scrim)');
  });

  it('keeps the HUD layout and its breakpoints untouched', () => {
    // Carried from the UI brief: the layout works, it is responsive, and it was
    // expensive. This task restyles it and must not move it.
    expect(sheet).toContain('.atlas-living-city-play-shell { position: relative; width: 100%;');
    expect(sheet).toContain('@media (max-width: 520px)');
    expect(sheet).toContain('@media (max-width: 360px)');
  });
});

describe('Atlas world is always behind the screens', () => {
  const sheet = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');

  it('gives the city stage its ground unconditionally', () => {
    // The ground used to arrive with .is-playing, which only two of the nine
    // screens ever added. Every other screen sat on a bare stage behind an
    // opaque panel, so the world may as well not have been running.
    const stage = sheet.slice(sheet.indexOf('#atlas-city-stage {'), sheet.indexOf('}', sheet.indexOf('#atlas-city-stage {')));
    expect(stage).toContain('background: var(--atlas-city-ground)');
  });

  it('no longer switches the world on per screen', () => {
    expect(sheet).not.toContain('#atlas-city-stage.is-playing');
    expect([...source.matchAll(/classList\.add\('is-playing'\)/g)]).toHaveLength(0);
    expect([...source.matchAll(/classList\.remove\('is-playing'\)/g)]).toHaveLength(0);
  });

  it('keeps the falloff at the edges of the world', () => {
    // The vignette rode on .is-playing. Dropping the class without moving it
    // would have quietly flattened the edges of every frame.
    expect(sheet).toContain('#atlas-city-stage::after');
    expect(sheet).toContain('linear-gradient(90deg, rgb(var(--atlas-shadow-rgb)');
  });

  it('keeps the stage behind the interface and out of the tab order', () => {
    const stage = sheet.slice(sheet.indexOf('#atlas-city-stage {'), sheet.indexOf('}', sheet.indexOf('#atlas-city-stage {')));
    expect(stage).toContain('z-index: 0');
    expect(stage).toContain('pointer-events: none');
    expect(source).toContain("host.setAttribute('aria-hidden', 'true')");
  });
});

describe('Atlas world-facing HUD elements wear the kit', () => {
  const sheet = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');

  function rule(selector: string): string {
    const start = sheet.indexOf(`${selector} {`);
    expect(start, `${selector} is missing`).toBeGreaterThan(-1);
    return sheet.slice(start, sheet.indexOf('}', start));
  }

  it('leaves no hard offset ink shadow on the world-facing HUD', () => {
    // These four sit directly over the city. A 2px hard offset is the poster
    // idiom, and it is the last of it left in the product.
    for (const selector of ['.atlas-camera-center', '.atlas-city-waypoint', '.atlas-mini-map']) {
      expect(rule(selector), `${selector} still has a hard offset shadow`).not.toMatch(/box-shadow:[^;]*\d+px \d+px 0/);
    }
  });

  it('rounds and glazes the waypoint and the centre button', () => {
    for (const selector of ['.atlas-camera-center', '.atlas-city-waypoint']) {
      const block = rule(selector);
      expect(block, `${selector} is not rounded`).toContain('var(--atlas-radius');
      expect(block, `${selector} is not glass`).toContain('backdrop-filter');
    }
  });

  it('keeps the minimap circular', () => {
    expect(rule('.atlas-mini-map')).toContain('border-radius: 50%');
  });

  it('does not move any of them', () => {
    // Position is layout, and layout is frozen by the standing HUD decision.
    expect(rule('.atlas-mini-map')).toContain('top: 112px');
    expect(rule('.atlas-city-waypoint')).toContain('top: 254px');
    expect(rule('.atlas-camera-center')).toContain('bottom: 148px');
    expect(rule('.atlas-camera-look-zone')).toContain('inset: 0 0 0 44%');
  });
});
