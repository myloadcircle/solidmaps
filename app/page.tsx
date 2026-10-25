'use client';

import dynamic from 'next/dynamic';
import { useCallback, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import RoutePlanner from '@/components/RoutePlanner';
import ActiveNavigation from '@/components/ActiveNavigation';
import VehicleProfileManager from '@/components/VehicleProfileManager';
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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const lastPlanRef = useRef<{ origin: LatLon; destination: LatLon; mode: Mode; vehicle_id?: string } | null>(null);

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

      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2 backdrop-blur">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-sky-400">solid</span>maps
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
    </main>
  );
}
