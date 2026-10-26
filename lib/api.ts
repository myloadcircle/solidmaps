import type {
  GeocodeResult,
  LatLon,
  ParkingResponse,
  RouteRequest,
  RouteResponse,
  User,
  VehicleProfile,
} from '@/shared/types';

const TOKEN_KEY = 'solidmaps_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '')}/api`
  : '/api';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`,
    );
  }
  return body as T;
}

export const api = {
  issueToken: (email: string) =>
    request<{ token: string; user: User }>('/auth/issue', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  getUser: () => request<User>('/auth/me'),
  deleteAccount: () =>
    request<{ deleted: boolean }>('/auth/account', { method: 'DELETE' }),
  geocode: (q: string) => request<GeocodeResult[]>(`/geocode?q=${encodeURIComponent(q)}`),
  planRoute: (r: RouteRequest) =>
    request<RouteResponse>('/route', { method: 'POST', body: JSON.stringify(r) }),
  parking: (lat: number, lon: number) =>
    request<ParkingResponse>(`/parking?lat=${lat}&lon=${lon}`),
  vehicleProfiles: () => request<VehicleProfile[]>('/vehicle-profile'),
  saveVehicleProfile: (p: Omit<VehicleProfile, 'id' | 'user_id'>) =>
    request<VehicleProfile>('/vehicle-profile', { method: 'POST', body: JSON.stringify(p) }),
};

export type { LatLon };
