import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../scripts/verify-atlas-contrast.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('Atlas contrast verifier', () => {
  it('is wired into the package scripts', () => {
    expect(packageJson.scripts['verify:atlas:contrast']).toBe('node scripts/verify-atlas-contrast.mjs');
  });

  it('holds the WCAG AA floors', () => {
    // The floors are the whole point. Loosening one silently would turn this
    // check into the kind of guard that cannot fail, which is the failure mode
    // it was written to replace.
    expect(script).toContain('const floor = large ? 3 : 4.5;');
    expect(script).toContain('size >= 24 || (size >= 18.66 && weight >= 700)');
  });

  it('audits every screen a player can reach', () => {
    for (const screen of [
      'welcome', 'how-to-play', 'daily-puzzle', 'knowledge-book',
      'district-atlas', 'beacon-commons', 'lantern',
    ]) {
      expect(script, `${screen} is not audited`).toContain(`'${screen}'`);
    }
  });

  it('measures the worst case rather than the declared colour', () => {
    // A dark translucent panel is at its least readable over the brightest
    // thing the city can put behind it, which is the sky.
    expect(script).toContain('const SKY = [76, 201, 240]');
    expect(script).toContain('const backdrop =');
  });

  it('fails the run rather than only reporting', () => {
    expect(script).toContain('process.exitCode = 1');
  });

  it('starts each screen from a fresh load', () => {
    // Otherwise a screen could inherit a passing state from the previous one.
    expect(script).toMatch(/for \(const screen of SCREENS\)[\s\S]{0,320}Page\.navigate/);
  });
});
