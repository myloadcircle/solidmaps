import type {
  FuelType,
  LatLon,
  Mode,
  ParkingResponse,
  ParkingZone,
  RouteRequest,
  RouteResponse,
  RouteStep,
  RouteWarning,
  SubscriptionTier,
  User,
  VehicleProfile,
  VehicleType,
} from '../../shared/types';

export interface Env {
  DB: D1Database;
  AUTH_SECRET?: string;
  ROUTING_ENGINE_URL?: string;
  ROUTING_ENGINE_TYPE?: string;
  PARKING_API_URL?: string;
  ALLOWED_ORIGIN?: string;
}

const MODES: Mode[] = ['walk', 'transit', 'car', 'truck'];
const VEHICLE_TYPES: VehicleType[] = ['car', 'van', 'hgv', 'motorcycle'];
const FUEL_TYPES: FuelType[] = ['petrol', 'diesel', 'electric', 'hybrid', 'hydrogen', 'other'];
const USER_AGENT = 'solidmaps-api/1.0 (https://solidmaps.app)';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function corsHeaders(env: Env): HeadersInit {
  const origin = env.ALLOWED_ORIGIN ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: unknown, status = 200, env?: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(env ? corsHeaders(env) : {}) },
  });
}

function fail(message: string, status: number, env: Env): Response {
  return json({ error: message }, status, env);
}

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(sig);
}

async function issueToken(userId: string, env: Env): Promise<string> {
  const secret = env.AUTH_SECRET ?? 'dev-insecure-secret';
  const payload = b64url(new TextEncoder().encode(userId));
  return `${payload}.${await hmac(payload, secret)}`;
}

async function verifyToken(token: string, env: Env): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = await hmac(payload, env.AUTH_SECRET ?? 'dev-insecure-secret');
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  return atob(payload.replace(/-/g, '+').replace(/_/g, '/')) || null;
}

interface UserRow {
  id: string;
  email: string;
  subscription_tier: string;
}

async function authUser(request: Request, env: Env): Promise<UserRow | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const userId = await verifyToken(token, env);
  if (!userId) return null;
  const row = await env.DB.prepare('SELECT id, email, subscription_tier FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRow>();
  return row ?? null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleIssue(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? '';
  if (!EMAIL_RE.test(email)) return fail('A valid email is required', 400, env);
  const id = crypto.randomUUID();
  const existing = await env.DB.prepare('SELECT id, subscription_tier FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; subscription_tier: string }>();
  let userId = existing?.id;
  if (!userId) {
    try {
      await env.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, email).run();
      userId = id;
    } catch {
      const again = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
      userId = again?.id ?? id;
    }
  }
  const token = await issueToken(userId, env);
  const user: User = {
    id: userId,
    email,
    subscription_tier: existing?.subscription_tier === 'pro' ? 'pro' : 'free',
  };
  return json({ token, user }, 200, env);
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return fail('Authentication required', 401, env);
  const payload: User = {
    id: user.id,
    email: user.email,
    subscription_tier: user.subscription_tier === 'pro' ? 'pro' : 'free',
  };
  return json(payload, 200, env);
}

async function handleGeocode(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get('q') ?? '';
  if (q.trim().length < 2) return fail('Missing query parameter "q"', 400, env);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
    { headers: { 'User-Agent': USER_AGENT } },
  );
  if (!res.ok) return fail('Geocoding provider error', 502, env);
  const data = (await res.json()) as { place_id: number; display_name: string; lat: string; lon: string }[];
  return json(
    data.map((d) => ({ id: String(d.place_id), text: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon) })),
    200,
    env,
  );
}

function validLatLon(p: LatLon | undefined | null): p is LatLon {
  return !!p && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}

