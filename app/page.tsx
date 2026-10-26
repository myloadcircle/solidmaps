'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import RoutePlanner from '@/components/RoutePlanner';
import ActiveNavigation from '@/components/ActiveNavigation';
import VehicleProfileManager from '@/components/VehicleProfileManager';
import Onboarding, { hasSeenOnboarding } from '@/components/Onboarding';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { LatLon, Mode, ParkingZone, RouteResponse } from '@/shared/types';

const SolidMap = dynamic(() => import('@/components/SolidMap').then((m) => m.SolidMap), { ssr: false });

export default function Home() {
  const { user, login, logout, loading } = useAuth();
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [parkingZones, setParkingZones] = useState<ParkingZone[]>([]);
  const [showVehicles, setShowVehicles] = useState(false);
  const [email, setEmail] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const lastPlanRef = useRef<{ origin: LatLon; destination: LatLon; mode: Mode; vehicle_id?: string } | null>(null);

  const finishOnboarding = useCallback(() => setShowOnboarding(false), []);

  // Onboarding shows once, shortly after first load.
  useEffect(() => {
    if (hasSeenOnboarding()) return;
    const t = setTimeout(() => setShowOnboarding(true), 350);
    return () => clearTimeout(t);
  }, []);

  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;
  }, []);

  const handlePlanned = useCallback(
    (plan: { origin: LatLon; destination: LatLon; mode: Mode; vehicle_id?: string }) => {
      lastPlanRef.current = plan;
    },
    [],
  );

  const handleReroute = useCallback((from: LatLon) => {
    const plan = lastPlanRef.current;
    if (!plan) return;
    api
      .planRoute({ origin: from, destination: plan.destination, mode: plan.mode, vehicle_id: plan.vehicle_id })
      .then(setRoute)
      .catch(() => {
        // Keep the old route on screen if the replan fails.
      });
  }, []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-900 font-sans text-slate-100">
      <SolidMap route={route} parkingZones={parkingZones} onMapReady={handleMapReady} />

      {showOnboarding && <Onboarding onDone={finishOnboarding} />}

      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2 backdrop-blur">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15">
            <svg viewBox="0 0 512 512" className="h-4 w-4 text-sky-400" aria-hidden="true">
              <path
                d="M256 88c-66 0-120 54-120 120 0 90 120 216 120 216s120-126 120-216c0-66-54-120-120-120zm0 164a44 44 0 1 1 0-88 44 44 0 0 1 0 88z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="text-slate-100">
            solid<span className="text-sky-400">maps</span>
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {loading ? null : user ? (
            <>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  user.subscription_tier === 'pro' ? 'bg-amber-400 text-slate-900' : 'bg-slate-700'
                }`}
              >
                {user.subscription_tier.toUpperCase()}
              </span>
              {user.subscription_tier === 'pro' && (
                <button
                  onClick={() => setShowVehicles((v) => !v)}
                  className="rounded-lg border border-slate-600 px-2 py-1 text-xs"
                >
                  Vehicle
                </button>
              )}
              <button onClick={logout} className="rounded-lg border border-slate-600 px-2 py-1 text-xs">
                Log out
              </button>
              <button
                onClick={() => {
                  if (!confirm('Delete your account and all vehicle profiles? This cannot be undone.')) return;
                  api
                    .deleteAccount()
                    .then(() => logout())
                    .catch(() => setAuthError('Delete failed — try again'));
                }}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-500 hover:border-rose-800 hover:text-rose-400"
                aria-label="Delete account"
              >
                Delete
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = email.trim();
                if (!value) return;
                setAuthError(null);
                login(value).catch(() => setAuthError('Sign-in failed'));
              }}
              className="flex items-center gap-1"
            >
              {authError && <span className="text-xs text-rose-400">{authError}</span>}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="email"
                className="w-32 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
              />
              <button type="submit" className="rounded-lg bg-sky-600 px-2 py-1 text-xs font-semibold">
                Sign in
              </button>
            </form>
          )}
        </div>
      </header>

      {route && (
        <ActiveNavigation
          key={`${route.provider}-${route.mode}-${route.distance_meters}`}
          route={route}
          map={mapRef.current}
          onClose={() => setRoute(null)}
          onReroute={handleReroute}
        />
      )}

      {showVehicles && user?.subscription_tier === 'pro' && (
        <VehicleProfileManager onClose={() => setShowVehicles(false)} />
      )}

      <RoutePlanner
        onRoute={setRoute}
        parkingZones={parkingZones}
        onParkingZones={setParkingZones}
        onPlanned={handlePlanned}
      />
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-3 rounded-md border border-gray-800 bg-gray-900/90 px-3 py-1.5 font-mono text-xs text-gray-400 shadow-lg">
        <a href="/privacy.html" className="hover:text-slate-200">Privacy</a>
        <span aria-hidden="true">·</span>
        <a href="/terms.html" className="hover:text-slate-200">Terms</a>
      </div>
    </main>
  );
}
