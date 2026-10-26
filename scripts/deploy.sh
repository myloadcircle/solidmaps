#!/usr/bin/env bash
# SolidMaps release: build once, ship everywhere.
# - worker  -> solidmaps-api.fbirele.workers.dev
# - pages   -> solidmaps (solidmaps.pages.dev) AND solidmaps-site (owns solidmap.app DNS)
# solidmap.app DNS points at solidmaps-site.pages.dev; the zone's DNS API is
# scope-blocked for the wrangler token, so both projects must receive the build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== typecheck =="
npx tsc --noEmit
npx tsc -p worker/tsconfig.json --noEmit

echo "== build =="
npm run build

echo "== worker =="
npx wrangler deploy

echo "== pages: solidmaps (solidmaps.pages.dev) =="
npx wrangler pages deploy out --project-name=solidmaps --branch=main

echo "== pages: solidmaps-site (serves solidmap.app + www) =="
npx wrangler pages deploy out --project-name=solidmaps-site --branch=main

echo "== verify =="
sleep 10
curl -fsS -o /dev/null https://solidmap.app/ && echo "solidmap.app OK"
curl -fsS -o /dev/null https://solidmaps.pages.dev/ && echo "solidmaps.pages.dev OK"
curl -fsS -o /dev/null 'https://solidmaps-api.fbirele.workers.dev/api/geocode?q=leeds' && echo "api OK"
echo "done."
