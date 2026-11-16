'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export const ROLLOUT_SEEN_KEY = 'satnav_rollout_v1_seen';

export const FEEDBACK_CATEGORIES = [
  { id: 'ukie', label: 'UK & Ireland' },
  { id: 'eu', label: 'Europe (EU)' },
  { id: 'global', label: 'Global' },
  { id: 'vehicle-profiles', label: 'Vehicle Profiles / HGV' },
  { id: 'other', label: 'Other' },
] as const;

export function hasSeenRollout(): boolean {
  try {
    return localStorage.getItem(ROLLOUT_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markRolloutSeen(): void {
  try {
    localStorage.setItem(ROLLOUT_SEEN_KEY, '1');
  } catch {}
}

interface SuggestionSheetProps {
  onClose: () => void;
}

export function SuggestionSheet({ onClose }: SuggestionSheetProps) {
  const [category, setCategory] = useState<string>('ukie');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (message.trim().length < 5) {
      setError('Tell us a little more (at least 5 characters).');
      return;
    }
    setState('busy');
    setError(null);
    api
      .sendFeedback(category, message.trim())
      .then(() => {
        setState('ok');
        setTimeout(onClose, 2600);
      })
      .catch((err: unknown) => {
        setState('error');
        setError(err instanceof Error ? err.message : 'Sending failed — try again.');
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Share a suggestion"
      >
        {state === 'ok' ? (
          <div className="py-6 text-center">
            <p className="text-2xl" aria-hidden="true">
              🚛
            </p>
            <p className="mt-3 text-sm font-semibold text-emerald-400">
              Thanks — your suggestion goes straight to Francis &amp; the build queue.
            </p>
            <button onClick={onClose} className="mt-5 w-full rounded-xl border border-slate-600 py-2 text-sm">
              Close
            </button>
          </div>
        ) : (
          <>
            <h3 className="text-base font-bold">Share a suggestion</h3>
            <p className="mt-1 text-xs text-slate-400">
              Where should the satnav engine go next? What do you need routed around?
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {FEEDBACK_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={
                    'rounded-full px-3 py-1.5 text-xs font-semibold ' +
                    (category === c.id ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Tell us what vehicle setup, restriction, or routing feature you want built in..."
              aria-label="Your suggestion"
              className="mt-3 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
            />
            {error && (
              <p className="mt-2 text-xs text-rose-400" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={state === 'busy'}
              className="mt-3 w-full rounded-xl bg-sky-600 py-2.5 text-sm font-bold disabled:opacity-50"
            >
              {state === 'busy' ? 'Sending…' : 'Send suggestion'}
            </button>
            <button onClick={onClose} className="mt-2 w-full rounded-xl py-2 text-xs text-slate-400 hover:text-slate-200">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function RolloutAnnouncement({ onClose, onSuggest }: { onClose: () => void; onSuggest: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label="Upgrading to full turn-by-turn satnav"
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-sky-500/40 bg-slate-900 p-5 text-slate-100 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-sky-400">Upgrading to Full Turn-by-Turn Satnav 🚀</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          We’re upgrading your app from a standalone alert tool into a full turn-by-turn satnav
          solution. Over the next 7 days, we’re rolling out our dedicated routing engine in stages:
        </p>
        <ol className="mt-3 space-y-1.5 text-sm text-slate-200">
          <li className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-400">1</span>
            UK &amp; Ireland (rolling out first)
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs font-bold text-sky-400">2</span>
            Europe (EU) (next)
          </li>
          <li className="flex items-center gap-2">
            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs font-bold text-violet-400">3</span>
            Global (following right after)
          </li>
        </ol>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Core navigation is landing for everyone, while Pro unlocks the full-fat routing
          experience—including full vehicle profile customization and multi-stop routing. Got a
          specific route pain point, vehicle profile need, or feature you want built in? Tell us
          directly—we’re actively shaping this week's rollout around driver feedback.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={onSuggest}
            className="flex-1 rounded-xl bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-500"
          >
            Share a Suggestion
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-600 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Got it
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          Reopen anytime via “What’s new” in the footer.
        </p>
      </div>
    </div>
  );
}