function haversineM(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ulezCompliant(profile: VehicleProfile): boolean {
  const fuel = profile.fuel_type;
  const cls = profile.emissions_class;
  if (!fuel || !cls) return true;
  if (fuel === 'electric' || fuel === 'hydrogen') return true;
  const m = cls.match(/euro\s*(\d+)/i);
  if (!m) return true;
  const euro = parseInt(m[1], 10);
  return fuel === 'petrol' ? euro >= 4 : euro >= 6;
}

function vehicleWarnings(profile: VehicleProfile | null, destination: LatLon, engine: string): RouteWarning[] {
  const warnings: RouteWarning[] = [];
  if (!profile) return warnings;
  const enforced = engine === 'valhalla';
  if (profile.max_height_meters) {
    warnings.push({
      type: 'bridge',
      title: `Height limit ${profile.max_height_meters}m active`,
      detail: enforced
        ? 'Bridge clearance is respected where OpenStreetMap data includes it.'
        : 'This engine cannot enforce height limits — check bridge clearances manually.',
      point: destination,
    });
  }
  if (profile.gross_weight_kg) {
    warnings.push({
      type: 'info',
      title: `Weight limit ${profile.gross_weight_kg}kg active`,
      detail: enforced
        ? 'Weight restrictions are respected where OpenStreetMap data includes them.'
        : 'This engine cannot enforce weight limits — check restrictions manually.',
      point: destination,
    });
  }
  if (!ulezCompliant(profile)) {
    warnings.push({
      type: 'ulez',
      title: 'ULEZ Zone Ahead',
      detail: `${profile.fuel_type ?? 'unknown fuel'} ${profile.emissions_class ?? 'unknown class'} is not ULEZ-compliant — check the zone boundary before entering.`,
      point: destination,
    });
  }
  return warnings;
}

function engineWarnings(profile: VehicleProfile | null, destination: LatLon, engine: string, mode: Mode): RouteWarning[] {
  const warnings = vehicleWarnings(profile, destination, engine);
  if (mode === 'transit') {
    warnings.unshift({
      type: 'info',
      title: 'Transit not available',
      detail: 'This routing engine has no transit data — showing a walking route instead.',
    });
  }
  return warnings;
}

function haversineRoute(origin: LatLon, destination: LatLon, mode: Mode, warnings: RouteWarning[]): RouteResponse {
  const distance = haversineM(origin, destination);
  const speed = mode === 'walk' || mode === 'transit' ? 1.4 : 13.9;
  return {
    provider: 'haversine',
    mode,
    distance_meters: Math.round(distance),
    duration_seconds: Math.max(60, Math.round(distance / speed)),
    geometry: {
      coordinates: [
        [origin.lon, origin.lat],
        [destination.lon, destination.lat],
      ],
    },
    steps: [
      { instruction: 'Proceed directly toward your destination (straight-line route).', distance_meters: Math.round(distance) },
      { instruction: 'You have arrived at your destination.', distance_meters: 0 },
    ],
    warnings,
    commercial: mode === 'truck',
  };
}

function decodePolyline6(str: string): [number, number][] {
  let lat = 0;
  let lon = 0;
  let i = 0;
  const out: [number, number][] = [];
  while (i < str.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

function osrmInstruction(step: { maneuver: { type: string; modifier?: string; exit?: number }; name?: string }): string {
  const t = step.maneuver.type;
  const mod = step.maneuver.modifier ?? '';
  const onto = step.name ? ` onto ${step.name}` : '';
  switch (t) {
    case 'depart':
      return `Depart${step.name ? ` from ${step.name}` : ''}`;
    case 'arrive':
      return 'Arrive at your destination';
    case 'turn':
    case 'new name':
      return `Turn ${mod}${onto}`;
    case 'continue':
    case 'end of road':
      return `Continue ${mod}${onto}`.trim();
    case 'merge':
      return `Merge${onto}`;
    case 'on ramp':
    case 'off ramp':
      return `Take the ramp${onto}`;
    case 'fork':
      return `Keep ${mod} at the fork${onto}`;
    case 'roundabout':
    case 'rotary':
      return `Enter the ${t} and take exit ${step.maneuver.exit ?? 1}${onto}`;
    default:
      return `${t}${mod ? ` ${mod}` : ''}${onto}`;
  }
}

interface OsrmResponse {
  routes?: {
    distance: number;
    duration: number;
    geometry?: { coordinates: [number, number][] };
    legs?: { steps?: { distance: number; name?: string; maneuver: { type: string; modifier?: string; exit?: number } }[] }[];
  }[];
}

async function osrmRoute(
  origin: LatLon,
  destination: LatLon,
  mode: Mode,
  profile: VehicleProfile | null,
  env: Env,
): Promise<RouteResponse> {
  const profileName = mode === 'walk' || mode === 'transit' ? 'foot' : 'driving';
  const base = env.ROUTING_ENGINE_URL!.replace(/\/+$/, '');
  const url = `${base}/route/v1/${profileName}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new ApiError(502, 'Routing engine error');
  const data = (await res.json()) as OsrmResponse;
  const route = data.routes?.[0];
  if (!route) throw new ApiError(502, 'Routing engine returned no route');
  const steps: RouteStep[] = (route.legs?.[0]?.steps ?? []).map((s) => ({
    instruction: osrmInstruction(s),
    distance_meters: Math.round(s.distance),
  }));
  return {
    provider: 'osrm',
    mode,
    distance_meters: Math.round(route.distance),
    duration_seconds: Math.round(route.duration),
    geometry: { coordinates: route.geometry?.coordinates ?? [] },
    steps,
    warnings: engineWarnings(profile, destination, 'osrm', mode),
    commercial: mode === 'truck',
  };
}

interface ValhallaResponse {
  trip?: {
    legs?: {
      shape: string;
      summary?: { length: number; time: number };
      maneuvers?: { instruction: string; length?: number }[];
    }[];
  };
}

async function valhallaRoute(
  origin: LatLon,
  destination: LatLon,
  mode: Mode,
  profile: VehicleProfile | null,
  env: Env,
): Promise<RouteResponse> {
  const costing = mode === 'walk' || mode === 'transit' ? 'pedestrian' : mode === 'truck' ? 'truck' : 'auto';
  const body: Record<string, unknown> = {
    locations: [
      { lat: origin.lat, lon: origin.lon },
      { lat: destination.lat, lon: destination.lon },
    ],
    costing,
  };
  if (costing === 'truck' && profile) {
    const opts: Record<string, number> = {};
    if (profile.max_height_meters) opts.height = profile.max_height_meters;
    if (profile.gross_weight_kg) opts.weight = Math.round((profile.gross_weight_kg / 1000) * 10) / 10;
    if (profile.axle_count) opts.axle_count = profile.axle_count;
    if (Object.keys(opts).length > 0) body.costing_options = { truck: opts };
  }
  const base = env.ROUTING_ENGINE_URL!.replace(/\/+$/, '');
  const res = await fetch(`${base}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(502, 'Routing engine error');
  const data = (await res.json()) as ValhallaResponse;
  const leg = data.trip?.legs?.[0];
  if (!leg || !leg.shape) throw new ApiError(502, 'Routing engine returned no route');
  const steps: RouteStep[] = (leg.maneuvers ?? [])
    .filter((m) => m.instruction)
    .map((m) => ({ instruction: m.instruction, distance_meters: Math.round((m.length ?? 0) * 1000) }));
  return {
    provider: 'valhalla',
    mode,
    distance_meters: Math.round((leg.summary?.length ?? 0) * 1000),
    duration_seconds: Math.round(leg.summary?.time ?? 0),
    geometry: { coordinates: decodePolyline6(leg.shape) },
    steps,
    warnings: engineWarnings(profile, destination, 'valhalla', mode),
    commercial: mode === 'truck',
  };
}

async function routeWithEngine(
  origin: LatLon,
  destination: LatLon,
  mode: Mode,
  profile: VehicleProfile | null,
  env: Env,
): Promise<RouteResponse> {
  const engineType = (env.ROUTING_ENGINE_TYPE ?? 'osrm').toLowerCase();
  const fallback = (detail: string): RouteResponse =>
    haversineRoute(origin, destination, mode, [
      { type: 'info', title: 'Straight-line route', detail },
      ...engineWarnings(profile, destination, engineType, mode),
    ]);
  if (!env.ROUTING_ENGINE_URL) {
    return fallback('No routing engine configured — showing a direct line instead of road routing.');
  }
  try {
    if (engineType === 'valhalla') return await valhallaRoute(origin, destination, mode, profile, env);
    return await osrmRoute(origin, destination, mode, profile, env);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 502) throw err;
    return fallback('The routing engine is unreachable — showing a direct line instead.');
  }
}

async function handleRoute(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as RouteRequest | null;
  if (!body || !validLatLon(body.origin) || !validLatLon(body.destination) || !MODES.includes(body.mode)) {
    return fail('Invalid request: origin, destination and a valid mode are required', 400, env);
  }
  const { origin, destination, mode } = body;
  const user = await authUser(request, env);
  const tier: SubscriptionTier = user?.subscription_tier === 'pro' ? 'pro' : 'free';

  if (mode === 'truck' && tier !== 'pro') {
    return fail('Truck routing requires a Pro subscription', 403, env);
  }

  let profile: VehicleProfile | null = null;
  if ((mode === 'truck' || mode === 'car') && tier === 'pro' && user && body.vehicle_id) {
    const row = await env.DB.prepare('SELECT * FROM vehicle_profiles WHERE id = ? AND user_id = ?')
      .bind(body.vehicle_id, user.id)
      .first<VehicleProfileRow>();
    if (!row) return fail('Vehicle profile not found', 404, env);
    profile = normalizeProfile(row);
  }

  return json(await routeWithEngine(origin, destination, mode, profile, env), 200, env);
}

type VehicleProfileRow = Omit<VehicleProfile, 'id' | 'user_id'> & { id: string; user_id: string; created_at?: number };

function normalizeProfile(row: VehicleProfileRow): VehicleProfile {
  return {
    id: row.id,
    user_id: row.user_id,
    vehicle_type: row.vehicle_type,
    max_height_meters: row.max_height_meters ?? null,
    gross_weight_kg: row.gross_weight_kg ?? null,
    axle_count: row.axle_count ?? null,
    fuel_type: row.fuel_type ?? null,
    emissions_class: row.emissions_class ?? null,
  };
}

interface ParkingZoneRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  max_stay_minutes: number | null;
  paid: number;
  rate_per_hour: number | null;
  restrictions: string;
}

async function handleParking(url: URL, env: Env): Promise<Response> {
  const lat = parseFloat(url.searchParams.get('lat') ?? '');
  const lon = parseFloat(url.searchParams.get('lon') ?? '');
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return fail('Invalid coordinates', 400, env);
  }
  const rows = await env.DB.prepare('SELECT * FROM parking_zones').all<ParkingZoneRow>();
  const point: LatLon = { lat, lon };
  const zones: ParkingZone[] = rows.results
    .map((z) => {
      let restrictions: string[] = [];
      try {
        restrictions = JSON.parse(z.restrictions) as string[];
      } catch {}
      return {
        id: z.id,
        name: z.name,
        lat: z.lat,
        lon: z.lon,
        radius_m: z.radius_m,
        max_stay_minutes: z.max_stay_minutes,
        paid: !!z.paid,
        rate_per_hour: z.rate_per_hour,
        restrictions,
        distance_m: Math.round(haversineM(point, { lat: z.lat, lon: z.lon })),
      };
    })
    .filter((z) => z.distance_m <= 500)
    .sort((a, b) => a.distance_m - b.distance_m);
  let availability: unknown = null;
  if (env.PARKING_API_URL) {
    try {
      const res = await fetch(`${env.PARKING_API_URL}/availability?lat=${lat}&lon=${lon}&radius=500`);
      if (res.ok) availability = await res.json();
    } catch {}
  }
  const response: ParkingResponse = { zones, availability };
  return json(response, 200, env);
}

