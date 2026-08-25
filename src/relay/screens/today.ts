import type { RelayWorldSnapshot } from '../api';

export function renderRelayToday(options: { onRescue: () => void; onSeason: () => void; onRules: () => void; onShare?: () => void; practice: boolean; world?: RelayWorldSnapshot | null; message?: string | null }): HTMLElement {
  const section = document.createElement('section'); section.className = 'relay-screen relay-today';
  const kicker = document.createElement('p'); kicker.className = 'relay-kicker'; kicker.textContent = 'NIM RESCUE RELAY';
  const heading = document.createElement('h1'); heading.textContent = 'Bring the relay home.';
  const copy = document.createElement('p'); copy.className = 'relay-lead'; copy.textContent = 'Fly a 45-second route, carry rescue nodes, and bank as many as you can before the pod gives out.';
  const progress = document.createElement('p'); progress.className = 'relay-progress'; progress.textContent = options.practice && !options.world ? 'Shared progress is unavailable. Practice mode is ready.' : options.world ? `${options.world.repairTotal} / ${options.world.target} repair units · ${options.world.verifiedPlayerCount} verified players` : 'Community progress is reconnecting.';
  const button = document.createElement('button'); button.className = 'relay-primary'; button.type = 'button'; button.textContent = 'Rescue now'; button.addEventListener('click', options.onRescue);
  const nav = document.createElement('nav'); nav.className = 'relay-links';
  const season = document.createElement('button'); season.type = 'button'; season.textContent = 'Season'; season.addEventListener('click', options.onSeason);
  const rules = document.createElement('button'); rules.type = 'button'; rules.textContent = 'How it works'; rules.addEventListener('click', options.onRules);
  nav.append(season, rules);
  if (options.onShare && options.world) { const share = document.createElement('button'); share.type = 'button'; share.textContent = 'Share progress'; share.addEventListener('click', options.onShare); nav.append(share); }
  section.append(kicker, heading, copy, progress, options.message ? message(options.message) : document.createTextNode(''), button, nav); return section;
}

function message(value: string): HTMLElement { const element = document.createElement('p'); element.className = 'relay-message'; element.textContent = value; return element; }
