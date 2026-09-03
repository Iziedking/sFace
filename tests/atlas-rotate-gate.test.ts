import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { screenNeedsLandscape, shouldGateForLandscape } from '../src/atlas/ui/shell/rotate-gate';

const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../src/atlas/ui/shell/rotate-gate.ts', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/atlas/ui/shell/kit.css', import.meta.url), 'utf8');

describe('Landscape gate', () => {
  it('gates the city, where the thumbs crowd the play area', () => {
    expect(screenNeedsLandscape('beacon-commons')).toBe(true);
    expect(screenNeedsLandscape('pay-harbor')).toBe(true);
  });

  it('leaves every reading surface alone', () => {
    /*
     * This is a wallet Mini App: menus, the guide and the payment sheets are
     * read one-handed and upright. Gating them would be friction the reference
     * games never pay, because they are standalone installs.
     */
    for (const screen of ['welcome', 'how-to-play', 'lantern', 'book', 'daily', 'evergreen']) {
      expect(screenNeedsLandscape(screen), `${screen} should not be gated`).toBe(false);
    }
  });

  it('only gates while the phone is upright', () => {
    expect(shouldGateForLandscape('beacon-commons', true)).toBe(true);
    expect(shouldGateForLandscape('beacon-commons', false)).toBe(false);
    expect(shouldGateForLandscape('welcome', true)).toBe(false);
  });

  it('refuses rather than locking, because locking is unavailable', () => {
    // iOS Safari does not implement screen.orientation.lock, and Android Chrome
    // honours it only in fullscreen, which a Mini App is not.
    // Matches a call, not the words: both files explain in prose why the lock
    // is not used, and prose is not an implementation.
    expect(app).not.toMatch(/orientation\s*\.\s*lock\s*\(/);
    expect(gate).not.toMatch(/orientation\s*\.\s*lock\s*\(/);
    expect(gate).toContain("addEventListener?.('orientationchange'");
  });

  it('checks before building the screen it would throw away', () => {
    for (const method of ['private renderBeaconCommons(): void {', 'private renderPayHarbor(): void {']) {
      const start = app.indexOf(method);
      expect(app.slice(start, start + 220)).toContain('if (this.gateForLandscape()) return;');
    }
  });

  it('stops listening once the screen no longer cares', () => {
    expect(app).toContain('this.stopWatchingOrientation?.()');
    expect(gate).toMatch(/return \(\) => \{[\s\S]*?removeEventListener/);
  });

  it('shows the destination rather than animating under reduced motion', () => {
    expect(sheet).toContain('.atlas-rotate-stage.is-still .atlas-rotate-phone');
    expect(gate).toContain("options.reducedMotion === true ? 'atlas-rotate-stage is-still'");
  });
});
