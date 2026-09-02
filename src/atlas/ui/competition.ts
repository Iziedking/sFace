import type { AtlasCompetitionSummary } from '../api';

export function createCompetitionView(summaries: readonly AtlasCompetitionSummary[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'atlas-competition-view';
  section.setAttribute('aria-label', 'Verified Atlas competition');
  if (summaries.length === 0) {
    section.append(text('Competition data is unavailable.'));
    return section;
  }
  for (const summary of summaries) {
    const card = document.createElement('article');
    card.className = 'atlas-competition-card';
    const role = document.createElement('h3');
    role.textContent = summary.role === 'builder' ? 'Builder path' : 'Explorer path';
    const score = document.createElement('p');
    score.textContent = summary.bestVerifiedScore === null ? 'No verified score yet' : `Best verified score: ${summary.bestVerifiedScore}`;
    const status = document.createElement('p');
    const eligibility = summary.eligibility === 'not-verified' ? 'not-verified' : summary.eligibility;
    const obligation = summary.dailyObligation.status === 'estimating' ? 'estimating' : summary.dailyObligation.status === 'verified-paid' ? 'verified-paid' : summary.dailyObligation.status;
    status.textContent = `${eligibility} / ${obligation}`;
    const amount = document.createElement('p');
    amount.textContent = summary.dailyObligation.amountLuna === null ? 'Daily amount: pending server close' : `Daily amount: ${summary.dailyObligation.amountLuna} Lunas`;
    card.append(role, score, status, amount);
    section.append(card);
  }
  return section;
}

function text(value: string): Text {
  return document.createTextNode(value);
}
