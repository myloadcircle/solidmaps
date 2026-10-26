'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { decodePlusCode, encodePlusCode, isPlusCode } from '@/lib/pluscode';
import type { LatLon, Mode, ParkingZone, RouteResponse, VehicleProfile } from '@/shared/types';
import LocationInput from './LocationInput';
import UpsellModal from './UpsellModal';

const MODES: { id: Mode; label: string }[] = [
  { id: 'walk', label: 'Walk' },
  { id: 'transit', label: 'Train' },
  { id: 'car', label: 'Car' },
  { id: 'truck', label: 'Truck' },
];

const COORD_RE = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;

interface RoutePlannerProps {
  onRoute: (route: RouteResponse) => void;
  parkingZones: ParkingZone[];
  onParkingZones: (zones: ParkingZone[]) => void;
  onPlanned?: (plan: { origin: LatLon; destination: LatLon; mode: Mode; vehicle_id?: string }) => void;
}

export default function RoutePlanner({ onRoute, parkingZones, onParkingZones, onPlanned }: RoutePlannerProps) {
  const { user } = useAuth();
  const isPro = user?.subscription_tier === 'pro';
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [mode, setMode] = useState<Mode>('car');
  const [proParking, setProParking] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const [profiles, setProfiles] = useState<VehicleProfile[]>([]);
  const [resolved, setResolved] = useState<{ origin: LatLon | null; destination: LatLon | null }>({
    origin: null,
    destination: null,
  });
  const [destinationCode, setDestinationCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<string | null>(null);

  useEffect(() => {
    if (!isPro) return;
    api
      .vehicleProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [isPro]);

  const resolve = useCallback(async (text: string, reference: LatLon | null): Promise<LatLon> => {
    const trimmed = text.trim();
    const m = COORD_RE.exec(trimmed);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
    const [codePart, ...localityParts] = trimmed.split(/\s+/);
    if (isPlusCode(codePart)) {
      const direct = decodePlusCode(codePart, reference);
      if (direct) return direct;
      if (localityParts.length > 0) {
        const results = await api.geocode(localityParts.join(' '));
        if (results.length > 0) {
          const localRef = { lat: results[0].lat, lon: results[0].lon };
          const decoded = decodePlusCode(codePart, localRef);
          if (decoded) return decoded;
        }
      }
      throw new Error(
        `Could not decode plus code "${codePart}" — add the nearby city, e.g. "${codePart} London", or use a full code.`,
      );
    }
    const results = await api.geocode(trimmed);
    if (!results.length) throw new Error(`Could not find a location for "${trimmed}"`);
    return { lat: results[0].lat, lon: results[0].lon };
  }, []);

  const plan = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!originText.trim() || !destinationText.trim()) {
        setError('Enter a start and destination.');
        return;
      }
      if ((mode === 'truck' || proParking) && !isPro) {
        setUpsell(
          mode === 'truck'
            ? 'Pro Truck Routing adds bridge-height and weight-limit aware routes for HGV and van drivers.'
            : 'Pro Parking shows parking-zone compliance rules at your destination so you never get ticketed.',
        );
        return;
      }
      setLoading(true);
      try {
        const origin = await resolve(originText, resolved.destination);
        const destination = await resolve(destinationText, resolved.origin);
        const route = await api.planRoute({
          origin,
          destination,
          mode,
          vehicle_id: isPro && vehicleId ? vehicleId : undefined,
        });
        setResolved({ origin, destination });
        setDestinationCode(encodePlusCode(destination.lat, destination.lon));
        onPlanned?.({
          origin,
          destination,
          mode,
          vehicle_id: isPro && vehicleId ? vehicleId : undefined,
        });
        onParkingZones([]);
        onRoute(route);
        if (proParking) {
          const parking = await api.parking(destination.lat, destination.lon);
          onParkingZones(parking.zones);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Route planning failed');
      } finally {
        setLoading(false);
      }
    },
    [originText, destinationText, mode, proParking, isPro, vehicleId, resolve, resolved, onRoute, onParkingZones, onPlanned],
  );

  return (
    <>
      <div className="absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-slate-700 bg-slate-900/95 p-3 shadow-xl backdrop-blur">
        <form onSubmit={plan} className="space-y-2">
          <LocationInput
            value={originText}
            onChange={setOriginText}
            placeholder="Start — address, plus code, or lat,lon"
          />
          <LocationInput
            value={destinationText}
            onChange={setDestinationText}
            placeholder="Destination — address, plus code, or lat,lon"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${
                  mode === m.id ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {m.label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={proParking}
                onChange={(e) => setProParking(e.target.checked)}
              />
              Pro Parking
            </label>
          </div>
          {isPro && (mode === 'truck' || mode === 'car') && profiles.length > 0 && (
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            >
              <option value="">Default vehicle</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.vehicle_type.toUpperCase()} — {p.max_height_meters ? `${p.max_height_meters}m` : '—'} —{' '}
                  {p.emissions_class ?? 'no class'}
                </option>
              ))}
            </select>
          )}
          {error && <p className="text-sm text-rose-400">{error}</p>}
          {!originText && !destinationText && !loading && (
            <p className="text-center text-xs text-slate-500">
              Try <span className="text-slate-300">“Camden Market”</span>, a plus code, or paste lat,lon
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-sky-600 py-2.5 font-bold shadow-lg shadow-sky-600/25 transition-transform active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? 'Planning…' : 'Plan route'}
          </button>
        </form>
        {destinationCode && (
          <p className="mt-2 text-center text-xs text-slate-400">
            Destination plus code: <span className="font-semibold text-slate-300">{destinationCode}</span>
          </p>
        )}
        {parkingZones.length > 0 && (
          <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto">
            {parkingZones.map((z) => (
              <div key={z.id} className="rounded-xl bg-slate-800 px-3 py-2 text-xs">
                <div className="flex justify-between font-semibold">
                  <span>{z.name}</span>
                  <span>{z.distance_m} m</span>
                </div>
                <div className="text-slate-400">
                  {z.restrictions.join(' · ')}
                  {z.max_stay_minutes ? ` · Max ${z.max_stay_minutes} min` : ''}
                  {z.paid && z.rate_per_hour != null ? ` · £${z.rate_per_hour}/h` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <UpsellModal feature={upsell} onClose={() => setUpsell(null)} />
    </>
  );
}
