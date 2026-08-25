import type { AtlasRole } from './types';

export interface AtlasPrologueRole {
  id: AtlasRole;
  title: string;
  description: string;
  nextDestination: string;
}

export const ATLAS_PROLOGUE = Object.freeze({
  id: 'pay-harbor-welcome',
  guide: {
    id: 'mara',
    name: 'Mara',
    title: 'Harbor keeper',
    need: 'The harbor lantern is out. Mara needs one safe payment route restored before the evening market opens.',
  },
  nextDestination: { label: 'Pay Harbor', description: 'Walk to the shop, learn what a NIM payment asks for, and help Mara relight the harbor.' },
  roles: [
    { id: 'explorer', title: 'Explorer', description: 'Walk through the shop and payment moment as a real user.', nextDestination: 'Pay Harbor' },
    { id: 'builder', title: 'Builder', description: 'Repair the provider and verification path that makes the payment work.', nextDestination: 'Pay Harbor' },
  ] satisfies AtlasPrologueRole[],
});
