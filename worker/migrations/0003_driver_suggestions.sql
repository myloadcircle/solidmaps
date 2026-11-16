-- Driver suggestion box (satnav rollout feedback) — shared by solidmap.app and mytruckroute.app.
-- app_source distinguishes which app the suggestion came from.
CREATE TABLE IF NOT EXISTS driver_suggestions (
  id TEXT PRIMARY KEY,
  app_source TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  user_tier TEXT NOT NULL DEFAULT 'unknown',
  user_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_driver_suggestions_created ON driver_suggestions(created_at);
CREATE INDEX IF NOT EXISTS idx_driver_suggestions_category ON driver_suggestions(category);
