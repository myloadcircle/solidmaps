import type { LatLon } from '@/shared/types';

/**
 * Real truck-restriction checks along a route — port of the TruckRoute v1.0.7
 * pipeline (docs: C:\DEV\truckroute-low-bridge-prompt.md, Part A): sample the
 * route polyline, query OpenStreetMap maxheight/maxweight via Overpass, parse
 * clearances, classify severity against the vehicle profile.
 *
 * Runs client-side because Overpass is reachable from browsers but hangs from
 * Cloudflare Workers egress (verified 2026-10-25). Never blocks route display;
 * callers fall back to the server's generic warnings when this fails.
 */

export type BridgeSeverity = 'critical' | 'warning' | 'info';

export interface TruckFinding {
  id: string;
  kind: 'height' | 'weight';
  /** Clearance in metres (height) or limit in tonnes (weight). */
  value: number;
  estimated: boolean;
  severity: BridgeSeverity;
  /** Position along the route where the restriction sits. */
  point: LatLon;
  /** Cumulative distance from the route start, in km. */
  atKm: number;
  source: string;
}

export interface BridgeCheck {
  status: 'ok' | 'failed' | 'skipped';
  findings: TruckFinding[];
  checkedAt: number;
}

const SAMPLE_SPACING_M = 300;
const SAMPLE_DEDUPE_M = 200;
const NEAR_ROUTE_M = 150;
const CHUNK_M = 2000;
const BBOX_PAD = 0.0025; // ≈250 m in degrees
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

function metersBetween(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la = (a[1] * Math.PI) / 180;
  const lb = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Nearest polyline index + distance for one point. */
function nearestOnPolyline(coords: [number, number][], p: [number, number]): { index: number; distM: number; atM: number } {
  let best = { index: 0, distM: Infinity, atM: 0 };
  let travelled = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
    const proj: [number, number] = [a[0] + abx * t, a[1] + aby * t];
    const d = metersBetween(proj, p);
    if (d < best.distM) best = { index: i, distM: d, atM: travelled + metersBetween(a, proj) };
    travelled += metersBetween(a, b);
  }
  const last = coords[coords.length - 1];
  const dLast = metersBetween(last, p);
  if (dLast < best.distM) best = { index: coords.length - 1, distM: dLast, atM: travelled };
  return best;
}

function samplePolyline(coords: [number, number][]): { point: [number, number]; atM: number }[] {
  if (coords.length < 2) return [];
  const out: { point: [number, number]; atM: number }[] = [{ point: coords[0], atM: 0 }];
  let sinceLast = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = metersBetween(coords[i - 1], coords[i]);
    {
      let remaining = seg;
      let pos = 0;
      while (sinceLast + remaining >= SAMPLE_SPACING_M) {
        const need = SAMPLE_SPACING_M - sinceLast;
        pos += need / seg;
        const p: [number, number] = [
          coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * pos,
          coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * pos,
        ];
        out.push({ point: p, atM: -1 });
        sinceLast = 0;
        remaining -= need;
      }
      sinceLast += remaining;
    }
  }
  // recompute atM by nearest snap
  let cum = 0;
  let j = 0;
  const withAt = out.map((s, idx) => {
    if (idx === 0) return { ...s, atM: 0 };
    while (j < coords.length - 2 && metersBetween(coords[j + 1], s.point) < metersBetween(coords[j], s.point)) {
      cum += metersBetween(coords[j], coords[j + 1]);
      j++;
    }
    return { ...s, atM: cum + metersBetween(coords[j], s.point) };
  });
  // dedupe by ~200 m
  const deduped: typeof withAt = [];
  for (const s of withAt) {
    const prev = deduped[deduped.length - 1];
    if (!prev || metersBetween(prev.point, s.point) >= SAMPLE_DEDUPE_M) deduped.push(s);
  }
  return deduped;
}

export function parseClearance(tag: string | undefined): { m: number; estimated: boolean } | null {
  if (!tag) return null;
  const v = tag.trim().toLowerCase();
  if (!v || v === 'yes' || v === 'default' || v === 'unknown' || v === 'no') return null;
  // feet/inches: 15ft, 15', 12'6", 4m6in
  const ftIn = /^(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?)?$/.exec(v);
  if (ftIn) return { m: Math.round((parseFloat(ftIn[1]) * 0.3048 + (parseFloat(ftIn[2] || '0') * 0.0254)) * 10) / 10, estimated: false };
  const mIn = /^(\d+)\s*m\s*(\d+)\s*in$/.exec(v);
  if (mIn) return { m: Math.round((parseFloat(mIn[1]) + parseFloat(mIn[2]) * 0.0254) * 10) / 10, estimated: false };
  const num = /^(\d+(?:[.,]\d+)?)\s*(?:m|metre|meter|meter)?s?$/.exec(v);
  if (num) return { m: Math.round(parseFloat(num[1].replace(',', '.')) * 10) / 10, estimated: false };
  return null;
}

export function parseWeightTonnes(tag: string | undefined): number | null {
  if (!tag) return null;
  const v = tag.trim().toLowerCase();
  const t = /^(\d+(?:[.,]\d+)?)\s*(?:t|tonne|tonnes|tons)?$/.exec(v);
  if (t) return parseFloat(t[1].replace(',', '.'));
  const kg = /^(\d+(?:\.\d+)?)\s*kg$/.exec(v);
  if (kg) return Math.round((parseFloat(kg[1]) / 1000) * 10) / 10;
  const lbs = /^(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)$/.exec(v);
  if (lbs) return Math.round((parseFloat(lbs[1]) * 0.453592 / 1000) * 10) / 10;
  return null;
}

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function cacheKey(coords: [number, number][], heightM: number | null, weightT: number | null): string {
  const sample = coords.filter((_, i) => i % Math.max(1, Math.floor(coords.length / 24)) === 0);
  return `sm_bridges:${djb2(JSON.stringify(sample) + heightM + weightT)}`;
}

