/**
 * The room's rules, shared by the screen and the service.
 *
 * Imported by both sides for the same reason src/data/contests.ts is: a limit
 * the client enforces and a limit the service enforces have to be the same
 * number, or the field lets somebody type a message that is then refused.
 *
 * It lives here rather than in server/chat.ts because that file reaches for
 * node:crypto to make ids, and importing it from the client pulled a Node
 * builtin into the browser bundle. The build refused it, which was the right
 * answer: the client has no business importing the service.
 */

/**
 * Longest a single message may be.
 *
 * Long enough to offer a clan seat or name a stake, short enough that a room
 * stays readable on a phone and nobody can push the conversation off screen
 * with one post.
 */
export const MAX_MESSAGE = 240;

/**
 * Whether a character is one a message has no business carrying.
 *
 * ## Why this counts code points instead of using a pattern
 *
 * The obvious version is a character class, and writing one meant putting the
 * characters into the source. Two attempts left a literal NUL byte in this
 * file: it compiled both times, and a file about removing invisible characters
 * is the last place one should be hiding. Comparing numbers has no such
 * failure mode and reads as what it is.
 *
 * C0 and C1 are the ordinary control ranges, replaced with a space so words
 * either side of one do not run together.
 *
 * The rest are the bidirectional overrides, and they are the interesting case:
 * they reorder the text around them, so a message can rearrange the line it is
 * sitting in. This is the only screen in the app that shows what a stranger
 * typed, so they are dropped rather than spaced.
 */
function classify(code: number): 'keep' | 'space' | 'drop' {
  if (code < 0x20) return 'space';
  if (code >= 0x7f && code <= 0x9f) return 'space';

  // LEFT-TO-RIGHT MARK, RIGHT-TO-LEFT MARK.
  if (code === 0x200e || code === 0x200f) return 'drop';
  // The embedding and override block, including POP DIRECTIONAL FORMATTING.
  if (code >= 0x202a && code <= 0x202e) return 'drop';
  // The isolates: FIRST STRONG, LEFT-TO-RIGHT, RIGHT-TO-LEFT, POP.
  if (code >= 0x2066 && code <= 0x2069) return 'drop';

  return 'keep';
}

/**
 * An invite somebody pasted into the room.
 *
 * ## Why only our own links, and why nothing else is ever a link
 *
 * The room is the one screen in this app that shows what a stranger typed, and
 * turning arbitrary text into something tappable is how a room full of
 * strangers becomes a delivery mechanism. So no URL in a message ever becomes a
 * link. Not one.
 *
 * The single exception is an sFace invite on this app's own origin, which
 * becomes a button that goes to a screen inside the app rather than out to the
 * web. It is checked by parsing the URL and comparing the origin, never by
 * looking for the origin inside the string: `https://evil.example/?x=sface.site`
 * contains our host and is not our host.
 *
 * Everything else, including a link to somewhere real and useful, stays as
 * plain text that the reader can decide about themselves.
 */
export interface Invite {
  kind: 'contest' | 'challenge';
  id: string;
}

export function findInvite(text: string, origin: string): Invite | null {
  if (origin.length === 0) return null;

  for (const token of text.split(/\s+/)) {
    if (!token.startsWith('http://') && !token.startsWith('https://')) continue;

    let url: URL;
    try {
      url = new URL(token);
    } catch {
      continue;
    }

    // The parsed origin, not a substring of the text.
    if (url.origin !== new URL(origin).origin) continue;

    const contest = url.searchParams.get('contest');
    if (contest) return { kind: 'contest', id: contest };

    const challenge = url.searchParams.get('c');
    if (challenge) return { kind: 'challenge', id: challenge };

    // The routed forms, /contest/<id> and /challenge/<id>.
    const match = /^\/(contest|challenge)\/([^/]+)$/.exec(url.pathname);
    if (match) return { kind: match[1] as Invite['kind'], id: decodeURIComponent(match[2]!) };
  }

  return null;
}

/**
 * Clean a message down to the text it claims to be.
 *
 * Shared so the count in the field and the count on the service agree. A client
 * that measured raw input while the service measured the tidied version would
 * refuse messages that looked fine in the box.
 */
export function tidyMessage(raw: string): string {
  let out = '';

  for (const character of raw) {
    const verdict = classify(character.codePointAt(0) ?? 0);
    if (verdict === 'drop') continue;
    out += verdict === 'space' ? ' ' : character;
  }

  // Any run of whitespace, so nobody posts forty blank lines to clear the room.
  return out.replace(/\s+/g, ' ').trim();
}
