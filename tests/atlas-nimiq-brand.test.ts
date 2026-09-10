import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const signet = readFileSync(new URL('../public/atlas/brand/nimiq-signet.svg', import.meta.url), 'utf8');
const lockup = readFileSync(new URL('../public/atlas/brand/nimiq-logo-horizontal.svg', import.meta.url), 'utf8');
const mark = readFileSync(new URL('../src/atlas/ui/nimiq-mark.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');

/*
 * Nimiq appeared on none of the sixteen shipped screenshots, including the
 * payment review, which is the one screen where a player is being asked to
 * approve a real transfer. These assets are the official files from
 * github.com/nimiq/designs, downloaded rather than redrawn, because an
 * approximated mark shown to the Nimiq team is worse than no mark.
 */
describe('Nimiq brand presence', () => {
  it('ships the official assets rather than a redrawn approximation', () => {
    for (const [name, source] of [['signet', signet], ['lockup', lockup]] as const) {
      expect(source.slice(0, 200), `${name} is not an SVG`).toContain('<svg');
      // The official radial gradient. If these stops change, the file is no
      // longer Nimiq's artwork.
      expect(source.toLowerCase(), `${name} lost the official gradient`).toContain('#ec991c');
      expect(source.toLowerCase(), `${name} lost the official gradient`).toContain('#e9b213');
    }
  });

  it('keeps the two files referenced rather than inlined, because their ids collide', () => {
    /*
     * Both official files declare id="radial-gradient" and a .cls-1 class. Two
     * inlined copies in one document would share those, so the second one's
     * gradient would resolve to the first one's definition. Referencing them
     * through <img> keeps each in its own document.
     */
    expect(signet).toContain('id="radial-gradient"');
    expect(lockup).toContain('id="radial-gradient"');
    expect(mark, 'the mark helper inlines SVG markup').not.toContain('<svg');
    expect(app, 'the app inlines Nimiq SVG markup').not.toContain('radial-gradient');
  });

  it('defines the asset paths in exactly one place', () => {
    expect(mark).toContain('/atlas/brand/nimiq-signet.svg');
    expect(mark).toContain('/atlas/brand/nimiq-logo-horizontal.svg');
    // Everything else asks the helper, so the paths cannot drift apart.
    expect(app, 'the app hardcodes a brand asset path').not.toContain('/atlas/brand/');
  });

  it('never recolours or dims the mark', () => {
    // Nimiq's guidelines govern this artwork, and the product's own rule is
    // that magenta is the only accent. The resolution is to leave the mark in
    // its official colours and not treat it as a UI accent at all.
    const rule = sheet.slice(sheet.indexOf('.atlas-nimiq-mark'), sheet.indexOf('}', sheet.indexOf('.atlas-nimiq-mark')));
    expect(rule.length, '.atlas-nimiq-mark has no rule').toBeGreaterThan(0);
    expect(rule, 'the mark is filtered').not.toContain('filter:');
    expect(rule, 'the mark is tinted').not.toContain('background-color:');
    expect(rule).not.toMatch(/opacity:\s*0?\.[0-8]/);
  });

  it('carries an accessible name that says Nimiq', () => {
    expect(mark).toContain('alt');
    expect(mark).toContain('Nimiq');
  });

  it('places the mark on the four surfaces the design requires', () => {
    // Persistent HUD mark, on both play screens through the shared brand
    // button; the loading splash; the title screen; and the payment review.
    expect(app, 'no mark in the HUD brand').toMatch(/private createCityBrand[\s\S]{0,900}?createNimiqMark/);
    expect(app, 'no mark on the loading splash').toMatch(/private renderLandingSplash[\s\S]{0,1200}?createNimiqMark/);
    expect(app, 'no mark on the title screen').toMatch(/private renderWelcome[\s\S]{0,2000}?createNimiqMark/);
    expect(app, 'no mark on the payment review').toMatch(/private createCityPaymentReview[\s\S]{0,2000}?createNimiqMark/);
  });

  it('marks the standalone lantern payment screen too', () => {
    /*
     * There are two payment surfaces, not one. createCityPaymentReview is the
     * panel over the 3D city; renderLantern is the full screen the shipped
     * screenshots actually show. Both list NETWORK, RECIPIENT and AMOUNT, and
     * wiring only the first left the captured payment screen unbranded.
     */
    const lantern = app.slice(app.indexOf('private renderLantern'));
    const body = lantern.slice(0, lantern.indexOf('private renderCurrentLanternSurface'));
    expect(body, 'the lantern screen has no Nimiq lockup').toContain("createNimiqMark('lockup')");
    expect(body, 'the lantern network row has no mark').toContain('networkValueCell');
  });
});
