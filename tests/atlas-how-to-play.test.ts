import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/atlas/ui/how-to-play.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const guideDoc = readFileSync(new URL('../docs/nim-atlas-how-to-play.md', import.meta.url), 'utf8');
const shoot = readFileSync(new URL('../scripts/shoot-atlas.mjs', import.meta.url), 'utf8');

describe('NIM Atlas clarity pass', () => {
  it('keeps the first-use explanation to four playable moves', () => {
    expect(guide).toContain('ATLAS_HOW_TO_PLAY_STEPS');
    expect((guide.match(/number: '/g) ?? []).length).toBe(4);
    expect(guide.length).toBeLessThan(4_500);
    expect(app).toContain('openHowToPlay');
    expect(app).toContain("actionButton('How to play'");
  });

  it('keeps the landing screen focused on the first human need', () => {
    expect(app).toContain('Sface is a Nimiq Pay Mini App game. NIM Atlas is the network you repair by playing.');
    expect(app).toContain('Mara needs one safe NIM payment route. Restore it, carry the lantern, relight the harbor.');
    expect(app).toContain('Explorer: inspect, approve, confirm.');
    expect(app).toContain('Builder: repair, predict, verify.');
  });

  it('connects each move to a concrete Nimiq Pay idea', () => {
    expect(guide).toContain('NIM');
    expect(guide).toContain('Nimiq Pay');
    expect(guide).toContain('Lunas');
    expect(guide).toContain('canonical confirmation');
    expect(guide).toContain('Ask');
    expect(guide).toContain('Check');
    expect(guide).toContain('Approve');
    expect(guide).toContain('Confirm');
    expect(guide).toContain('Unlock');
  });

  it('makes the visual proof gallery part of the product documentation', () => {
    expect(app).toContain('atlas-snapshot-grid');
    expect(guide).toContain('/atlas/screenshots/atlas-390-pay-harbor.png');
    expect(guide).toContain('/atlas/screenshots/atlas-430-payment-review.png');
    expect(css).toContain('.atlas-how-to-play');
    expect(css).toContain('.atlas-snapshot-grid');
    expect(css).toContain('min-height: 44px');
    expect(readme).toContain('How to play NIM Atlas');
    expect(readme).toContain('atlas-390-pay-harbor.png');
    expect(guideDoc).toContain('# NIM Atlas: how to play');
    expect(guideDoc).toContain('Choose → Walk → Learn → Change');
    expect(guideDoc).toContain('atlas-430-payment-review.png');
  });

  it('keeps captured product snapshots available to the built app', () => {
    expect(shoot).toContain("'public', 'atlas', 'screenshots'");
  });
});
