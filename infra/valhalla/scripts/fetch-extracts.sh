#!/usr/bin/env bash
# Download the OSM extracts Valhalla builds the routing graph from.
#
# Coverage is deliberately regional and additive. Every extract listed here becomes part of the
# same tileset, so adding a country is one line — no schema, client or hosting change. Widening the
# build does *not* widen what a GB user downloads: routewasm fetches graph tiles per request, so a
# Scottish route only ever pulls Scottish tiles.
#
# Default = the launch coverage: Great Britain and the island of Ireland. Both are disjoint
# Geofabrik regions, so they drop straight into custom_files/ with no osmium merge step.
#
# Add a country as subscription revenue funds it (see docs/truckroute-plan.md), e.g.
#   europe/france-latest.osm.pbf
# or override the whole set for one run:
#   SOLIDMAPS_REGIONS="europe/great-britain-latest.osm.pbf europe/france-latest.osm.pbf" \
#     ./scripts/fetch-extracts.sh
#
# After changing this list, the tiles must be rebuilt — see README.md ("Adding a country").
#
# Re-runs are cheap: already-downloaded files are skipped.
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${DEST:-custom_files}"
mkdir -p "${DEST}"

BASE="https://download.geofabrik.de"

# Space-separated Geofabrik-relative paths. Override with $SOLIDMAPS_REGIONS.
DEFAULT_REGIONS="europe/great-britain-latest.osm.pbf europe/ireland-and-northern-ireland-latest.osm.pbf"
read -r -a REGIONS <<< "${SOLIDMAPS_REGIONS:-${DEFAULT_REGIONS}}"

echo "coverage: ${#REGIONS[@]} extract(s)"
for region in "${REGIONS[@]}"; do
  echo "  - ${region}"
done

for region in "${REGIONS[@]}"; do
  name="$(basename "${region}")"
  if [ -s "${DEST}/${name}" ]; then
    echo "have ${name}"
    continue
  fi
  echo "downloading ${name} ..."
  curl -fL --retry 3 --retry-delay 5 -o "${DEST}/${name}.part" "${BASE}/${region}"
  mv "${DEST}/${name}.part" "${DEST}/${name}"
done

echo
echo "extracts ready in ${DEST}/ — now run:  docker compose up -d"
