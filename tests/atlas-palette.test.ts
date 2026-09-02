import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATLAS_CITIZEN_WARDROBE, ATLAS_UI_TOKENS, ATLAS_WORLD_PALETTE, worldColourCss } from '../src/atlas/palette';
import { ATLAS_PALETTE } from '../src/atlas/render/three/palette';

describe('Atlas world palette', () => {
  it('holds every colour as a 24-bit integer', () => {
    for (const [name, value] of Object.entries(ATLAS_WORLD_PALETTE)) {
      expect(Number.isInteger(value), `${name} is not an integer`).toBe(true);
      expect(value, `${name} is out of range`).toBeGreaterThanOrEqual(0);
      expect(value, `${name} is out of range`).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('renders a css string that round-trips to the same integer', () => {
    for (const name of Object.keys(ATLAS_WORLD_PALETTE) as Array<keyof typeof ATLAS_WORLD_PALETTE>) {
      const css = worldColourCss(name);
      expect(css, `${name} is not #rrggbb`).toMatch(/^#[0-9a-f]{6}$/);
      expect(Number.parseInt(css.slice(1), 16)).toBe(ATLAS_WORLD_PALETTE[name]);
    }
  });

  it('agrees with the character spec on every GLB material name and value', () => {
    // The art spec is the authority: build_character.py writes these names and
    // baseColorFactors into every character GLB, and prepareRuntimeMaterials
    // matches materials by name. This guard exists because the two had already
    // drifted once, invisibly — the old map called workwear "charcoal", a name
    // no GLB material could match, and carried stale skin values.
    const spec = JSON.parse(
      readFileSync(new URL('../art/atlas/characters/atlas-walker-v1/character-spec.json', import.meta.url), 'utf8'),
    ) as { palette: Record<string, string> };
    for (const [name, hex] of Object.entries(spec.palette)) {
      expect(ATLAS_WORLD_PALETTE, `missing material key ${name}`).toHaveProperty(name);
      expect(worldColourCss(name as keyof typeof ATLAS_WORLD_PALETTE), `${name} drifted from the art spec`).toBe(hex.toLowerCase());
    }
  });

  it('dresses the crowd only in real material names', () => {
    const spec = JSON.parse(
      readFileSync(new URL('../art/atlas/characters/atlas-walker-v1/character-spec.json', import.meta.url), 'utf8'),
    ) as { palette: Record<string, string> };
    expect(ATLAS_CITIZEN_WARDROBE.length).toBe(4);
    for (const variant of ATLAS_CITIZEN_WARDROBE) {
      for (const [name, hex] of Object.entries(variant)) {
        // A wardrobe key that is not a material name is silently ignored at
        // runtime, so the NPC quietly keeps its default colour instead.
        expect(spec.palette, `wardrobe key ${name} is not a material name`).toHaveProperty(name);
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('leaves three/palette.ts as a re-export with no literals of its own', () => {
    const source = readFileSync(new URL('../src/atlas/render/three/palette.ts', import.meta.url), 'utf8');
    expect([...source.matchAll(/0x[0-9a-fA-F]{6}/g)]).toHaveLength(0);
    expect(ATLAS_PALETTE).toBe(ATLAS_WORLD_PALETTE);
  });
});

describe('Atlas renderers carry no colour of their own', () => {
  const sources = [
    'render/three/three-renderer.ts',
    'render/pixi-renderer.ts',
    'render/renderer.ts',
  ];

  it('defines no colour literal outside the palette module', () => {
    for (const relative of sources) {
      const source = readFileSync(new URL(`../src/atlas/${relative}`, import.meta.url), 'utf8');
      const strays = [
        ...[...source.matchAll(/0x[0-9a-fA-F]{6}\b/g)].map((match) => match[0]),
        ...[...source.matchAll(/'#[0-9a-fA-F]{3,8}'/g)].map((match) => match[0]),
      ];
      expect(strays, `${relative} holds colour literals: ${[...new Set(strays)].join(', ')}`).toHaveLength(0);
    }
  });

  it('imports the palette in every renderer', () => {
    for (const relative of sources) {
      const source = readFileSync(new URL(`../src/atlas/${relative}`, import.meta.url), 'utf8');
      expect(source, `${relative} does not import the palette`).toMatch(/from '\.\.?\/(\.\.\/)?palette'/);
    }
  });
});

describe('Atlas UI tokens mirror the stylesheet', () => {
  const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);

  function declaredInCss(): Map<string, string> {
    const declared = new Map<string, string>();
    for (const match of rootBlock.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
      declared.set(match[1]!, match[2]!.trim());
    }
    return declared;
  }

  it('declares every UI token in :root with the same value', () => {
    // CSS cannot import TypeScript, so the two are mirrored rather than
    // generated. This guard is what makes the mirror trustworthy: without it
    // the palette drifts silently, exactly as the world palette already did
    // against the art spec.
    const declared = declaredInCss();
    for (const [name, value] of Object.entries(ATLAS_UI_TOKENS)) {
      expect(declared.has(name), `--${name} is missing from :root`).toBe(true);
      expect(declared.get(name), `--${name} disagrees with the palette module`).toBe(value);
    }
  });

  it('leaves no colour token in :root unaccounted for', () => {
    const colourish = /^(#|rgb|hsl|\d+ \d+ \d+$)/;
    for (const [name, value] of declaredInCss()) {
      if (!colourish.test(value)) continue;
      expect(ATLAS_UI_TOKENS, `--${name} is a colour with no entry in ATLAS_UI_TOKENS`).toHaveProperty(name);
    }
  });
});

describe('Atlas candy palette', () => {
  it('marks the single next action in magenta', () => {
    expect(ATLAS_UI_TOKENS['atlas-signal']).toBe('#ff477e');
    expect(ATLAS_UI_TOKENS['atlas-signal-deep']).toBe('#d81e5b');
  });

  it('demotes orange from the accent to the warning role', () => {
    // Orange was the accent. It is now what a refusal or a locked gate wears,
    // so no screen shows two colours competing to be the next action.
    expect(ATLAS_UI_TOKENS['atlas-warn']).toBe('#ff9f1c');
    expect(Object.values(ATLAS_UI_TOKENS)).not.toContain('#f28b30');
  });

  it('turns the page into glass over a world rather than paper', () => {
    expect(ATLAS_UI_TOKENS['atlas-paper']).toMatch(/^rgba\(/);
    expect(ATLAS_UI_TOKENS['atlas-ink']).toBe('#f7f9ff');
  });

  it('recolours the world accent to match the UI accent', () => {
    // Two accents is what the one-accent rule exists to prevent, and the world
    // is on screen at the same time as the UI.
    expect(ATLAS_WORLD_PALETTE.restorationEmitter).toBe(0xff477e);
  });

  it('keeps the theme colour agreeing with the page ground', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8')) as { theme_color: string };
    expect(html).toContain('content="#101430"');
    expect(manifest.theme_color).toBe('#101430');
  });
});
