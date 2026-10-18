'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { isPlusCode, normalizePlusCode } from '@/lib/pluscode';
import type { GeocodeResult } from '@/shared/types';

interface LocationInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export default function LocationInput({ value, onChange, placeholder }: LocationInputProps) {
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (trimmed.length < 3 || isPlusCode(trimmed) || /^-?\d/.test(trimmed)) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      api
        .geocode(trimmed)
        .then((results) => {
          setSuggestions(results.slice(0, 5));
          setOpen(results.length > 0);
        })
        .catch(() => {
          setSuggestions([]);
          setOpen(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const trimmed = value.trim();
          if (isPlusCode(trimmed)) onChange(normalizePlusCode(trimmed));
          setTimeout(() => setOpen(false), 150);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s.text);
                  setSuggestions([]);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-800"
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
