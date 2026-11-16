#!/usr/bin/env bash
# SolidMaps — InstaBox POC: prove the UK+IE Valhalla build and truck routing.
# Engine-only (no Caddy/TLS/DNS): the free sandbox is the build+snapshot POC;
# the serving home is the Hetzner box (infra/valhalla/setup-vps.sh).
#
# Sandbox realities this script respects:
#   - 20 GiB disk: small-disk discipline (2G swap, 1 thread, pbfs removed after build)
#   - /data is the big filesystem: docker data-root and the build both live there
#   - free-tier 120-min run cap: no wasted steps, everything logged to /data/poc.log
set -euo pipefail
exec >>/data/poc.log 2>&1

echo "=== $(date -u) SolidMaps Valhalla POC start"
uname -m
df -h / /data || true

# 1. Docker (CI templates have passwordless sudo; skip if present)
if ! command -v docker >/dev/null 2>&1; then
  echo '--- installing docker'
  curl -fsSL https://get.docker.com | sh
fi
# Keep docker's layers on /data (the 20 GiB filesystem), not a small root fs.
mkdir -p /data/docker
if ! grep -q 'data-root' /etc/docker/daemon.json 2>/dev/null; then
  mkdir -p /etc/docker
  echo '{"data-root":"/data/docker"}' > /etc/docker/daemon.json
  systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || true
fi
docker info --format 'docker ok: {{.ServerVersion}} data-root={{.DockerRootDir}}'

# 2. Swap safety net (2G on this disk size)
if ! swapon --show | grep -q /data/swapfile; then
  fallocate -l 2G /data/swapfile
  chmod 600 /data/swapfile
  mkswap /data/swapfile
  swapon /data/swapfile
fi
sysctl -w vm.swappiness=10 >/dev/null || true

# 3. Estate infra files (public repo raw)
mkdir -p /data/valhalla/custom_files
cd /data/valhalla
for f in docker-compose.yml scripts/fetch-extracts.sh; do
  mkdir -p "$(dirname "$f")"
  curl -fsSL --retry 3 -o "$f" "https://raw.githubusercontent.com/myloadcircle/solidmaps/master/infra/valhalla/$f"
done
chmod +x scripts/fetch-extracts.sh

# 4. Extracts + engine (valhalla service only; caddy needs DNS this box does not have)
./scripts/fetch-extracts.sh
# Placeholders satisfy compose's whole-file variable interpolation; only caddy reads them.
cat > .env <<'ENV'
VALHALLA_DOMAIN=poc.local
ROUTING_ENGINE_TOKEN=poc-placeholder
ACME_EMAIL=poc@local
VALHALLA_USE_TILES_IGNORE_PBF=False
VALHALLA_THREADS=1
ENV
docker compose up -d valhalla

# 5. Wait for the build (the scripted image serves once tiles exist)
echo '--- waiting for valhalla /status on :8002'
for i in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8002/status >/dev/null 2>&1; then echo "UP after ${i}x30s"; break; fi
  sleep 30
done

# 6. Prove truck routing on the UK graph (same OD as every lane verification)
HTTP=$(curl -s -o /tmp/route.json -w '%{http_code}' -m 120 \
  -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":51.538,"lon":-0.142},{"lat":51.501,"lon":-0.142}],"costing":"truck","costing_options":{"truck":{"height":4.0,"weight":32.0,"axle_count":5}},"units":"kilometers"}' \
  http://127.0.0.1:8002/route)
LEN=$(grep -o '"length":[0-9.]*' /tmp/route.json | head -1 | cut -d: -f2)
TIME_MIN=$(( $(grep -o '"time":[0-9.]*' /tmp/route.json | head -1 | cut -d: -f2 | cut -d. -f1) / 60 ))
echo "=== TRUCK ROUTE: HTTP=$HTTP LEN=${LEN}km TIME=${TIME_MIN}min"
[ "$HTTP" = "200" ] || { echo '=== POC FAILED at route'; exit 1; }

# Height-avoidance signal: same OD must differ under a 3.0 m cap (Camden arches) or at least re-cost
HTTP2=$(curl -s -o /tmp/route2.json -w '%{http_code}' -m 120 \
  -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":51.538,"lon":-0.142},{"lat":51.501,"lon":-0.142}],"costing":"truck","costing_options":{"truck":{"height":3.0,"weight":32.0,"axle_count":5}},"units":"kilometers"}' \
  http://127.0.0.1:8002/route)
LEN2=$(grep -o '"length":[0-9.]*' /tmp/route2.json | head -1 | cut -d: -f2)
echo "=== 3.0m CAP: HTTP=$HTTP2 LEN=${LEN2}km (vs ${LEN}km at 4.0m)"

# 7. Small-disk cleanup: serving uses the tar, never the pbfs
rm -f custom_files/*.osm.pbf
sed -i 's/VALHALLA_USE_TILES_IGNORE_PBF=False/VALHALLA_USE_TILES_IGNORE_PBF=True/' .env 2>/dev/null || true
df -h /data

echo "=== $(date -u) POC COMPLETE — snapshot me now"
