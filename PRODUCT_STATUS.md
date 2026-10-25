# solidmaps — product status

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
