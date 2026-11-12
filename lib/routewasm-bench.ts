import type { Mode, RouteRequest, RouteResponse, VehicleProfile } from '@/shared/types';
import type { RouteWasmClient } from 'routewasm';

/**
 * Dev-only measurement harness for the on-device (routewasm) engine.
 *
 * The open question behind the on-device prototype is "how big is the first download, and how fast
 * is a route on a phone?" — and a single successful route cannot answer either. This harness takes
 * the three measurements routewasm's performance guide asks for, in the same shape, so the numbers
 * are comparable with the published ones:
 *
 *   1. cold     — persistent tiles dropped first, so the graph is re-downloaded
 *   2. warm     — median + p95 over N repeats (default 30, matching the guide's example)
 *   3. transfer — tile requests and bytes seen by the Resource Timing API
 *
 * Installed as `window.__solidmapsBench` outside production builds only, and imported dynamically so
 * it can never land in a production bundle. See infra/valhalla/README.md step 6.
 */

/** A route run, injected rather than imported to avoid a cycle with lib/routewasm.ts. */
type RunRoute = (req: RouteRequest, profile: VehicleProfile | null) => Promise<RouteResponse>;

export interface BenchTarget {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  mode?: Mode;
  profile?: VehicleProfile | null;
  /** Warm repeats. 30 matches the performance guide's median/p95 example. */
  repeats?: number;
  /**
   * Jitter each warm destination by roughly this many metres. The guide's warm step says to vary
   * nearby endpoints, because a request that needs new tiles is the interesting case — a repeated
   * identical request only ever hits the cache.
   */
  jitterMeters?: number;
}

interface TileSnapshot {
  requests: number;
  bytes: number;
}

export interface TileTransfer extends TileSnapshot {
  /** Responses served from cache or a 304, i.e. no bytes on the wire. */
  fromCache: number;
  /**
   * False when cross-origin timing is hidden (no `Timing-Allow-Origin` on the tile host), in which
   * case every `transferSize` is 0 and the byte total is a lower bound. See the README's CORS note.
   */
  bytesVisible: boolean;
}

export interface BenchReport {
  mode: Mode;
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  jitterMeters: number;
  route: { distanceKm: number; durationMin: number; steps: number } | null;
  cold: { ms: number; transfer: TileTransfer };
  warm: { repeats: number; minMs: number; medianMs: number; p95Ms: number; maxMs: number };
  session: { transfer: TileTransfer; metrics: Record<string, unknown> | { error: string } };
  notes: string[];
  error?: string;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Cumulative tile traffic since the page loaded. Callers subtract snapshots to get a phase delta. */
function tileSnapshot(): TileSnapshot {
  let requests = 0;
  let bytes = 0;
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    // The tile template ends in `.zst` (NEXT_PUBLIC_ROUTEWASM_TILE_URL); config/locales are `.json`.
    if (!entry.name.includes('.zst')) continue;
    requests++;
    bytes += entry.transferSize || entry.encodedBodySize || 0;
  }
  return { requests, bytes };
}

function describe(delta: TileSnapshot): TileTransfer {
  let fromCache = 0;
  let bytesVisible = false;
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    if (!entry.name.includes('.zst')) continue;
    if (entry.transferSize > 0) bytesVisible = true;
    if (entry.transferSize === 0 && entry.decodedBodySize > 0) fromCache++;
  }
  return { ...delta, fromCache, bytesVisible };
}

function diff(after: TileSnapshot, before: TileSnapshot): TileSnapshot {
  return { requests: after.requests - before.requests, bytes: after.bytes - before.bytes };
}

/** ~1e-5 degrees is ~1.1 m of latitude; good enough to step off a cached tile edge. */
function offset(point: { lat: number; lon: number }, metres: number, seed: number): { lat: number; lon: number } {
  if (!metres) return point;
  const angle = seed * 2.399963; // golden angle, so repeats fan out instead of drifting one way
  const dLat = (metres * Math.cos(angle)) / 111_320;
  const dLon = (metres * Math.sin(angle)) / (111_320 * Math.cos((point.lat * Math.PI) / 180) || 1);
  return { lat: point.lat + dLat, lon: point.lon + dLon };
}

