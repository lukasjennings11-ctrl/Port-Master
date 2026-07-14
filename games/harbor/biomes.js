/* HARBOR — selectable backdrops, presented as unlockable WORLDS. window.HARBOR_BIOMES
 * Each biome re-skins terrain/landforms/water/sky/light/vegetation + a climate-matched
 * building style (`build`); gameplay is identical. Worlds unlock sequentially by progression
 * (`unlockEra`/`unlockLabel`); HARBOR_BIOME_ORDER is the progression order (green first).
 * Phase 15c: `unlockEra` now only gates ELIGIBILITY for discovery (game.js's Uncharted Waters
 * expedition) — reaching that era no longer unlocks the world for free; the player must pay to
 * chart it. `unlockLabel` is the locked-tap hint shown on the biome-select bar.
 * Colours are linear-ish (tonemapped at render). Phase 19a PAPERCRAFT REBOOT: the 16b candy
 * saturation is inverted into a MATTE CONSTRUCTION-PAPER deck — every stop desaturated 30–45%
 * with a warm paper bias (kraft browns, felt greens, muted brick, sand card, denim blue), and
 * every shadowTint pulled from chromatic blue toward a neutral grey-mauve paper shadow. Each
 * world keeps its identity as a different STACK OF CARD: green isles = olive/kraft, desert =
 * sand card, nordic = grey-blue felt, tropical = warm leaf, mountain = slate card.
 */
(function (g) {
  g.HARBOR_BIOMES = {
    green: {
      id: 'green', name: 'Green Isles', unlockEra: 0, unlockLabel: 'Starting world',
      ground: [0.33, 0.42, 0.23], hill: [0.27, 0.34, 0.21], hillType: 'hill', snow: false,
      deep: [0.13, 0.23, 0.34], shallow: [0.32, 0.48, 0.52],
      shadowTint: [0.62, 0.60, 0.76],   // neutral grey-mauve paper shadow (19a — was chromatic blue)
      skyTop: [0.48, 0.62, 0.82], skyBot: [0.86, 0.90, 0.92], sun: [0.76, 0.71, 0.62], fog: [0.84, 0.85, 0.81], veg: 'tree', vegN: 26, hilliness: 1.0, beach: [0.80, 0.71, 0.53],
      build: { wall: [[0.70, 0.44, 0.36], [0.80, 0.62, 0.38], [0.78, 0.72, 0.60], [0.56, 0.62, 0.70], [0.86, 0.78, 0.60]], roof: [0.62, 0.32, 0.26], roofStyle: 'pitch', trim: [0.94, 0.91, 0.84] }
    },
    mountain: {
      id: 'mountain', name: 'Mountain Fjord', unlockEra: 1, unlockLabel: 'Trading Post era — chart it via Uncharted Waters',
      ground: [0.33, 0.39, 0.26], hill: [0.40, 0.42, 0.47], hillType: 'mountain', snow: true,
      deep: [0.12, 0.17, 0.26], shallow: [0.27, 0.36, 0.42],
      shadowTint: [0.58, 0.58, 0.74],   // neutral grey-mauve paper shadow (19a)
      skyTop: [0.46, 0.58, 0.74], skyBot: [0.84, 0.87, 0.90], sun: [0.68, 0.68, 0.71], fog: [0.80, 0.82, 0.83], veg: 'pine', vegN: 30, hilliness: 2.4, beach: [0.72, 0.70, 0.66],
      build: { wall: [[0.58, 0.44, 0.32], [0.66, 0.52, 0.38], [0.48, 0.38, 0.29], [0.78, 0.73, 0.66]], roof: [0.34, 0.30, 0.28], roofStyle: 'pitch', trim: [0.74, 0.42, 0.34] }
    },
    desert: {
      id: 'desert', name: 'Desert Coast', unlockEra: 2, unlockLabel: 'Industrial era — chart it via Uncharted Waters',
      ground: [0.66, 0.52, 0.33], hill: [0.58, 0.44, 0.29], hillType: 'mesa', snow: false,
      deep: [0.15, 0.26, 0.31], shallow: [0.37, 0.50, 0.47],
      shadowTint: [0.68, 0.58, 0.72],   // neutral grey-mauve paper shadow (19a, a touch warm for sand card)
      skyTop: [0.55, 0.66, 0.80], skyBot: [0.92, 0.85, 0.70], sun: [0.78, 0.70, 0.57], fog: [0.86, 0.80, 0.66], veg: 'none', vegN: 0, hilliness: 1.5, beach: [0.80, 0.70, 0.50],
      build: { wall: [[0.84, 0.70, 0.52], [0.78, 0.62, 0.44], [0.74, 0.54, 0.40], [0.86, 0.74, 0.56]], roof: [0.70, 0.46, 0.32], roofStyle: 'flat', trim: [0.90, 0.84, 0.68] }
    },
    tropical: {
      id: 'tropical', name: 'Tropical', unlockEra: 3, unlockLabel: 'Metropolis era — chart it via Uncharted Waters',
      ground: [0.33, 0.46, 0.22], hill: [0.26, 0.38, 0.20], hillType: 'hill', snow: false,
      deep: [0.15, 0.31, 0.34], shallow: [0.38, 0.56, 0.51],
      shadowTint: [0.58, 0.63, 0.74],   // neutral grey-mauve paper shadow (19a)
      skyTop: [0.44, 0.64, 0.80], skyBot: [0.88, 0.92, 0.90], sun: [0.77, 0.72, 0.62], fog: [0.84, 0.87, 0.83], veg: 'palm', vegN: 24, hilliness: 0.8, beach: [0.84, 0.76, 0.56],
      build: { wall: [[0.90, 0.86, 0.78], [0.86, 0.66, 0.54], [0.56, 0.72, 0.68], [0.86, 0.74, 0.44]], roof: [0.38, 0.48, 0.54], roofStyle: 'hip', trim: [0.38, 0.58, 0.54] }
    },
    nordic: {
      id: 'nordic', name: 'Nordic Cliffs', unlockEra: 4, unlockLabel: 'Megaport era — chart it via Uncharted Waters',
      ground: [0.35, 0.39, 0.39], hill: [0.42, 0.45, 0.49], hillType: 'cliff', snow: true,
      deep: [0.12, 0.155, 0.22], shallow: [0.26, 0.33, 0.38],
      shadowTint: [0.56, 0.58, 0.74],   // neutral grey-mauve paper shadow (19a)
      skyTop: [0.50, 0.58, 0.70], skyBot: [0.84, 0.86, 0.88], sun: [0.66, 0.67, 0.71], fog: [0.78, 0.80, 0.82], veg: 'pine', vegN: 22, hilliness: 2.0, beach: [0.68, 0.68, 0.66],
      build: { wall: [[0.55, 0.59, 0.64], [0.64, 0.66, 0.68], [0.46, 0.50, 0.55], [0.76, 0.72, 0.66]], roof: [0.28, 0.31, 0.36], roofStyle: 'pitch', trim: [0.87, 0.87, 0.88] }
    }
  };
  g.HARBOR_BIOME_ORDER = ['green', 'mountain', 'desert', 'tropical', 'nordic'];
})(window);
