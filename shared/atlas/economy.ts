/**
 * Nimiq monetary facts used by the Atlas game contract.
 *
 * The provider and chain APIs use integer Lunas. Keeping these values in one
 * shared module prevents the client review screen, server catalog, and replay
 * lesson from drifting apart.
 */
export const ATLAS_LUNAS_PER_NIM = 100_000;
export const ATLAS_LANTERN_PRICE_LUNA = 10_000;
export const ATLAS_LANTERN_PRICE_NIM = '0.1';
export const ATLAS_FIRST_SEASON_ALLOCATION_LUNA = 5_000_000_000;
export const ATLAS_FIRST_SEASON_ALLOCATION_NIM = 50_000;
