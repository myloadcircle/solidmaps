'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

interface UpsellModalProps {
  feature: string | null;
  onClose: () => void;
}

export default function UpsellModal({ feature, onClose }: UpsellModalProps) {
  const { user } = useAuth();
  const upgradeUrl = process.env.NEXT_PUBLIC_UPGRADE_URL;
  const [truckId, setTruckId] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  // Attach the signed-in user so the Stripe webhook can flip the right account to Pro.
  const checkoutUrl = useMemo(() => {
    if (!upgradeUrl) return null;
    if (!user) return upgradeUrl;
    try {
      const url = new URL(upgradeUrl);
      url.searchParams.set('client_reference_id', user.id);
      if (user.email) url.searchParams.set('prefilled_email', user.email);
      return url.toString();
    } catch {
      return upgradeUrl;
    }
  }, [upgradeUrl, user]);

  if (!feature) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold">Go Pro</h2>
        <p className="mt-2 text-sm text-slate-300">{feature}</p>
        <ul className="mt-3 space-y-1 text-sm text-slate-300">
          <li>· Truck routing with bridge-height and weight-limit warnings</li>
          <li>· Live parking data around your destination (OpenStreetMap)</li>
          <li>· ULEZ / LEZ compliance warnings across the UK</li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          Height and weight limits are flagged as warnings; routes avoid them only where the
          underlying OpenStreetMap data supports it.
        </p>

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/60 p-3">
          <p className="text-xs font-semibold text-slate-300">Already Pro on TruckRoute?</p>
          <div className="mt-2 flex gap-2">
            <input
              value={truckId}
              onChange={(e) => {
                setTruckId(e.target.value);
                setState('idle');
                setMsg(null);
              }}
              placeholder="Your TruckRoute account ID or email"
              aria-label="TruckRoute account ID"
              className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-500"
            />
            <button
              type="button"
              disabled={state === 'busy' || truckId.trim().length === 0}
              onClick={() => {
                setState('busy');
                setMsg(null);
                api
                  .exchangeTruckroute(truckId.trim())
                  .then(() => {
                    setState('ok');
                    setMsg('Pro unlocked — reload to see it.');
                    setTimeout(onClose, 1600);
                  })
                  .catch((err: unknown) => {
                    setState('error');
                    setMsg(err instanceof Error ? err.message : 'Exchange failed');
                  });
              }}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {state === 'busy' ? 'Checking…' : 'Use it here'}
            </button>
          </div>
          {msg && (
            <p className={'mt-2 text-xs ' + (state === 'ok' ? 'text-emerald-400' : 'text-rose-400')} role="status">
              {msg}
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            We check your TruckRoute subscription with RevenueCat and unlock SolidMaps Pro for the
            matching period. No payment is taken here.
          </p>
        </div>

        {checkoutUrl ? (
          <a href={checkoutUrl} className="mt-4 block rounded-xl bg-sky-600 py-3 text-center font-semibold">
            Upgrade now
          </a>
        ) : (
          <p className="mt-4 rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-center text-xs text-slate-400">
            Direct billing isn't open yet — use TruckRoute Pro above, or check back soon.
          </p>
        )}
        <button onClick={onClose} className="mt-3 w-full rounded-xl border border-slate-600 py-2 text-sm">
          Maybe later
        </button>
      </div>
    </div>
  );
}