export async function checkTruckRoute(
  coords: [number, number][] | null | undefined,
  vehicle: { heightM: number | null; weightKg: number | null },
): Promise<BridgeCheck> {
  if (!coords || coords.length < 2) return { status: 'skipped', findings: [], checkedAt: Date.now() };
  const cacheK = cacheKey(coords, vehicle.heightM, vehicle.weightKg);
  try {
    const cached = localStorage.getItem(cacheK);
    if (cached) {
      const parsed = JSON.parse(cached) as BridgeCheck;
      if (Date.now() - parsed.checkedAt < CACHE_TTL_MS) return parsed;
    }
  } catch {}
  try {
    const samples = samplePolyline(coords);
    if (samples.length === 0) return { status: 'skipped', findings: [], checkedAt: Date.now() };
    // chunk samples into ~2 km groups
    const chunks: { point: [number, number]; atM: number }[][] = [];
    let chunkStartM = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (chunks.length === 0 || s.atM - chunkStartM > CHUNK_M) {
        chunks.push([]);
        chunkStartM = s.atM;
      }
      chunks[chunks.length - 1].push(s);
    }
    // one batched Overpass query per ≤4 chunks (URL length guard)
    const findings: TruckFinding[] = [];
    const seen = new Set<string>();
    for (let g = 0; g < chunks.length; g += 4) {
      const group = chunks.slice(g, g + 4);
      const clauses: string[] = [];
      for (const chunk of group) {
        for (const s of chunk) {
          const sLat = (s.point[1] - BBOX_PAD).toFixed(5);
          const wLon = (s.point[0] - BBOX_PAD).toFixed(5);
          const nLat = (s.point[1] + BBOX_PAD).toFixed(5);
          const eLon = (s.point[0] + BBOX_PAD).toFixed(5);
          clauses.push(`way["maxheight"](${sLat},${wLon},${nLat},${eLon});way["maxweight"](${sLat},${wLon},${nLat},${eLon});`);
        }
      }
      const query = `[out:json][timeout:25];(${clauses.join('')});out geom;`;
      let ways: OverpassWay[] = [];
      // Mirror fallback: the public instances throttle aggressive IPs; browsers
      // on user networks reach at least one of these (TruckRoute-proven).
      for (const endpoint of OVERPASS_ENDPOINTS) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          const res = await fetch(endpoint + '?data=' + encodeURIComponent(query), {
            signal: ctrl.signal,
          });
          if (res.ok) {
            const j = (await res.json()) as { elements?: OverpassWay[] };
            ways = j.elements ?? [];
            if (ways.length > 0) break;
          }
        } catch {
          // try the next mirror
        } finally {
          clearTimeout(timer);
        }
      }
      for (const way of ways) {
        if (seen.has(String(way.id))) continue;
        const tags = way.tags ?? {};
        const geom = way.geometry ?? [];
        // nearest geometry point to the route
        let best: { distM: number; atM: number; point: LatLon } | null = null;
        for (const gpt of geom) {
          const p: [number, number] = [gpt.lon, gpt.lat];
          const near = nearestOnPolyline(coords, p);
          if (!best || near.distM < best.distM) {
            best = { distM: near.distM, atM: near.atM, point: { lat: gpt.lat, lon: gpt.lon } };
          }
        }
        if (!best || best.distM > NEAR_ROUTE_M) continue;
        // height
        const hTag = tags['maxheight:physical'] ?? tags['maxheight:legal'] ?? tags['maxheight'] ?? tags['clearance'];
        const est = !tags['maxheight:physical'] && !tags['maxheight:legal'] && !tags['maxheight'] && !!tags['clearance'];
        const h = parseClearance(hTag);
        if (h && vehicle.heightM) {
          const severity: BridgeSeverity = h.m <= vehicle.heightM + 0.3 ? 'critical' : h.m <= vehicle.heightM + 0.8 ? 'warning' : 'info';
          seen.add(String(way.id));
          findings.push({
            id: `h${way.id}`,
            kind: 'height',
            value: h.m,
            estimated: est,
            severity,
            point: best.point,
            atKm: Math.round((best.atM / 1000) * 10) / 10,
            source: hTag ?? 'maxheight',
          });
          continue;
        }
        // weight
        const wTag = tags['maxweight:physical'] ?? tags['maxweight'] ?? tags['maxweight:hgv'];
        const w = parseWeightTonnes(wTag);
        if (w && vehicle.weightKg) {
          const vehicleT = vehicle.weightKg / 1000;
          const severity: BridgeSeverity = w < vehicleT ? 'critical' : w < vehicleT * 1.1 ? 'warning' : 'info';
          seen.add(String(way.id));
          findings.push({
            id: `w${way.id}`,
            kind: 'weight',
            value: w,
            estimated: false,
            severity,
            point: best.point,
            atKm: Math.round((best.atM / 1000) * 10) / 10,
            source: wTag ?? 'maxweight',
          });
        }
      }
    }
    findings.sort((a, b) => {
      const rank = { critical: 0, warning: 1, info: 2 } as const;
      return rank[a.severity] - rank[b.severity] || a.atKm - b.atKm;
    });
    const result: BridgeCheck = { status: 'ok', findings: findings.slice(0, 12), checkedAt: Date.now() };
    try {
      localStorage.setItem(cacheK, JSON.stringify(result));
    } catch {}
    return result;
  } catch {
    return { status: 'failed', findings: [], checkedAt: Date.now() };
  }
}
