export interface AtlasHowToPlayStep {
  readonly number: string;
  readonly label: string;
  readonly title: string;
  readonly copy: string;
}

export interface AtlasHowToPlayPath {
  readonly label: string;
  readonly title: string;
  readonly copy: string;
}

export interface AtlasNimiqBridge {
  readonly label: string;
  readonly meaning: string;
}

export const ATLAS_HOW_TO_PLAY_STEPS: readonly AtlasHowToPlayStep[] = Object.freeze([
  { number: '01', label: 'CHOOSE', title: 'Pick a path', copy: 'Explorer uses the world. Builder repairs it.' },
  { number: '02', label: 'WALK', title: 'Find the need', copy: 'Move through the district until a person or system needs help.' },
  { number: '03', label: 'CHECK', title: 'Check before you approve', copy: 'Confirm who gets the NIM and the exact amount. Then approve it yourself.' },
  { number: '04', label: 'CHANGE', title: 'See the result', copy: 'The district improves when the right evidence is complete.' },
]);

export const ATLAS_HOW_TO_PLAY_PATHS: readonly AtlasHowToPlayPath[] = Object.freeze([
  { label: 'EXPLORER', title: 'Use the network', copy: 'Walk Mara\'s shop, review a NIM payment, and reopen the harbor.' },
  { label: 'BUILDER', title: 'Repair the network', copy: 'Keep permission, the exact payment, and network proof as separate steps.' },
]);

export const ATLAS_NIMIQ_BRIDGE: readonly AtlasNimiqBridge[] = Object.freeze([
  { label: 'NIM', meaning: 'the money used for the payment in this mission' },
  { label: 'LUNAS', meaning: 'Lunas are the smallest units of NIM. 1 NIM = 100,000 Lunas, so 0.1 NIM = 10,000 Lunas.' },
  { label: 'NIMIQ PAY', meaning: 'shows who will receive the NIM and how much, then asks for your permission' },
  { label: 'CONFIRM', meaning: 'a current network record must match the person and amount before the game unlocks' },
]);

export const ATLAS_PAYMENT_VERBS = Object.freeze(['Ask', 'Check', 'Approve', 'Confirm', 'Unlock']);

export const ATLAS_HOW_TO_PLAY_SNAPSHOTS = Object.freeze([
  { src: '/atlas/screenshots/atlas-390-pay-harbor.png', alt: 'Pay Harbor scene with Mara\'s first mission', caption: 'The need' },
  { src: '/atlas/screenshots/atlas-430-payment-review.png', alt: 'Nimiq Pay request review showing network, recipient, and Lunas', caption: 'The check' },
  { src: '/atlas/screenshots/atlas-390-welcome.png', alt: 'NIM Atlas welcome screen with Explorer and Builder paths', caption: 'The choice' },
]);
