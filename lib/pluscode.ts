import { OpenLocationCode } from 'open-location-code';
import type { LatLon } from '@/shared/types';

const olc = new OpenLocationCode();

export function isPlusCode(input: string): boolean {
  try {
    return olc.isValid(input.trim().toUpperCase());
  } catch {
    return false;
  }
}

export function decodePlusCode(input: string, reference?: LatLon | null): LatLon | null {
  const code = input.trim().toUpperCase();
  try {
    if (!olc.isValid(code)) return null;
    if (olc.isFull(code)) {
      const area = olc.decode(code);
      return { lat: area.latitudeCenter, lon: area.longitudeCenter };
    }
    if (reference) {
      const full = olc.recoverNearest(code, reference.lat, reference.lon);
      const area = olc.decode(full);
      return { lat: area.latitudeCenter, lon: area.longitudeCenter };
    }
    return null;
  } catch {
    return null;
  }
}

export function encodePlusCode(lat: number, lon: number): string {
  return olc.encode(lat, lon);
}

export function normalizePlusCode(input: string): string {
  return input.trim().toUpperCase();
}
