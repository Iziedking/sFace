export function renderRelayRun(options: { countdown: number; paused: boolean; onResume: () => void; onPause: () => void; onSteer: (value: number) => void; state: { score: number; integrity: number; carried: number; banked: number; seconds: number } }): HTMLElement {
  const section = document.createElement('section'); section.className = 'relay-hud'; section.setAttribute('aria-label', 'Relay run status');
  const heading = document.createElement('h1'); heading.className = 'relay-visually-hidden'; heading.textContent = 'NIM Rescue Relay run'; section.append(heading);
  const label = (name: string, key: string, value: string): HTMLElement => { const item = document.createElement('div'); item.className = 'relay-stat'; const title = document.createElement('span'); title.textContent = name; const figure = document.createElement('strong'); figure.dataset.relayStat = key; figure.textContent = value; item.append(title, figure); return item; };
  section.append(label('Time', 'time', `${Math.max(0, options.state.seconds).toFixed(1)}s`), label('Integrity', 'integrity', `${options.state.integrity}/3`), label('Carrying', 'carried', String(options.state.carried)), label('Banked', 'banked', String(options.state.banked)));
  const guide = document.createElement('div'); guide.className = 'relay-run-guide'; guide.setAttribute('aria-live', 'polite');
  const guideTitle = document.createElement('strong'); guideTitle.textContent = 'RESCUE LOOP';
  const objective = document.createElement('p'); objective.textContent = options.countdown > 0
    ? 'Get ready: drag left/right to steer.'
    : options.state.carried > 0
      ? `Carrying ${options.state.carried}. Cross an orange gate to bank them.`
      : 'Collect orange nodes, then cross an orange gate to bank them.';
  objective.dataset.relayObjective = '';
  const controls = document.createElement('p'); controls.textContent = 'Collect orange nodes · cross an orange gate to bank them · Avoid red hazards';
  const movement = document.createElement('p'); movement.textContent = 'Tap a steering button, drag left/right, or use ← → / A/D.';
  const legend = document.createElement('div'); legend.className = 'relay-legend';
  for (const item of [['relay-key-node', 'NODE = collect'], ['relay-key-gate', 'BANK GATE = score'], ['relay-key-hazard', 'HAZARD = avoid'], ['relay-key-you', 'YOU = steer']] as const) {
    const entry = document.createElement('span'); entry.className = 'relay-legend-item';
    const key = document.createElement('i'); key.className = item[0]; key.setAttribute('aria-hidden', 'true');
    entry.append(key, document.createTextNode(item[1])); legend.append(entry);
  }
  const steerControls = document.createElement('div'); steerControls.className = 'relay-steer-controls'; steerControls.setAttribute('aria-label', 'Steering controls');
  const steeringOptions: ReadonlyArray<readonly [string, number]> = [['Move left', -127], ['Center', 0], ['Move right', 127]];
  for (const [label, value] of steeringOptions) {
    const button = document.createElement('button'); button.className = 'relay-steer-button'; button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', `${label} rescue pod`); button.addEventListener('click', () => options.onSteer(value)); steerControls.append(button);
  }
  guide.append(guideTitle, objective, controls, movement, steerControls, legend); section.append(guide);
  if (options.countdown > 0) { const count = document.createElement('div'); count.className = 'relay-countdown'; count.textContent = String(options.countdown); count.setAttribute('aria-live', 'assertive'); section.append(count); }
  if (options.paused) { const button = document.createElement('button'); button.className = 'relay-primary relay-resume'; button.type = 'button'; button.textContent = 'Resume practice'; button.addEventListener('click', options.onResume); section.append(button); }
  else { const button = document.createElement('button'); button.className = 'relay-pause'; button.type = 'button'; button.textContent = 'Pause'; button.addEventListener('click', options.onPause); section.append(button); }
  return section;
}
