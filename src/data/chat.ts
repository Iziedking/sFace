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
