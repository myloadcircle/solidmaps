-- Billing: Stripe Payment Link membership state.
-- Adds Pro membership bookkeeping to users and an idempotency ledger for webhooks.

ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN pro_since INTEGER;
ALTER TABLE users ADD COLUMN pro_until INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
