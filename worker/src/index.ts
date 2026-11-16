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
import {
  engineWarnings,
  parseValhallaTrip,
  valhallaCosting,
  valhallaTruckOptions,
  type ValhallaResponse,
} from '../../shared/routing';

export interface Env {
  DB: D1Database;
  CACHE?: KVNamespace;
  AUTH_SECRET?: string;
  /** OSRM-compatible engine (public demo today; self-hosted later). */
  ROUTING_ENGINE_URL?: string;
  /** 'osrm' (default) or 'valhalla'. */
  ROUTING_ENGINE_TYPE?: string;
  /** Bearer token for the Valhalla Caddy proxy (infra/valhalla). */
  ROUTING_ENGINE_TOKEN?: string;
  /**
   * Owner's architectural rule (2026-11-12): the truck/global rollout swaps
   * engines by changing THIS one URL — Stage 1 hosted Valhalla, Stage 2 the
   * self-hosted VPS, Stage 3 a Cloudflare-fronted global cluster. Standard
   * Valhalla REST only: POST /route, POST /optimized_route,
   * POST /sources_to_targets. Falls back to ROUTING_ENGINE_URL for compat.
   */
  VALHALLA_BASE_URL?: string;
  PARKING_API_URL?: string;
  ALLOWED_ORIGIN?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** RevenueCat secret API key (sk_…) for TruckRoute Pro entitlement validation. Owner mints. */
  REVCAT_SECRET_KEY?: string;
}

const MODES: Mode[] = ['walk', 'transit', 'car', 'truck'];
const VEHICLE_TYPES: VehicleType[] = ['car', 'van', 'hgv', 'motorcycle'];
const FUEL_TYPES: FuelType[] = ['petrol', 'diesel', 'electric', 'hybrid', 'hydrogen', 'other'];
const USER_AGENT = 'solidmaps-api/1.0 (https://solidmap.app)';

