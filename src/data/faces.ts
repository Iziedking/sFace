/**
 * The faces you are there to rescue.
 *
 * These are archetypes, not real people, and that is deliberate. Everyone will
 * recognise the type without anyone being named, which is funnier and is the
 * only version that is safe to ship. Do not swap these for real names or
 * likenesses.
 *
 * Each quirk changes how you play around that face, so rescuing five of them
 * feels different from rescuing the same one five times. The quirk is the
 * design, the joke is the wrapping.
 */

export type FaceQuirk =
  | 'heavy'        // slows the player while carried
  | 'talker'       // pauses mid-flight, you have to wait
  | 'paranoid'     // will not move while attackers are near
  | 'skittish'     // follows only if you have held fire recently
  | 'mercenary';   // frees himself halfway, then wants a cut

export interface FaceDef {
  id: string;
  name: string;
  /** One line shown on pickup. Dry, not winking. */
  line: string;
  quirk: FaceQuirk;
  /** Base score for a successful extraction. */
  bounty: number;
  /** Rough spawn weight, higher means more common. */
  weight: number;
}

export const FACES: readonly FaceDef[] = [
  {
    id: 'exchange-king',
    name: 'The Exchange King',
    line: 'My jet is already running.',
    quirk: 'heavy',
    bounty: 300,
    weight: 3,
  },
  {
    id: 'ethereal-founder',
    name: 'The Ethereal Founder',
    line: 'Hold on, I have not finished the point about scaling.',
    quirk: 'talker',
    bounty: 250,
    weight: 3,
  },
  {
    id: 'cold-storage',
    name: 'Madam Cold Storage',
    line: 'I am not moving until that route is clear.',
    quirk: 'paranoid',
    bounty: 400,
    weight: 2,
  },
  {
    id: 'whitepaper-prophet',
    name: 'The Whitepaper Prophet',
    line: 'It is all in the document. Nobody read the document.',
    quirk: 'skittish',
    bounty: 350,
    weight: 2,
  },
  {
    id: 'market-maker',
    name: 'The Last Market Maker',
    line: 'I can get myself out. My fee is separate.',
    quirk: 'mercenary',
    bounty: 500,
    weight: 1,
  },
  /*
   * Three added when the cast went from five to eight.
   *
   * These only ever appear when the X read failed, so they are the shape of the
   * game rather than the content of a day. Same rule as the five above: a type
   * anybody would recognise, one dry line, and nothing that could be read as
   * being about a specific real person.
   */
  {
    id: 'airdrop-farmer',
    name: 'The Airdrop Farmer',
    line: 'Fourteen months of this and it vests over two years.',
    quirk: 'skittish',
    bounty: 300,
    weight: 3,
  },
  {
    id: 'liquidated-whale',
    name: 'The Liquidated Whale',
    line: 'It was not leverage. It was conviction, at five times.',
    quirk: 'heavy',
    bounty: 450,
    weight: 2,
  },
  {
    id: 'permanent-bull',
    name: 'The Permanent Bull',
    line: 'This is the bottom. I have said that four times and I meant it each time.',
    quirk: 'talker',
    bounty: 280,
    weight: 3,
  },
];

/** Weighted pick, driven by the seeded RNG so every client agrees. */
export function pickFace(roll: number): FaceDef {
  const total = FACES.reduce((sum, f) => sum + f.weight, 0);
  let target = roll * total;
  for (const face of FACES) {
    target -= face.weight;
    if (target <= 0) return face;
  }
  return FACES[0];
}
