# TruckRoute foundation — Valhalla adapter audit + integration plan (2026-10-25)

Context: TruckRoute (mytruckroute.app) is live and native on Play. SolidMaps is to become the
routing-engine platform underneath it and future fleet products.

## Adapter audit (worker/src/index.ts, verified by read)

### Completed
- `valhallaRoute()` — full request builder: `POST {ROUTING_ENGINE_URL}/route` with `locations`,
  `costing` (auto/pedestrian/truck by mode).
- **Truck costing options wired**: `height` (from `max_height_meters`), `weight` (t from
  `gross_weight_kg`), `axle_count` — sent as `costing_options.truck`.
- Polyline-6 decoder (`decodePolyline6`) for Valhalla shape geometry.
- Maneuver → step instruction mapping with distances.
- Engine switch: `ROUTING_ENGINE_TYPE=valhalla` flips the whole `/api/route` path.
- Warning system knows the difference: `enforced = engine === 'valhalla'` — height/weight warnings
  read "respected where OSM data includes it" on Valhalla vs "check manually" on OSRM.

### Missing
1. **A live Valhalla endpoint** — the only blocker. `ROUTING_ENGINE_URL` currently points at the OSRM
   demo; no Valhalla instance exists in the estate.
2. Valhalla **OSM truck attributes**: height/weight avoidance only works if the Valhalla tileset was
   built with `admin/build` incl. truck restrictions config (default valhalla_build_tariffs +
   tagged heights). Must be verified on whatever endpoint we stand up, else the "enforced" copy lies.
3. Alternatives (`"alternatives": 2`) and waypoints (>2 locations) — not sent.
4. Truck-specific response fields (summaries only; no per-leg Hazmat/toll flags surfaced).
5. `handleRoute` truck gate is Pro-only — for TruckRoute-the-app (already paid/Pro there) the engine
   API needs a server-to-server path: API key auth, not user JWT.

## Endpoint options (decision for owner)
| Option | Cost | Notes |
|---|---|---|
| Self-host Valhalla on Fly/Railway (public tile cache, ~2GB RAM) | ~$10-20/mo | Full control, tariff build we verify, no rate limits. Recommended. |
| Valhalla Docker on the existing estate VPS (if any capacity) | $0 | Ops burden on an already-busy box |
| Keep OSRM + precomputed height/weight penalty graph | build effort | Not real avoidance — weaker than the copy promises |

## Implementation plan (ordered)
1. Stand up `valhalla` container (Fly.io, `gyorfi/valhalla-docker` or official build), planet extract
   = Europe initially (TruckRoute is UK/EU), `elevation` off, truck tariffs on.
2. Verify with a known low-bridge route (e.g. A406 Archway 4.1m) that `height=3.8` reroutes —
   screenshot the diff as evidence before flipping the engine.
3. Worker: set `ROUTING_ENGINE_TYPE=valhalla` + `ROUTING_ENGINE_URL` to the instance; keep OSRM as
   automatic fallback (already coded: engine errors → haversine; upgrade to OSRM fallback instead).
4. Add `alternatives=2` + multi-location support to both adapters (OSRM: `alternatives=true`,
   `&lon,lat;...` waypoints already free; Valhalla: locations array already supports it).
5. Add `X-API-Key` auth tier for TruckRoute server-side calls (new KV/table of keys, bypasses user JWT,
   rate-limited 600/min).
6. TruckRoute app: point its routing calls at `https://solidmaps-api.../api/route` (or a
   `route.truckroute.mytruckroute.app` worker route on the same code) — one engine, two products.

## What this unlocks
- Honest Pro truck routing in SolidMaps (chargeable per monetisation plan).
- TruckRoute gets height/weight avoidance without its own routing infra.
- The same endpoint serves RideShield/city products later (see reuse-strategy.md).
