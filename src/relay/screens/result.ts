export function renderRelayResult(options: { score: number; completedTicks: number; onAgain: () => void; onSeason: () => void; onSubmit?: () => void; onShare?: () => void; verified?: boolean; message?: string | null }): HTMLElement {
  const section = document.createElement('section'); section.className = 'relay-screen relay-result';
  const kicker = document.createElement('p'); kicker.className = 'relay-kicker'; kicker.textContent = options.verified ? 'VERIFIED RESULT' : 'PRACTICE RESULT';
  const heading = document.createElement('h1'); heading.textContent = `${options.score} repair points`;
  const copy = document.createElement('p'); copy.className = 'relay-lead'; copy.textContent = 'Your result is saved on this screen. Competitive authorization comes after the result, never before it.';
  const detail = document.createElement('p'); detail.className = 'relay-detail'; detail.textContent = `${options.completedTicks} simulation ticks verified locally.`;
  const again = document.createElement('button'); again.className = 'relay-primary'; again.type = 'button'; again.textContent = 'Rescue again'; again.addEventListener('click', options.onAgain);
  const season = document.createElement('button'); season.className = 'relay-secondary'; season.type = 'button'; season.textContent = 'View season'; season.addEventListener('click', options.onSeason);
  const submit = options.onSubmit ? document.createElement('button') : null;
  if (submit && options.onSubmit) { submit.className = 'relay-primary'; submit.type = 'button'; submit.textContent = 'Start verified run'; submit.addEventListener('click', options.onSubmit); }
  const share = options.verified && options.onShare ? document.createElement('button') : null;
  if (share && options.onShare) { share.className = 'relay-secondary'; share.type = 'button'; share.textContent = 'Share verified result'; share.addEventListener('click', options.onShare); }
  section.append(kicker, heading, copy, detail, options.message ? message(options.message) : document.createTextNode(''), ...(share ? [share] : []), ...(submit ? [submit] : []), again, season); return section;
}
function message(value: string): HTMLElement { const element = document.createElement('p'); element.className = 'relay-message'; element.textContent = value; return element; }
