/*
 * Every colour in the Atlas world, defined once.
 *
 * Before this file the same values were written out in four places:
 * three/palette.ts, three-renderer.ts, pixi-renderer.ts and renderer.ts. That
 * is how the palette drifted the first time, and it is why recolouring the
 * world used to mean finding fifty literals by hand.
 *
 * The eight keys under "material names" are GLB material names, declared by
 * art/atlas/characters/atlas-walker-v1/character-spec.json and emitted into
 * every character GLB. prepareRuntimeMaterials and the crowd wardrobe below
 * look materials up by those names, so renaming one desyncs the runtime from
 * the shipped art. Add keys freely; rename none. atlas-palette.test.ts asserts
 * the eight against the spec file.
 *
 * Two of them had already drifted when this module was written: the old map
 * carried skin as 0xd9a27f and skinShadow as 0xb97758 against the spec's
 * 0xc98c68 and 0xa7684f, and it named 0x292725 "charcoal" when the art calls it
 * "workwear" — a name no GLB material could ever match. Neither was visible
 * because the map they lived in had no consumers at all.
 */
export const ATLAS_WORLD_PALETTE = Object.freeze({
  // Material names, mirrored from character-spec.json.
  skin: 0xc98c68,
  skinShadow: 0xa7684f,
  ink: 0x14110e,
  workwear: 0x292725,
  cream: 0xf4ede0,
  orange: 0xff5a1f,
  seafoam: 0x8fb3a8,
  leather: 0x65513b,

  // Environment surfaces.
  paper: 0xeadfc8,
  water: 0x8fc8c2,
  plant: 0x6f8e6e,

  // Atmosphere.
  sky: 0xf4ede0,
  haze: 0xe7e4da,
  ambientLight: 0xfff8ed,
  sunLight: 0xffd3a8,

  // Restoration signals and lantern stations.
  restorationEmitter: 0xf28b30,
  guidanceEmitter: 0xffd36a,
  lanternUnlit: 0x8f8777,
  lanternLit: 0xf2c15f,
  lanternComplete: 0x82b9b1,
  lanternMast: 0x746653,
  lanternMastComplete: 0x4f746f,
  lanternPedestal: 0x9a876f,
  stationWarm: 0xe08a38,
  stationDim: 0x70675c,
  stationGold: 0xd6b56c,
});

export type AtlasWorldColour = keyof typeof ATLAS_WORLD_PALETTE;

export function worldColourCss(name: AtlasWorldColour): string {
  return `#${ATLAS_WORLD_PALETTE[name].toString(16).padStart(6, '0')}`;
}

/*
 * Crowd wardrobe.
 *
 * Each variant overrides GLB material colours by name, which is why the keys
 * here are material names and not free-form labels: prepareRuntimeMaterials
 * matches them against the material it is tinting. A key that is not a material
 * name is silently ignored, so these are asserted against the spec too.
 */
export const ATLAS_CITIZEN_WARDROBE = Object.freeze([
  Object.freeze({ orange: '#2f7890', workwear: '#d4d9cf', seafoam: '#e08a38', ink: '#2c2530' }),
  Object.freeze({ orange: '#bd5b32', workwear: '#3f5364', seafoam: '#d8bd73', ink: '#30252a' }),
  Object.freeze({ orange: '#477c62', workwear: '#a8b6a8', seafoam: '#cf7840', ink: '#26333a' }),
  Object.freeze({ orange: '#d18b37', workwear: '#5b6674', seafoam: '#78a7a1', ink: '#282631' }),
]);

/*
 * The 2D canvas fallback's illustration palette.
 *
 * Separate from ATLAS_WORLD_PALETTE on purpose. That map's material keys are
 * GLB material names and changing one changes the shipped art; these are
 * drawing colours for a flat illustration of the same world and answer to
 * nothing but that renderer. Same file, so the palette is still in one place.
 */
export const ATLAS_FALLBACK_PALETTE = Object.freeze({
  line: '#171411',
  ground: '#f4ede0',
  groundDim: '#c9bdac',
  groundBuilder: '#e1e6df',
  groundRaised: '#eadfc8',
  sandLight: '#e8dfcf',
  sandWarm: '#e5d0a7',
  sandDeep: '#d5c7aa',
  active: '#f28b30',
  activeDim: '#c67832',
  relayScanned: '#f6c85f',
  beaconGold: '#d6a649',
  muted: '#6d6256',
  settled: '#5b8f68',
  rescued: '#5bb98c',
  selection: '#4e7f9f',
  warn: '#d55238',
  builderPath: '#b9c79a',
  foliageLight: '#c8d3b0',
  foliageMid: '#a7b889',
  waterLight: '#b8ced9',
  waterDeep: '#4e9ccf',
  routeQuiet: '#8a9295',
  stone: '#a9a092',
  slate: '#53626b',
  skinWarm: '#d6a77d',
  clay: '#8f493c',
  timber: '#6f5338',
  timberDark: '#3a251c',
  shadow: '#25201b',
});

export type AtlasFallbackColour = keyof typeof ATLAS_FALLBACK_PALETTE;
