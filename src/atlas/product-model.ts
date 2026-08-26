import { ATLAS_EVERGREEN_ADVENTURES, type EvergreenAdventure } from '../../shared/atlas/adventures/evergreen';
import { ATLAS_DAILY_CHALLENGES, type AtlasDailyChallenge } from '../../shared/atlas/daily';

const LAUNCH_SEASON_START_UTC = Date.UTC(2026, 7, 25);
const DAY_MS = 24 * 60 * 60 * 1_000;

export function selectDailyChallenge(now = new Date()): AtlasDailyChallenge {
  const utcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const elapsedDays = Math.max(0, Math.floor((utcDay - LAUNCH_SEASON_START_UTC) / DAY_MS));
  return ATLAS_DAILY_CHALLENGES[elapsedDays % ATLAS_DAILY_CHALLENGES.length]!;
}

export function dailyChallengeChoices(challenge: AtlasDailyChallenge): string[] {
  const alternatives = unique(
    ATLAS_DAILY_CHALLENGES
      .filter((candidate) => candidate.theme === challenge.theme && candidate.answer !== challenge.answer)
      .map((candidate) => candidate.answer),
  );
  const start = challenge.day % alternatives.length;
  const choices = [challenge.answer, alternatives[start]!, alternatives[(start + 2) % alternatives.length]!];
  return rotate(choices, challenge.day % choices.length);
}

export function evergreenTeachBackChoices(adventure: EvergreenAdventure, step: number): string[] {
  const answer = adventure.teachBack[step];
  if (!answer) throw new Error('Atlas teach-back step is unavailable.');
  const alternatives = unique(
    ATLAS_EVERGREEN_ADVENTURES
      .flatMap((candidate) => candidate.teachBack)
      .filter((candidate) => candidate !== answer),
  );
  const seed = [...adventure.id].reduce((total, character) => total + character.charCodeAt(0), step);
  const choices = [answer, alternatives[seed % alternatives.length]!, alternatives[(seed + 5) % alternatives.length]!];
  return rotate(choices, seed % choices.length);
}

export function formatDailyChoice(value: string): string {
  return /^\d+$/.test(value) ? `${Number(value).toLocaleString('en-US')} Lunas` : value.replace(/-/g, ' ');
}

export function dailyRetryHint(challenge: AtlasDailyChallenge): string {
  const hints: Record<AtlasDailyChallenge['theme'], string> = {
    money: 'Not yet. Open the Knowledge Book and check the Luna conversion, exact amount, and recipient fragments.',
    permission: 'Not yet. Open the Knowledge Book and trace who asks, who approves, and where custody remains.',
    evidence: 'Not yet. Open the Knowledge Book and separate provider lookup, canonical evidence, confirmation, and fulfillment.',
    network: 'Not yet. Open the Knowledge Book and check the consensus, network-view, and distribution fragments.',
  };
  return hints[challenge.theme];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function rotate<T>(values: T[], amount: number): T[] {
  return [...values.slice(amount), ...values.slice(0, amount)];
}
