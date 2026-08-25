import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = ['today.ts', 'run.ts', 'result.ts', 'season.ts', 'rules.ts', 'error.ts'].map((name) => readFileSync(new URL(`../src/relay/screens/${name}`, import.meta.url), 'utf8'));
const css = readFileSync(new URL('../src/relay/relay.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/relay/main.ts', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('Relay accessibility and offline contracts', () => {
  it('uses one semantic h1 and button controls on every screen', () => {
    for (const source of files) {
      expect(source).toContain("createElement('h1')");
      expect(source).toContain("createElement('button')");
      expect(source).toContain(".type = 'button'");
    }
  });

  it('labels the HUD, exposes live countdown status, and never makes the canvas the start gate', () => {
    const run = files[1]!;
    expect(run).toContain("aria-label', 'Relay run status'");
    expect(run).toContain("aria-live', 'assertive'");
    expect(index).toContain('<div id="ui"></div>');
    expect(main).toContain("this.ui.append(renderRelayToday");
    expect(main).not.toContain("canvas.addEventListener('click'");
  });

  it('keeps visible focus, reduced motion, and 44px touch targets', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('min-height: 44px');
  });

  it('registers an offline shell without making competitive actions offline-authoritative', () => {
    expect(main).toContain('serviceWorker');
    expect(main).toContain('practice');
    expect(main).toContain('requestRelayAttempt');
  });
});
