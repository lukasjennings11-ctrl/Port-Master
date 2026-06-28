#!/usr/bin/env bash
# Dev-only: (re)download HARBOR's bundled CC0/MIT glTF assets from GitHub into ./assets/.
# Assets are committed to the repo so the shipped game makes no external requests.
# Run from games/harbor/:  bash assetfetch.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p assets

# KayKit "City Builder Bits" — MIT (Kay Lousberg), via Malcolmnixon mirror. Self-contained .glb.
KAYKIT="https://raw.githubusercontent.com/Malcolmnixon/KayKitCityBuilderBits/HEAD/addons/kaykit_city_builder_bits/Assets/gltf"
for L in A B C D E F G H; do
  echo "fetch building_$L"
  curl -fsS --max-time 60 -o "assets/building_$L.glb" "$KAYKIT/building_${L}_lit.glb"
done

echo "done. See CREDITS.md for licences."
