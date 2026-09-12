/*
 * The product's own mark.
 *
 * NIM Atlas is a game that teaches Nimiq; it is not a Nimiq product. Leading
 * the HUD with the Nimiq signet implied otherwise, so the crest leads and
 * Nimiq is credited explicitly as "Powered by Nimiq" instead. See
 * `createNimiqPoweredBy` below, and src/atlas/ui/nimiq-mark.ts for the
 * official assets, which are unchanged.
 */
import { createNimiqMark } from './nimiq-mark';

export const ATLAS_CREST_SRC = '/atlas/brand/beacon-crest.svg';

export function createAtlasCrest(options: { decorative?: boolean; className?: string } = {}): HTMLImageElement {
  const image = document.createElement('img');
  image.src = ATLAS_CREST_SRC;
  image.className = options.className ? `atlas-crest ${options.className}` : 'atlas-crest';
  image.decoding = 'async';
  image.loading = 'eager';
  if (options.decorative) {
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
  } else {
    image.alt = 'NIM Atlas';
  }
  return image;
}

/**
 * The attribution line. Nimiq's own mark, labelled, so the relationship is
 * stated rather than implied by placement.
 */
export function createNimiqPoweredBy(): HTMLElement {
  const wrapper = document.createElement('p');
  wrapper.className = 'atlas-powered-by';
  const label = document.createElement('span');
  label.textContent = 'Powered by';
  wrapper.append(label, createNimiqMark('lockup', { decorative: true }));
  wrapper.setAttribute('aria-label', 'Powered by Nimiq');
  return wrapper;
}
