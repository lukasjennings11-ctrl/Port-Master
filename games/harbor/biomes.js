/* HARBOR — selectable backdrops, presented as unlockable WORLDS. window.HARBOR_BIOMES
 * Each biome re-skins terrain/landforms/water/sky/light/vegetation + a climate-matched
 * building style (`build`); gameplay is identical. Worlds unlock sequentially by progression
 * (`unlockEra`/`unlockLabel`); HARBOR_BIOME_ORDER is the progression order (green first).
 * Phase 15c: `unlockEra` now only gates ELIGIBILITY for discovery (game.js's Uncharted Waters
 * expedition) — reaching that era no longer unlocks the world for free; the player must pay to
 * chart it. `unlockLabel` is the locked-tap hint shown on the biome-select bar.
 * Colours are linear-ish (tonemapped at render). Phase 16b VIBRANT STORYBOOK pass: every stop
 * pushed further toward bold, saturated picture-book colour — lush layered greens, warm ochre
 * sand, punchier rock, and a two-tone postcard sea (rich teal deep -> bright turquoise shallow,
 * see F_WATER's shore-band gradient in gl.js) — while keeping each biome's own identity distinct.
 */
(function (g) {
  g.HARBOR_BIOMES = {
    green: {
      id: 'green', name: 'Green Isles', unlockEra: 0, unlockLabel: 'Starting world',
      ground: [0.20, 0.46, 0.16], hill: [0.13, 0.36, 0.14], hillType: 'hill', snow: false,
      deep: [0.02, 0.24, 0.40], shallow: [0.10, 0.62, 0.66],
      shadowTint: [0.50, 0.56, 1.21],   // cool shadow tint (warm-key / cool-shadow ramp) — Phase 14a: punched wider for storybook confidence
      skyTop: [0.26, 0.58, 0.98], skyBot: [0.78, 0.93, 1.0], sun: [1.40, 1.28, 1.04], fog: [0.82, 0.91, 0.99], veg: 'tree', vegN: 26, hilliness: 1.0, beach: [0.96, 0.86, 0.58],
      build: { wall: [[0.92, 0.30, 0.24], [0.96, 0.64, 0.20], [0.80, 0.76, 0.62], [0.56, 0.68, 0.80], [0.98, 0.86, 0.58]], roof: [0.66, 0.18, 0.16], roofStyle: 'pitch', trim: [0.98, 0.95, 0.90] }
    },
    mountain: {
      id: 'mountain', name: 'Mountain Fjord', unlockEra: 1, unlockLabel: 'Trading Post era — chart it via Uncharted Waters',
      ground: [0.32, 0.48, 0.28], hill: [0.46, 0.50, 0.60], hillType: 'mountain', snow: true,
      deep: [0.03, 0.16, 0.28], shallow: [0.10, 0.36, 0.50],
      shadowTint: [0.46, 0.58, 1.13],   // cool shadow tint (warm-key / cool-shadow ramp) — Phase 14a: punched wider for storybook confidence
      skyTop: [0.30, 0.58, 0.90], skyBot: [0.82, 0.91, 0.99], sun: [1.16, 1.18, 1.24], fog: [0.84, 0.90, 0.96], veg: 'pine', vegN: 30, hilliness: 2.4, beach: [0.78, 0.78, 0.76],
      build: { wall: [[0.64, 0.40, 0.24], [0.74, 0.50, 0.28], [0.50, 0.36, 0.24], [0.84, 0.78, 0.70]], roof: [0.28, 0.24, 0.24], roofStyle: 'pitch', trim: [0.92, 0.32, 0.24] }
    },
    desert: {
      id: 'desert', name: 'Desert Coast', unlockEra: 2, unlockLabel: 'Industrial era — chart it via Uncharted Waters',
      ground: [0.94, 0.70, 0.34], hill: [0.90, 0.56, 0.26], hillType: 'mesa', snow: false,
      deep: [0.04, 0.32, 0.42], shallow: [0.16, 0.64, 0.64],
      shadowTint: [0.77, 0.48, 1.05],   // cool shadow tint (warm-key / cool-shadow ramp) — Phase 14a: punched wider for storybook confidence
      skyTop: [0.36, 0.64, 0.96], skyBot: [1.0, 0.86, 0.60], sun: [1.46, 1.22, 0.82], fog: [0.98, 0.86, 0.64], veg: 'none', vegN: 0, hilliness: 1.5, beach: [0.98, 0.84, 0.52],
      build: { wall: [[0.96, 0.72, 0.44], [0.90, 0.62, 0.36], [0.86, 0.52, 0.32], [0.98, 0.82, 0.54]], roof: [0.80, 0.40, 0.22], roofStyle: 'flat', trim: [0.98, 0.90, 0.68] }
    },
    tropical: {
      id: 'tropical', name: 'Tropical', unlockEra: 3, unlockLabel: 'Metropolis era — chart it via Uncharted Waters',
      ground: [0.28, 0.58, 0.18], hill: [0.18, 0.50, 0.20], hillType: 'hill', snow: false,
      deep: [0.0, 0.50, 0.56], shallow: [0.10, 0.86, 0.78],
      shadowTint: [0.43, 0.71, 1.10],   // cool shadow tint (warm-key / cool-shadow ramp) — Phase 14a: punched wider for storybook confidence
      skyTop: [0.18, 0.68, 0.98], skyBot: [0.86, 0.98, 1.0], sun: [1.44, 1.32, 1.04], fog: [0.88, 0.97, 1.0], veg: 'palm', vegN: 24, hilliness: 0.8, beach: [1.0, 0.94, 0.68],
      build: { wall: [[1.0, 0.96, 0.90], [1.0, 0.72, 0.56], [0.56, 0.90, 0.86], [1.0, 0.86, 0.30]], roof: [0.30, 0.50, 0.62], roofStyle: 'hip', trim: [0.20, 0.70, 0.68] }
    },
    nordic: {
      id: 'nordic', name: 'Nordic Cliffs', unlockEra: 4, unlockLabel: 'Megaport era — chart it via Uncharted Waters',
      ground: [0.40, 0.48, 0.50], hill: [0.48, 0.54, 0.60], hillType: 'cliff', snow: true,
      deep: [0.04, 0.12, 0.24], shallow: [0.12, 0.34, 0.46],
      shadowTint: [0.38, 0.53, 1.18],   // cool shadow tint (warm-key / cool-shadow ramp) — Phase 14a: punched wider for storybook confidence
      skyTop: [0.40, 0.58, 0.78], skyBot: [0.84, 0.88, 0.94], sun: [1.10, 1.14, 1.24], fog: [0.80, 0.84, 0.90], veg: 'pine', vegN: 22, hilliness: 2.0, beach: [0.74, 0.76, 0.76],
      build: { wall: [[0.54, 0.60, 0.68], [0.64, 0.68, 0.72], [0.44, 0.50, 0.58], [0.76, 0.72, 0.66]], roof: [0.20, 0.26, 0.34], roofStyle: 'pitch', trim: [0.86, 0.88, 0.92] }
    }
  };
  g.HARBOR_BIOME_ORDER = ['green', 'mountain', 'desert', 'tropical', 'nordic'];
})(window);
