import type { AtlasDistrictId } from './types';

export type AtlasStorySpeaker = 'mara' | 'atlas' | 'nia' | 'oren' | 'tala' | 'ivo' | 'ada';

export interface AtlasVoiceLine {
  readonly speaker: AtlasStorySpeaker;
  readonly locale: 'en-US';
  readonly text: string;
}

export interface AtlasStoryChapter {
  readonly chapter: number;
  readonly districtId: AtlasDistrictId;
  readonly title: string;
  readonly guide: string;
  readonly humanNeed: string;
  readonly lesson: string;
  readonly storyBeat: string;
  readonly mission: string;
  readonly consequence: string;
  readonly clue: string;
  readonly reveal: string;
  readonly voice: { readonly arrival: AtlasVoiceLine; readonly completion: AtlasVoiceLine };
}

export interface AtlasHubDispatch {
  readonly id: string;
  readonly title: string;
  readonly chapterId: AtlasDistrictId;
  readonly hook: string;
  readonly objective: string;
  readonly lesson: string;
  readonly rewardCopy: string;
}

export const ATLAS_STORY = {
  title: 'The Thread That Binds',
  logline: 'Six districts have forgotten how to trust one another. Help their people, restore the Network Beacon, and discover the one thing no machine can provide.',
  opening: 'The Beacon did not break. Its six threads stopped listening to one another. Mara needs a witness who can follow each thread from a human need to a verified result.',
  finale: 'The missing piece was never another relay. It was the witness who knows when to ask, check, approve, confirm, and unlock.',
  hubName: 'Atlas Dispatch',
  dailyLoop: 'Take one field job, solve one real Nimiq idea, change one visible place, and return to the hub to see the community signal grow.',
} as const;

const voice = (speaker: AtlasStorySpeaker, text: string): AtlasVoiceLine => ({ speaker, locale: 'en-US', text });

