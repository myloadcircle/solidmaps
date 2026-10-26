# SolidMaps reuse strategy — the estate mapping platform (2026-10-25)

Consumers: RideShield, AccraHustle, LagosHustle, TruckRoute, future city products.

## Architecture direction

SolidMaps already separates the three reusable planes:
1. **Engine (Worker)** — `solidmaps-api` is product-agnostic: geocode, route (OSRM/Valhalla adapters),
   parking, tiles, KV cache, rate limit. Consumers call it; they never re-implement providers.
2. **Map client (React)** — SolidMap.tsx is a thin, product-neutral shell: style + protocol + route
   drawing + GPS puck. Today it lives in-repo; extraction is mechanical when the second consumer exists.
3. **Product layer** — RoutePlanner/ActiveNavigation/VehicleProfileManager are SolidMaps-specific UX.

Rule: extract on the SECOND consumer, not before (avoid speculative abstraction). TruckRoute's
engine integration (truckroute-plan.md) is the trigger for the first real extraction: the worker.

## Module map (current home → target package)

| Module | Today | Target (`@estate/maps-*`) | Consumers |
|---|---|---|---|
| **Map layer** | components/SolidMap.tsx + maplibre 6 + OpenFreeMap style | `@estate/maps-map` — props: style URL, center, pitch, globe on/off | all |
| **Route layer** | drawRoute + ActiveNavigation (steps, auto-advance, voice, reroute) | `@estate/maps-route` — consumes RouteResponse; product supplies the plan API | TruckRoute, city apps |
| **District layer** | — | `@estate/maps-district`: GeoJSON district overlays + tap-for-info (OpenFreeMap has admin boundaries; source `boundaries` layer) | AccraHustle, LagosHustle (area guides, delivery zones) |
| **Geofence layer** | — | `@estate/maps-geofence`: polygon store + point-in-polygon worker endpoint + enter/exit events on the client (reuses haversine + KV cells already in the worker) | RideShield (safe-zone alerts), city products |
| **Business layer** | — | `@estate/maps-business`: POI set from Nominatim bounded search (same call as parking today, `q=<category>`), product-branded markers | Hustle apps (vendors, agents), TruckRoute (fuel/hgv-parking) |
| **Parking layer** | worker handleParking + nominatimToZones + Zone markers | `@estate/maps-parking`: already product-neutral; add category param | SolidMaps, TruckRoute (HGV bays), city apps |

Note the multiplier: `handleParking`'s Nominatim bounded search IS the business layer with
`q=parking` swapped for any category. One function, three modules of value.

## Concrete next steps per consumer
- **TruckRoute**: engine now (truckroute-plan.md), `@estate/maps-route` when its UI adopts web nav.
- **RideShield**: geofence layer first (safe zones), reuses auth + KV rate-limit patterns.
- **AccraHustle / LagosHustle**: district + business layers over the same map layer; per-city
  OpenFreeMap extract caching (offline-ready PMTiles per metro later).
- **Future city products**: start from the map + district layers; the worker already scales (KV
  caches are per-product-prefixable: `geo:`, `park:`, add `biz:<app>:`).

## Guardrail
Every consumer keeps estate rules: own-domain legal pages, no cross-app identity bleed, ASCII store
copy, its own icons/design (listing-asset-reuse-trap memory), and the shared engine gets per-key
rate limits so one product cannot starve the others.
