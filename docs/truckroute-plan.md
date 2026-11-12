# TruckRoute foundation — Valhalla adapter audit + integration plan (2026-10-25)

Context: TruckRoute (mytruckroute.app) is live and native on Play. SolidMaps is to become the
routing-engine platform underneath it and future fleet products.

## Adapter audit (worker/src/index.ts, verified by read)

### Completed
- `valhallaRoute()` — full request builder: `POST {ROUTING_ENGINE_URL}/route` with `locations`,
  `costing` (auto/pedestrian/truck by mode), `units` pinned to kilometres and
  `directions_options.language=en-GB`.
- **Truck costing options wired**: `height` (from `max_height_meters`), `weight` (t from
  `gross_weight_kg`), `axle_count` — sent as `costing_options.truck`.
- Polyline-6 decoder (`decodePolyline6`) for Valhalla shape geometry.
- Maneuver → step instruction mapping with distances, plus per-step `location` and
  `distance_from_start` derived from `begin_shape_index` (needed for camera-follow / auto-advance).
- Bearer-token auth on the router call when `ROUTING_ENGINE_TOKEN` is set — required once Valhalla
  sits behind an authenticating proxy.
- Engine switch: `ROUTING_ENGINE_TYPE=valhalla` flips the whole `/api/route` path.
- Warning system knows the difference: `enforced = engine === 'valhalla'` — height/weight warnings
  read "respected where OSM data includes it" on Valhalla vs "check manually" on OSRM.

> **Refactor (2026-11-05).** The parsing and warning logic above — `decodePolyline6`,
> `parseValhallaLeg`, `valhallaCosting`, `valhallaTruckOptions`, `ulezCompliant`, `vehicleWarnings`,
> `engineWarnings` — now lives in [`shared/routing.ts`](../shared/routing.ts) and is imported by both
> the Worker adapter and the on-device (WebAssembly) adapter. `worker/src/index.ts` keeps only the
> HTTP surface. This is what makes the two engines provably identical in what they emit, rather than
> two copies that drift.

### Missing
1. **A live Valhalla endpoint** — the deployment is scaffolded in `infra/valhalla/`
   (Compose + Caddy token proxy + GB/Ireland tile build + host shortlist). It still needs a VM to be
   provisioned, tiles built and the endpoint verified before the engine is flipped.
   `ROUTING_ENGINE_URL` continues to point at the OSRM demo until then. The *on-device* half of the
   same build needs no VM — see "On-device engine" below.
2. Valhalla **OSM truck attributes**: height/weight avoidance only works if the tileset was
   built with `admin/build` incl. truck restrictions config (default valhalla_build_tariffs +
   tagged heights). Must be verified on whatever endpoint we stand up, else the "enforced" copy lies.
3. Alternatives (`"alternatives": 2`) and waypoints (>2 locations) — not sent.
4. Truck-specific response fields (summaries only; no per-leg Hazmat/toll flags surfaced). Truck
   `width`/`length` are also unsupported: `VehicleProfile` has no such columns yet.
5. `handleRoute` truck gate is Pro-only — for TruckRoute-the-app (already paid/Pro there) the engine
   API needs a server-to-server path: API key auth, not user JWT.

## Endpoint options (decided)
| Option | Cost | Decision |
|---|---|---|
| Self-host Valhalla on a small Linux VM, Caddy token proxy (`infra/valhalla/`) | ~€15/mo | **Chosen.** Full control, tariffs we verify, no rate limits. Recommended host: Hetzner CPX31. |
| Valhalla Docker on the existing estate VPS | $0 | Rejected — needs ≥8 GB free RAM; a tile build would starve anything else on the box. |
| Keep OSRM + precomputed height/weight penalty graph | build effort | Rejected — not real avoidance, weaker than the copy promises. |

Full runbook, host shortlist and verification steps: [`infra/valhalla/README.md`](../infra/valhalla/README.md).

## On-device engine — routewasm (decided 2026-11-05)

A second engine alongside the VM: Valhalla compiled to WebAssembly, running **inside the browser**
([`routewasm`](https://routewasm.dev), MIT). It exists because the VM has a structural limit the SDK
removes — every calculation is a round trip, so an offline-capable navigation product can never
fully work that way, and a fleet device in a dead spot cannot route at all.

Why it fits this codebase cheaply: it speaks Valhalla's JSON API **verbatim**, so
[`shared/routing.ts`](../shared/routing.ts) parses both engines' responses with the same code, and
the truck restrictions verified against the native build are the ones it enforces.

| | VM (native Valhalla) | On-device (routewasm) |
|---|---|---|
| Per-route server call | yes | **no** |
| Works offline | no | yes, inside retained coverage |
| Cold first-use cost | none | graph tiles (endpoint-dominated) |
| Route span | service limits (5,000 km) | `maxLocalRouteKm`, default 400 km |
| Elevation / transit | available | unavailable |
| Marginal cost | VM + bandwidth | static storage |

**Decision: run both.** On-device is the default path in the app; the VM is the fallback, the
server-to-server surface for TruckRoute, and the only option beyond the span guard. There is no
forced choice for the user because `RoutePlanner` tries on-device first and falls back silently —
missing WebAssembly, a failed tile fetch and `route_too_long` all land on exactly today's behaviour
instead of an error.

Status: engine wired behind `NEXT_PUBLIC_ROUTEWASM_*`, off by default, emitting
`provider: 'valhalla-wasm'`. Outstanding is the tile slice itself — build, pack, host, measure:
[`infra/valhalla/README.md`](../infra/valhalla/README.md#on-device-routing-routewasm).

## Coverage strategy (decided 2026-11-05)

Coverage is the extract list in [`infra/valhalla/scripts/fetch-extracts.sh`](../infra/valhalla/scripts/fetch-extracts.sh)
(`SOLIDMAPS_REGIONS`). Launch set: **Great Britain + Ireland**.

Grow it with revenue, not up front. Each added country costs build time and storage and **nothing in
the client** — graph tiles are fetched per route, so a UK user never downloads continental tiles and
there is no per-country branch anywhere. A new country is one line, one rebuild, a new dataset
prefix and five env vars.

Re-measure one thing each time: cold first-use transfer, which is endpoint-dominated and does grow
with the number of tiles the endpoints sit among. If one dataset ever makes GB cold routes
expensive, split it into per-region datasets — one `datasetId` and prefix each, picked per user. Same
mechanism, just more of them; no new engineering.

## Implementation plan (ordered)
1. Provision a VM and stand up the stack from `infra/valhalla/` (Compose: `valhalla-scripted` image
   builds GB + Ireland tiles from the Geofabrik extracts, Caddy fronts it with bearer-token auth).
2. Verify with a known low-bridge route (e.g. A406 Archway 4.1m) that `height=3.8` reroutes —
   screenshot the diff as evidence before flipping the engine.
3. Worker: set `ROUTING_ENGINE_TYPE=valhalla` + `ROUTING_ENGINE_URL` to the instance (both currently
   commented in `wrangler.toml`) and `wrangler secret put ROUTING_ENGINE_TOKEN`; keep OSRM as
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
