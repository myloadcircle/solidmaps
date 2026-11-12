#!/usr/bin/env bash
# SolidMaps — one-shot Valhalla VPS bootstrap (Option A: build on the box).
#
# Run ON a fresh Ubuntu 22.04/24.04 VPS (Hetzner CX33, 8 GB RAM) as root:
#
#   ROUTING_ENGINE_TOKEN=vh_... \
#   VALHALLA_DOMAIN=valhalla.solidmap.app \
#   ACME_EMAIL=fbirele@gmail.com \
#   bash setup-vps.sh
#
# What it does:
#   1. installs Docker + the 4 GB swap safety net (tile build peaks ~8 GB)
#   2. fetches the estate infra files from the public repo (compose, Caddyfile, extracts script)
#   3. downloads the GB + Ireland Geofabrik extracts
#   4. starts valhalla-scripted (build_admins + build_time_zones on, per the global plan)
#   5. starts Caddy (auto-TLS on the domain, bearer-token gate, /route + /status only)
#   6. waits for the tile build, then runs an end-to-end truck-route verification
#
# Prereq: DNS A/AAAA record for $VALHALLA_DOMAIN -> this server's IP (proxied through
# Cloudflare is fine; Caddy's HTTP-01 challenge passes through the proxy).
#
# Runtime after build: ~2–3 GB RSS. Stage-2 widening = add a line to
# scripts/fetch-extracts.sh (or SOLIDMAPS_REGIONS env) + one restart with
# VALHALLA_USE_TILES_IGNORE_PBF=False. See infra/valhalla/README.md.
set -euo pipefail

ROUTING_ENGINE_TOKEN="${ROUTING_ENGINE_TOKEN:?export ROUTING_ENGINE_TOKEN (from C:/DEV/secrets/valhalla-vps-token.txt)}"
VALHALLA_DOMAIN="${VALHALLA_DOMAIN:?export VALHALLA_DOMAIN (e.g. valhalla.solidmap.app)}"
ACME_EMAIL="${ACME_EMAIL:?export ACME_EMAIL}"
BRANCH="${BRANCH:-master}"
REPO_RAW="https://raw.githubusercontent.com/myloadcircle/solidmaps/${BRANCH}/infra/valhalla"

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (sudo -E bash setup-vps.sh)" >&2
  exit 1
fi

echo "== [1/6] Docker + swap"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null

echo "== [2/6] firewall (22/80/443 only)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

echo "== [3/6] estate infra files -> /opt/valhalla"
mkdir -p /opt/valhalla/custom_files
cd /opt/valhalla
for f in docker-compose.yml Caddyfile scripts/fetch-extracts.sh README.md; do
  mkdir -p "$(dirname "$f")"
  curl -fsSL --retry 3 -o "$f" "${REPO_RAW}/$f"
  echo "  fetched $f"
done
chmod +x scripts/fetch-extracts.sh

echo "== [4/6] .env"
cat > .env <<ENV
VALHALLA_DOMAIN=${VALHALLA_DOMAIN}
ROUTING_ENGINE_TOKEN=${ROUTING_ENGINE_TOKEN}
ACME_EMAIL=${ACME_EMAIL}
VALHALLA_USE_TILES_IGNORE_PBF=False
VALHALLA_THREADS=2
ENV
chmod 600 .env

echo "== [5/6] extracts + build (GB ~1.6 GB + IE; build peaks ~8 GB — expect 25–40 min)"
./scripts/fetch-extracts.sh
docker compose up -d
echo "  tiles building — this runs inside the container; watch: docker compose logs -f valhalla"

echo "== [6/6] verification (blocks until the build finishes)"
echo -n "  waiting for Valhalla /status"
for i in $(seq 1 120); do
  if curl -sf -H "Authorization: Bearer ${ROUTING_ENGINE_TOKEN}" \
      "https://${VALHALLA_DOMAIN}/status" >/dev/null 2>&1; then
    echo " UP"
    break
  fi
  echo -n "."
  sleep 30
done

echo -n "  end-to-end truck route (Camden -> Westminster, 4 m / 32 t / 5 axles): "
HTTP=$(curl -s -o /tmp/sm-route.json -w '%{http_code}' -m 60 \
  -H "Authorization: Bearer ${ROUTING_ENGINE_TOKEN}" -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":51.538,"lon":-0.142},{"lat":51.501,"lon":-0.142}],"costing":"truck","costing_options":{"truck":{"height":4.0,"weight":32.0,"axle_count":5}},"units":"kilometers"}' \
  "https://${VALHALLA_DOMAIN}/route")
LEN=$(grep -o '"length":[0-9.]*' /tmp/sm-route.json | head -1 | cut -d: -f2)
TIME_MIN=$(( $(grep -o '"time":[0-9.]*' /tmp/sm-route.json | head -1 | cut -d: -f2 | cut -d. -f1) / 60 ))
if [ "$HTTP" = "200" ]; then
  echo "PASS (${HTTP}, ${LEN}km/${TIME_MIN}min)"
  cat <<DONE

===============================================================
 Valhalla is LIVE and serving truck routing.

 Hand back to the lane:
   1. npx wrangler secret put ROUTING_ENGINE_TOKEN   # paste this token
   2. wrangler.toml: VALHALLA_BASE_URL = "https://${VALHALLA_DOMAIN}"
                      ROUTING_ENGINE_TYPE = "valhalla"
   3. npx wrangler deploy
 Done — SolidMaps truck routing is on the own engine.
===============================================================
DONE
else
  echo "NOT READY YET ($HTTP) — the build is still running; re-run this section later:"
  echo "  curl -H 'Authorization: Bearer \$TOKEN' https://${VALHALLA_DOMAIN}/status"
  exit 0
fi
