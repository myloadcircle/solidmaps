# solidmaps → Mapbox parity plan

Evidence base: REA v6.5.0 `analyze-javascript-application` over `mapbox-gl@3.33.0` (npm tarball,
sha256 root graph 44285efb…). REA recovered the original source tree from the shipped source maps:
2,717 original modules / 4,697 graph nodes / 266 style-spec property keys. Live probes of
solidmaps worker + Pages done 2026-10-25.

## Where the build is (verified live 2026-10-25)

| Piece | State |
|---|---|
| Worker API (`solidmaps-api…workers.dev`) | Healthy: geocode 200, OSRM turn-by-turn verified, tile proxy + edge cache, D1 auth, vehicle profiles, Pro gate |
| Pages frontend (`9eaf4a1a…pages.dev`) | Live but STALE — built before `PMTILES_URL` existed; 0 `pmtiles` refs in served bundle → renders raster tiles |
| 3D buildings | Code complete in repo, NOT live (needs Pages env var + redeploy) |
| Local node_modules | COMPLETE (PRODUCT_STATUS.md is stale: next 15.4.11, maplibre-gl 4.7.1, pmtiles 4.5.0 all present) |
| Engine | maplibre-gl 4.7.1 — terrain/hillshade/heatmap yes; globe/sky/cooperative-gestures NO (maplibre 6.16 has all) |

## What Mapbox GL JS 3.33 actually ships (REA evidence)

Renderer: globe + 16 alt projections (`src/geo/projection/`), skybox + fog, directional light with
cast/receive shadows, 3D model layer (`model-*` props), rain + snow particle systems
(`src/precipitation/`), building facades (windows/floors/roofs, ambient occlusion, flood light),
slot + placement-group layers (Mapbox Standard style), raster-particle flow layer, WebGL2 MRT,
WASM-SIMD paths, tile request cache, dictionary coder.

Controls: navigation, geolocate, fullscreen, scale, logo, attribution, **indoor**.

Platform moat (not in the bundle): api.mapbox.com tiles/styles/fonts/models + events.mapbox.com
telemetry + Directions/Geocoding/Search/Matrix/Isochrone cloud APIs + live traffic.

## Roadmap

### Tier 0 — ship what's built (hours)
1. Pages → Settings → Env vars: `NEXT_PUBLIC_PMTILES_URL=https://build.protomaps.com/20260519.pmtiles`, redeploy → 3D buildings live.
2. Fix PRODUCT_STATUS.md stale claims (node_modules complete).

### Tier 1 — free parity (days)
3. Upgrade maplibre-gl 4.7.1 → 6.x: globe projection, sky, cooperative gestures, perf. One-line version bump + CSS/API check.
4. Style: replace the 4-layer debug style with a real theme — OpenFreeMap (free hosted vector tiles, 3D buildings, 3 styles incl. Standard-like) or full Protomaps theme JSON (places, landuse, POIs, roads by class). This alone is most of the perceived quality gap.
5. Navigation UX: GeolocateControl GPS puck, auto-advance steps by position, camera follow (`followWithCourse`), reroute on off-route, voice via SpeechSynthesis.
6. Geocoding: Nominatim public API is 1 rps / no-production-intent — move to Photon (komoot) or LocationIQ or self-host Pelias; add debounced autocomplete + reverse + category search.

### Tier 2 — the moat features (1–2 weeks)
7. Routing depth: `alternatives=true`, multi-stop waypoints, exclude tolls/ferry, departure time; host own OSRM/Valhalla (FOSSGIS demos OK for dev only).
8. Truck mode that actually enforces height/weight: Valhalla truck costing — adapter already coded in the worker, needs `ROUTING_ENGINE_TYPE=valhalla` + a real Valhalla endpoint.
9. Offline regions: PMTiles + existing service worker → precache region → offline nav = BEYOND Mapbox web, and it's the sovereign differentiator.
10. Telemetry: own analytics endpoint in the worker (events.mapbox.com equivalent), perf metrics (tile load times, fps).

### Tier 3 — last 10% (weeks, diminishing)
11. Overture 3D landmarks (Mapbox's own data source, free) for landmark buildings.
12. Shadows / model layer not in maplibre — custom layer + three.js if ever needed.
13. Indoor, precipitation, alt projections — custom layers, low ROI.

## Honest framing
The ENGINE gap is closeable (maplibre IS mapbox-gl v2's open fork; v6 has globe/sky/terrain).
The PLATFORM gap (worldwide curated tiles + live traffic + search quality) is a data problem —
solved by OpenFreeMap/Protomaps/Overture + FOSSGIS/self-hosted routing, not by code.
