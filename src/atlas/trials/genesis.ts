export interface GenesisTrialResult {
  correct: boolean;
  luna: number | null;
  explanation: string;
  sourceUrl: string;
  recipe: string;
}

const CORRECT = '1_200_000';

export function gradeGenesisTrial(answer: string): GenesisTrialResult {
  const correct = answer === CORRECT;
  return {
    correct,
    luna: correct ? 1_200_000 : null,
    explanation: correct
      ? 'Correct. Nimiq uses integer Lunas: 12 multiplied by 100000 is 1200000 Lunas.'
      : 'Not yet. One NIM is 100000 Lunas, so multiply 12 by 100000.',
    sourceUrl: 'https://nimiq.dev/mini-apps/api-reference/nimiq-provider',
    recipe: 'const LUNAS_PER_NIM = 100_000\nconst luna = 12 * LUNAS_PER_NIM',
  };
}
