import type { RouteRequest, RouteResponse, VehicleProfile } from '@/shared/types';
import {
  engineWarnings,
  parseValhallaLeg,
  valhallaCosting,
  valhallaTruckOptions,
  type ValhallaResponse,
} from '@/shared/routing';

/**
 * On-device routing via Valhalla compiled to WebAssembly (the `routewasm` SDK).
 *
 * This is an *alternative engine* to the Cloudflare Worker's `/api/route`: the graph tiles are
 * fetched from static storage (R2) and cached in OPFS, so route calculation happens on the device
 * with no per-route server call. It speaks Valhalla's JSON API verbatim, which is why the response
 * parsing lives in `shared/routing.ts` and is identical to the server adapter's.
 *
 * Ships behind a flag and is opt-in per build — see NEXT_PUBLIC_ROUTEWASM_* in next.config.js.
 */

const ENABLED = process.env.NEXT_PUBLIC_ROUTEWASM_ENABLED === '1';
const TILE_URL_TEMPLATE = process.env.NEXT_PUBLIC_ROUTEWASM_TILE_URL ?? '';
const CONFIG_URL = process.env.NEXT_PUBLIC_ROUTEWASM_CONFIG_URL ?? '';
const LOCALES_URL = process.env.NEXT_PUBLIC_ROUTEWASM_LOCALES_URL ?? '';
const DATASET_ID = process.env.NEXT_PUBLIC_ROUTEWASM_DATASET_ID ?? '';
const MAX_LOCAL_ROUTE_KM = Number(process.env.NEXT_PUBLIC_ROUTEWASM_MAX_KM || '400');

/** Assets copied out of node_modules by `npm run sync:routewasm` (see scripts/sync-routewasm.mjs). */
const WORKER_URL = '/wasm/worker.js';
const WASM_JS_URL = '/wasm/valhalla_wasm.js';

export const ON_DEVICE_PROVIDER = 'valhalla-wasm';

/** True only when the flag is on *and* a tile + config source has been configured. */
export function onDeviceRoutingEnabled(): boolean {
  return ENABLED && Boolean(TILE_URL_TEMPLATE && CONFIG_URL);
}

let enginePromise: Promise<import('routewasm').RouteWasmClient> | null = null;

async function getEngine(): Promise<import('routewasm').RouteWasmClient> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { RouteWasmClient } = await import('routewasm');
      const client = new RouteWasmClient({ workerUrl: WORKER_URL });
      await client.init({
        wasmJsUrl: WASM_JS_URL,
        tileUrlTemplate: TILE_URL_TEMPLATE,
        tileCompression: 'zstd',
        configUrl: CONFIG_URL,
        localesUrl: LOCALES_URL || undefined,
        language: 'en-GB',
        // Keeps the OPFS cache across host/path changes — an explicit id is required to stay
        // sovereign over where the tiles are served from.
        datasetId: DATASET_ID || undefined,
        persistTiles: true,
        maxLocalRouteKm: MAX_LOCAL_ROUTE_KM,
        valhallaConfig: { maxCacheMB: 300 },
      });
      if (process.env.NODE_ENV !== 'production') {
        (window as unknown as { __solidmapsRouteEngine?: unknown }).__solidmapsRouteEngine = client;
        // Measurement harness. Imported dynamically so it never enters a production bundle.
        void import('./routewasm-bench').then(({ installRouteBench }) => installRouteBench(client, routeOnDevice));
      }
      return client;
    })().catch((err) => {
      // Clear the memo so a later attempt can retry (e.g. a transient tile fetch failure).
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * Route entirely on the device. Rejects on any failure (unsupported mode coverage, tile fetch
 * error, `route_too_long`) so the caller can fall back to the server engine.
 */
export async function routeOnDevice(
  req: RouteRequest,
  profile: VehicleProfile | null,
): Promise<RouteResponse> {
  const client = await getEngine();
  const costing = valhallaCosting(req.mode);
  const body: Record<string, unknown> = {
    locations: [
      { lat: req.origin.lat, lon: req.origin.lon },
      { lat: req.destination.lat, lon: req.destination.lon },
    ],
    costing,
    // Kilometres is Valhalla's default but pin it explicitly: shared parsing assumes it.
    units: 'kilometers',
    directions_options: { units: 'kilometers', language: 'en-GB' },
  };
  if (costing === 'truck') {
    const options = valhallaTruckOptions(profile);
    if (options) body.costing_options = { truck: options };
  }

  const raw = await client.call<string>('route', JSON.stringify(body));
  const data = JSON.parse(raw) as ValhallaResponse & { error?: string; error_code?: number };
  const leg = data.trip?.legs?.[0];
  if (!leg || !leg.shape) {
    throw new Error(data.error ?? 'On-device engine returned no route');
  }
  const parsed = parseValhallaLeg(leg);
  return {
    provider: ON_DEVICE_PROVIDER,
    mode: req.mode,
    distance_meters: parsed.distance_meters,
    duration_seconds: parsed.duration_seconds,
    geometry: { coordinates: parsed.coordinates },
    steps: parsed.steps,
    // 'valhalla' so the profile advisories claim enforcement, which the WASM build honours
    // exactly as the native one does (same OSM restriction data).
    warnings: engineWarnings(profile, req.destination, 'valhalla', req.mode),
    commercial: req.mode === 'truck',
  };
}
