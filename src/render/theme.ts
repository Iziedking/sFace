/**
 * The look, in one place.
 *
 * Bone cream paper, near-black ink, one signal orange. The whole product is a
 * printed poster that happens to move.
 *
 * Three rules, and they are what make it read as solid rather than classy:
 *
 * 1. **Colour is flat.** No gradients standing in for depth, no translucent
 *    panels, no glass. A thing is either orange or it is not. Where depth is
 *    needed it comes from a hard offset shadow, the way ink sits on paper.
 * 2. **Orange means one thing: the chart and the action.** The price line, the
 *    primary button, the extraction beacon. Crimson means one thing: something
 *    is trying to kill you, or something failed. Nothing else is coloured.
 * 3. **Ink is the default.** Type, outlines, and every character silhouette
 *    are ink. That is what holds a bright canvas together, and it is why the
 *    characters are outlined rather than shaded.
 *
 * Mirrored as CSS variables in src/style.css. Change one, change both.
 */

export const theme = {
  /** Page and canvas. Warm paper, never white. */
  canvas: '#f4ede0',
  /** One step down, for cards and the sky band behind the chart. */
  paper: '#eae0cd',
  /** Two steps down, for the ground mass under the price line. */
  paperDeep: '#ded2ba',

  /** Type, outlines, and every silhouette. */
  ink: '#14110e',
  inkMuted: '#8c8378',
  inkFaint: '#b3a893',

  /** The chart, the action, the rescue. Nothing else. */
  accent: '#ff5a1f',
  accentDeep: '#d63f0a',
  /** Only for large flat fills behind ink, never for type. */
  accentPale: '#ffd9c4',

  /** Attackers, damage, and failure. Nothing else. */
  danger: '#d3212c',
  dangerPale: '#f7ccd0',

  /** Rescue targets. Warm and distinct from the orange. */
  rescue: '#2f7d63',
  rescuePale: '#c8e3d8',

  /** Hard offset shadow. Ink at low alpha, never a blur. */
  shade: 'rgba(20, 17, 14, 0.16)',
  hairline: 'rgba(20, 17, 14, 0.14)',
} as const;

/**
 * Monospace for anything verifiable: tickers, handles, addresses, scores, the
 * clock. Mono is the signal that says this number came from somewhere real.
 */
export const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/**
 * Display face for headlines. A heavy grotesque, falling back through what
 * ships on a phone. No Inter, and nothing that reads as a default.
 */
export const DISPLAY =
  '"Archivo Black", "Helvetica Neue", Impact, "Arial Black", system-ui, sans-serif';

/**
 * Respect the OS setting. Effects check this and cut particles, shake and
 * flashes rather than slowing them down. Read live rather than cached, since
 * the setting can change while the app is open.
 */
export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Deterministic pick from a palette, keyed by a string.
 *
 * Used to give a handle a stable look: the same person always gets the same
 * jacket, the same hair, the same skin tone, on every device, without storing
 * anything about them. Not cryptographic and does not need to be.
 */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickFrom<T>(list: readonly T[], seed: string, salt = 0): T {
  const index = (hashString(value(seed, salt))) % list.length;
  return list[index] as T;
}

function value(seed: string, salt: number): string {
  return salt === 0 ? seed : `${seed}#${salt}`;
}
