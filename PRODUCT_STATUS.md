# solidmaps — product status

## Production-readiness round (2026-10-25, deployed + verified)
- **CORS**: `*` → allowlist (prod, `*.solidmaps.pages.dev` previews, localhost) applied at the fetch boundary. Verified: evil origin gets no ACAO header, prod/preview/local echo correctly.
- **KV cache namespace** `CACHE` (00d89c7e…): geocode 24 h, route 5 min, parking 24 h per ~110 m cell. Hit headers verified via raw response dump. ★ ROOT CAUSE NOTE: fire-and-forget `void CACHE.put(...)` is cancelled when the request ends — all background puts MUST go through `ctx.waitUntil()` (this silently killed every cache write for a whole deploy).
- **Rate limit**: 30 geocodes/min per IP in KV — verified live (burst of 35 → 5× 429).
- **Pro Parking is real now**: live OSM data via Nominatim bounded search (viewbox + extratags). Leeds 16 zones, Edinburgh 17, Camden 18 (e.g. "Leeds Station Car Park, 130 m, paid, multi-storey"). Overpass was tried and dropped: 406 for default curl UAs, 9 s hangs from Cloudflare egress, kumi mirror 502 — Nominatim is the same OSM data and already a dependency. The 4-row D1 seed is now only a fallback.
- **Legal**: `/privacy` + `/terms` live (Loadcircle Ltd, England and Wales), footer links, SW bumped to v3.
- **Honesty fixes**: upsell copy no longer promises enforced height/weight avoidance; pinch zoom re-enabled (was `userScalable:false`).
- **Verified clean**: AUTH_SECRET set in prod; no secret files tracked in git; D1 migrations applied; 22-check endpoint QA suite green (validation, auth 401s, truck gating 403, tiles, 404s, OPTIONS 204).
- **NOT verified**: actual WebGL render in a real browser (IAB webview unavailable in session). Render *inputs* verified instead: OpenFreeMap style 200 (111 layers) + London z10 vector tile 200 (MVT, 222 KB).

## Deployment state (2026-10-25)
- **Worker**: `https://solidmaps-api.fbirele.workers.dev` — version `45871b5e`
- **Frontend production**: `https://solidmaps.pages.dev` — deploy via local `next build` + `npx wrangler pages deploy out --project-name=solidmaps --branch=main` (production branch is `main`, NOT `master`; git push does NOT auto-deploy)
- **Custom domain `solidmaps.app`**: NOT REGISTERED (NXDOMAIN via 1.1.1.1). Blocked on owner purchase (~£15/yr), then Pages → Custom domains → attach.

## Mapbox parity round 1 (2026-10-25, shipped)
- **Engine**: maplibre-gl 4.7.1 → **6.16.0** (globe projection on style load, cooperative gesture set, WebGL2 paths)
- **Style**: default is now **OpenFreeMap Liberty** (`https://tiles.openfreemap.org/styles/liberty`) — keyless, worldwide vector tiles, POIs + labels; 3D buildings auto-added (`buildings-3d` fill-extrusion, OpenMapTiles `render_height`, z14+) on any vector style. PMTiles branch kept: set `NEXT_PUBLIC_PMTILES_URL` to force sovereign Protomaps mode; `NEXT_PUBLIC_MAP_STYLE` overrides with any style URL.
- **Navigation UX**: GeolocateControl GPS puck; Start/Pause live navigation with position watch, camera follow (heading-bearing, z16.5, pitch 55), step auto-advance by distance travelled, voice guidance via SpeechSynthesis, off-route detection (>60 m × 2 fixes → automatic replan), live remaining distance/ETA.
- **Worker**: OSRM steps now carry `location` [lon,lat] + `distance_from_start` (cumulative m) — deployed and verified live (`a08c8c21`).
- `tsc --noEmit` and `tsc -p worker` pass; `next build` passes with OpenFreeMap path.

## Directions / routing (fixed, earlier round)
- Live and deployed to `https://solidmaps-api.fbirele.workers.dev`
- `ROUTING_ENGINE_URL = https://router.project-osrm.org` in `wrangler.toml` `[vars]` and `.dev.vars`
- Real OSRM turn-by-turn routes; `ActiveNavigation` shows a fallback banner when the provider is `haversine`
- Valhalla adapter (height/weight-aware truck costing) is coded; switch with `ROUTING_ENGINE_TYPE=valhalla` + a live Valhalla endpoint

## Local repo
- Git + GitHub: `https://github.com/myloadcircle/solidmaps` (branch: `master`)
- `node_modules` COMPLETE (next 15.4.11, maplibre-gl 6.16.0, pmtiles 4.5.0) — local `next build` works

## Blocked
- `graphify update` — `graphify.exe` blocked by Application Control policy on this machine; graph files at last known state in `graphify-out/`

## Next gaps to Mapbox parity (see MAPBOX_PARITY_PLAN.md)
Tier 2: alternatives/multi-stop, Valhalla truck enforcement, offline PMTiles regions, own telemetry.
