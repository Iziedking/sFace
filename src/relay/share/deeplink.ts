const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REPLAY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface RelayMiniAppLinkData {
  missionDate: string;
  replayId?: string;
}

export function createRelayMiniAppDeepLink(origin: string, missionDate: string, replayId?: string): string {
  if (!DATE_PATTERN.test(missionDate)) throw new Error('Deep-link mission date is invalid.');
  if (replayId !== undefined && !REPLAY_PATTERN.test(replayId)) throw new Error('Deep-link replay id is invalid.');
  const target = new URL(origin);
  target.search = '';
  target.searchParams.set('missionDate', missionDate);
  if (replayId !== undefined) target.searchParams.set('replayId', replayId);
  return `nimiqpay://miniapp?url=${encodeURIComponent(target.toString())}`;
}

export function parseRelayMiniAppDeepLink(value: string): RelayMiniAppLinkData | null {
  try {
    const outer = new URL(value);
    if (outer.protocol !== 'nimiqpay:' || outer.hostname !== 'miniapp') return null;
    const targetValue = outer.searchParams.get('url');
    if (!targetValue) return null;
    const target = new URL(targetValue);
    const missionDate = target.searchParams.get('missionDate') ?? '';
    const replayId = target.searchParams.get('replayId') ?? undefined;
    if (!DATE_PATTERN.test(missionDate) || (replayId !== undefined && !REPLAY_PATTERN.test(replayId))) return null;
    return replayId === undefined ? { missionDate } : { missionDate, replayId };
  } catch {
    return null;
  }
}
