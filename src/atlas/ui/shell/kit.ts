export interface PillButtonOptions {
  readonly label: string;
  readonly onActivate: () => void;
  readonly ariaLabel?: string;
  readonly variant?: 'signal' | 'ghost';
}

export interface RoundIconButtonOptions {
  readonly glyph: string;
  readonly ariaLabel: string;
  readonly onActivate: () => void;
  readonly size?: 'large' | 'small';
}

export function glassPanel(className = ''): HTMLElement {
  const panel = document.createElement('section');
  panel.className = className ? `atlas-glass ${className}` : 'atlas-glass';
  return panel;
}

export function pillButton(options: PillButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.variant === 'ghost' ? 'atlas-pill atlas-pill-ghost' : 'atlas-pill';
  button.textContent = options.label;
  button.setAttribute('aria-label', options.ariaLabel ?? options.label);
  button.addEventListener('click', options.onActivate);
  return button;
}

/*
 * A glyph-only control, so it carries its name for a screen reader rather than
 * leaving one behind. ariaLabel is required for exactly that reason: an icon is
 * not a label, and a button whose whole content is one has no accessible name.
 */
export function roundIconButton(options: RoundIconButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.size === 'small' ? 'atlas-round atlas-round-small' : 'atlas-round';
  button.textContent = options.glyph;
  button.setAttribute('aria-label', options.ariaLabel);
  button.addEventListener('click', options.onActivate);
  return button;
}
