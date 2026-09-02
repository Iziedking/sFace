export interface AtlasWorldAction {
  label: string;
  ariaLabel: string;
  onActivate: () => void;
  disabled?: boolean;
}

export function createSemanticWorldControl(action: AtlasWorldAction): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'atlas-primary atlas-world-control';
  button.textContent = action.label;
  button.setAttribute('aria-label', action.ariaLabel);
  button.disabled = action.disabled ?? false;
  button.addEventListener('click', action.onActivate);
  return button;
}

export function createSemanticWorldControls(actions: readonly AtlasWorldAction[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'atlas-world-controls';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'World actions');
  for (const action of actions) group.append(createSemanticWorldControl(action));
  return group;
}
