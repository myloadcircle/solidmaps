'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@/lib/api';
import type { FuelType, VehicleProfile, VehicleType } from '@/shared/types';

const VEHICLE_TYPES: VehicleType[] = ['car', 'van', 'hgv', 'motorcycle'];
const FUEL_TYPES: FuelType[] = ['petrol', 'diesel', 'electric', 'hybrid', 'hydrogen', 'other'];
const EMISSIONS = ['Euro0', 'Euro1', 'Euro2', 'Euro3', 'Euro4', 'Euro5', 'Euro6', 'Euro6d', 'Zero Emission'];

interface FormState {
  vehicle_type: VehicleType;
  max_height_meters: string;
  gross_weight_kg: string;
  axle_count: string;
  fuel_type: FuelType;
  emissions_class: string;
}

const EMPTY_FORM: FormState = {
  vehicle_type: 'car',
  max_height_meters: '',
  gross_weight_kg: '',
  axle_count: '',
  fuel_type: 'petrol',
  emissions_class: 'Euro6',
};

export default function VehicleProfileManager({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<VehicleProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  useEffect(() => {
    api
      .vehicleProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await api.saveVehicleProfile({
        vehicle_type: form.vehicle_type,
        max_height_meters: form.max_height_meters === '' ? null : parseFloat(form.max_height_meters),
        gross_weight_kg: form.gross_weight_kg === '' ? null : Math.round(parseFloat(form.gross_weight_kg)),
        axle_count: form.axle_count === '' ? null : Math.round(parseFloat(form.axle_count)),
        fuel_type: form.fuel_type,
        emissions_class: form.emissions_class,
      });
      setProfiles((p) => [saved, ...p]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const input =
    'w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm';

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 max-h-[80%] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Vehicle profiles</h2>
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-3 py-1 text-sm">
          Close
        </button>
      </div>

      <form onSubmit={submit} className="mt-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-400">
            Vehicle type
            <select
              value={form.vehicle_type}
              onChange={(e) => setForm((f) => ({ ...f, vehicle_type: e.target.value as VehicleType }))}
              className={input}
            >
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Fuel type
            <select
              value={form.fuel_type}
              onChange={(e) => setForm((f) => ({ ...f, fuel_type: e.target.value as FuelType }))}
              className={input}
            >
              {FUEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Emissions class
            <select
              value={form.emissions_class}
              onChange={(e) => setForm((f) => ({ ...f, emissions_class: e.target.value }))}
              className={input}
            >
              {EMISSIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Max height (m)
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.max_height_meters}
              onChange={(e) => setForm((f) => ({ ...f, max_height_meters: e.target.value }))}
              className={input}
              placeholder="e.g. 4.2"
            />
          </label>
          <label className="text-xs text-slate-400">
            Gross weight (kg)
            <input
              type="number"
              min="0"
              value={form.gross_weight_kg}
              onChange={(e) => setForm((f) => ({ ...f, gross_weight_kg: e.target.value }))}
              className={input}
              placeholder="e.g. 7500"
            />
          </label>
          <label className="text-xs text-slate-400">
            Axle count
            <input
              type="number"
              min="0"
              value={form.axle_count}
              onChange={(e) => setForm((f) => ({ ...f, axle_count: e.target.value }))}
              className={input}
              placeholder="e.g. 2"
            />
          </label>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-sky-600 py-2.5 font-bold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      {profiles.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {profiles.map((p) => (
            <li key={p.id} className="rounded-xl bg-slate-800 px-3 py-2 text-xs">
              <div className="font-semibold">
                {p.vehicle_type.toUpperCase()} · {p.emissions_class ?? 'no class'} · {p.fuel_type ?? 'no fuel'}
              </div>
              <div className="text-slate-400">
                {p.max_height_meters ? `${p.max_height_meters}m` : '—'} height ·{' '}
                {p.gross_weight_kg ? `${p.gross_weight_kg}kg` : '—'} weight ·{' '}
                {p.axle_count ? `${p.axle_count} axles` : '—'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