async function handleVehicleProfileList(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return fail('Authentication required', 401, env);
  const rows = await env.DB.prepare('SELECT * FROM vehicle_profiles WHERE user_id = ? ORDER BY created_at DESC')
    .bind(user.id)
    .all<VehicleProfileRow>();
  return json(rows.results.map(normalizeProfile), 200, env);
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}

async function handleVehicleProfileCreate(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return fail('Authentication required', 401, env);
  const body = (await request.json().catch(() => null)) as Partial<VehicleProfile> | null;
  if (!body || !VEHICLE_TYPES.includes(body.vehicle_type as VehicleType)) {
    return fail('Invalid vehicle profile', 400, env);
  }
  const profile: VehicleProfile = {
    id: crypto.randomUUID(),
    user_id: user.id,
    vehicle_type: body.vehicle_type as VehicleType,
    max_height_meters: numOrNull(body.max_height_meters),
    gross_weight_kg: intOrNull(body.gross_weight_kg),
    axle_count: intOrNull(body.axle_count),
    fuel_type: FUEL_TYPES.includes(body.fuel_type as FuelType) ? (body.fuel_type as FuelType) : null,
    emissions_class: typeof body.emissions_class === 'string' && body.emissions_class.trim() ? body.emissions_class.trim() : null,
  };
  await env.DB.prepare(
    'INSERT INTO vehicle_profiles (id, user_id, vehicle_type, max_height_meters, gross_weight_kg, axle_count, fuel_type, emissions_class) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      profile.id,
      profile.user_id,
      profile.vehicle_type,
      profile.max_height_meters,
      profile.gross_weight_kg,
      profile.axle_count,
      profile.fuel_type,
      profile.emissions_class,
    )
    .run();
  return json(profile, 201, env);
}

