import type { RelayWorldSnapshot } from '../api';

export function renderRelaySeason(onBack: () => void, world?: RelayWorldSnapshot | null): HTMLElement {
  const section = document.createElement('section'); section.className = 'relay-screen';
  const kicker = document.createElement('p'); kicker.className = 'relay-kicker'; kicker.textContent = 'SEASON 0';
  const heading = document.createElement('h1'); heading.textContent = 'The world is waiting.';
  const copy = document.createElement('p'); copy.className = 'relay-lead'; copy.textContent = world ? `${world.repairTotal} of ${world.target} repair units · projection ${world.projectionVersion} · ${world.verifiedPlayerCount} verified players` : 'Repair progress is not available yet. No community number is fabricated.';
  const button = document.createElement('button'); button.className = 'relay-primary'; button.type = 'button'; button.textContent = 'Back to today'; button.addEventListener('click', onBack);
  section.append(kicker, heading, copy, button); return section;
}
