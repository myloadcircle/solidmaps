# Self-hosted Valhalla — GB + Ireland

Replaces the OSRM public demo server with a routing engine we control. Valhalla gives us real
truck restrictions (height / weight / axles from OSM tags), which is what the Pro "truck" mode in
SolidMaps currently only *warns* about.

This directory is host-agnostic: it is plain Docker Compose, so it runs on any Linux VM with
Docker and ~8 GB RAM. Nothing here is tied to a specific provider.

## Two consumers of the same build

The tile build is the asset; the VM is only one way to serve it.

| Consumer | Needs | Role |
|---|---|---|
| **Native Valhalla on the VM** | a long-lived process, 2–4 GB RSS | The **server engine**: server-to-server callers (TruckRoute), routes beyond the on-device span guard, and the fallback when a device cannot run WebAssembly. |
| **routewasm (Valhalla → WebAssembly)** | static files only | The **on-device engine**: routes are calculated in the browser with no per-route server call, and keep working offline inside retained coverage. |

Both read the same graph, so the truck restrictions verified in step 7 below are the ones the
on-device engine enforces too. `scripts/pack-routewasm-tiles.mjs` converts the built tree into the
static layout the WebAssembly client fetches — see [On-device routing](#on-device-routing-routewasm).

That is also why coverage here is a *list*: `scripts/fetch-extracts.sh` takes any number of
Geofabrik extracts, so widening the build is one line and one rebuild.

## Provisioning a VPS (Option A — build on the box)

One script takes a fresh Ubuntu VPS (Hetzner CX33, 8 GB) to a serving engine:

```bash
ROUTING_ENGINE_TOKEN=<vault: valhalla-vps-token.txt> \
VALHALLA_DOMAIN=valhalla.solidmap.app \
ACME_EMAIL=fbirele@gmail.com \
sudo -E bash setup-vps.sh
```

It installs Docker, adds the 4 GB swap net, pulls the estate files from this repo,
downloads GB+IE extracts, builds tiles (25-40 min, ~8 GB peak), fronts everything with
Caddy (auto-TLS + bearer gate), and finishes with an end-to-end truck-route verification.
Prereq: DNS for $VALHALLA_DOMAIN -> the VPS IP (Cloudflare proxy is fine).
Token lives in the estate vault; the Worker gets the same value via
`wrangler secret put ROUTING_ENGINE_TOKEN`.

## Why Valhalla cannot run on Cloudflare

The **native** engine cannot, and the Worker stays on Cloudflare:

- Valhalla is a long-lived service holding a memory-mapped tile graph (GB + Ireland ≈ **2–4 GB RSS**
  at rest, ≈ **8 GB peak** during the tile build).
- Cloudflare Workers have a 128 MB memory cap and no persistent local disk.
- Containers / VMs are the only fit.

So the server architecture is: **Worker (edge) → HTTPS → Caddy (auth + TLS) → Valhalla (VM)**.

The **WebAssembly** engine is the exception — it runs inside the browser, so it needs neither a
Worker nor a VM, only static tile storage. It never replaces the VM entirely: `routewasm` refuses
requests spanning more than `maxLocalRouteKm` (default 400 km) rather than pull hundreds of
megabytes of tiles, and the WASM build has no elevation and no transit.

## What you get

```
infra/valhalla/
├── docker-compose.yml                # valhalla (tile build + service) behind caddy (bearer-token proxy)
├── Caddyfile                         # TLS termination + shared-token auth; exposes only /route and /status
├── .env.example                      # host, email, token, pin, threads
├── scripts/
│   ├── fetch-extracts.sh             # pulls the configured Geofabrik extracts into custom_files/
│   └── pack-routewasm-tiles.mjs      # built tiles -> static layout for on-device (WebAssembly) routing
└── custom_files/                     # (gitignored) pbfs + built tiles — the only stateful volume
```

Only two endpoints are reachable through the proxy: `POST /route` and `GET /status`. Everything
else returns `404` and every request without the correct `Authorization: Bearer …` header returns
`401`. This matters because Valhalla's own HTTP API is completely unauthenticated.

## Host shortlist

Sizing: **4 vCPU / 8 GB RAM / ≥40 GB disk** is the comfortable floor for GB + Ireland. The tile
build is the memory peak; steady-state serving needs far less. Prices are indicative and drift —
check current pricing before committing.

| Option | Spec | Indicative cost | Notes |
|---|---|---|---|
| **Hetzner Cloud CPX31** | 4 vCPU / 8 GB / 160 GB NVMe | ≈ €15/mo | **Recommended.** Best price/performance. EU regions (Falkenstein/Helsinki) ⇒ ~20–30 ms from the UK. |
| **Hetzner Cloud CPX21** | 3 vCPU / 4 GB / 80 GB | ≈ €10–11/mo | Cheapest viable. Trim `VALHALLA_THREADS=2` and expect a slow build; tight on RAM for the build step. |
| **OVHcloud VPS** | 4 vCPU / 8 GB, London region | ≈ £12–18/mo | Pick this if UK latency and UK data residency matter more than price. |
| **DigitalOcean / Linode** | 4 vCPU / 8 GB, London | ≈ $40–48/mo | Familiar UX, considerably more expensive for the same spec. |
| **Existing estate VPS** | — | $0 | Only if there is ≥8 GB free RAM; a tile build will starve anything else on the box. |

Deliberately **not** recommended: Fly.io / Railway. They can run the container, but Valhalla wants a
large persistent local volume plus a high steady memory ceiling, which is exactly what those
platforms price badly.

### Recommendation

Start on **Hetzner CPX31** (or an OVH London VPS if UK-only data residency is a hard requirement).
It is one small, boring VM that also gives you somewhere to put other self-hosted services later.
Provision it in the region closest to your users — for a UK product that is a UK/EU region either way.

## Runbook

### 1. Provision the host

Any Ubuntu 22.04+ VM with 4 vCPU / 8 GB RAM. Install Docker + the Compose plugin, then open
`80/tcp` and `443/tcp` in the firewall (Caddy needs both for the Let's Encrypt HTTP-01 challenge).

### 2. Point DNS at it

```
A    valhalla.solidmap.app    <host public IP>
```

Do this before `docker compose up` — Caddy requests the certificate on first start and will retry
on failure, but it is cleaner to have DNS live first.

### 3. Configure

```bash
cd infra/valhalla
cp .env.example .env
openssl rand -hex 32        # paste into ROUTING_ENGINE_TOKEN in .env
$EDITOR .env
```

### 4. Fetch the OSM extracts

```bash
./scripts/fetch-extracts.sh          # ≈ 3 GB total, one-off
```

### 5. Build tiles and start

```bash
docker compose up -d
docker compose logs -f valhalla      # the first boot builds the graph — this is the long part
```

The tile build reads everything in `custom_files/`, writes `valhalla_tiles.tar` plus the admin and
timezone DBs, then serves on `8002`. Leave it running until the logs stop showing build progress.

### 6. Verify

```bash
# Without the token → 401
curl -s -o /dev/null -w '%{http_code}\n' https://valhalla.solidmap.app/status

# With the token → 200 + version JSON
curl -s -H "Authorization: Bearer $ROUTING_ENGINE_TOKEN" https://valhalla.solidmap.app/status
```

Then a real route (any GB→IE pair proves both extracts merged correctly):

```bash
curl -s -X POST https://valhalla.solidmap.app/route \
  -H "Authorization: Bearer $ROUTING_ENGINE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"locations":[{"lat":51.5074,"lon":-0.1278},{"lat":53.3498,"lon":-6.2603}],"costing":"auto"}'
```

### 7. Prove truck avoidance actually works

The Pro copy claims height/weight are respected. Verify before trusting it:

```bash
# Same route, first as a car, then as a 4.2 m HGV. The HGV geometry must differ.
-d '{"locations":[…],"costing":"truck","costing_options":{"truck":{"height":4.2}}}'
```

Pick a corridor with a known signed low bridge. If the geometry does **not** change, the tiles were
built without truck attributes and the "enforced" warning copy is lying — fix that before enabling
truck mode in production.

### 8. Wire the Worker

```bash
# secrets/vars are set from the repo root
npx wrangler secret put ROUTING_ENGINE_TOKEN     # same value as .env
```

Then flip the engine in `wrangler.toml` — see the commented block there. **Do not flip it before
step 6 passes**: an unreachable engine degrades every route to a straight line.

## On-device routing (routewasm)

The same tile build drives a second engine that runs in the browser: [routewasm](https://routewasm.dev)
is Valhalla compiled to WebAssembly, and it speaks Valhalla's JSON API verbatim. Routes are then
calculated on the device — no per-route server call, a real offline story inside retained coverage,
and no per-route fee. It ships behind a flag (`NEXT_PUBLIC_ROUTEWASM_*`) and silently falls back to
the Worker engine on any failure, so enabling it can never take routing down.

The one thing it needs from us is **static hosting**, because it fetches graph tiles one at a time
from a plain URL template.

### 1. Build the tiles

Exactly as above — `./scripts/fetch-extracts.sh && docker compose up -d`. The native build is the
prerequisite for the on-device one.

### 2. Take the locales out of the image

The WASM client fetches directions strings as `<localesUrl>/<language>.json`, and
`lib/routewasm.ts` asks for `en-GB`. Skip this and you must leave
`NEXT_PUBLIC_ROUTEWASM_LOCALES_URL` blank (which quietly re-introduces a call to the SDK author's
host — the last third-party dependency in the path).

```bash
docker compose cp valhalla:/usr/share/valhalla/locales ./custom_files/locales
```

### 3. Pack

Valhalla serves a tile *directory*; routewasm fetches `<tilePath>.zst`. This converts one to the
other, sanitises the config (`mjolnir.tile_url = "wasm://{tilePath}"`) and writes a `manifest.json`
with the tile count and byte totals.

The scripted image runs with `build_tar=True`, so the graph lands as a single `valhalla_tiles.tar`
rather than an unpacked tree. Unpack it once before packing:

```bash
tar -xf custom_files/valhalla_tiles.tar -C custom_files
node infra/valhalla/scripts/pack-routewasm-tiles.mjs        # Node >= 22.15; no `zstd` binary needed
```

Output lands in `custom_files/routewasm-release/`:

```
routewasm-release/
├── 0/… 1/… 2/…            # the graph, one *.gph.zst per tile, nested exactly as Valhalla wrote it
├── config.json
├── locales/en-GB.json …
└── manifest.json          # datasetId, tile count, uncompressed/compressed bytes
```

### 4. Upload

The tree is static; only the tile paths matter. R2 keeps it inside the Cloudflare account and
serves with no egress fee, but any static host works. Upload with an S3-compatible client, not
`wrangler r2 object put` — that is one object per invocation and there are tens of thousands here.

```bash
# R2 is S3-compatible. Create the bucket once, then mirror the tree under a dataset prefix.
rclone sync custom_files/routewasm-release/ r2:solidmaps-tiles/gb-ie/ --checksum
# or: aws s3 sync custom_files/routewasm-release/ s3://solidmaps-tiles/gb-ie/ \
#       --endpoint-url https://<accountid>.r2.cloudflarestorage.com
```

The prefix is what versions a dataset. Change the coverage or refresh the OSM data → upload to a
**new** prefix and repoint `NEXT_PUBLIC_ROUTEWASM_TILE_URL`; never overwrite a live one, because
devices have tiles cached under the old dataset id and would mix graphs.

Bucket (created once, empty until the packer runs — `solidmaps-tiles` is the intended name):

```bash
npx wrangler r2 bucket create solidmaps-tiles
```

Hosting requirements:

- **Public read.** Either a custom domain on the bucket (`tiles.solidmap.app`) or a Worker in front.
- **CORS.** The app fetches these cross-origin from `solidmap.app`, so the tile host must return
  `Access-Control-Allow-Origin` for the app origins. Without it every tile fetch fails and routing
  falls back to the Worker.
- **`Timing-Allow-Origin`.** Optional, but without it the browser zeroes every `transferSize`, so
  step 6's byte totals are a lower bound and first-load size cannot be measured honestly. Set it to
  the same origins as `Access-Control-Allow-Origin`.

### 5. Point the app at it

```bash
NEXT_PUBLIC_ROUTEWASM_ENABLED=1
NEXT_PUBLIC_ROUTEWASM_TILE_URL=https://tiles.solidmap.app/gb-ie/{tilePath}.zst
NEXT_PUBLIC_ROUTEWASM_CONFIG_URL=https://tiles.solidmap.app/gb-ie/config.json
NEXT_PUBLIC_ROUTEWASM_LOCALES_URL=https://tiles.solidmap.app/gb-ie/locales
NEXT_PUBLIC_ROUTEWASM_DATASET_ID=gb-ie-2026-11-05        # must change when tile contents change
NEXT_PUBLIC_ROUTEWASM_MAX_KM=400                          # optional; the span guard (0 = disabled)
```

`{tilePath}` **must** survive verbatim in the template — the SDK substitutes it and appends nothing,
including the `.zst`. `DATASET_ID` is the OPFS cache key: it is what lets you move tiles between
hosts without every device re-downloading the graph, and it is what keeps two datasets from mixing.

### 6. Measure before committing

One successful route proves nothing about first-use cost. Take the three numbers from
[the performance guide](https://routewasm.dev/docs/performance.md) — **cold** (fresh profile),
**warm** (median/p95 over ~30 repeats), **reload/offline** — and read `client.metrics()` for
`persistent_tiles` hit/miss.

In a dev build the harness does all of it: run one route once (any mode), then

```js
window.__solidmapsBench.run({ origin: { lat: 51.5074, lon: -0.1278 }, destination: { lat: 53.4808, lon: -2.2426 } })
// truck: { mode: 'truck', profile: <VehicleProfile> }   nearby: { jitterMeters: 2000, repeats: 30 }
```

It clears the persisted graph first, so the first timing is a real cold transfer, then repeats and
reports median/p95, tile counts, transferred bytes and `client.metrics()` as one JSON blob you can
copy out of DevTools. `window.__solidmapsRouteEngine` exposes the raw client alongside it.

Report the dataset release, device, browser and network alongside those numbers, plus whether the
visual map was loaded: map tiles are a separate download and are easily mistaken for routing cost.
Two caveats the harness prints itself — cold excludes WASM/engine startup, and the byte totals need
`Timing-Allow-Origin` on the tile host or they are only a lower bound.

Set expectations against the published shape: transfer is dominated by the two endpoints, not the
distance — roughly 53 MB at 10 km rising to ~111 MB at 400 km, then a hard knee above it. A GB-only
tileset is much smaller than those planet figures, but the curve still applies within it.

### Adding a country

Coverage is the extract list, so this is a one-line change plus a rebuild:

```bash
cd infra/valhalla
SOLIDMAPS_REGIONS="europe/great-britain-latest.osm.pbf europe/ireland-and-northern-ireland-latest.osm.pbf europe/france-latest.osm.pbf" \
  ./scripts/fetch-extracts.sh
# rebuild: set VALHALLA_USE_TILES_IGNORE_PBF=False, docker compose up -d, then set it back to True
node scripts/pack-routewasm-tiles.mjs --dataset-id gb-ie-fr-2026-12-01
```

Then upload to a new prefix and repoint the env vars. Nothing in the app changes: tiles are fetched
per route, so a user in London never downloads the French tiles, and the added countries cost only
build time and storage until someone routes there. That is what makes "add countries as subscription
revenue funds it" a config change rather than an engineering project.

## Operating notes

- **Rebuilding after an OSM refresh.** Drop the new `.osm.pbf` into `custom_files/`, set
  `VALHALLA_USE_TILES_IGNORE_PBF=False`, `docker compose up -d` once, then set it back to `True`.
  With it left at `True` the container reuses the existing tarball and ignores new extracts.
- **Build gets OOM-killed.** Lower `VALHALLA_THREADS` (each thread holds significant working memory).
- **Tiles are the only state.** `custom_files/` is the entire backup surface. Back up the tarball
  if rebuilds are expensive for you.
- **Elevation is off.** `build_elevation: "False"` means `/height` and grade-sensitive routing are
  unavailable. Flip it on (and rebuild) if the truck feature needs surveyed heights rather than
  OSM's tagged `maxheight`.
