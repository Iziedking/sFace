/**
 * The receipts. Real posts about the thing this game is about.
 *
 * The opening makes a claim: crypto is having a bad year and somebody has to
 * save face. That claim is either evidenced or it is a mood, and a game whose
 * whole premise is "the market builds the level" cannot afford to be a mood.
 * So the opening carries actual posts from actual people, each one a link to
 * the original.
 *
 * ## The rule these live under
 *
 * Every row is a screenshot of a real post plus a link to that exact post. No
 * row carries a sentence written here about what the post says, because a
 * paraphrase of somebody's words is a thing they did not write with their name
 * on it. The image is theirs and the link goes to the source, so anybody can
 * check in one tap that we did not put words in a stranger's mouth.
 *
 * The handle is taken from the URL rather than transcribed, so it cannot drift
 * from where the link actually goes.
 *
 * ## Two at a time
 *
 * All ten on one screen is a wall nobody reads. Two is a glance, and because
 * the pair is drawn fresh on every load, somebody who opens the game a handful
 * of times over a day sees most of them without ever being shown a list.
 */

export interface CollapsePost {
  /** Handle without the @, exactly as it appears in the post URL. */
  handle: string;
  /** The post itself. Opened in a new tab, never embedded. */
  url: string;
  /**
   * Screenshot in public/x_post, named for the handle so the pair is obvious.
   *
   * WebP, resized to 800 wide. The originals were PNGs totalling 3.3MB, all of
   * it downloaded on first load whether a given post was drawn or not, to fill
   * a card that is never more than about 370 across. At quality 88 the text is
   * still sharp under inspection and the set comes to under a megabyte.
   */
  image: string;
}

export const COLLAPSE_POSTS: readonly CollapsePost[] = [
  {
    handle: 'AnonVee_',
    url: 'https://x.com/AnonVee_/status/2081646863875264814',
    image: '/x_post/anonvee.webp',
  },
  {
    handle: 'JonamKnight',
    url: 'https://x.com/JonamKnight/status/2081369191203148148',
    image: '/x_post/jonamknight.webp',
  },
  {
    handle: 'wyckoffweb',
    url: 'https://x.com/wyckoffweb/status/2081345717256212943',
    image: '/x_post/wyckoffweb.webp',
  },
  {
    handle: 'AshCrypto',
    url: 'https://x.com/AshCrypto/status/2080220062284222698',
    image: '/x_post/ashcrypto.webp',
  },
  {
    handle: 'stobixcom',
    url: 'https://x.com/stobixcom/status/2082061098061095067',
    image: '/x_post/stobixcom.webp',
  },
  {
    handle: 'sidrevocx',
    url: 'https://x.com/sidrevocx/status/2080767684703047788',
    image: '/x_post/sidrevocx.webp',
  },
  {
    handle: 'jfgrissom',
    url: 'https://x.com/jfgrissom/status/2081938954086211941',
    image: '/x_post/jfgrissom.webp',
  },
  {
    handle: 'JunoCrypto3',
    url: 'https://x.com/JunoCrypto3/status/2082547347465322644',
    image: '/x_post/junocrypto3.webp',
  },
  {
    handle: 'crypto_first21',
    url: 'https://x.com/crypto_first21/status/2082322044839202893',
    image: '/x_post/crypto_first21.webp',
  },
  {
    handle: 'KryptoBeard13',
    url: 'https://x.com/KryptoBeard13/status/2081751117072048608',
    image: '/x_post/kryptobeard13.webp',
  },
];

/** How many are shown at once. See the note at the top on why it is two. */
export const POSTS_SHOWN = 2;

/**
 * Two of them, drawn fresh.
 *
 * Deliberately NOT seeded off the daily mission. Everything else in this game
 * is the same for everybody on a given day, on purpose, because scores are
 * compared. These are not scored and not compared, so they are the one place a
 * genuine reroll costs nothing and buys a reason to look twice.
 *
 * Drawn without replacement, or the same post can appear beside itself.
 */
export function pickPosts(count = POSTS_SHOWN): CollapsePost[] {
  const pool = [...COLLAPSE_POSTS];
  const picked: CollapsePost[] = [];

  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(...pool.splice(index, 1));
  }

  return picked;
}
