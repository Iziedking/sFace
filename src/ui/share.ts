/**
 * The score card and the invite. Marketing is a full quarter of the score, so
 * this is a feature of the game rather than something bolted on at the end.
 *
 * The card is drawn on a canvas at a fixed size and carries the real ticker,
 * the real percentage, and the real date. That is the whole point: the artifact
 * that travels has to be checkable against the market, or it is just a number
 * on a gradient.
 *
 * Sharing tries the native sheet first, because on a phone inside a wallet that
 * is the thing people actually use, and falls back to an X compose intent. The
 * intent needs no OAuth, no API key, and no review, which is why it is the
 * growth loop rather than a proper integration.
 */

import { theme, MONO } from '../render/theme';
import type { RunState } from '../game/state';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 675;

export interface CardData {
  ticker: string;
  changePct: number;
  live: boolean;
  date: string;
  score: number;
  facesExtracted: number;
  facesTotal: number;
  attackersCleared: number;
  survived: boolean;
  rank: number | null;
}

export function cardDataFrom(state: RunState, rank: number | null): CardData {
  return {
    ticker: state.mission.ticker,
    changePct: state.mission.changePct,
    live: state.mission.live,
    date: state.mission.date,
    score: state.score,
    facesExtracted: state.facesExtracted,
    facesTotal: state.faces.length,
    attackersCleared: state.attackersCleared,
    survived: state.phase === 'extracted',
    rank,
  };
}

/** Draw the card. Returns a data URL, or null if the canvas is unavailable. */
export function drawScoreCard(data: CardData): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = theme.void;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Faint terminal grid, the same idea as the game background.
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < CARD_WIDTH; x += 60) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CARD_HEIGHT);
  }
  for (let y = 0; y < CARD_HEIGHT; y += 60) {
    ctx.moveTo(0, y);
    ctx.lineTo(CARD_WIDTH, y);
  }
  ctx.stroke();

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // Wordmark. The amber dot is the one distinctive element and it survives
  // being shrunk to a favicon.
  ctx.fillStyle = theme.ink;
  ctx.font = `700 44px ${MONO}`;
  ctx.fillText('sFace', 72, 64);
  const wordWidth = ctx.measureText('sFace').width;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(72 + wordWidth + 14, 64 + 34, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.inkFaint;
  ctx.font = `500 20px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(data.date, CARD_WIDTH - 72, 78);

  // The mission, in mono, because it is checkable.
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.accent;
  ctx.font = `700 96px ${MONO}`;
  ctx.fillText(data.ticker, 72, 178);

  if (data.live) {
    const tickerWidth = ctx.measureText(data.ticker).width;
    ctx.fillStyle = theme.danger;
    ctx.font = `700 48px ${MONO}`;
    ctx.fillText(`${data.changePct.toFixed(1)}%`, 72 + tickerWidth + 28, 222);
  }

  ctx.fillStyle = theme.inkMuted;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(
    data.live ? "Today's worst performer became the level" : 'Practice mission',
    72,
    300,
  );

  // The number.
  ctx.fillStyle = theme.ink;
  ctx.font = `700 150px ${MONO}`;
  ctx.fillText(data.score.toLocaleString(), 72, 356);

  ctx.fillStyle = theme.inkFaint;
  ctx.font = `500 22px ${MONO}`;
  ctx.fillText('SCORE', 76, 530);

  // Right-hand stats.
  const stats: Array<[string, string]> = [
    ['FACES OUT', `${data.facesExtracted}/${data.facesTotal}`],
    ['CLEARED', String(data.attackersCleared)],
  ];
  if (data.rank !== null) stats.push(['RANK TODAY', `#${data.rank}`]);

  ctx.textAlign = 'right';
  stats.forEach(([label, value], index) => {
    const y = 360 + index * 78;
    ctx.fillStyle = theme.inkFaint;
    ctx.font = `500 18px ${MONO}`;
    ctx.fillText(label, CARD_WIDTH - 72, y);
    ctx.fillStyle = theme.ink;
    ctx.font = `700 42px ${MONO}`;
    ctx.fillText(value, CARD_WIDTH - 72, y + 24);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = data.survived ? theme.accent : theme.danger;
  ctx.font = `700 22px ${MONO}`;
  ctx.fillText(data.survived ? 'EXTRACTED' : 'WENT DOWN', 72, 588);

  ctx.textAlign = 'right';
  ctx.fillStyle = theme.inkFaint;
  ctx.font = `500 20px ${MONO}`;
  ctx.fillText('A Nimiq Pay mini app', CARD_WIDTH - 72, 588);

  return canvas.toDataURL('image/png');
}

/** Copy that leads with the mechanic. The tech is the second sentence. */
export function shareText(data: CardData): string {
  const where = data.live
    ? `Flew the ${data.ticker} crash`
    : 'Flew a practice run on sFace';
  const saved =
    data.facesExtracted > 0
      ? `and pulled out ${data.facesExtracted} of ${data.facesTotal}.`
      : 'and left empty handed.';
  return `${where} ${saved} ${data.score.toLocaleString()} points. Beat that.`;
}

export function xIntent(text: string, url: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/**
 * Native share sheet if the device has one, X compose intent if it does not.
 *
 * The image is only attached when canShare confirms files are supported.
 * Passing files to a share sheet that cannot take them throws, and losing the
 * share entirely is worse than sharing text alone.
 */
export async function shareRun(
  data: CardData,
  dataUrl: string | null,
  linkUrl: string,
): Promise<void> {
  const text = shareText(data);

  const file = dataUrl ? await toFile(dataUrl, `sface-${data.date}.png`) : null;

  if (navigator.share) {
    const payload: ShareData = { text, url: linkUrl };
    if (file && navigator.canShare?.({ files: [file] })) {
      payload.files = [file];
    }
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      // A user who dismisses the sheet has not asked for a second attempt.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }

  window.open(xIntent(text, linkUrl), '_blank', 'noopener,noreferrer');
}

/** Share a link with no card behind it, for a challenge sent before a run. */
export async function shareLink(text: string, linkUrl: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ text, url: linkUrl });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  window.open(xIntent(text, linkUrl), '_blank', 'noopener,noreferrer');
}

async function toFile(dataUrl: string, name: string): Promise<File | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: 'image/png' });
  } catch {
    return null;
  }
}
