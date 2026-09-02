import { atlasBeatRows, type AtlasMissionBeat } from '../../../shared/atlas/mission-director';
import { createSemanticWorldControl } from './semantic-world-controls';

export type AtlasToolkitDepth = 'glance' | 'tool' | 'reference' | 'competition';

export interface AtlasToolkitObjective {
  depth: AtlasToolkitDepth;
  objective: string;
  detail: string;
  status?: string;
  action?: {
    label: string;
    ariaLabel: string;
    onActivate: () => void;
  };
}

export interface AtlasToolkit {
  element: HTMLElement;
  update(next: AtlasToolkitObjective): void;
  setDetail(detail: string): void;
  setStatus(status: string): void;
  setDepth(depth: AtlasToolkitDepth): void;
  destroy(): void;
}

const DEPTH_LABELS: Record<AtlasToolkitDepth, string> = {
  glance: 'Current route',
  tool: 'Tools on this route',
  reference: 'Knowledge reference',
  competition: 'Competitive proof',
};

export function createAtlasToolkit(initial: AtlasToolkitObjective): AtlasToolkit {
  const root = document.createElement('section');
  root.className = `atlas-toolkit atlas-toolkit-${initial.depth} atlas-objective`;
  root.setAttribute('aria-label', 'Atlas Toolkit');

  const depth = document.createElement('p');
  depth.className = 'atlas-loop atlas-toolkit-depth';
  depth.textContent = DEPTH_LABELS[initial.depth];

  const objective = document.createElement('div');
  objective.className = 'atlas-toolkit-objective';
  objective.dataset.atlasCurrentObjective = 'true';
  objective.setAttribute('aria-live', 'polite');
  const heading = document.createElement('strong');
  const detail = document.createElement('p');
  objective.append(heading, detail);

  const status = document.createElement('p');
  status.className = 'atlas-toolkit-status';
  status.setAttribute('role', 'status');

  const actionHost = document.createElement('div');
  actionHost.className = 'atlas-toolkit-action';
  root.append(depth, objective, status, actionHost);

  let actionButton: HTMLButtonElement | null = null;
  let actionKey = '';
  const renderAction = (action: AtlasToolkitObjective['action']): void => {
    const nextActionKey = action ? `${action.label}|${action.ariaLabel}` : '';
    if (nextActionKey === actionKey) return;
    actionKey = nextActionKey;
    actionButton?.remove();
    actionButton = action ? createSemanticWorldControl(action) : null;
    if (actionButton) actionHost.append(actionButton);
  };

  const update = (next: AtlasToolkitObjective): void => {
    root.className = `atlas-toolkit atlas-toolkit-${next.depth} atlas-objective`;
    depth.textContent = DEPTH_LABELS[next.depth];
    heading.textContent = next.objective;
    detail.textContent = next.detail;
    status.textContent = next.status ?? '';
    renderAction(next.action);
  };

  const setDepth = (nextDepth: AtlasToolkitDepth): void => {
    root.className = `atlas-toolkit atlas-toolkit-${nextDepth} atlas-objective`;
    depth.textContent = DEPTH_LABELS[nextDepth];
  };

  update(initial);
  return {
    element: root,
    update,
    setDetail: (nextDetail) => { detail.textContent = nextDetail; },
    setStatus: (nextStatus) => { status.textContent = nextStatus; },
    setDepth,
    destroy: () => root.remove(),
  };
}

/**
 * The stuck-route panel. One shape for every district, so six rungs cannot
 * drift into six different explanations of the same idea.
 *
 * The order is the point: the claim the player believed, then why it is not
 * enough, then what would actually settle it.
 */
export function renderAtlasBeatPanel(beat: AtlasMissionBeat): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'atlas-beat-panel';
  panel.setAttribute('data-beat', beat.kind);
  panel.setAttribute('data-scale', beat.scale);
  for (const row of atlasBeatRows(beat)) {
    const element = document.createElement(row.kind === 'headline' ? 'h2' : 'p');
    element.className = `atlas-beat-${row.kind}`;
    element.textContent = row.text;
    // The refusal is announced rather than left to colour alone, because it is
    // the only row that changes what the player should do next.
    if (row.kind === 'refusal') element.setAttribute('role', 'status');
    panel.append(element);
  }
  return panel;
}
