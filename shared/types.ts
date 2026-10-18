export type SubscriptionTier = 'free' | 'pro';
export type VehicleType = 'car' | 'van' | 'hgv' | 'motorcycle';
export type FuelType = 'petrol' | 'diesel' | 'electric' | 'hybrid' | 'hydrogen' | 'other';
export type Mode = 'walk' | 'transit' | 'car' | 'truck';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface User {
  id: string;
  email: string;
  subscription_tier: SubscriptionTier;
}

export interface VehicleProfile {
  id: string;
  user_id: string;
  vehicle_type: VehicleType;
  max_height_meters: number | null;
  gross_weight_kg: number | null;
  axle_count: number | null;
  fuel_type: FuelType | null;
  emissions_class: string | null;
}

export interface RouteRequest {
  origin: LatLon;
  destination: LatLon;
  mode: Mode;
  vehicle_id?: string;
}

export interface RouteWarning {
  type: 'ulez' | 'bridge' | 'traffic' | 'toll' | 'info';
  title: string;
  detail: string;
  point?: LatLon;
}

export interface RouteGeometry {
  coordinates: [number, number][];
}

export interface RouteStep {
  instruction: string;
  distance_meters: number;
}

export interface RouteResponse {
  provider: string;
  mode: Mode;
  distance_meters: number;
  duration_seconds: number;
  geometry: RouteGeometry | null;
  steps: RouteStep[];
  warnings: RouteWarning[];
  commercial: boolean;
}

export interface GeocodeResult {
  id: string;
  text: string;
  lat: number;
  lon: number;
}

export interface ParkingZone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  max_stay_minutes: number | null;
  paid: boolean;
  rate_per_hour: number | null;
  restrictions: string[];
  distance_m: number;
}

export interface ParkingResponse {
  zones: ParkingZone[];
  availability: unknown;
}