const ALLOWED_ORIGINS: string[] = [
  'https://solidmap.app',
  'https://www.solidmap.app',
  'https://solidmap.xyz',
  'https://www.solidmap.xyz',
  'https://solidmaps.pages.dev',
  'https://solidmaps-site.pages.dev',
  'https://solidmaps-api.fbirele.workers.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  // Explicit override (kept for staging/preview hosts) or the fixed allowlist.
  if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*' && origin === env.ALLOWED_ORIGIN) return origin;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Cloudflare Pages hosts for this project. The Pages project is named 'solidmaps-site', so its
  // canonical host and per-deployment preview hosts carry a '-site' suffix. The older
  // '<hash>.solidmaps.pages.dev' form is kept for compatibility.
  if (/^https:\/\/[a-z0-9-]+\.solidmaps(-site)?\.pages\.dev$/.test(origin)) return origin;
  return null;
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = allowedOrigin(request, env);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200, _env?: Env): Response {
  // CORS headers are applied once at the fetch() boundary.
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(message: string, status: number, _env?: Env): Response {
  return json({ error: message }, status);
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

/** Pro expiry is honoured softly: an expired member reads as free without downgrading the row, so renewals re-flip it. */
function resolveTier(row: { subscription_tier: string; pro_until: number | null }): 'free' | 'pro' {
  if (row.subscription_tier !== 'pro') return 'free';
  if (row.pro_until != null && row.pro_until > 0 && row.pro_until * 1000 < Date.now()) return 'free';
  return 'pro';
}

async function authUser(request: Request, env: Env): Promise<(UserRow & { pro_until: number | null }) | null> {
  const token = (request.headers.get('Authorization') ?? '').startsWith('Bearer ')
    ? request.headers.get('Authorization')!.slice(7)
    : null;
  if (!token) return null;
  const userId = await verifyToken(token, env);
  if (!userId) return null;
  return await env.DB.prepare('SELECT id, email, subscription_tier, pro_until FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRow & { pro_until: number | null }>();
}

/**
 * Estate service keys: TruckRoute (and future products) call the engine without a
 * SolidMaps account. KV svc:{key} -> {app, tier}. Minted by the lane; revocable by
 * deleting the KV key.
 */
interface ServiceKey {
  app: string;
  tier: 'pro' | 'engine';
}

async function serviceKeyAuth(request: Request, env: Env): Promise<ServiceKey | null> {
  const key = request.headers.get('X-API-Key');
  if (!key || !env.CACHE) return null;
  const raw = await env.CACHE.get('svc:' + key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceKey;
    return parsed.app && parsed.tier ? parsed : null;
  } catch {
    return null;
  }
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

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a Stripe `Stripe-Signature` header (t=,v1=) against the raw request body. */
async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
  const expected = await hmacHex(`${timestamp}.${payload}`, secret);
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}

interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
}

async function onCheckoutCompleted(session: Record<string, unknown>, env: Env): Promise<void> {
  const clientRef = typeof session.client_reference_id === 'string' ? session.client_reference_id : null;
  const customerId = typeof session.customer === 'string' ? session.customer : null;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
  const details = session.customer_details as { email?: unknown } | undefined;
  const email =
    typeof session.customer_email === 'string'
      ? session.customer_email
      : typeof details?.email === 'string'
        ? details.email
        : null;

  let userId: string | null = null;
  if (clientRef) {
    const byId = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(clientRef)
      .first<{ id: string }>();
    userId = byId?.id ?? null;
  }
  if (!userId && email) {
    const byEmail = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email.trim().toLowerCase())
      .first<{ id: string }>();
    userId = byEmail?.id ?? null;
  }
  if (!userId) {
    console.warn('stripe checkout completed with no matching user', { clientRef, email });
    return;
  }
  await env.DB.prepare(
    `UPDATE users
        SET subscription_tier = 'pro',
            stripe_customer_id = COALESCE(?, stripe_customer_id),
            stripe_subscription_id = COALESCE(?, stripe_subscription_id),
            pro_since = COALESCE(pro_since, unixepoch())
      WHERE id = ?`,
  )
    .bind(customerId, subscriptionId, userId)
    .run();
}

async function onSubscriptionEnded(obj: Record<string, unknown>, env: Env): Promise<void> {
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;
  if (!customerId) return;
  await env.DB.prepare(
    `UPDATE users
        SET subscription_tier = 'free',
            stripe_subscription_id = NULL
      WHERE stripe_customer_id = ?`,
  )
    .bind(customerId)
    .run();
}

/** Stripe webhook: flip Pro membership on checkout, revoke on lapse. Idempotent by event id. */
async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return fail('Billing is not configured', 503, env);
  const signature = request.headers.get('Stripe-Signature') ?? '';
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, signature, secret))) {
    return fail('Invalid signature', 400, env);
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return fail('Invalid payload', 400, env);
  }
  const eventId = typeof event.id === 'string' ? event.id : null;
  const type = typeof event.type === 'string' ? event.type : '';
  if (eventId) {
    const seen = await env.DB.prepare('SELECT id FROM stripe_events WHERE id = ?')
      .bind(eventId)
      .first<{ id: string }>();
    if (seen) return json({ received: true, duplicate: true }, 200, env);
  }
  try {
    const object = event.data?.object ?? {};
    if (type === 'checkout.session.completed') await onCheckoutCompleted(object, env);
    else if (type === 'customer.subscription.deleted' || type === 'invoice.payment_failed') {
      await onSubscriptionEnded(object, env);
    }
  } catch (err) {
    console.error('stripe webhook handler error', err);
    return fail('Webhook handler error', 500, env);
  }
  if (eventId) {
    await env.DB.prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)')
      .bind(eventId, type)
      .run();
  }
  return json({ received: true }, 200, env);
}

