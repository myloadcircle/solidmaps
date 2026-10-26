'use client';

import { useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { LatLon, RouteResponse } from '@/shared/types';

/** Metres from a point to the route polyline, plus metres travelled along it. */
function projectOnRoute(
  coords: [number, number][],
  pos: LatLon,
): { offMeters: number; travelledMeters: number } {
  if (coords.length === 0) return { offMeters: Infinity, travelledMeters: 0 };
  const latScale = Math.cos((pos.lat * Math.PI) / 180);
  const toM = (dLon: number, dLat: number): number =>
    Math.hypot(dLon * 111320 * latScale, dLat * 110540);
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + toM(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]));
  }
  let best = { seg: 0, t: 0, dist: Infinity, travelled: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0];
    const ay = coords[i][1];
    const bx = coords[i + 1][0];
    const by = coords[i + 1][1];
    const abx = (bx - ax) * latScale;
    const aby = by - ay;
    const apx = (pos.lon - ax) * latScale;
    const apy = pos.lat - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
    const dx = apx - abx * t;
    const dy = apy - aby * t;
    const dist = Math.hypot(dx, dy) * 111320;
    const travelled = cum[i] + (cum[i + 1] - cum[i]) * t;
    if (dist < best.dist) best = { seg: i, t, dist, travelled };
  }
  const last = coords.length - 1;
  const distLast = toM(pos.lon - coords[last][0], pos.lat - coords[last][1]);
  if (distLast < best.dist) best = { seg: last, t: 1, dist: distLast, travelled: cum[last] };
  return { offMeters: best.dist, travelledMeters: best.travelled };
}

function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  } catch {
    // Voice guidance unavailable — navigation continues silently.
  }
}

