/* HARBOR — selectable backdrops. window.HARBOR_BIOMES
 * Each biome re-skins terrain/landforms/water/sky/light/vegetation; gameplay is identical.
 * Colours are linear-ish (tonemapped at render).
 */
(function (g) {
  g.HARBOR_BIOMES = {
    green: {
      id: 'green', name: 'Green Isles',
      ground: [0.34, 0.46, 0.24], hill: [0.26, 0.42, 0.20], hillType: 'hill', snow: false,
      deep: [0.03, 0.13, 0.18], shallow: [0.07, 0.30, 0.34],
      skyTop: [0.30, 0.56, 0.86], skyBot: [0.74, 0.87, 0.96], sun: [1.25, 1.16, 0.98], fog: [0.78, 0.88, 0.95], veg: 'tree', vegN: 26
    },
    mountain: {
      id: 'mountain', name: 'Mountain Fjord',
      ground: [0.32, 0.40, 0.30], hill: [0.42, 0.44, 0.50], hillType: 'mountain', snow: true,
      deep: [0.04, 0.11, 0.18], shallow: [0.10, 0.24, 0.32],
      skyTop: [0.34, 0.50, 0.74], skyBot: [0.76, 0.84, 0.92], sun: [1.08, 1.08, 1.14], fog: [0.80, 0.86, 0.92], veg: 'pine', vegN: 30
    },
    desert: {
      id: 'desert', name: 'Desert Coast',
      ground: [0.82, 0.66, 0.38], hill: [0.78, 0.58, 0.32], hillType: 'mesa', snow: false,
      deep: [0.05, 0.22, 0.28], shallow: [0.16, 0.44, 0.46],
      skyTop: [0.46, 0.64, 0.86], skyBot: [0.98, 0.88, 0.68], sun: [1.34, 1.18, 0.86], fog: [0.95, 0.86, 0.68], veg: 'none', vegN: 0
    },
    tropical: {
      id: 'tropical', name: 'Tropical', ground: [0.48, 0.62, 0.30], hill: [0.30, 0.52, 0.26], hillType: 'hill', snow: false,
      deep: [0.0, 0.38, 0.46], shallow: [0.10, 0.66, 0.64],
      skyTop: [0.24, 0.62, 0.92], skyBot: [0.84, 0.94, 0.96], sun: [1.34, 1.22, 1.02], fog: [0.84, 0.94, 0.96], veg: 'palm', vegN: 22
    },
    nordic: {
      id: 'nordic', name: 'Nordic Cliffs', ground: [0.40, 0.43, 0.45], hill: [0.46, 0.48, 0.52], hillType: 'cliff', snow: true,
      deep: [0.05, 0.11, 0.15], shallow: [0.12, 0.22, 0.28],
      skyTop: [0.46, 0.54, 0.64], skyBot: [0.74, 0.78, 0.84], sun: [0.96, 1.0, 1.12], fog: [0.76, 0.80, 0.86], veg: 'pine', vegN: 20
    }
  };
  g.HARBOR_BIOME_ORDER = ['green', 'mountain', 'desert', 'tropical', 'nordic'];
})(window);
