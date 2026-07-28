/**
 * Every string the player reads lives here.
 *
 * Nimiq Pay tells us which language the user picked, so this is keyed and
 * swappable. Locales other than English are partial on purpose: each key falls
 * back to English when a translation is missing, so adding a language is
 * additive and a missing key is a small English word rather than a blank.
 *
 * Voice: short declaratives. Problem first, action second. Dry, and allowed to
 * be funny, but never breathless and never a marketing line. It talks the way
 * crypto X talks about a bad day, which is flatly and with the joke buried.
 *
 * Two hard rules. No exclamation marks in a failure state, because nobody
 * wants to be shouted at after dying. And nothing claims anything the product
 * cannot back: no invented numbers, no "the best", no promise of a prize that
 * is not already funded.
 */

const en = {
  appName: 'sFace',
  tagline: "Crypto's down. Somebody has to save face.",

  // Boot and briefing
  loadingMission: 'Reading the market',
  missionToday: "Today's wreck",
  fearIndex: 'Fear and Greed',
  difficulty: 'Difficulty',
  briefBody:
    'The chart is the ground. The people in it are whoever crypto spent today arguing about. Get them out before the clock does.',
  startRun: 'Start the run',
  howToPlay: 'How to play',
  connectX: 'Connect X',
  connectedAs: 'Flying as',
  disconnectX: 'Disconnect',
  connectXWhy: 'Your picture rides on your character and your handle goes on the board.',
  connectXFailed: 'Could not connect that account. Playing without it.',
  controlsMove: 'Left thumb flies',
  controlsShoot: 'Right thumb aims and fires',
  controlsRescue: 'Touch a face to free it',

  // Live run
  timeLeft: 'Time',
  carrying: 'Carrying',
  extractAhead: 'Pad ahead',
  extractReached: 'Extraction',
  facesFreed: 'freed',

  // Results
  runComplete: 'Run complete',
  runFailed: 'You went down with them',
  score: 'Score',
  faces: 'Faces out',
  attackers: 'Attackers cleared',
  timeBonus: 'Time bonus',
  bounty: 'Market bounty',
  playAgain: 'Run it again',
  challengeFriend: 'Challenge a friend',
  shareRun: 'Share this run',
  viewBoard: 'Daily board',

  // Leaderboard
  boardTitle: 'Today',
  boardEmpty: 'Nobody has flown this one yet. First score sets the mark.',
  boardYou: 'You',
  boardOffline: 'The board is unreachable. Your score is saved on this device.',

  // Challenges
  challengeTitle: 'Challenge',
  challengeStake: 'Stake',
  challengeSame:
    'Same day, same seed, same level, down to the pixel. No advantage anyone can buy. Higher score takes the stake.',
  challengeCreate: 'Create the challenge',
  challengeOpen: 'Waiting on them',
  challengeAccept: 'Accept and play',
  challengeWon: 'You won',
  challengeLost: 'They beat you',
  challengeSettle: 'Pay the stake',
  challengeSettled: 'Settled on chain',
  challengeNoWallet: 'Open this in Nimiq Pay to stake NIM.',
  challengeSelf: 'That is your own challenge.',

  // Honest failure states, one sentence each
  errorMissionOffline:
    'Could not reach the market. Playing an offline mission instead.',
  errorBoardPost: 'Score could not be posted. It is still saved here.',
  errorGeneric: 'Something went wrong. Try that again.',
} as const;

export type CopyKey = keyof typeof en;

/** Partial overrides. Anything missing falls through to English. */
const overrides: Record<string, Partial<Record<CopyKey, string>>> = {
  de: {
    tagline: 'Der Markt fällt. Irgendwer muss das Gesicht wahren.',
    loadingMission: 'Markt wird gelesen',
    missionToday: 'Das Wrack von heute',
    fearIndex: 'Angst und Gier',
    difficulty: 'Schwierigkeit',
    startRun: 'Lauf starten',
    timeLeft: 'Zeit',
    carrying: 'Dabei',
    score: 'Punkte',
    faces: 'Gerettet',
    playAgain: 'Nochmal',
    challengeFriend: 'Freund herausfordern',
    runComplete: 'Lauf beendet',
    runFailed: 'Du bist abgestürzt',
  },
  es: {
    tagline: 'El mercado cae. Alguien tiene que salvar la cara.',
    loadingMission: 'Leyendo el mercado',
    missionToday: 'El naufragio de hoy',
    fearIndex: 'Miedo y codicia',
    difficulty: 'Dificultad',
    startRun: 'Empezar',
    timeLeft: 'Tiempo',
    carrying: 'Llevas',
    score: 'Puntos',
    faces: 'Rescatados',
    playAgain: 'Otra vez',
    challengeFriend: 'Retar a un amigo',
    runComplete: 'Carrera terminada',
    runFailed: 'Has caído',
  },
  pt: {
    tagline: 'O mercado caiu. Alguém tem de salvar a face.',
    loadingMission: 'A ler o mercado',
    missionToday: 'O destroço de hoje',
    startRun: 'Começar',
    timeLeft: 'Tempo',
    score: 'Pontos',
    faces: 'Resgatados',
    playAgain: 'Outra vez',
  },
  fr: {
    tagline: 'Le marché chute. Il faut bien sauver la face.',
    loadingMission: 'Lecture du marché',
    missionToday: "L'épave du jour",
    startRun: 'Lancer',
    timeLeft: 'Temps',
    score: 'Score',
    faces: 'Sauvés',
    playAgain: 'Rejouer',
  },
};

let active: Partial<Record<CopyKey, string>> = {};

/** Called once at boot with whatever Nimiq Pay reported. */
export function setLanguage(code: string): void {
  active = overrides[code.toLowerCase().slice(0, 2)] ?? {};
}

/** Read a string. Always returns something printable. */
export function t(key: CopyKey): string {
  return active[key] ?? en[key];
}

/**
 * Difficulty reads as a word, not a number. "Extreme fear" tells the player
 * why today is hard. A 5 tells them nothing.
 */
export function difficultyLabel(fearGreed: number): string {
  if (fearGreed <= 20) return 'Extreme fear';
  if (fearGreed <= 40) return 'Fear';
  if (fearGreed <= 60) return 'Neutral';
  if (fearGreed <= 80) return 'Greed';
  return 'Extreme greed';
}
