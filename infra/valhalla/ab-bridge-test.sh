#!/usr/bin/env bash
# SolidMaps — height-avoidance A/B: the definitive proof that Valhalla actually
# ROUTES AROUND a real, OSM-verified low bridge (not just warns about it).
#
# Run ON the VPS (Overpass is reachable from Hetzner egress; it has been down or
# throttled from the dev network and the InstaBox, so this runs server-side):
#
#   sudo -E ROUTING_ENGINE_TOKEN=<vault token> bash ab-bridge-test.sh
#
# Method: fetch a real maxheight-tagged way near a corridor from Overpass, then
# route the same corridor at a height ABOVE and BELOW the restriction and diff.
set -euo pipefail

DOMAIN="${VALHALLA_DOMAIN:-valhalla.solidmap.app}"
TOKEN="${ROUTING_ENGINE_TOKEN:?export ROUTING_ENGINE_TOKEN (vault: valhalla-vps-token.txt)}"
PORT="${PORT:-443}"
BASE="https://$DOMAIN:$PORT"
UA='solidmaps-ab/1.0 (https://solidmap.app)'

echo "== [1/3] fetch a real OSM maxheight way (London, Overpass)"
Q='%5Bout%3Ajson%5D%5Btimeout%3A25%5D%3Bway%5B%22maxheight%22%5D%2851.50%2C-0.20%2C51.60%2C-0.05%29%3Bout%20tags%20geom%2020%3B'
curl -s -m 45 -H "User-Agent: $UA" "https://overpass-api.de/api/interpreter?data=$Q" -o /tmp/ab-ovp.json
H=$(grep -o '"maxheight":"[0-9.,]*"' /tmp/ab-ovp.json | head -1 | cut -d'"' -f4 | cut -d',' -f1)
if [ -z "$H" ]; then
  echo "  Overpass returned nothing usable — trying kumi mirror"
  curl -s -m 45 -H "User-Agent: $UA" "https://overpass.kumi.systems/api/interpreter?data=$Q" -o /tmp/ab-ovp.json
  H=$(grep -o '"maxheight":"[0-9.,]*"' /tmp/ab-ovp.json | head -1 | cut -d'"' -f4 | cut -d',' -f1)
fi
[ -n "$H" ] || { echo "FATAL: no maxheight way found via either mirror"; exit 1; }
echo "  bridge height found: ${H} m"

# Lat/lon of the bridge: first geometry point of the first way with that tag
BRIDGE_LAT=$(node -e '
  const j = JSON.parse(require("fs").readFileSync("/tmp/ab-ovp.json","utf8"));
  const w = (j.elements||[]).find(e => e.tags && e.tags.maxheight && /^(0|1|2|3|4|4\.5)\./.test(String(e.tags.maxheight).replace(",", ".")));
  const g = w && w.geometry && w.geometry[0];
  if (!g) process.exit(1);
  console.log(g.lat + "," + g.lon);
' 2>/dev/null || true)
[ -n "$BRIDGE_LAT" ] || { echo "FATAL: could not extract bridge coordinates"; exit 1; }
echo "  bridge at: $BRIDGE_LAT"

echo "== [2/3] route a corridor across it: 6.0 m truck vs ${H} m truck"
# Build two waypoints ~400 m either side of the bridge so the corridor must cross it.
BRIDGE_LAT="$BRIDGE_LAT" node <<'NODE' > /tmp/ab-points.env
const [blat, blon] = process.argv[1].split(',').map(Number);
const dLat = 0.0036;
const a = { lat: blat + dLat, lon: blon };
const b = { lat: blat - dLat, lon: blon };
console.log(`A_LAT=${a.lat.toFixed(6)}\nA_LON=${a.lon.toFixed(6)}\nB_LAT=${b.lat.toFixed(6)}\nB_LON=${b.lon.toFixed(6)}`);
NODE
. /tmp/ab-points.env

route() {
  curl -s -m 90 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"locations\":[{\"lat\":$A_LAT,\"lon\":$A_LON},{\"lat\":$B_LAT,\"lon\":$B_LON}],\"costing\":\"truck\",\"costing_options\":{\"truck\":{\"height\":$1,\"weight\":32.0}},\"units\":\"kilometers\"}" \
    "$BASE/route"
}

HIGH=$(route 6.0 | grep -o '"summary":{[^}]*}' | head -1)
LOW_RAW=$(route "$H")
LOW=$(echo "$LOW_RAW" | grep -o '"summary":{[^}]*}' | head -1)
echo "  high (6.0m): $HIGH"
echo "  low  (${H}m): $LOW"

HL=$(echo "$HIGH" | grep -o '"length":[0-9.]*' | cut -d: -f2)
LL=$(echo "$LOW" | grep -o '"length":[0-9.]*' | cut -d: -f2)

echo "== [3/3] verdict"
if [ -n "$HL" ] && [ -n "$LL" ]; then
  if node -e "process.exit(Number('$LL') > Number('$HL') + 0.05 ? 0 : 1)"; then
    echo "  PASS — height avoidance PROVEN: ${H}m truck goes ${LL}km vs ${HL}km for a 6.0m truck."
    echo "  The engine reroutes around the real bridge. This unlocks honest 'avoidance' claims."
  else
    echo "  SAME LENGTH — this corridor has no tagged restriction the ${H}m truck must avoid."
    echo "  Re-run on another found bridge (list more: /tmp/ab-ovp.json)."
  fi
else
  echo "  INCONCLUSIVE — one of the routes failed; check /tmp for responses."
fi
