import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guide = readFileSync(new URL('../src/atlas/ui/how-to-play.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/atlas/render/renderer.ts', import.meta.url), 'utf8');

describe('NIM Atlas presentation integrity', () => {
  it('references only shipped guide images', () => {
    const imagePaths = [...guide.matchAll(/src: '([^']+)'/g)].map((match) => match[1]!);
    expect(imagePaths).toHaveLength(3);
    for (const imagePath of imagePaths) {
      expect(imagePath).not.toContain('/docs/');
      expect(existsSync(new URL(`../public${imagePath}`, import.meta.url))).toBe(true);
    }
  });

  it('keeps the role choice and its explanation in a non-overlapping mobile layout', () => {
    expect(css).toContain('.atlas-role-buttons { display: grid;');
    expect(css).toContain('.atlas-role-description { display: block;');
    expect(css).toContain('grid-column: 1 / -1;');
    expect(css).toContain('.atlas-role { min-height: 72px;');
  });

  it('uses authored human adventure language instead of placeholder fault art', () => {
    expect(renderer).toContain('drawMatureHuman');
    expect(renderer).toContain('drawHarborLanternShop');
    // The colour word moved with the accent: the route the player is told to
    // follow is magenta now, and copy naming a colour the product no longer
    // uses is a wrong instruction, not a stale string. What this line guards is
    // that the wayfinding speaks to a person at all.
    expect(renderer).toContain('FOLLOW THE PINK WAY');
    expect(renderer).not.toContain("context.fillText('FAULT'");
    expect(renderer).not.toContain('drawHarborPerson');
    expect(app).not.toMatch(/â|Ã/);
  });
});
