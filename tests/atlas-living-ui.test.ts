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
