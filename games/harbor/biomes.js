/* HARBOR — selectable backdrops, presented as unlockable WORLDS. window.HARBOR_BIOMES
 * Each biome re-skins terrain/landforms/water/sky/light/vegetation + a climate-matched
 * building style (`build`); gameplay is identical. Worlds unlock sequentially by progression
 * (`unlockEra`/`unlockLabel`); HARBOR_BIOME_ORDER is the progression order (green first).
 * Colours are linear-ish (tonemapped at render). Bold-cartoon palette: bright & saturated.
 */
(function (g) {
  g.HARBOR_BIOMES = {
    green: {
      id: 'green', name: 'Green Isles', unlockEra: 0, unlockLabel: 'Starting world',
      ground: [0.21, 0.38, 0.14], hill: [0.16, 0.32, 0.13], hillType: 'hill', snow: false,
      deep: [0.04, 0.20, 0.30], shallow: [0.12, 0.46, 0.52],
      shadowTint: [0.62, 0.66, 1.16],   // cool shadow tint (warm-key / cool-shadow ramp)
      skyTop: [0.30, 0.60, 0.94], skyBot: [0.80, 0.92, 1.0], sun: [1.35, 1.24, 1.04], fog: [0.82, 0.91, 0.99], veg: 'tree', vegN: 26, hilliness: 1.0, beach: [0.90, 0.84, 0.62],
      build: { wall: [[0.80, 0.36, 0.30], [0.86, 0.62, 0.34], [0.74, 0.70, 0.58], [0.62, 0.66, 0.72], [0.88, 0.80, 0.62]], roof: [0.58, 0.22, 0.18], roofStyle: 'pitch', trim: [0.95, 0.93, 0.88] }
    },
    mountain: {
      id: 'mountain', name: 'Mountain Fjord', unlockEra: 1, unlockLabel: 'Unlocks: Trading Post era',
      ground: [0.36, 0.46, 0.30], hill: [0.48, 0.50, 0.58], hillType: 'mountain', snow: true,
      deep: [0.05, 0.14, 0.22], shallow: [0.14, 0.30, 0.40],
      shadowTint: [0.58, 0.68, 1.10],   // cool shadow tint (warm-key / cool-shadow ramp)
      skyTop: [0.34, 0.56, 0.84], skyBot: [0.82, 0.90, 0.98], sun: [1.18, 1.18, 1.22], fog: [0.84, 0.90, 0.96], veg: 'pine', vegN: 30, hilliness: 2.4, beach: [0.74, 0.76, 0.74],
      build: { wall: [[0.62, 0.42, 0.28], [0.70, 0.50, 0.32], [0.54, 0.38, 0.26], [0.78, 0.74, 0.68]], roof: [0.34, 0.26, 0.22], roofStyle: 'pitch', trim: [0.86, 0.40, 0.30] }
    },
    desert: {
      id: 'desert', name: 'Desert Coast', unlockEra: 2, unlockLabel: 'Unlocks: Industrial era',
      ground: [0.88, 0.72, 0.42], hill: [0.84, 0.62, 0.36], hillType: 'mesa', snow: false,
      deep: [0.06, 0.30, 0.36], shallow: [0.22, 0.56, 0.56],
      shadowTint: [0.82, 0.60, 1.04],   // cool shadow tint (warm-key / cool-shadow ramp)
      skyTop: [0.42, 0.66, 0.92], skyBot: [1.0, 0.90, 0.70], sun: [1.42, 1.24, 0.90], fog: [0.98, 0.88, 0.70], veg: 'none', vegN: 0, hilliness: 1.5, beach: [0.95, 0.85, 0.60],
      build: { wall: [[0.90, 0.74, 0.52], [0.86, 0.66, 0.44], [0.82, 0.58, 0.40], [0.94, 0.82, 0.62]], roof: [0.74, 0.46, 0.30], roofStyle: 'flat', trim: [0.96, 0.88, 0.72] }
    },
    tropical: {
      id: 'tropical', name: 'Tropical', unlockEra: 3, unlockLabel: 'Unlocks: Metropolis era',
      ground: [0.34, 0.52, 0.22], hill: [0.24, 0.46, 0.22], hillType: 'hill', snow: false,
      deep: [0.0, 0.46, 0.54], shallow: [0.14, 0.78, 0.74],
      shadowTint: [0.56, 0.78, 1.08],   // cool shadow tint (warm-key / cool-shadow ramp)
      skyTop: [0.24, 0.66, 0.96], skyBot: [0.88, 0.97, 1.0], sun: [1.42, 1.30, 1.08], fog: [0.88, 0.97, 1.0], veg: 'palm', vegN: 24, hilliness: 0.8, beach: [0.97, 0.93, 0.74],
      build: { wall: [[0.96, 0.94, 0.90], [0.96, 0.78, 0.66], [0.70, 0.88, 0.86], [0.96, 0.86, 0.50]], roof: [0.40, 0.52, 0.60], roofStyle: 'hip', trim: [0.30, 0.66, 0.66] }
    },
    nordic: {
      id: 'nordic', name: 'Nordic Cliffs', unlockEra: 4, unlockLabel: 'Unlocks: Megaport era',
      ground: [0.44, 0.48, 0.48], hill: [0.52, 0.54, 0.58], hillType: 'cliff', snow: true,
      deep: [0.06, 0.14, 0.20], shallow: [0.16, 0.30, 0.38],
      shadowTint: [0.52, 0.64, 1.14],   // cool shadow tint (warm-key / cool-shadow ramp)
      skyTop: [0.46, 0.58, 0.72], skyBot: [0.82, 0.86, 0.92], sun: [1.10, 1.12, 1.20], fog: [0.80, 0.84, 0.90], veg: 'pine', vegN: 22, hilliness: 2.0, beach: [0.70, 0.72, 0.72],
      build: { wall: [[0.58, 0.60, 0.64], [0.66, 0.66, 0.68], [0.50, 0.52, 0.56], [0.72, 0.70, 0.66]], roof: [0.26, 0.28, 0.32], roofStyle: 'pitch', trim: [0.80, 0.82, 0.86] }
    }
  };
  g.HARBOR_BIOME_ORDER = ['green', 'mountain', 'desert', 'tropical', 'nordic'];
})(window);