export const ATLAS_STORY_CHAPTERS: readonly AtlasStoryChapter[] = [
  {
    chapter: 1,
    districtId: 'genesis-garden',
    title: 'The First Spark',
    guide: 'Mara',
    humanNeed: 'A child is waiting to send a birthday gift, but the request is written in numbers nobody can read.',
    lesson: 'NIM is the currency. Lunas are its smaller units. An address names where value should arrive.',
    storyBeat: 'The player turns a confusing request into a promise the garden can understand.',
    mission: 'Find the right amount, destination, and account before the garden courier leaves.',
    consequence: 'The birthday path lights from the sender to the correct home.',
    clue: 'The first thread carries a name, a unit, and a destination.',
    reveal: 'Value becomes useful when people can read what it means.',
    voice: { arrival: voice('mara', 'The first thread is small, but it carries someone\'s whole promise. Make the value readable.'), completion: voice('atlas', 'The garden understands the request. One clear unit can move a world forward.') },
  },
  {
    chapter: 2,
    districtId: 'light-forest',
    title: 'The Path That Waits',
    guide: 'Nia',
    humanNeed: 'Nia needs the clinic path lit before her family walks home through the forest.',
    lesson: 'A useful network view must be current before a player acts on it.',
    storyBeat: 'The forest teaches patience. A bright answer from an old view can still lead people the wrong way.',
    mission: 'Read provider readiness, consensus, and block height, then reconnect the canopy only from a usable view.',
    consequence: 'A safe green route appears between the homes and the clinic.',
    clue: 'The second thread does not ask for speed. It asks whether the view is fresh.',
    reveal: 'Knowing when to wait is part of knowing how to move.',
    voice: { arrival: voice('nia', 'The clinic is close, but the forest signal is old. Check the view before you promise a path.'), completion: voice('atlas', 'The canopy is lit from a living view. Patience just became protection.') },
  },
  {
    chapter: 3,
    districtId: 'pay-harbor',
    title: 'The Last Lantern',
    guide: 'Mara',
    humanNeed: 'Mara needs one exact payment to relight the harbor and bring the night ferries home.',
    lesson: 'Nimiq Pay keeps the player in control. Review the network, recipient, amount, and approval before the wallet acts.',
    storyBeat: 'The player learns that asking a wallet and receiving a receipt are not the same as confirmed delivery.',
    mission: 'Inspect the lantern, review 0.1 NIM, approve only with explicit intent, then wait for network evidence.',
    consequence: 'The lantern is carried to the tower, the market opens, and the harbor signal returns.',
    clue: 'The third thread glows only when consent and evidence agree.',
    reveal: 'A payment is a promise between people, not a button press.',
    voice: { arrival: voice('mara', 'Pay Harbor is dark. Help me make one careful payment, then wait until the network tells us it arrived.'), completion: voice('mara', 'The harbor is open again. You did not trust a button. You checked the promise.') },
  },
  {
    chapter: 4,
    districtId: 'albatross-causeway',
    title: 'The Crossing That Must Wait',
    guide: 'Oren',
    humanNeed: 'Oren needs medicine escorted across the causeway without telling a family it arrived before it is safe.',
    lesson: 'A lookup, inclusion, confirmation, and finality are different moments in a transaction journey.',
    storyBeat: 'The ferry refuses to move for a hash alone. The player must read the evidence in order.',
    mission: 'Sort the receipt states and release the ferry only when sender, recipient, amount, success, and confirmations match.',
    consequence: 'The medicine ferry crosses and the causeway signal turns white.',
    clue: 'The fourth thread is a clock with more than one honest answer.',
    reveal: 'Good systems know the difference between started and safe.',
    voice: { arrival: voice('oren', 'The receipt says something happened. It does not yet say the medicine is safe to deliver. Walk the evidence forward.'), completion: voice('atlas', 'The crossing is final enough to trust. The family can be told the truth.') },
  },
  {
    chapter: 5,
    districtId: 'validator-peaks',
    title: 'Many Hands',
    guide: 'Tala',
    humanNeed: 'Tala needs the mountain signal spread across more than one operator so every village keeps a route.',
    lesson: 'Validators produce and check blocks. Delegation lets more people participate, while distribution strengthens resilience.',
    storyBeat: 'The player sees that a network can be busy and still be fragile if one peak carries every signal.',
    mission: 'Read validator and delegation signals, then choose the safer distributed route without authorizing a stake change.',
    consequence: 'Three mountain beacons pulse instead of one overloaded tower.',
    clue: 'The fifth thread is stronger when it has many hands.',
    reveal: 'Resilience is a community shape, not a single hero.',
    voice: { arrival: voice('tala', 'One mountain is shouting for every village. Read the shape of the network before you choose its safest route.'), completion: voice('atlas', 'The peaks are sharing the work. A stronger network leaves room for more than one answer.') },
  },
  {
    chapter: 6,
    districtId: 'builder-city',
    title: 'The Door That Asks',
    guide: 'Ivo',
    humanNeed: 'Ivo needs a neighborhood service that stays useful even when a wallet is unavailable or a player says no.',
    lesson: 'A Mini App asks the host for capabilities. The player chooses sensitive actions, and keys stay in the wallet.',
    storyBeat: 'The player repairs a service that reads locally first, asks clearly, and recovers honestly.',
    mission: 'Compose provider initialization, read access, signing, consent, and recovery without hiding a wallet prompt.',
    consequence: 'The city kiosk serves practice offline and explains every capability it cannot provide.',
    clue: 'The sixth thread is a door that opens only when someone chooses it.',
    reveal: 'Good technology makes room for a no.',
    voice: { arrival: voice('ivo', 'A service should not grab a key just because you opened the door. Help me make every request earn its moment.'), completion: voice('atlas', 'The kiosk is honest now. It can help, ask, wait, and recover without pretending.') },
  },
  {
    chapter: 7,
    districtId: 'beacon-core',
    title: 'The Witness Mark',
    guide: 'Ada',
    humanNeed: 'The whole Atlas community needs one signal that separates practice, promise, proof, and change.',
    lesson: 'The complete Nimiq learning loop is ask, check, approve, confirm, and unlock.',
    storyBeat: 'The six repaired threads converge. The Beacon still waits because a network needs people who can tell the truth about what they saw.',
    mission: 'Assemble every district seal, complete the final teach-back, and prove the route through a replayable skill run.',
    consequence: 'The Network Beacon lights from verified community progress and the Atlas page becomes a shared map.',
    clue: 'The last thread was carried by the player all along.',
    reveal: ATLAS_STORY.finale,
    voice: { arrival: voice('ada', 'You brought back six truths. The Beacon needs one final piece: someone who knows when a promise is proven.'), completion: voice('ada', 'The Atlas is complete. The network is alive because its people know how to witness it.') },
  },
];

