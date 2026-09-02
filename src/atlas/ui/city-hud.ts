export interface AtlasCityHud {
  readonly root: HTMLElement;
  setObjective(text: string): void;
  setAction(label: string | null): void;
  destroy(): void;
}

export function createAtlasCityHud(host: HTMLElement): AtlasCityHud {
  const root = document.createElement('section');
  root.className = 'atlas-city-hud';
  root.setAttribute('aria-label', 'City mission controls');
  const objective = document.createElement('p');
  objective.className = 'atlas-city-objective';
  objective.setAttribute('aria-live', 'polite');
  const action = document.createElement('button');
  action.className = 'atlas-city-action';
  action.type = 'button';
  action.hidden = true;
  root.append(objective, action);
  host.append(root);
  return {
    root,
    setObjective(text: string): void { objective.textContent = text; },
    setAction(label: string | null): void {
      action.hidden = label === null;
      action.textContent = label ?? '';
    },
    destroy(): void { root.remove(); },
  };
}
