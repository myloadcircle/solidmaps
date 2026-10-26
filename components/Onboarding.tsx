'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'solidmaps_onboarded_v1';

function PinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <path
        d="M256 88c-66 0-120 54-120 120 0 90 120 216 120 216s120-126 120-216c0-66-54-120-120-120zm0 164a44 44 0 1 1 0-88 44 44 0 0 1 0 88z"
        fill="currentColor"
      />
    </svg>
  );
}

interface Slide {
  title: ReactNode;
  kicker: string;
  lines: string[];
  art: ReactNode;
}

const SLIDES: Slide[] = [
  {
    kicker: 'SolidMaps',
    title: (
      <>
        Drive smarter.
        <br />
        Park legally.
      </>
    ),
    lines: ['Free turn-by-turn navigation on a private, edge-fast map engine.'],
    art: (
      <div className="relative flex h-40 w-40 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-sky-500/20 blur-2xl sm-anim-glow" />
        <PinMark className="sm-anim-pop h-24 w-24 text-sky-400 drop-shadow-[0_0_24px_rgba(56,189,248,0.55)]" />
      </div>
    ),
  },
  {
    kicker: 'Navigation',
    title: 'Real routing. Real voice.',
    lines: ['Turn-by-turn guidance with voice prompts,', 'live GPS tracking and automatic rerouting'],
    art: (
      <svg viewBox="0 0 200 120" className="sm-anim-pop h-40 w-56" aria-hidden="true">
        <path d="M20 95 C 60 95, 70 40, 110 40 S 160 70, 180 30" fill="none" stroke="#38bdf8" strokeWidth="6" strokeLinecap="round" />
        <path d="M20 95 C 60 95, 70 40, 110 40 S 160 70, 180 30" fill="none" stroke="#0c4a6e" strokeWidth="12" strokeLinecap="round" opacity="0.5" />
        <circle cx="20" cy="95" r="7" fill="#e2e8f0" />
        <circle cx="180" cy="30" r="7" fill="#f59e0b" />
        <circle cx="110" cy="40" r="5" fill="#38bdf8" />
      </svg>
    ),
  },
  {
    kicker: 'Parking Intelligence',
    title: 'Park without the circling.',
    lines: ['Live parking data around your destination —', 'bays, restrictions and max-stay rules.'],
    art: (
      <div className="flex h-40 items-end justify-center gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`sm-anim-pop sm-delay-${i + 1} flex w-16 flex-col items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 p-3`}
          >
            <span className="rounded-md bg-sky-600 px-2 py-0.5 text-lg font-black text-white">P</span>
            <span className="h-1.5 w-8 rounded bg-slate-700" />
            <span className="h-1.5 w-10 rounded bg-slate-700" />
          </div>
        ))}
      </div>
    ),
  },
  {
    kicker: 'Ready',
    title: 'Start exploring.',
    lines: ['Type a destination, drop a plus code,', 'or just follow your feet.'],
    art: (
      <div className="relative flex h-40 w-40 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-emerald-500/15 blur-2xl sm-anim-glow" />
        <PinMark className="sm-anim-pop h-20 w-20 text-emerald-400 drop-shadow-[0_0_24px_rgba(52,211,153,0.5)]" />
      </div>
    ),
  },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(); if (e.key === 'Enter') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
    onDone();
  };

  const next = () => (slide === SLIDES.length - 1 ? finish() : setSlide((s) => s + 1));
  const s = SLIDES[slide];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/92 px-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to SolidMaps"
    >
      <button
        onClick={finish}
        className="absolute right-4 top-4 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      >
        Skip
      </button>

      <div key={slide} className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-6 flex h-44 items-center justify-center">{s.art}</div>
        <p className="sm-anim-fade-up text-xs font-bold uppercase tracking-[0.25em] text-sky-400">{s.kicker}</p>
        <h2 className="sm-anim-fade-up sm-delay-1 mt-3 text-3xl font-bold leading-tight text-slate-100">{s.title}</h2>
        <p className="sm-anim-fade-up sm-delay-2 mt-4 text-sm leading-relaxed text-slate-400">
          {s.lines.map((l, i) => (
            <span key={i} className="block">
              {l}
            </span>
          ))}
        </p>
      </div>

      <div className="mt-10 flex items-center gap-3">
        <div className="flex items-center gap-2" aria-label={`Step ${slide + 1} of ${SLIDES.length}`}>
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              aria-label={`Go to step ${i + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === slide ? 'w-7 bg-sky-400' : 'w-2 bg-slate-700 hover:bg-slate-600'
              }`}
            />
          ))}
        </div>
      </div>

      <button
        onClick={next}
        className="mt-8 w-64 rounded-2xl bg-sky-600 py-3.5 text-base font-bold text-white shadow-lg shadow-sky-600/30 transition-transform active:scale-[0.98] hover:bg-sky-500"
      >
        {slide === SLIDES.length - 1 ? 'Start exploring' : 'Continue'}
      </button>
      <p className="mt-3 text-[11px] text-slate-600">Skippable anytime · installable to your home screen</p>
    </div>
  );
}

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