export function installRouteBench(client: RouteWasmClient, runRoute: RunRoute): void {
  if (typeof window === 'undefined') return;

  const bench = {
    client,

    /** Drop the persisted graph for this dataset, so the next route is a genuine cold start. */
    async clear(): Promise<void> {
      await client.clearPersistentTiles();
      console.info('[solidmaps/bench] persistent tiles cleared for this dataset');
    },

    async metrics(): Promise<Record<string, unknown>> {
      return client.metrics();
    },

    transfer(): TileTransfer {
      return describe(tileSnapshot());
    },

    async run(target: BenchTarget): Promise<BenchReport> {
      const mode = target.mode ?? 'car';
      const profile = target.profile ?? null;
      const repeats = Math.max(2, target.repeats ?? 30);
      const jitterMeters = Math.max(0, target.jitterMeters ?? 0);
      const req: RouteRequest = { origin: target.origin, destination: target.destination, mode };

      const notes = [
        'cold excludes WASM instantiation and engine startup — the client is already initialised.',
        'byte totals need Timing-Allow-Origin on the tile host; if bytesVisible is false they are a lower bound.',
        'the visual map (PMTiles/basemap) is a separate download and is not counted here.',
        'report the dataset id, device, browser and network with these numbers before committing.',
      ];

      let route: BenchReport['route'] = null;
      try {
        // 1. Cold: clear persisted tiles so the graph is transferred again.
        await client.clearPersistentTiles();
        const beforeCold = tileSnapshot();
        const coldStart = performance.now();
        const coldResult = await runRoute(req, profile);
        const coldMs = performance.now() - coldStart;
        const coldTransfer = describe(diff(tileSnapshot(), beforeCold));

        route = {
          distanceKm: Math.round(coldResult.distance_meters / 100) / 10,
          durationMin: Math.round(coldResult.duration_seconds / 6) / 10,
          steps: coldResult.steps.length,
        };

        // 2. Warm: the same request again, optionally walking the destination off the cached tiles.
        const timings: number[] = [];
        for (let i = 0; i < repeats; i++) {
          const warmReq: RouteRequest =
            jitterMeters > 0
              ? { ...req, destination: offset(target.destination, jitterMeters, i) }
              : req;
          const start = performance.now();
          await runRoute(warmReq, profile);
          timings.push(performance.now() - start);
        }
        const sorted = [...timings].sort((a, b) => a - b);

        // 3. Session view: everything the app has pulled, plus the engine's own counters.
        let metrics: BenchReport['session']['metrics'];
        try {
          metrics = await client.metrics();
        } catch (err) {
          metrics = { error: err instanceof Error ? err.message : String(err) };
        }

        const report: BenchReport = {
          mode,
          origin: target.origin,
          destination: target.destination,
          jitterMeters,
          route,
          cold: { ms: coldMs, transfer: coldTransfer },
          warm: {
            repeats,
            minMs: sorted[0],
            medianMs: median(sorted),
            p95Ms: percentile(sorted, 0.95),
            maxMs: sorted[sorted.length - 1],
          },
          session: { transfer: describe(tileSnapshot()), metrics },
          notes,
        };
        log(report);
        return report;
      } catch (err) {
        const report: BenchReport = {
          mode,
          origin: target.origin,
          destination: target.destination,
          jitterMeters,
          route,
          cold: { ms: 0, transfer: describe({ requests: 0, bytes: 0 }) },
          warm: { repeats, minMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0 },
          session: { transfer: describe(tileSnapshot()), metrics: {} },
          notes,
          error: err instanceof Error ? err.message : String(err),
        };
        console.error('[solidmaps/bench] run failed —', report.error);
        console.log(JSON.stringify(report, null, 2));
        return report;
      }
    },
  };

  (window as unknown as { __solidmapsBench?: unknown }).__solidmapsBench = bench;
  console.info(
    '[solidmaps/bench] ready — window.__solidmapsBench.run({ origin, destination, mode, jitterMeters })',
  );
}

function log(report: BenchReport): void {
  console.log(
    `[solidmaps/bench] cold ${report.cold.ms.toFixed(0)} ms · ` +
      `${(report.cold.transfer.bytes / 1e6).toFixed(2)} MB in ${report.cold.transfer.requests} tiles · ` +
      `warm median ${report.warm.medianMs.toFixed(0)} ms / p95 ${report.warm.p95Ms.toFixed(0)} ms ` +
      `over ${report.warm.repeats}`,
  );
  // Full report as JSON so it can be copied straight out of DevTools (right-click → Copy).
  console.log(JSON.stringify(report, null, 2));
}