export default function ActiveNavigation({
  route,
  map,
  onClose,
  onReroute,
}: {
  route: RouteResponse;
  map: maplibregl.Map | null;
  onClose: () => void;
  onReroute: (from: LatLon) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<{ meters: number; seconds: number } | null>(null);
  const offRouteRef = useRef(0);
  const stepIndexRef = useRef(0);

  useEffect(() => {
    setStepIndex(0);
    stepIndexRef.current = 0;
    setNavigating(false);
    setRemaining(null);
    offRouteRef.current = 0;
  }, [route]);

  const coordinates = route.geometry?.coordinates ?? [];
  const totalMeters = route.distance_meters;

  useEffect(() => {
    if (!navigating) return;
    if (!('geolocation' in navigator)) {
      setGpsError('This browser does not expose GPS location.');
      return;
    }
    speak('Starting navigation. ' + (route.steps[0]?.instruction ?? 'Follow the route.'));
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsError(null);
        const here: LatLon = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const { offMeters, travelledMeters } = projectOnRoute(coordinates, here);
        if (totalMeters > 0) {
          setRemaining({
            meters: Math.max(0, totalMeters - travelledMeters),
            seconds: Math.max(0, route.duration_seconds * (1 - travelledMeters / totalMeters)),
          });
        }
        // Auto-advance: passed the next maneuver point (30 m slack).
        while (
          stepIndexRef.current + 1 < route.steps.length &&
          route.steps[stepIndexRef.current + 1].distance_from_start != null &&
          travelledMeters + 30 >= route.steps[stepIndexRef.current + 1].distance_from_start!
        ) {
          stepIndexRef.current += 1;
          setStepIndex(stepIndexRef.current);
          speak(route.steps[stepIndexRef.current].instruction);
        }
        // Off-route: 60 m off the line on two consecutive fixes → replan.
        if (offMeters > 60) {
          offRouteRef.current += 1;
          if (offRouteRef.current >= 2) {
            offRouteRef.current = 0;
            speak('Recalculating route.');
            onReroute(here);
            return;
          }
        } else {
          offRouteRef.current = 0;
        }
        map?.easeTo({
          center: [here.lon, here.lat],
          zoom: 16.5,
          bearing: pos.coords.heading ?? map.getBearing(),
          pitch: 55,
          duration: 800,
        });
      },
      (err) => setGpsError(err.message || 'GPS unavailable'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
    };
    // Route object identity changes per plan; coordinates captured per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, route, map, onReroute]);

  const step = route.steps[stepIndex];
  const shownMeters = remaining && navigating ? remaining.meters : route.distance_meters;
  const shownSeconds = remaining && navigating ? remaining.seconds : route.duration_seconds;
  const mins = Math.max(1, Math.round(shownSeconds / 60));
  const durationLabel =
    mins >= 1440 ? `${Math.floor(mins / 1440)} d ${Math.round((mins % 1440) / 60)} h` : `${mins} min`;
  const traffic =
    route.provider === 'mapbox' && route.mode === 'car'
      ? 'Live traffic data active'
      : route.mode === 'transit'
        ? 'Scheduled service'
        : 'No live traffic feed for this route';
  // When the amber straight-line banner is shown, drop the duplicate
  // "Straight-line route" warning and fold its cause into the banner.
  const warnings =
    route.provider === 'haversine'
      ? route.warnings.filter((w) => w.title !== 'Straight-line route')
      : route.warnings;
  const haversineCause = route.warnings.find((w) => w.title === 'Straight-line route')?.detail;

  return (
    <div className="absolute left-3 right-3 top-16 z-20 rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-slate-100 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">
            {navigating
              ? `${(shownMeters / 1000).toFixed(1)} km · ${durationLabel} left`
              : `${(route.distance_meters / 1000).toFixed(1)} km · ${durationLabel}`}
          </div>
          <div className="text-xs text-slate-400">
            {route.mode.toUpperCase()} via {route.provider} · {traffic}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!navigating ? (
            <button
              onClick={() => setNavigating(true)}
              className="rounded-lg bg-sky-600 px-3 py-1 text-sm font-semibold"
              aria-label="Start navigation"
            >
              Start
            </button>
          ) : (
            <button
              onClick={() => setNavigating(false)}
              className="rounded-lg border border-slate-600 px-3 py-1 text-sm"
              aria-label="Pause navigation"
            >
              Pause
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1 text-sm"
            aria-label="End navigation"
          >
            End
          </button>
        </div>
      </div>

      {route.provider === 'haversine' && (
        <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/15 p-3 text-sm text-amber-300">
          ⚠️ Straight-line estimate — road routing unavailable. No turn-by-turn directions.
          {haversineCause && <span className="mt-1 block text-xs text-amber-200/80">{haversineCause}</span>}
        </div>
      )}
      {gpsError && (
        <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/15 p-3 text-sm text-rose-300">
          GPS: {gpsError}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {warnings.map((w, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 text-sm ${
                w.type === 'ulez' || w.type === 'bridge'
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              ⚠️ {w.title} — {w.detail}
            </div>
          ))}
        </div>
      )}

      {step && (
        <div className="mt-3 flex items-center gap-3">
          <button
            disabled={stepIndex === 0}
            onClick={() => {
              const i = Math.max(0, stepIndex - 1);
              stepIndexRef.current = i;
              setStepIndex(i);
            }}
            className="rounded-lg bg-slate-800 px-3 py-2 disabled:opacity-30"
            aria-label="Previous step"
          >
            ‹
          </button>
          <div className="flex-1">
            <div className="text-sm text-slate-300">
              Step {stepIndex + 1} of {route.steps.length}
              {navigating && remaining ? ' · live' : ''}
            </div>
            <div className="font-medium">{step.instruction}</div>
          </div>
          <button
            disabled={stepIndex >= route.steps.length - 1}
            onClick={() => {
              const i = Math.min(route.steps.length - 1, stepIndex + 1);
              stepIndexRef.current = i;
              setStepIndex(i);
            }}
            className="rounded-lg bg-sky-600 px-3 py-2 disabled:opacity-30"
            aria-label="Next step"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
