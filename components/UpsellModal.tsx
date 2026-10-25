'use client';

interface UpsellModalProps {
  feature: string | null;
  onClose: () => void;
}

export default function UpsellModal({ feature, onClose }: UpsellModalProps) {
  if (!feature) return null;
  const upgradeUrl = process.env.NEXT_PUBLIC_UPGRADE_URL;
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
        {upgradeUrl ? (
          <a
            href={upgradeUrl}
            className="mt-5 block rounded-xl bg-sky-600 py-3 text-center font-semibold"
          >
            Upgrade now
          </a>
        ) : (
          <p className="mt-5 text-center text-xs text-slate-500">
            Checkout not configured. Set NEXT_PUBLIC_UPGRADE_URL.
          </p>
        )}
        <button onClick={onClose} className="mt-3 w-full rounded-xl border border-slate-600 py-2 text-sm">
          Maybe later
        </button>
      </div>
    </div>
  );
}
