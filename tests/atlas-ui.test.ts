import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('NIM Atlas public first district UI', () => {
  it('makes Atlas the public entry without deleting internal Relay source', () => {
    expect(index).toContain('/src/atlas/main.ts');
    expect(index).toContain('/src/atlas/atlas.css');
    expect(index).not.toContain('/src/relay/main.ts');
    expect(index).toContain('Explore the network. Build what survives.');
  });

  it('ships semantic controls and required portrait accessibility policies', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
    expect(main).toContain("document.createElement('button')");
    expect(main).toContain("setAttribute('aria-label'");
    expect(main).toContain("setAttribute('aria-live'");
    expect(main).not.toMatch(/shooter|fire weapon|kill/i);
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (max-width: 320px)');
    expect(css).toContain('@media (min-width: 390px)');
    expect(css).toContain('@media (min-width: 430px)');
    expect(css).toContain('scrollbar-width: thin');
    expect(css).toContain('scrollbar-color: var(--atlas-orange) var(--atlas-paper)');
    expect(css).toContain('.atlas-panel::-webkit-scrollbar');
    expect(css).toContain('width: 7px');
  });

  it('makes the SFACE and NIM Atlas relationship explicit and keeps Pay central', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    const manifest = readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8');
    expect(main).toContain('Sface is a Nimiq Pay Mini App game where you explore NIM Atlas, learn the payment network, and build what survives.');
    expect(manifest).toContain('Sface is a Nimiq Pay Mini App game where you explore NIM Atlas');
    expect(main).toContain('Play the full learning path without a wallet.');
    expect(main).toContain('Nimiq Pay is the live payment gate');
  });

  it('keeps the mission loop visible so a first-time player knows what they are doing', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    const prologue = readFileSync(new URL('../shared/atlas/prologue.ts', import.meta.url), 'utf8');
    expect(main).toContain('Meet Mara');
    expect(prologue).toContain("id: 'explorer'");
    expect(prologue).toContain("id: 'builder'");
    expect(main).toContain('Pay Harbor');
    expect(main).toContain('PRACTICE MODE / PLAYABLE WITHOUT A WALLET');
    expect(main).toContain('NIMIQ PAY IS THE LIVE PAYMENT GATE');
    expect(main).toContain('Review payment request');
    expect(main).toContain('Simulate verified confirmation');
    expect(main).toContain('YOU ARE HERE');
    expect(main).toContain('Builder Trial 1 of 6');
  });

  it('ships a mirrored Builder repair board with predictions and an explicit local-only wallet boundary', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('BUILDER REPAIR / PAYMENT PATH');
    expect(main).toContain('Predict each observation before running the repair');
    expect(main).toContain('Provider ready');
    expect(main).toContain('SIMULATED LOOKUP / NO PAYMENT');
    expect(main).toContain('No arbitrary code runs here');
  });

  it('ships a Living Knowledge Book and a closed-book teach-back boundary', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    const knowledge = readFileSync(new URL('../shared/atlas/knowledge.ts', import.meta.url), 'utf8');
    expect(main).toContain('LIVING KNOWLEDGE BOOK');
    expect(main).toContain('ASK / CHECK / APPROVE / CONFIRM / UNLOCK');
    expect(main).toContain('BOOK CLOSED / TEACH-BACK');
    expect(main).toContain('FREE CORE / NO PRIZE ADVANTAGE');
    expect(knowledge).toContain("availability: 'free-core'");
  });

  it('exposes a daily applied puzzle without fabricating reward or leaderboard outcomes', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('DAILY ATLAS PUZZLE');
    expect(main).toContain('LEARN / SOLVE / VERIFY');
    expect(main).toContain('Reward share appears only after server verification');
    expect(main).toContain('EXPLORER LEADERBOARD');
    expect(main).toContain('BUILDER LEADERBOARD');
    expect(main).toContain('No verified scores yet');
  });

  it('exposes the evergreen district atlas with Explorer and Builder mirrors', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    const evergreen = readFileSync(new URL('../shared/atlas/adventures/evergreen.ts', import.meta.url), 'utf8');
    expect(main).toContain('DISTRICT ATLAS');
    expect(main).toContain('Walk the District Atlas');
    expect(evergreen).toContain('The Canopy That Waits');
    expect(main).toContain('TRANSFER / TEACH-BACK');
  });

  it('shows the Network Beacon with an honest unavailable state before server data exists', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('NETWORK BEACON');
    expect(main).toContain('No verified community progress yet');
    expect(main).toContain('UNAVAILABLE / SERVER PROJECTION');
  });

  it('shows the optional shop as locked until an owner enables a verified mainnet catalog', () => {
    const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('MAINNET EXPANSIONS');
    expect(main).toContain('OWNER APPROVAL REQUIRED');
    expect(main).toContain('Purchases stay disabled');
  });
});