async function handleTiles(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const seg = url.pathname.split('/').filter(Boolean);
  const z = parseInt(seg[2] ?? '', 10);
  const x = parseInt(seg[3] ?? '', 10);
  const y = parseInt(seg[4] ?? '', 10);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > 19) {
    return fail('Invalid tile', 400, env);
  }
  const max = 2 ** z;
  if (x < 0 || x >= max || y < 0 || y >= max) return fail('Tile out of range', 400, env);
  const cache = caches.default;
  const cacheKey = new Request(`https://tiles.solidmaps.app/${z}/${x}/${y}.png`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) return fail('Tile provider error', 502, env);
  const response = new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=2592000',
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    const url = new URL(request.url);
    const seg = url.pathname.split('/').filter(Boolean);
    try {
      if (seg[0] !== 'api') return new Response('Not found', { status: 404 });
      if (seg[1] === 'auth' && seg[2] === 'issue' && request.method === 'POST') return await handleIssue(request, env);
      if (seg[1] === 'auth' && seg[2] === 'me' && request.method === 'GET') return await handleMe(request, env);
      if (seg[1] === 'geocode' && request.method === 'GET') return await handleGeocode(url, env);
      if (seg[1] === 'route' && request.method === 'POST') return await handleRoute(request, env);
      if (seg[1] === 'parking' && request.method === 'GET') return await handleParking(url, env);
      if (seg[1] === 'vehicle-profile' && request.method === 'GET') return await handleVehicleProfileList(request, env);
      if (seg[1] === 'vehicle-profile' && request.method === 'POST') return await handleVehicleProfileCreate(request, env);
      if (seg[1] === 'tiles' && request.method === 'GET') return await handleTiles(url, env, ctx);
      return fail('Not found', 404, env);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.message, err.status, env);
      console.error('solidmaps-api error', err);
      return fail('Internal server error', 500, env);
    }
  },
};
