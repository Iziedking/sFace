export type RelayShareVariant = 'personal-proof' | 'community-deficit' | 'district-completion' | 'weekly-final';

export interface RelayShareCardInput {
  variant: RelayShareVariant;
  verified: boolean;
  missionDate: string;
  score: number;
  completedTicks: number;
  repairUnits: number;
  world?: { repairTotal: number; target: number };
  weekly?: { label: string; finalScore: number };
}

export interface RelayShareCard {
  text: string;
  svg: string;
  filename: string;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

function validate(input: RelayShareCardInput): void {
  if (input.verified !== true) throw new Error('Only verified Relay results can be shared.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.missionDate)) throw new Error('Share mission date is invalid.');
  if (![input.score, input.completedTicks, input.repairUnits].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('Share result values are invalid.');
  if (input.completedTicks > 1_350) throw new Error('Share result ticks are invalid.');
}

function copy(input: RelayShareCardInput): string {
  switch (input.variant) {
    case 'personal-proof': return `Verified NIM Rescue Relay run: ${input.score} repair points on ${input.missionDate}. ${input.repairUnits} repair units contributed.`;
    case 'community-deficit': {
      if (!input.world) throw new Error('Community share requires current world progress.');
      const remaining = Math.max(0, input.world.target - input.world.repairTotal);
      return remaining === 0
        ? `The district is repaired in NIM Rescue Relay on ${input.missionDate}.`
        : `${remaining} repair units left to repair the district in NIM Rescue Relay.`;
    }
    case 'district-completion': {
      if (!input.world) throw new Error('District share requires current world progress.');
      return input.world.repairTotal >= input.world.target
        ? `District completion confirmed in NIM Rescue Relay on ${input.missionDate}.`
        : `District progress: ${input.world.repairTotal}/${input.world.target} repair units.`;
    }
    case 'weekly-final':
      if (!input.weekly) throw new Error('Weekly share requires current weekly result data.');
      return `${input.weekly.label}: ${input.weekly.finalScore} verified repair points in NIM Rescue Relay.`;
  }
}

export function createRelayShareCard(input: RelayShareCardInput): RelayShareCard {
  validate(input);
  const text = copy(input);
  const safeText = escapeXml(text);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f4ede0"/><path d="M0 520h1200v110H0z" fill="#f28b30"/><text x="72" y="112" font-family="monospace" font-size="28" font-weight="700" fill="#b45309">NIM RESCUE RELAY</text><text x="72" y="250" font-family="sans-serif" font-size="48" font-weight="700" fill="#171411">${safeText}</text><text x="72" y="570" font-family="monospace" font-size="24" fill="#171411">${escapeXml(input.missionDate)}</text></svg>`;
  return { text, svg, filename: `nim-rescue-relay-${input.missionDate}.svg` };
}
