# SolidMaps ↔ TruckRoute mapping (2026-11-12)

Owner directive: SolidMaps is the routing/satnav **engine layer**; TruckRoute is the trucker-facing
**brand/app**. TruckRoute Pro holders get SolidMaps Pro as an upgrade. UK satnav first; the map
coverage grows global as TruckRoute signups grow (3-stage Valhalla rollout, see infra/valhalla/README.md).

## What each side owns

| Concern | Owner |
|---|---|
| Routing engine (Valhalla truck graph, height/weight/axles) | SolidMaps worker (`VALHALLA_BASE_URL`) |
| Satnav loop (voice, auto-advance, camera-follow, reroute, wake lock) | SolidMaps web app (`solidmap.app`) |
| Multi-stop (`/optimized_route`) + distance matrix (`/sources_to_targets`) | SolidMaps worker |
| Bridge/restriction discovery along route | SolidMaps web (Overpass pipeline, lib/bridges.ts) |
| Trucker brand, Play app, RevenueCat billing, reviews | TruckRoute (mytruckroute.app) |
| Car/walk/transit consumer navigation + parking | SolidMaps |

## One Pro across two apps

| Side | Mechanism | State |
|---|---|---|
| SolidMaps Pro (direct) | Stripe payment link → `/api/billing/webhook` → tier flip (idempotent) | Live code; **payment link URL not yet set** (`NEXT_PUBLIC_UPGRADE_URL`) |
| TruckRoute Pro (in-app) | RevenueCat + Play Billing (live in the TruckRoute Android app) | Live |
| **Cross-app upgrade** | `POST /api/entitlement/revcat` — signed-in SolidMaps user submits their TruckRoute RevenueCat `app_user_id`; worker validates server-side against RevenueCat REST and flips the tier with `pro_until` mirroring the RC expiry | **Built; parked on `REVCAT_SECRET_KEY`** (owner mints from the RevenueCat dashboard; the vault holds only the public `goog_` SDK key) |
| Engine access for TruckRoute (no SolidMaps account) | `X-API-Key` service key → KV `svc:{key}` → `{app:"truckroute", tier:"pro"}`; accepted on `/api/route` + `/api/matrix`; revocable by KV delete | **LIVE — key minted, see `C:\DEV\secrets\solidmaps-service-keys.txt`** |

Frontend: the Go Pro modal has an "Already Pro on TruckRoute?" exchange (input + RevenueCat check).
Until `REVCAT_SECRET_KEY` is minted it answers honestly: "TruckRoute Pro exchange is not configured yet".

## Rollout order

1. **UK satnav (now)**: GB+IE Valhalla build (infra/valhalla), SolidMaps satnav loop live, TruckRoute
   calls the engine via `X-API-Key` (or keeps its own Mapbox until its UI adopts it).
2. **Pro bridge activation**: owner mints `REVCAT_SECRET_KEY` → `wrangler secret put REVCAT_SECRET_KEY`
   → the exchange starts returning real verdicts. Also set `NEXT_PUBLIC_UPGRADE_URL` for direct Stripe Pro.
3. **Global**: widen `scripts/fetch-extracts.sh` (Europe → NA → West Africa → SA) per demand from
   TruckRoute signups; Stage-3 planet build → R2 → regional Valhalla nodes behind the Worker.

## Service-key rules (estate)

- Keys are per-product, stored in `C:\DEV\secrets\solidmaps-service-keys.txt` (never committed).
- Rate limiting/failover for Stage 3 rides the Worker (per-key KV counters if abuse appears).
- One product, one key; a leaked key is one KV delete away from dead.
