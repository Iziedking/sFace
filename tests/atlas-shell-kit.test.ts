import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const kit = readFileSync(new URL('../src/atlas/ui/shell/kit.ts', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/atlas/ui/shell/kit.css', import.meta.url), 'utf8');

describe('Atlas shell kit', () => {
  it('exports the three primitives', () => {
    for (const factory of ['export function glassPanel', 'export function pillButton', 'export function roundIconButton']) {
      expect(kit, `missing ${factory}`).toContain(factory);
    }
  });

  it('carries no colour of its own', () => {
    for (const source of [kit, sheet]) {
      expect([...source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]).toHaveLength(0);
      expect([...source.matchAll(/rgba?\(\s*\d+[\s,]/g)]).toHaveLength(0);
    }
  });

  it('meets the tap target floor on every control', () => {
    // 44px is the accessibility floor the brief set and the device floor is a
    // phone, so a control below it is a control nobody can hit.
    const targets = [...sheet.matchAll(/min-(?:height|width):\s*(\d+)px/g)].map((match) => Number(match[1]));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target).toBeGreaterThanOrEqual(44);
  });

  it('keeps the press displacement that survived from legacy sface', () => {
    expect(sheet).toContain(':active');
    expect(sheet).toMatch(/translate\(/);
  });

  it('falls back to a solid surface where backdrop-filter is unavailable', () => {
    // A glass panel with no blur support is a translucent panel over a moving
    // world, which is unreadable rather than merely plainer.
    expect(sheet).toContain('@supports not (backdrop-filter: blur(1px))');
  });

  it('gives every control a visible focus ring in the selection token', () => {
    expect(sheet).toContain(':focus-visible');
    expect(sheet).toContain('var(--atlas-selected)');
  });

  it('stops its motion under reduced motion', () => {
    expect(sheet).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('requires a name on a glyph-only control', () => {
    // A round button whose whole label is an icon leaves no accessible name
    // behind unless one is supplied, so the type makes it mandatory.
    expect(kit).toMatch(/RoundIconButtonOptions[\s\S]*?readonly ariaLabel: string;/);
    expect(kit).toContain("button.setAttribute('aria-label', options.ariaLabel)");
  });
});
