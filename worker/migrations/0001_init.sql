CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro'))
);

CREATE TABLE IF NOT EXISTS vehicle_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('car', 'van', 'hgv', 'motorcycle')),
  max_height_meters REAL,
  gross_weight_kg INTEGER,
  axle_count INTEGER,
  fuel_type TEXT CHECK (fuel_type IN ('petrol', 'diesel', 'electric', 'hybrid', 'hydrogen', 'other')),
  emissions_class TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_vehicle_profiles_user ON vehicle_profiles(user_id);

CREATE TABLE IF NOT EXISTS saved_routes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('walk', 'transit', 'car', 'truck')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_saved_routes_user ON saved_routes(user_id);

CREATE TABLE IF NOT EXISTS parking_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 250,
  max_stay_minutes INTEGER,
  paid INTEGER NOT NULL DEFAULT 0,
  rate_per_hour REAL,
  restrictions TEXT NOT NULL DEFAULT '[]'
);

INSERT OR IGNORE INTO parking_zones (id, name, lat, lon, radius_m, max_stay_minutes, paid, rate_per_hour, restrictions) VALUES
  ('zone-camden-1', 'Camden CPZ', 51.5390, -0.1426, 300, 120, 1, 3.2, '["Mon-Fri 08:30-18:30", "Pay by phone only"]'),
  ('zone-westminster-a', 'Westminster Zone A', 51.5100, -0.1300, 400, 60, 1, 5.6, '["Mon-Sun 08:00-22:00", "No loading during peak"]'),
  ('zone-islington', 'Islington Permit Zone', 51.5450, -0.1030, 350, NULL, 0, NULL, '["Permit holders only"]'),
  ('zone-shoreditch', 'Shoreditch Loading Bay', 51.5230, -0.0800, 150, 45, 1, 2.0, '["Goods vehicles only", "Max 45 min"]');
