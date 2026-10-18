'use client';

import { useEffect, useState } from 'react';
import type { RouteResponse } from '@/shared/types';

export default function ActiveNavigation({
  route,
  onClose,
}: {
  route: RouteResponse;
  onClose: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setStepIndex(0);
  }, [route]);

  const step = route.steps[stepIndex];
  const traffic =
    route.provider === 'mapbox' && route.mode === 'car'
      ? 'Live traffic data active'
      : route.mode === 'transit'
        ? 'Scheduled service'
        : 'No live traffic feed for this route';

  return (
    <div className="absolute left-3 right-3 top-16 z-20 rounded-2xl border border-slate-700 bg-slate-900/95 p-4 text-slate-100 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">
            {Math.round(route.distance_meters / 10) / 100} km ·{' '}
            {Math.max(1, Math.round(route.duration_seconds / 60))} min
          </div>
          <div className="text-xs text-slate-400">
            {route.mode.toUpperCase()} via {route.provider} · {traffic}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg border border-slate-600 px-3 py-1 text-sm"
          aria-label="End navigation"
        >
          End
        </button>
      </div>

      {route.provider === 'haversine' && (
        <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/15 p-3 text-sm text-amber-300">
          ⚠️ Straight-line estimate — road routing unavailable. No turn-by-turn directions.
        </div>
      )}
      {route.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {route.warnings.map((w, i) => (
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
            onClick={() => setStepIndex((i) => i - 1)}
            className="rounded-lg bg-slate-800 px-3 py-2 disabled:opacity-30"
            aria-label="Previous step"
          >
            ‹
          </button>
          <div className="flex-1">
            <div className="text-sm text-slate-300">
              Step {stepIndex + 1} of {route.steps.length}
            </div>
            <div className="font-medium">{step.instruction}</div>
          </div>
          <button
            disabled={stepIndex >= route.steps.length - 1}
            onClick={() => setStepIndex((i) => i + 1)}
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
