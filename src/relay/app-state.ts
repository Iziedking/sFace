export type RelayScreen =
  | 'boot'
  | 'today'
  | 'countdown'
  | 'running'
  | 'paused'
  | 'practice-result'
  | 'authorization'
  | 'submitting'
  | 'verified-result'
  | 'retryable-failure'
  | 'hard-rejection'
  | 'season'
  | 'rules'
  | 'error';

export interface RelayAppState {
  screen: RelayScreen;
  runKind: 'practice' | 'competitive';
  missionDate: string | null;
  countdown: number;
  pauseReason: 'visibility' | 'blur' | 'webview' | null;
  result: { score: number; completedTicks: number } | null;
  message: string | null;
}

export type RelayAppEvent =
  | { type: 'PRACTICE_READY'; missionDate: string; message?: string | null }
  | { type: 'RESCUE_NOW' }
  | { type: 'COUNTDOWN_TICK'; value: number }
  | { type: 'PRACTICE_FINISHED'; score: number; completedTicks: number }
  | { type: 'PAUSE'; reason: NonNullable<RelayAppState['pauseReason']> }
  | { type: 'RESUME' }
  | { type: 'AUTHORIZE' }
  | { type: 'AUTH_DECLINED' }
  | { type: 'COMPETITIVE_READY' }
  | { type: 'SUBMITTING' }
  | { type: 'SUBMIT_VERIFIED'; score: number; completedTicks: number }
  | { type: 'SUBMIT_RETRYABLE'; message: string }
  | { type: 'SUBMIT_REJECTED'; message: string }
  | { type: 'OPEN_SEASON' }
  | { type: 'OPEN_RULES' }
  | { type: 'ERROR'; message: string };

export function createRelayAppState(screen: RelayScreen = 'boot'): RelayAppState {
  return { screen, runKind: 'practice', missionDate: null, countdown: 3, pauseReason: null, result: null, message: null };
}

export function relayAppReducer(state: RelayAppState, event: RelayAppEvent): RelayAppState {
  switch (event.type) {
    case 'PRACTICE_READY': return { ...state, screen: 'today', runKind: 'practice', missionDate: event.missionDate, message: event.message ?? null };
    case 'RESCUE_NOW': return state.screen === 'today' ? { ...state, screen: 'countdown', runKind: 'practice', countdown: 3 } : state;
    case 'COUNTDOWN_TICK': return event.value <= 0 ? { ...state, screen: 'running', countdown: 0 } : { ...state, countdown: event.value };
    case 'PRACTICE_FINISHED': return { ...state, screen: 'practice-result', result: { score: event.score, completedTicks: event.completedTicks }, message: null };
    case 'PAUSE': return state.screen === 'running' ? { ...state, screen: 'paused', pauseReason: event.reason } : state;
    case 'RESUME': return state.screen === 'paused' ? { ...state, screen: 'running', pauseReason: null } : state;
    case 'AUTHORIZE': return state.screen === 'practice-result' ? { ...state, screen: 'authorization' } : state;
    case 'AUTH_DECLINED': return state.screen === 'authorization' ? { ...state, screen: 'practice-result', message: 'Competitive authorization was declined. Your practice result is preserved.' } : state;
    case 'COMPETITIVE_READY': return state.screen === 'authorization' ? { ...state, screen: 'countdown', runKind: 'competitive', countdown: 3, message: null } : state;
    case 'SUBMITTING': return { ...state, screen: 'submitting', message: null };
    case 'SUBMIT_VERIFIED': return { ...state, screen: 'verified-result', result: { score: event.score, completedTicks: event.completedTicks }, message: null };
    case 'SUBMIT_RETRYABLE': return { ...state, screen: 'retryable-failure', message: event.message };
    case 'SUBMIT_REJECTED': return { ...state, screen: 'hard-rejection', message: event.message };
    case 'OPEN_SEASON': return { ...state, screen: 'season' };
    case 'OPEN_RULES': return { ...state, screen: 'rules' };
    case 'ERROR': return { ...state, screen: 'error', message: event.message };
  }
}
