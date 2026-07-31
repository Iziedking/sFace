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
  // x.com rather than twitter.com. The old host still redirects, but a judge
  // watching the address bar should not see the previous name of the site the
  // whole game is built on.
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/**
 * Open the X composer, from inside the click that asked for it.
 *
 * ## The bug this exists to prevent
 *
 * A browser only lets you open a window while the page still holds "transient
 * activation", which is granted by a click and revoked after the first await.
 * Share used to convert the score card to a File first and then call
 * window.open, so on every desktop browser the popup was blocked and the button
 * did visibly nothing. No error, no window, no clue.
 *
 * So the window is opened synchronously, before anything is awaited, and its
 * location is set immediately. Nothing between the click and this call is
 * allowed to await.
 */
/**
 * Is the page still holding a live user gesture?
 *
 * The share sheet needs one and will not say so politely: it rejects with
 * AbortError, the same error a person gets for closing the sheet themselves.
 * Asking first is the only way to tell those two apart before the fact.
 */
/**
 * A device where the OS share sheet is the normal way to share.
 *
 * Coarse pointer, which is a phone or a tablet. Deliberately not a check for
 * the API existing: desktop Chrome has it and should not use it here.
 */
function matchesTouch(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function activated(): boolean {
  const activation = navigator.userActivation;
  // Older engines do not expose this. Assume the gesture is live rather than
  // refusing to share on a browser that would have handled it fine.
  return activation ? activation.isActive : true;
}

function openIntent(text: string, linkUrl: string): void {
  const opened = window.open(xIntent(text, linkUrl), '_blank', 'noopener,noreferrer');

  // Popup blockers can still refuse. Falling back to the current tab is better
  // than a button that does nothing: the game is a mini app, and coming back is
  // one tap.
  if (!opened) window.location.href = xIntent(text, linkUrl);
}

/**
 * Native share sheet if the device has one, X compose intent if it does not.
 *
 * The sheet is tried first because on a phone inside a wallet it is the thing
 * people actually use. `canShare` is checked synchronously so the desktop path
 * never awaits before it opens a window. See openIntent.
 */
export async function shareRun(
  data: CardData,
  file: File | null,
  linkUrl: string,
): Promise<void> {
  const text = shareText(data);

  /*
   * ## The second half of the same bug
   *
   * Opening the composer synchronously fixed the browsers with no share sheet.
   * The ones that HAVE a sheet stayed broken for a subtler reason, and it took
   * a second report to find.
   *
   * This function used to turn the score card into a File before sharing. That
   * await spends the click's transient activation, so navigator.share was then
   * called with no live gesture and rejected. It rejects with AbortError, which
   * is the same error a person gets for closing the sheet themselves, and the
   * handler below quite reasonably treats that as "they changed their mind" and
   * returns without doing anything. Silent, no console error, button dead.
   *
   * So the card is now converted to a File when the results screen is built,
   * long before anybody clicks, and arrives here ready. Nothing between the
   * click and navigator.share is allowed to await. Do not reintroduce one.
   */
  /*
   * ## The third report on this button
   *
   * The native sheet is the right thing on a phone and the wrong thing on a
   * desktop. Chrome exposes navigator.share on Windows, so this took that path,
   * handed the payload to the OS, and whether anything visible happened was up
   * to a system dialog that frequently does not appear. From the player's side
   * the button did nothing, with no error to find.
   *
   * A share sheet is only offered where somebody actually shares through one.
   * Everywhere else goes straight to the X composer, which is a window opening:
   * unambiguous, and what a desktop player wanted anyway.
   */
  const wantsSheet = matchesTouch() && Boolean(navigator.share);

  if (!wantsSheet || !activated()) {
    openIntent(text, linkUrl);
    return;
  }

  const payload: ShareData = { text, url: linkUrl };
  if (file && navigator.canShare?.({ files: [file] })) payload.files = [file];

  try {
    await navigator.share(payload);
  } catch (error) {
    // Now that the gesture is guaranteed live, an AbortError really is someone
    // dismissing the sheet, and they have not asked for a second attempt.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    openIntent(text, linkUrl);
  }
}

/** Share a link with no card behind it, for a challenge or a clan invite. */
export async function shareLink(text: string, linkUrl: string): Promise<void> {
  /*
   * ## The fourth report, on the button next to the one that was fixed
   *
   * shareRun was taught that desktop Chrome exposes navigator.share and must
   * not be handed the OS sheet. This function, which does the same job for a
   * clan invite and a challenge, was left testing whether the API merely
   * exists. So on a desktop it handed the invite to a system dialog that does
   * not appear, and Invite on X did nothing at all, silently, exactly as the
   * run share used to.
   *
   * Fixing one of two functions that share a failure is not fixing it. Both now
   * ask the same question: does this person share through a sheet, and is the
   * click still live.
   */
  const wantsSheet = matchesTouch() && Boolean(navigator.share);

  if (!wantsSheet || !activated()) {
    openIntent(text, linkUrl);
    return;
  }

  try {
    await navigator.share({ text, url: linkUrl });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    openIntent(text, linkUrl);
  }
}

/**
 * Turn the drawn card into a File, ahead of time.
 *
 * Called when the results screen is built rather than when Share is clicked,
 * because the conversion is async and the click cannot afford to await. See
 * shareRun.
 */
export async function cardFile(dataUrl: string | null, date: string): Promise<File | null> {
  if (!dataUrl) return null;
  return toFile(dataUrl, `sface-${date}.png`);
}

async function toFile(dataUrl: string, name: string): Promise<File | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: 'image/png' });
  } catch {
    return null;
  }
}
