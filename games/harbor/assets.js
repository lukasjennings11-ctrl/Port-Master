/* HARBOR — bundled asset manifest. window.HARBOR_ASSETS
 * Real CC0/MIT low-poly glTF used by the renderer (loaded via gltf.js). Everything here is
 * pulled from GitHub and committed under games/harbor/assets/ so the game stays self-contained
 * (portal rule: no external links). Provenance + licences are in CREDITS.md. Anything NOT covered
 * by an asset falls back to procedural geometry in models.js — the game always renders.
 *
 * Currently shipped: KayKit "City Builder Bits" buildings (MIT, Kay Lousberg / mirror Malcolmnixon)
 * — modern blocks used for the developed-port skyline (Trading-Post era onward). Each .glb embeds
 * the shared atlas texture, so one upload covers all.
 */
(function (g) {
  g.HARBOR_ASSETS = {
    // modern city skyline blocks (used era >= 1); index 0..7
    buildings: [
      'assets/building_A.glb', 'assets/building_B.glb', 'assets/building_C.glb', 'assets/building_D.glb',
      'assets/building_E.glb', 'assets/building_F.glb', 'assets/building_G.glb', 'assets/building_H.glb'
    ]
  };
})(window);
