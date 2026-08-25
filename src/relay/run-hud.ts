export interface RelayRunHudState {
  score: number;
  integrity: number;
  carried: number;
  banked: number;
  seconds: number;
}

interface RelayHudRoot {
  querySelector(selector: string): { textContent: string | null } | null;
}

export function updateRelayRunHud(root: RelayHudRoot, state: RelayRunHudState): void {
  setText(root, '[data-relay-stat="time"]', `${Math.max(0, state.seconds).toFixed(1)}s`);
  setText(root, '[data-relay-stat="integrity"]', `${state.integrity}/3`);
  setText(root, '[data-relay-stat="carried"]', String(state.carried));
  setText(root, '[data-relay-stat="banked"]', String(state.banked));
  setText(
    root,
    '[data-relay-objective]',
    state.carried > 0
      ? `Carrying ${state.carried}. Cross an orange gate to bank them.`
      : 'Collect orange nodes, then cross an orange gate to bank them.',
  );
}

function setText(root: RelayHudRoot, selector: string, value: string): void {
  const element = root.querySelector(selector);
  if (element) element.textContent = value;
}
