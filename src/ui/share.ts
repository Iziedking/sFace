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
  /** Handles of the people who made it out. Named, because that is the story. */
  saved: string[];
  /** Today's crypto X headline, when we read one. */
  headline: string | null;
  /** The player's own X handle, when they connected an account. */
  handle: string | null;
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
    // Who was actually pulled out. Naming them is what makes a shared card a
    // story rather than a number.
    saved: state.faces
      .filter((f) => f.state === 'extracted')
      .map((f) => f.handle)
      .slice(0, 5),
    headline: state.mission.story?.headline ?? null,
    handle: null,
  };
}

/** Draw the card. Returns a data URL, or null if the canvas is unavailable. */
export function drawScoreCard(data: CardData): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const PAD = 64;

  ctx.fillStyle = theme.canvas;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // A thick ink border. The card is a printed poster, so it has an edge.
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, CARD_WIDTH - 16, CARD_HEIGHT - 16);

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // Wordmark. The orange dot is the one distinctive element and it survives
  // being shrunk to a favicon.
  ctx.fillStyle = theme.ink;
  ctx.font = `700 40px ${MONO}`;
  ctx.fillText('sFace', PAD, 52);
  const wordWidth = ctx.measureText('sFace').width;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(PAD + wordWidth + 13, 52 + 31, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = theme.inkMuted;
  ctx.font = `600 19px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(data.date, CARD_WIDTH - PAD, 62);

  // The mission. A solid ink plate with the ticker knocked out of it, so the
  // one checkable fact on the card is the loudest thing on it.
  ctx.textAlign = 'left';
  ctx.font = `700 84px ${MONO}`;
  const tickerWidth = ctx.measureText(data.ticker).width;

  ctx.fillStyle = theme.ink;
  ctx.fillRect(PAD, 132, tickerWidth + 40, 104);
  ctx.fillStyle = theme.accent;
  ctx.fillText(data.ticker, PAD + 20, 148);

  if (data.live) {
    ctx.fillStyle = theme.danger;
    ctx.fillRect(PAD + tickerWidth + 56, 132, 190, 104);
    ctx.fillStyle = theme.canvas;
    ctx.font = `700 46px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${data.changePct.toFixed(1)}%`, PAD + tickerWidth + 151, 166);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = theme.ink;
  ctx.font = `600 22px ${MONO}`;
  ctx.fillText(
    data.live ? "TODAY'S WORST PERFORMER BECAME THE LEVEL" : 'PRACTICE MISSION',
    PAD,
    258,
  );

  // Today's story, when we read one. This is the line that makes the card
  // legible to somebody who has never heard of the game.
  if (data.headline) {
    ctx.fillStyle = theme.accentPale;
    ctx.fillRect(PAD, 292, CARD_WIDTH - PAD * 2, 52);
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 3;
    ctx.strokeRect(PAD, 292, CARD_WIDTH - PAD * 2, 52);

    ctx.fillStyle = theme.ink;
    ctx.font = `600 22px ${MONO}`;
    ctx.fillText(truncate(ctx, data.headline, CARD_WIDTH - PAD * 2 - 32), PAD + 16, 306);
  }

  // The number.
  const numberTop = data.headline ? 366 : 330;
  ctx.fillStyle = theme.ink;
  ctx.font = `700 140px ${MONO}`;
  ctx.fillText(data.score.toLocaleString(), PAD, numberTop);

  ctx.fillStyle = theme.inkMuted;
  ctx.font = `700 20px ${MONO}`;
  ctx.fillText('SCORE', PAD + 4, numberTop + 148);

  // Right-hand stats.
  const stats: Array<[string, string]> = [
    ['OUT', `${data.facesExtracted}/${data.facesTotal}`],
    ['CLEARED', String(data.attackersCleared)],
  ];
  if (data.rank !== null) stats.push(['RANK', `#${data.rank}`]);

  ctx.textAlign = 'right';
  stats.forEach(([label, value], index) => {
    const y = 372 + index * 74;
    ctx.fillStyle = theme.inkMuted;
    ctx.font = `700 17px ${MONO}`;
    ctx.fillText(label, CARD_WIDTH - PAD, y);
    ctx.fillStyle = theme.ink;
    ctx.font = `700 40px ${MONO}`;
    ctx.fillText(value, CARD_WIDTH - PAD, y + 20);
  });

  // Who was actually pulled out. Names beat a count every time.
  ctx.textAlign = 'left';
  if (data.saved.length > 0) {
    ctx.font = `700 18px ${MONO}`;
    let x = PAD;
    for (const handle of data.saved) {
      const tag = `@${handle}`;
      const width = ctx.measureText(tag).width + 20;
      if (x + width > CARD_WIDTH - PAD - 220) break;

      ctx.fillStyle = theme.rescue;
      ctx.fillRect(x, CARD_HEIGHT - 128, width, 34);
      ctx.fillStyle = theme.canvas;
      ctx.fillText(tag, x + 10, CARD_HEIGHT - 119);
      x += width + 8;
    }
  }

  // Outcome, as a solid plate.
  const outcome = data.survived ? 'EXTRACTED' : 'WENT DOWN';
  ctx.font = `700 22px ${MONO}`;
  const outcomeWidth = ctx.measureText(outcome).width + 28;
  ctx.fillStyle = data.survived ? theme.rescue : theme.danger;
  ctx.fillRect(PAD, CARD_HEIGHT - 82, outcomeWidth, 40);
  ctx.fillStyle = theme.canvas;
  ctx.fillText(outcome, PAD + 14, CARD_HEIGHT - 71);

  ctx.textAlign = 'right';
  ctx.fillStyle = theme.ink;
  ctx.font = `600 19px ${MONO}`;
  ctx.fillText(
    data.handle ? `@${data.handle} · a Nimiq Pay mini app` : 'A Nimiq Pay mini app',
    CARD_WIDTH - PAD,
    CARD_HEIGHT - 66,
  );

  // toDataURL throws on a tainted canvas. Nothing cross-origin is drawn here
  // for exactly that reason, but guard anyway: losing the share is worse than
  // losing the picture.
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Trim to fit a pixel width, with an ellipsis rather than a hard cut. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}...`;
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
