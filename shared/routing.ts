import type { LatLon, Mode, RouteStep, RouteWarning, VehicleProfile } from './types';

/**
 * Decode a Google-encoded polyline at 1e-6 precision, as `[lon, lat]` pairs.
 *
 * Valhalla returns manoeuvre shapes in **polyline6**, not Google's polyline5 — decoding one as
 * the other silently shifts every coordinate. Shared by the Worker adapter and the on-device
 * (WebAssembly) adapter so the two engines cannot drift apart.
 */
export function decodePolyline6(str: string): [number, number][] {
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

export interface ValhallaManeuver {
  instruction: string;
  /** Length of this manoeuvre in kilometres (Valhalla's default unit). */
  length?: number;
  time?: number;
  /** Index into the leg's decoded shape where this manoeuvre begins. */
  begin_shape_index?: number;
  end_shape_index?: number;
}

export interface ValhallaLeg {
  shape: string;
  summary?: { length: number; time: number };
  maneuvers?: ValhallaManeuver[];
}

export interface ValhallaResponse {
  trip?: { legs?: ValhallaLeg[] };
}

export interface ParsedValhallaLeg {
  coordinates: [number, number][];
  distance_meters: number;
  duration_seconds: number;
  steps: RouteStep[];
}

export interface ParsedValhallaTrip {
  coordinates: [number, number][];
  steps: RouteStep[];
  distance_meters: number;
  duration_seconds: number;
}

/**
 * Parse a whole Valhalla trip (1+ legs) into the route contract. Multi-stop
 * (`/optimized_route`) returns one leg per segment; legs are concatenated with
 * `distance_from_start` accumulated across the whole trip so satnav auto-advance
 * and camera-follow work over multi-stop routes exactly like single-leg ones.
 */
export function parseValhallaTrip(trip: ValhallaResponse['trip']): ParsedValhallaTrip {
  const coordinates: [number, number][] = [];
  const steps: RouteStep[] = [];
  let distance = 0;
  let duration = 0;
  for (const leg of trip?.legs ?? []) {
    const parsed = parseValhallaLeg(leg);
    if (coordinates.length > 0 && parsed.coordinates.length > 0) {
      coordinates.push(...parsed.coordinates.slice(1));
    } else {
      coordinates.push(...parsed.coordinates);
    }
    const base = distance;
    for (const s of parsed.steps) {
      steps.push({
        ...s,
        distance_from_start:
          s.distance_from_start != null ? Math.round(base + s.distance_from_start) : undefined,
      });
    }
    distance += parsed.distance_meters;
    duration += parsed.duration_seconds;
  }
  return {
    coordinates,
    steps,
    distance_meters: Math.round(distance),
    duration_seconds: Math.round(duration),
  };
}

/**
 * Turn one Valhalla leg into the shape/step contract the UI consumes.
 *
 * Valhalla reports only a shape index per manoeuvre, so walk the decoded geometry to recover the
 * `[lon, lat]` the UI needs for camera-follow and auto-advance. Accumulate over *all* manoeuvres
 * (before filtering) so a manoeuvre without narration cannot skew the running total.
 */
export function parseValhallaLeg(leg: ValhallaLeg): ParsedValhallaLeg {
  const coordinates = decodePolyline6(leg.shape);
  let travelledMeters = 0;
  const steps: RouteStep[] = (leg.maneuvers ?? [])
    .map((m) => {
      const step: RouteStep = {
        instruction: m.instruction,
        distance_meters: Math.round((m.length ?? 0) * 1000),
      };
      const point = coordinates[m.begin_shape_index ?? -1];
      if (point) step.location = [point[0], point[1]];
      if (m.begin_shape_index !== undefined) step.distance_from_start = Math.round(travelledMeters);
      travelledMeters += (m.length ?? 0) * 1000;
      return step;
    })
    .filter((s) => s.instruction);
  return {
    coordinates,
    distance_meters: Math.round((leg.summary?.length ?? 0) * 1000),
    duration_seconds: Math.round(leg.summary?.time ?? 0),
    steps,
  };
}

/** Valhalla `costing` name for each SolidMaps travel mode. */
export function valhallaCosting(mode: Mode): 'pedestrian' | 'auto' | 'truck' {
  if (mode === 'walk' || mode === 'transit') return 'pedestrian';
  return mode === 'truck' ? 'truck' : 'auto';
}

/**
 * Valhalla `costing_options.truck` for a vehicle profile, in the units Valhalla expects
 * (metres for height, tonnes for weight). Returns null when nothing is worth sending.
 */
export function valhallaTruckOptions(profile: VehicleProfile | null): Record<string, number> | null {
  if (!profile) return null;
  const opts: Record<string, number> = {};
  if (profile.max_height_meters) opts.height = profile.max_height_meters;
  if (profile.gross_weight_kg) opts.weight = Math.round((profile.gross_weight_kg / 1000) * 10) / 10;
  if (profile.axle_count) opts.axle_count = profile.axle_count;
  return Object.keys(opts).length > 0 ? opts : null;
}

export function ulezCompliant(profile: VehicleProfile): boolean {
  const fuel = profile.fuel_type;
  const cls = profile.emissions_class;
  if (!fuel || !cls) return true;
  if (fuel === 'electric' || fuel === 'hydrogen') return true;
  const m = cls.match(/euro\s*(\d+)/i);
  if (!m) return true;
  const euro = parseInt(m[1], 10);
  return fuel === 'petrol' ? euro >= 4 : euro >= 6;
}

/**
 * Advisory warnings derived from the vehicle profile, not from the route geometry.
 * `engine` is the routing engine that produced the route: Valhalla enforces OSM height/weight
 * restrictions during costing, so the wording only claims enforcement when it actually applies.
 */
export function vehicleWarnings(profile: VehicleProfile | null, destination: LatLon, engine: string): RouteWarning[] {
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

export function engineWarnings(
  profile: VehicleProfile | null,
  destination: LatLon,
  engine: string,
  mode: Mode,
): RouteWarning[] {
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
