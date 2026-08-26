import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/atlas/main.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/atlas/render/renderer.ts', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('NIM Atlas release-quality UI contract', () => {
  it('keeps the first decision and primary adventure above secondary systems', () => {
    const welcome = main.slice(main.indexOf('private renderWelcome'), main.indexOf('private renderBeaconStatus'));
    expect(welcome).toContain('atlas-home-grid');
    expect(welcome).toContain('atlas-quick-grid');
    expect(welcome.indexOf("actionButton('Meet Mara'")).toBeLessThan(welcome.indexOf("actionButton('Open Living Knowledge Book'"));
    expect(welcome).not.toContain('this.renderLeaderboards()');
    expect(welcome).not.toContain('this.renderShopCatalog()');
    expect(css).toContain('.atlas-home-grid');
    expect(css).toContain('.atlas-quick-grid');
  });

  it('uses semantic role selection and gives every non-game screen a route home', () => {
    expect(main).toContain("setAttribute('aria-pressed'");
    expect(main).toContain('atlas-screen-nav');
    expect(main).toContain("actionButton('Atlas home'");
    expect(css).toContain('.atlas-screen-nav');
  });

  it('serves the actual daily rotation and does not hardcode day-one answers', () => {
    expect(main).toContain('selectDailyChallenge(new Date())');
    expect(main).toContain('dailyChallengeChoices(challenge)');
    expect(main).not.toContain('ATLAS_DAILY_CHALLENGES[0]');
    expect(main).not.toContain("['120000', '1200000', '12000000']");
  });

  it('makes district teach-back a real choice and routes Builders through their repair', () => {
    expect(main).toContain('evergreenTeachBackChoices(adventure');
    expect(main).toContain('Open provider workshop');
    expect(main).toContain('finishBuilderRepairIntoHarbor');
    expect(main).toContain('knowledgeTeachBackPrompt(stepId)');
    expect(main).not.toContain('Which principle comes next: ${stepId.toUpperCase()}?');
  });

  it('renders the harbor consequence visually instead of claiming a text-only transformation', () => {
    expect(renderer).toContain('drawHarbor');
    expect(renderer).toContain("phase === 'tower-lit'");
    expect(main).toContain('this.renderer.drawHarbor');
  });

  it('introduces the shipped NIM Atlas product before archived Cycle I history', () => {
    const firstSection = readme.slice(0, readme.indexOf('## Historical'));
    expect(firstSection).toContain('Sface is a Nimiq Pay Mini App game');
    expect(firstSection).not.toContain("Crypto's down. Somebody has to save face.");
  });
});
