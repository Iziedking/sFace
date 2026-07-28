/**
 * The look, in one place.
 *
 * The accent is amber, and it is spent on one idea: amber is rescue. The
 * chart line, the extraction beacon, the freed faces, and the primary button
 * are amber, and nothing else is. Red is reserved for things trying to kill
 * you and for failure states, so red on screen always means the same thing.
 * Everything else is neutral on near-black.
 *
 * Deliberately not here: no blue-to-purple gradient, no glass panels, no
 * particles that exist for their own sake. Those read as filler.
 *
 * These values are mirrored as CSS variables in src/style.css for the DOM
 * screens. If you change one, change both.
 */

export const theme = {
  /** Page and canvas background. */
  void: '#08090d',
  /** Panels and the terminal grid. */
  surface: '#12141c',
  grid: 'rgba(255, 255, 255, 0.045)',
  gridStrong: 'rgba(255, 255, 255, 0.09)',

  /** Amber means rescue. */
  accent: '#ffa22b',
  accentSoft: 'rgba(255, 162, 43, 0.16)',
  accentDim: 'rgba(255, 162, 43, 0.45)',

  /** Red means danger, damage, and failure. Nothing else. */
  danger: '#ff4a3d',
  dangerSoft: 'rgba(255, 74, 61, 0.18)',

  /** The people you are there to get out. */
  face: '#ffe0b2',

  ink: '#f4f5f7',
  inkMuted: '#8b90a0',
  inkFaint: '#565b6b',
} as const;

/**
 * Monospace for anything verifiable: tickers, addresses, hashes, scores, the
 * clock. Mono is the signal that says this number came from somewhere real.
 */
export const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/**
 * Respect the OS setting. Effects check this and cut particles, shake, and
 * flashes rather than just slowing them down. Read live rather than cached,
 * because the setting can change while the app is open.
 */
export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