const DAILY_DISPATCHES: readonly AtlasHubDispatch[] = [
  { id: 'dispatch-first-spark', title: 'Atlas Dispatch: The Clear Request', chapterId: 'genesis-garden', hook: 'A birthday parcel has the right value but the wrong unit label.', objective: 'Translate the request into NIM, Lunas, and a destination before the courier leaves.', lesson: 'Readable value prevents accidental value.', rewardCopy: 'A correct unassisted replay contributes to the server-verified daily pool. No local answer is a payout.' },
  { id: 'dispatch-living-view', title: 'Atlas Dispatch: The Fresh Signal', chapterId: 'light-forest', hook: 'The clinic path is bright, but the forest view may be old.', objective: 'Check consensus and block height before you relight the safe route.', lesson: 'A current view is part of a safe action.', rewardCopy: 'The hub records reward eligibility only after server replay verification.' },
  { id: 'dispatch-harbor-check', title: 'Atlas Dispatch: The Exact Lantern', chapterId: 'pay-harbor', hook: 'Mara found a duplicate lantern on the harbor bill.', objective: 'Choose one exact 0.1 NIM payment and explain why approval is still the player\'s decision.', lesson: 'Consent and amount checks protect a payment.', rewardCopy: 'Daily hub rewards are skill-based and server-verified, never chance-based.' },
  { id: 'dispatch-crossing-clock', title: 'Atlas Dispatch: The Honest Receipt', chapterId: 'albatross-causeway', hook: 'A family is waiting for medicine, but the receipt has only just appeared.', objective: 'Move the receipt through lookup, inclusion, confirmation, and finality in the correct order.', lesson: 'Started is not the same as safe to deliver.', rewardCopy: 'The client shows pending until the server verifies the replay and closes the daily obligation.' },
  { id: 'dispatch-many-hands', title: 'Atlas Dispatch: The Shared Peak', chapterId: 'validator-peaks', hook: 'One validator beacon is carrying every village signal.', objective: 'Read the distribution and choose the healthier network shape.', lesson: 'Distributed participation supports resilience.', rewardCopy: 'A verified best daily run can contribute to the hub pool under the published rules.' },
  { id: 'dispatch-open-door', title: 'Atlas Dispatch: The Door That Asks', chapterId: 'builder-city', hook: 'Ivo\'s kiosk requests wallet access before it can explain what it needs.', objective: 'Repair the capability order so local practice and consent come before sensitive actions.', lesson: 'A good Mini App makes capability boundaries visible.', rewardCopy: 'Reward status remains estimating or pending until authoritative server checks complete.' },
];

export function getAtlasStoryChapter(districtId: AtlasDistrictId): AtlasStoryChapter | undefined {
  return ATLAS_STORY_CHAPTERS.find((chapter) => chapter.districtId === districtId);
}

export function selectAtlasHubDispatch(date: Date): AtlasHubDispatch {
  const timestamp = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = Math.floor(timestamp / 86_400_000);
  return DAILY_DISPATCHES[((day % DAILY_DISPATCHES.length) + DAILY_DISPATCHES.length) % DAILY_DISPATCHES.length]!;
}