/** Play Data safety: account + all owned records must be deletable in-app. */
async function handleAccountDelete(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return fail('Authentication required', 401, env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM vehicle_profiles WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM saved_routes WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return json({ deleted: true }, 200, env);
}

/** Cross-isolate fixed-window limiter in KV: 30 geocodes/min per client IP. */
async function geocodeAllowed(env: Env, ip: string): Promise<boolean> {
  if (!env.CACHE) return true;
  const key = `rl:${ip}`;
  const count = parseInt((await env.CACHE.get(key)) ?? '0', 10);
  if (count >= 30) return false;
  await env.CACHE.put(key, String(count + 1), { expirationTtl: 60 });
  return true;
}

/** UK postcode shapes: full "HA3 8SX" or district "HA3". UK postcodes are globally unique. */
const UK_FULL_POSTCODE_RE = /^[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}$/i;
const UK_OUTCODE_RE = /^[a-z]{1,2}\d[a-z\d]?$/i;

interface GeoHit {
  id: string;
  text: string;
  lat: number;
  lon: number;
}

/** Authoritative UK postcode geocoding via postcodes.io (free, no key). */
async function geocodeUKPostcode(q: string): Promise<GeoHit[] | null> {
  const compact = q.replace(/\s+/g, '').toUpperCase();
  try {
    if (UK_FULL_POSTCODE_RE.test(q.trim())) {
      const res = await fetch(`https://api.postcodes.io/postcodes/${compact}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.ok) {
        const j = (await res.json()) as {
          result?: { postcode: string; latitude: number; longitude: number; admin_district: string[] };
        };
        if (j.result) {
          return [
            {
              id: `pc/${j.result.postcode}`,
              text: `${j.result.postcode} — ${j.result.admin_district.join(', ')}`,
              lat: j.result.latitude,
              lon: j.result.longitude,
            },
          ];
        }
      }
      return [];
    }
    if (UK_OUTCODE_RE.test(q.trim())) {
      const res = await fetch(`https://api.postcodes.io/outcodes/${compact}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.ok) {
        const j = (await res.json()) as {
          result?: { outcode: string; latitude: number; longitude: number; admin_district: string[] };
        };
        if (j.result) {
          return [
            {
              id: `out/${j.result.outcode}`,
              text: `${j.result.outcode} — ${j.result.admin_district.join(', ')}`,
              lat: j.result.latitude,
              lon: j.result.longitude,
            },
          ];
        }
      }
      return [];
    }
  } catch {
    // postcodes.io unreachable — fall through to the general geocoder.
  }
  return null;
}

async function handleGeocode(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const q = url.searchParams.get('q') ?? '';
  if (q.trim().length < 2) return fail('Missing query parameter "q"', 400, env);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await geocodeAllowed(env, ip))) {
    return fail('Too many searches — slow down and retry shortly', 429, env);
  }
  const normalized = q.trim().toLowerCase().replace(/\s+/g, ' ');
  if (env.CACHE) {
    const cached = await env.CACHE.get(`geo:v2:${normalized}`);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Solidmaps-Cache': 'hit' },
      });
    }
  }
  // UK postcodes resolve authoritatively; generic geocoders misfile them worldwide.
  let hits: GeoHit[] | null = await geocodeUKPostcode(q);
  if (hits === null || hits.length === 0) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(normalized)}`,
      { headers: { 'User-Agent': USER_AGENT } },
    );
    if (!res.ok) return fail('Geocoding provider error', 502, env);
    const data = (await res.json()) as { place_id: number; display_name: string; lat: string; lon: string }[];
    hits = data.map((d) => ({
      id: String(d.place_id),
      text: d.display_name,
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
    }));
  }
  const payload = JSON.stringify(hits);
  if (env.CACHE) {
    ctx.waitUntil(env.CACHE.put(`geo:v2:${normalized}`, payload, { expirationTtl: 86400 }).catch(() => {}));
  }
  return new Response(payload, { status: 200, headers: { 'Content-Type': 'application/json' } });
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

// Warning derivation (`engineWarnings`, `vehicleWarnings`, `ulezCompliant`) lives in
// shared/routing.ts so the Worker and the on-device WebAssembly engine stay identical.

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

interface OsrmStep {
  distance: number;
  name?: string;
  maneuver: { type: string; modifier?: string; exit?: number; location?: [number, number] };
}

interface OsrmResponse {
  routes?: {
    distance: number;
    duration: number;
    geometry?: { coordinates: [number, number][] };
    legs?: { steps?: OsrmStep[] }[];
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
  const rawSteps = route.legs?.[0]?.steps ?? [];
  let travelled = 0;
  const steps: RouteStep[] = rawSteps.map((s) => {
    const step: RouteStep = {
      instruction: osrmInstruction(s),
      distance_meters: Math.round(s.distance),
    };
    if (s.maneuver.location) {
      step.location = [s.maneuver.location[0], s.maneuver.location[1]];
      step.distance_from_start = Math.round(travelled);
    }
    travelled += s.distance;
    return step;
  });
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

/** Resolved Valhalla base URL per the owner's single-swap rule. */
function valhallaBaseUrl(env: Env): string | null {
  const raw = env.VALHALLA_BASE_URL ?? (env.ROUTING_ENGINE_TYPE === 'valhalla' ? env.ROUTING_ENGINE_URL : null);
  return raw ? raw.replace(/\/+$/, '') : null;
}

/** Standard Valhalla REST POST with the proxy token attached. */
async function valhallaRequest(env: Env, path: string, body: Record<string, unknown>): Promise<ValhallaResponse> {
  const base = valhallaBaseUrl(env);
  if (!base) throw new ApiError(502, 'No Valhalla endpoint configured');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  };
  if (env.ROUTING_ENGINE_TOKEN) headers.Authorization = `Bearer ${env.ROUTING_ENGINE_TOKEN}`;
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(502, `Valhalla ${path} error`);
  return (await res.json()) as ValhallaResponse;
}

function valhallaBody(
  locations: LatLon[],
  mode: Mode,
  profile: VehicleProfile | null,
): Record<string, unknown> {
  const costing = valhallaCosting(mode);
  const body: Record<string, unknown> = {
    locations: locations.map((l) => ({ lat: l.lat, lon: l.lon })),
    costing,
    // Kilometres is Valhalla's default but pin it explicitly: shared parsing assumes it.
    units: 'kilometers',
    directions_options: { units: 'kilometers', language: 'en-GB' },
  };
  if (costing === 'truck') {
    const options = valhallaTruckOptions(profile);
    if (options) body.costing_options = { truck: options };
  }
  return body;
}

async function valhallaRoute(
  origin: LatLon,
  destination: LatLon,
  mode: Mode,
  profile: VehicleProfile | null,
  env: Env,
): Promise<RouteResponse> {
  const data = await valhallaRequest(env, '/route', valhallaBody([origin, destination], mode, profile));
  const parsed = parseValhallaTrip(data.trip);
  if (parsed.coordinates.length === 0) throw new ApiError(502, 'Routing engine returned no route');
  return {
    provider: 'valhalla',
    mode,
    distance_meters: parsed.distance_meters,
    duration_seconds: parsed.duration_seconds,
    geometry: { coordinates: parsed.coordinates },
    steps: parsed.steps,
    warnings: engineWarnings(profile, destination, 'valhalla', mode),
    commercial: mode === 'truck',
  };
}

/**
 * Pro multi-stop: Valhalla /optimized_route orders the waypoints and returns one
 * leg per segment. Same response contract as the single-leg route.
 */
async function valhallaOptimizedRoute(
  origin: LatLon,
  waypoints: LatLon[],
  destination: LatLon,
  mode: Mode,
  profile: VehicleProfile | null,
  env: Env,
): Promise<RouteResponse> {
  const locations = [origin, ...waypoints, destination];
  const data = await valhallaRequest(env, '/optimized_route', {
    ...valhallaBody(locations, mode, profile),
    optimize: false,
  });
  const parsed = parseValhallaTrip(data.trip);
  if (parsed.coordinates.length === 0) throw new ApiError(502, 'Routing engine returned no route');
  return {
    provider: 'valhalla',
    mode,
    distance_meters: parsed.distance_meters,
    duration_seconds: parsed.duration_seconds,
    geometry: { coordinates: parsed.coordinates },
    steps: parsed.steps,
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
    // Chain: Valhalla down → OSRM (if configured) → haversine. Stage-1 testing
    // stays usable while the VPS rebuilds; Stage-3 clusters fail over cleanly.
    if (engineType === 'valhalla' && env.ROUTING_ENGINE_URL) {
      try {
        const osrm = await osrmRoute(origin, destination, mode, profile, env);
        return {
          ...osrm,
          warnings: [
            ...osrm.warnings,
            {
              type: 'info' as const,
              title: 'Truck engine unavailable',
              detail: 'Valhalla is unreachable — truck restrictions are advisory on this fallback route.',
            },
          ],
        };
      } catch {
        // fall through to haversine
      }
    }
    return fallback('The routing engine is unreachable — showing a direct line instead.');
  }
}

/** Valhalla /sources_to_targets matrix → simple seconds/metres grid. */
async function handleMatrix(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  const svc = await serviceKeyAuth(request, env);
  if (!user && !svc) return fail('Authentication required', 401, env);
  const body = (await request.json().catch(() => null)) as
    | { sources?: LatLon[]; targets?: LatLon[]; mode?: Mode }
    | null;
  const sources = (body?.sources ?? []).filter(validLatLon).slice(0, 25);
  const targets = (body?.targets ?? []).filter(validLatLon).slice(0, 25);
  if (sources.length === 0 || targets.length === 0) {
    return fail('sources and targets arrays (1–25 valid points each) are required', 400, env);
  }
  const mode: Mode = MODES.includes(body?.mode as Mode) ? (body!.mode as Mode) : 'truck';
  const pro = (user && resolveTier(user) === 'pro') || svc?.tier === 'pro';
  if (mode === 'truck' && !pro) {
    return fail('Truck matrix requires a Pro subscription', 403, env);
  }
  if (!valhallaBaseUrl(env)) return fail('No Valhalla endpoint configured', 503, env);
  const costing = valhallaCosting(mode);
  const payload: Record<string, unknown> = {
    sources: sources.map((l) => ({ lat: l.lat, lon: l.lon })),
    targets: targets.map((l) => ({ lat: l.lat, lon: l.lon })),
    costing,
    units: 'kilometers',
  };
  if (costing === 'truck') {
    // Profile-less truck matrix: enforce only the OSM graph's own restrictions.
  }
  const data = await valhallaRequest(env, '/sources_to_targets', payload);
  interface MatrixCell { time?: number; distance?: number; to?: number; from?: number }
  const raw = (data as unknown as { sources_to_targets?: MatrixCell[][] | MatrixCell[] }).sources_to_targets;
  const flat = Array.isArray(raw?.[0]) ? (raw as MatrixCell[][]) : [ (raw as MatrixCell[]) ?? [] ];
  const matrix = sources.map((_, si) => {
    const row = flat[si] ?? [];
    return targets.map((_, ti) => ({
      duration_seconds: row[ti]?.time != null ? Math.round(row[ti].time!) : null,
      distance_meters: row[ti]?.distance != null ? Math.round(row[ti].distance! * 1000) : null,
    }));
  });
  return json(
    {
      sources: sources.length,
      targets: targets.length,
      mode,
      matrix,
    },
    200,
    env,
  );
}

/**
 * TruckRoute Pro -> SolidMaps Pro bridge. A signed-in SolidMaps user submits the RevenueCat
 * app_user_id their TruckRoute subscription lives under; the worker validates it server-side
 * against RevenueCat and flips the SolidMaps tier. Expiry mirrors the RC entitlement date.
 */
async function handleRevCatExchange(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  if (!user) return fail('Authentication required', 401, env);
  if (!env.REVCAT_SECRET_KEY) return fail('TruckRoute Pro exchange is not configured yet', 503, env);
  const body = (await request.json().catch(() => null)) as { app_user_id?: string } | null;
  const appUserId = body?.app_user_id?.trim();
  if (!appUserId || appUserId.length > 256) return fail('A TruckRoute account ID is required', 400, env);
  const res = await fetch(
    'https://api.revenuecat.com/v1/subscribers/' + encodeURIComponent(appUserId) + '/active_entitlements',
    { headers: { Authorization: 'Bearer ' + env.REVCAT_SECRET_KEY, Accept: 'application/json' } },
  );
  if (res.status === 404) {
    return fail('No TruckRoute subscription found for that account ID', 404, env);
  }
  if (!res.ok) return fail('Could not validate the TruckRoute subscription right now', 502, env);
  const data = (await res.json()) as {
    subscriber?: { entitlements?: Record<string, { expires_date?: string }> };
  };
  const ents = data.subscriber?.entitlements ?? {};
  const entry = Object.entries(ents).find(([id]) => id.toLowerCase().includes('pro')) ??
    (Object.keys(ents).length > 0 ? Object.entries(ents)[0] : null);
  if (!entry) return fail('TruckRoute Pro is not active for that account ID', 404, env);
  const expires = entry[1].expires_date ? Math.floor(new Date(entry[1].expires_date).getTime() / 1000) : null;
  await env.DB.prepare(
    "UPDATE users SET subscription_tier = 'pro', pro_until = COALESCE(?, pro_until) WHERE id = ?"
  )
    .bind(expires, user.id)
    .run();
  return json({ upgraded: true, pro_until: expires, source: 'truckroute' }, 200, env);
}


const FEEDBACK_CATEGORIES = ['ukie', 'eu', 'global', 'vehicle-profiles', 'other'];
const FEEDBACK_MAX = 1000;

/** Shared limiter pattern (KV counter, per-IP per-minute). */
async function feedbackAllowed(env: Env, ip: string): Promise<boolean> {
  if (!env.CACHE) return true;
  const key = 'fb:' + ip;
  const n = parseInt((await env.CACHE.get(key)) ?? '0', 10);
  if (n >= 10) return false;
  await env.CACHE.put(key, String(n + 1), { expirationTtl: 60 });
  return true;
}

/**
 * Driver suggestion box (satnav rollout). Accepts direct submissions (solidmap.app)
 * and service-key proxies (mytruckroute.app); writes to the shared D1 table.
 */
async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const user = await authUser(request, env);
  const svc = await serviceKeyAuth(request, env);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await feedbackAllowed(env, ip))) return fail('Too many suggestions — try again in a minute', 429, env);
  const body = (await request.json().catch(() => null)) as
    | { category?: string; message?: string; app_source?: string; user_tier?: string }
    | null;
  const category = body?.category ?? '';
  const message = (body?.message ?? '').trim();
  if (!FEEDBACK_CATEGORIES.includes(category)) return fail('Pick a valid category', 400, env);
  if (message.length < 5 || message.length > FEEDBACK_MAX) {
    return fail('Tell us a little more (5-' + FEEDBACK_MAX + ' characters)', 400, env);
  }
  const appSource = svc ? svc.app : 'solidmaps';
  const tier: string = svc
    ? (typeof body?.user_tier === 'string' && body.user_tier ? body.user_tier : 'unknown')
    : user
      ? resolveTier(user)
      : 'anonymous';
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO driver_suggestions (id, app_source, category, message, user_tier, user_id) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, appSource, category, message, tier, user?.id ?? null)
    .run();
  return json({ ok: true }, 200, env);
}

async function handleRoute(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as RouteRequest | null;
  if (!body || !validLatLon(body.origin) || !validLatLon(body.destination) || !MODES.includes(body.mode)) {
    return fail('Invalid request: origin, destination and a valid mode are required', 400, env);
  }
  const { origin, destination, mode } = body;
  const user = await authUser(request, env);
  const svc = await serviceKeyAuth(request, env);
  const tier: SubscriptionTier =
    user && resolveTier(user) === 'pro' ? 'pro' : svc?.tier === 'pro' ? 'pro' : 'free';

  if (mode === 'truck' && tier !== 'pro') {
    return fail('Truck routing requires a Pro subscription', 403, env);
  }

  let profile: VehicleProfile | null = null;
  // Service-key callers (TruckRoute et al.) pass dimensions inline — their UI owns
  // the vehicle settings, so no SolidMaps profile lookup applies.
  const inline = (body as { vehicle?: { height_m?: number; weight_kg?: number; axle_count?: number } }).vehicle;
  if (svc && inline) {
    profile = {
      id: 'inline',
      user_id: 'service',
      vehicle_type: 'hgv',
      max_height_meters: typeof inline.height_m === 'number' && inline.height_m > 0 ? inline.height_m : null,
      gross_weight_kg: typeof inline.weight_kg === 'number' && inline.weight_kg > 0 ? Math.round(inline.weight_kg) : null,
      axle_count: typeof inline.axle_count === 'number' && inline.axle_count > 0 ? Math.round(inline.axle_count) : null,
      fuel_type: null,
      emissions_class: null,
    };
  }
  if (!profile && (mode === 'truck' || mode === 'car') && tier === 'pro' && user && body.vehicle_id) {
    const row = await env.DB.prepare('SELECT * FROM vehicle_profiles WHERE id = ? AND user_id = ?')
      .bind(body.vehicle_id, user.id)
      .first<VehicleProfileRow>();
    if (!row) return fail('Vehicle profile not found', 404, env);
    profile = normalizeProfile(row);
  }

  // Pro multi-stop: intermediate stops ride Valhalla /optimized_route.
  const waypoints = (body.waypoints ?? []).filter(validLatLon).slice(0, 8);
  if (waypoints.length > 0 && tier !== 'pro') {
    return fail('Multi-stop routing requires a Pro subscription', 403, env);
  }
  // Cache key covers the full stop list so multi-stop responses never collide.
  const r4 = (n: number) => n.toFixed(4);
  const stopsKey = waypoints.map((w) => `${r4(w.lat)},${r4(w.lon)}`).join('|');
  const vehicleKey = body.vehicle_id ?? (profile ? `i${profile.max_height_meters ?? 0}x${profile.gross_weight_kg ?? 0}x${profile.axle_count ?? 0}` : 'anon');
  const routeKey = `route:${r4(origin.lat)},${r4(origin.lon)};${stopsKey};${r4(destination.lat)},${r4(destination.lon)};${mode};${vehicleKey}`;
  if (env.CACHE) {
    const cached = await env.CACHE.get(routeKey);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Solidmaps-Cache': 'hit' },
      });
    }
  }
  const result =
    waypoints.length > 0
      ? await routeWithStops(origin, waypoints, destination, mode, profile, env)
      : await routeWithEngine(origin, destination, mode, profile, env);
  if (env.CACHE) {
    ctx.waitUntil(env.CACHE.put(routeKey, JSON.stringify(result), { expirationTtl: 300 }).catch(() => {}));
  }
  return json(result, 200, env);
}

/** Engine dispatch for multi-stop routes (Valhalla only; OSRM has no optimizer). */
async function routeWithStops(
  origin: LatLon,
  waypoints: LatLon[],
  destination: LatLon,
  mode: Mode,
  profile: VehicleProfile | null,
  env: Env,
): Promise<RouteResponse> {
  if (valhallaBaseUrl(env)) {
    return valhallaOptimizedRoute(origin, waypoints, destination, mode, profile, env);
  }
  // No Valhalla configured: chain the stops through the point-to-point engine
  // so multi-stop still works (unoptimized order) before the engine ships.
  const legs: RouteResponse[] = [];
  let prev = origin;
  for (const stop of [...waypoints, destination]) {
    legs.push(await routeWithEngine(prev, stop, mode, profile, env));
    prev = stop;
  }
  const coordinates = legs.flatMap((l) => l.geometry?.coordinates ?? []);
  const steps = legs.flatMap((l, i) =>
    (i === legs.length - 1 ? l.steps : l.steps.slice(0, -1)).map((s) => ({
      ...s,
      distance_from_start: undefined,
    })),
  );
  const base = legs.every((l) => l.provider === 'valhalla');
  return {
    provider: base ? 'valhalla' : legs[0].provider,
    mode,
    distance_meters: legs.reduce((a, l) => a + l.distance_meters, 0),
    duration_seconds: legs.reduce((a, l) => a + l.duration_seconds, 0),
    geometry: { coordinates },
    steps,
    warnings: legs[0].warnings,
    commercial: mode === 'truck',
  };
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

interface NominatimParkingResult {
  place_id: number;
  lat: string;
  lon: string;
  category?: string;
  type?: string;
  name?: string;
  extratags?: Record<string, string>;
}

function parseMaxstayMinutes(v: string | undefined): number | null {
  if (!v) return null;
  const hours = /(\d+(?:\.\d+)?)\s*hour/.exec(v);
  if (hours) return Math.round(parseFloat(hours[1]) * 60);
  const mins = /(\d+)\s*min/.exec(v);
  if (mins) return parseInt(mins[1], 10);
  return null;
}

function nominatimToZones(results: NominatimParkingResult[], point: LatLon): ParkingZone[] {
  return results
    .filter((r) => r.category === 'amenity' && (r.type ?? '').startsWith('parking'))
    .map((r) => {
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      const tags = r.extratags ?? {};
      const restrictions: string[] = [];
      if (tags.access && tags.access !== 'yes') restrictions.push(`Access: ${tags.access}`);
      if (tags.maxstay) restrictions.push(`Max stay: ${tags.maxstay}`);
      if (tags.fee === 'yes') restrictions.push('Paid parking');
      if (tags.charge) restrictions.push(`Charge: ${tags.charge}`);
      if (tags.parking) restrictions.push(`Type: ${tags.parking.replace(/_/g, ' ')}`);
      const zone: ParkingZone = {
        id: `nominatim/${r.place_id}`,
        name: r.name?.trim() || 'Parking',
        lat,
        lon,
        radius_m: 100,
        max_stay_minutes: parseMaxstayMinutes(tags.maxstay),
        paid: tags.fee === 'yes',
        rate_per_hour: null,
        restrictions: restrictions.length > 0 ? restrictions : ['Data from OpenStreetMap'],
        distance_m: Math.round(haversineM(point, { lat, lon })),
      };
      return zone;
    })
    .filter((z) => z.distance_m <= 500)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 20);
}

/**
 * Live parking via Nominatim bounded search (same OSM data as Overpass, but a
 * provider we already depend on and can actually reach from Workers egress).
 */
async function fetchParkingFromOsm(point: LatLon): Promise<ParkingZone[] | null> {
  const dLon = 0.006;
  const dLat = 0.0045;
  const viewbox = `${(point.lon - dLon).toFixed(5)},${(point.lat + dLat).toFixed(5)},${(point.lon + dLon).toFixed(5)},${(point.lat - dLat).toFixed(5)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=20&extratags=1&bounded=1&viewbox=${viewbox}&q=parking`,
      { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimParkingResult[];
    return nominatimToZones(data, point);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handleParking(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const lat = parseFloat(url.searchParams.get('lat') ?? '');
  const lon = parseFloat(url.searchParams.get('lon') ?? '');
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return fail('Invalid coordinates', 400, env);
  }
  const point: LatLon = { lat, lon };

  // Live OSM parking data, cached 24 h per ~110 m cell.
  const cellKey = `park:${lat.toFixed(3)},${lon.toFixed(3)}`;
  let zones: ParkingZone[] | null = null;
  if (env.CACHE) {
    const cached = await env.CACHE.get(cellKey);
    if (cached) {
      try {
        zones = JSON.parse(cached) as ParkingZone[];
        for (const z of zones) z.distance_m = Math.round(haversineM(point, { lat: z.lat, lon: z.lon }));
        zones = zones.filter((z) => z.distance_m <= 500).sort((a, b) => a.distance_m - b.distance_m);
      } catch {}
    }
  }
  if (!zones) {
    zones = await fetchParkingFromOsm(point);
    if (zones && env.CACHE) {
      ctx.waitUntil(env.CACHE.put(cellKey, JSON.stringify(zones), { expirationTtl: 86400 }).catch(() => {}));
    }
  }

  // Fallback: curated D1 zones (historical seed data) when Overpass is unavailable.
  if (!zones) {
    const rows = await env.DB.prepare('SELECT * FROM parking_zones').all<ParkingZoneRow>();
    zones = rows.results
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
        } satisfies ParkingZone;
      })
      .filter((z) => z.distance_m <= 500)
      .sort((a, b) => a.distance_m - b.distance_m);
  }
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
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  const origin = allowedOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Vary', 'Origin');
  } else {
    headers.delete('Access-Control-Allow-Origin');
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request, env);
    }
    const url = new URL(request.url);
    const seg = url.pathname.split('/').filter(Boolean);
    try {
      let inner: Response;
      if (seg[0] !== 'api') inner = new Response('Not found', { status: 404 });
      else if (seg[1] === 'auth' && seg[2] === 'issue' && request.method === 'POST') inner = await handleIssue(request, env);
      else if (seg[1] === 'auth' && seg[2] === 'me' && request.method === 'GET') inner = await handleMe(request, env);
      else if (seg[1] === 'auth' && seg[2] === 'account' && request.method === 'DELETE') inner = await handleAccountDelete(request, env);
      else if (seg[1] === 'entitlement' && seg[2] === 'revcat' && request.method === 'POST') inner = await handleRevCatExchange(request, env);
      else if (seg[1] === 'geocode' && request.method === 'GET') inner = await handleGeocode(request, url, env, ctx);
      else if (seg[1] === 'route' && request.method === 'POST') inner = await handleRoute(request, env, ctx);
      else if (seg[1] === 'parking' && request.method === 'GET') inner = await handleParking(url, env, ctx);
      else if (seg[1] === 'vehicle-profile' && request.method === 'GET') inner = await handleVehicleProfileList(request, env);
      else if (seg[1] === 'vehicle-profile' && request.method === 'POST') inner = await handleVehicleProfileCreate(request, env);
      else if (seg[1] === 'matrix' && request.method === 'POST') inner = await handleMatrix(request, env);
      else if (seg[1] === 'feedback' && request.method === 'POST') inner = await handleFeedback(request, env);
      else if (seg[1] === 'tiles' && request.method === 'GET') inner = await handleTiles(url, env, ctx);
      else if (seg[1] === 'stripe' && seg[2] === 'webhook' && request.method === 'POST') inner = await handleStripeWebhook(request, env);
      else inner = fail('Not found', 404, env);
      return withCors(inner, request, env);
    } catch (err) {
      if (err instanceof ApiError) return withCors(fail(err.message, err.status, env), request, env);
      console.error('solidmaps-api error', err);
      return withCors(fail('Internal server error', 500, env), request, env);
    }
  },
};
