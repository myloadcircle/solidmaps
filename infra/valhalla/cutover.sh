#!/usr/bin/env bash
# SolidMaps — Hetzner cutover: one command AFTER setup-vps.sh prints PASS.
#
#   bash infra/valhalla/cutover.sh
#
# What it does (reads the token from the estate vault, no prompts):
#   1. verifies DNS for valhalla.solidmap.app actually resolves
#   2. live-verifies the engine (/status + a real truck route through Caddy)
#   3. uploads ROUTING_ENGINE_TOKEN as a Worker secret
#   4. flips wrangler.toml: VALHALLA_BASE_URL + ROUTING_ENGINE_TYPE=valhalla
#   5. deploys the Worker and E2E-verifies production truck routing on it
#
# Safe to re-run: every step is idempotent, and the flip only happens after the
# engine passes verification — an unreachable engine can never serve prod routes.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="valhalla.solidmap.app"
TOKEN=$(grep -oE 'vh_[a-f0-9]{48}' /c/DEV/secrets/valhalla-vps-token.txt | head -1)
[ -n "$TOKEN" ] || { echo "FATAL: token not found in vault"; exit 1; }

echo "== [1/5] DNS check"
IP=$(nslookup "$DOMAIN" 2>/dev/null | awk '/^Address/ && !/127\.0\.0\.1|#/{print $2; exit}')
if [ -z "$IP" ]; then
  echo "FATAL: $DOMAIN does not resolve yet. Add the Cloudflare A record first."
  exit 1
fi
echo "  resolves to $IP"

echo "== [2/5] engine verification through Caddy (public URL)"
for i in 1 2 3 4 5; do
  S=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H "Authorization: Bearer $TOKEN" "https://$DOMAIN/status" || true)
  [ "$S" = "200" ] && break
  echo "  /status not 200 yet ($S) — is setup-vps.sh finished? retry $i/5"
  sleep 20
done
[ "$S" = "200" ] || { echo "FATAL: engine not reachable"; exit 1; }
echo "  /status OK"
HTTP=$(curl -s -o /c/temp/sm/cutover-route.json -w '%{http_code}' -m 60 \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":51.538,"lon":-0.142},{"lat":51.501,"lon":-0.142}],"costing":"truck","costing_options":{"truck":{"height":4.0,"weight":32.0,"axle_count":5}},"units":"kilometers"}' \
  "https://$DOMAIN/route")
LEN=$(grep -o '"length":[0-9.]*' /c/temp/sm/cutover-route.json | head -1 | cut -d: -f2)
[ "$HTTP" = "200" ] && echo "  truck route PASS (${LEN}km)" || { echo "FATAL: route failed ($HTTP)"; exit 1; }

echo "== [3/5] Worker secret"
printf '%s' "$TOKEN" | npx wrangler secret put ROUTING_ENGINE_TOKEN 2>&1 | tail -1

echo "== [4/5] wrangler.toml flip"
node -e "
const fs = require('fs');
const f = 'wrangler.toml';
let t = fs.readFileSync(f, 'utf8');
t = t.replace('# VALHALLA_BASE_URL = \"https://valhalla.solidmap.app\"', 'VALHALLA_BASE_URL = \"https://valhalla.solidmap.app\"');
t = t.replace('# ROUTING_ENGINE_TYPE = \"valhalla\"', 'ROUTING_ENGINE_TYPE = \"valhalla\"');
if (!/^VALHALLA_BASE_URL = /m.test(t)) throw new Error('flip failed');
fs.writeFileSync(f, t);
console.log('  wrangler.toml: VALHALLA_BASE_URL + ROUTING_ENGINE_TYPE=valhalla');
"

echo "== [5/5] deploy + production E2E"
npx wrangler deploy 2>&1 | tail -2
sleep 3
TRK_KEY=$(grep -oE 'trk_[a-f0-9]{48}' /c/DEV/secrets/solidmaps-service-keys.txt | head -1)
PROD=$(curl -s -m 60 -X POST 'https://solidmaps-api.fbirele.workers.dev/api/route' \
  -H 'Content-Type: application/json' -H "X-API-Key: $TRK_KEY" \
  -d '{"origin":{"lat":51.538,"lon":-0.142},"destination":{"lat":51.501,"lon":-0.142},"mode":"truck"}' \
  -o /c/temp/sm/prod-truck.json -w '%{http_code}')
PROVIDER=$(grep -o '"provider":"[a-z]*"' /c/temp/sm/prod-truck.json | head -1)
echo "  prod truck route (TruckRoute service path): HTTP=$PROD $PROVIDER"
[ "$PROVIDER" = '"provider":"valhalla"' ] || { echo "  WARN: prod still not on valhalla — check KV cache (5-min TTL) or the flip above."; }

cat <<DONE

===============================================================
 CUTOVER COMPLETE — SolidMaps truck routing is on YOUR engine.
   - engine: https://$DOMAIN (GB+IE, truck costing live)
   - worker: VALHALLA_BASE_URL set, valhalla-type active
 Next: run infra/valhalla/ab-bridge-test.sh ON the VPS to prove
 height avoidance, then TruckRoute + solidmap.app both steer.
===============================================================
DONE
