# HARBOR — third-party asset credits

All bundled 3D assets are redistributed under permissive licences and committed locally
(`games/harbor/assets/`) so the game stays self-contained (no external requests at runtime).

## KayKit — City Builder Bits
- **Files:** `assets/building_A.glb` … `assets/building_H.glb` (modern city blocks used for the
  developed-port skyline). Each `.glb` embeds the shared `citybits_texture` atlas.
- **Author:** Kay Lousberg (KayKit / kaylousberg.com)
- **Licence:** MIT
- **Obtained from:** GitHub mirror `Malcolmnixon/KayKitCityBuilderBits`
  (`addons/kaykit_city_builder_bits/Assets/gltf/building_*_lit.glb`), which carries an MIT LICENSE.
- **Notice:** "City Builder Bits" © Kay Lousberg, used under the MIT License.

Everything else in HARBOR (terrain, landforms, trees, huts, quays, cranes, boats/ships, water,
sky) is procedurally generated in `models.js` / `gl.js` — no third-party assets.

If any asset's licence is ever in doubt it is removed and the renderer falls back to procedural
geometry (see `assets.js` / `models.js`).
