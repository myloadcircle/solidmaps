# SolidMaps monetisation plan (design, not yet wired) — 2026-10-25

## Principles (from the estate's wellness/pricing doctrine)
Small nudges over big features; a free tier that is genuinely useful (the funnel); never price the
core journey out of habit; price references: TruckRoute Pro $9.99 one-off flip, CertPocket £19.99/yr,
Quashkit £6.99 once, Mindfulness $29.99/mo is the anti-pattern.

## Tiers

### SolidMaps Free (the funnel, forever free)
- Turn-by-turn navigation, voice, rerouting
- Car / walk / transit modes
- Parking lookups (basic: nearest bays + names)
- Unlimited searches (rate-limited fairly)

### SolidMaps Pro
| Feature | Status today | Pro shape |
|---|---|---|
| Truck mode (HGV/van profiles) | Gated, engine = OSRM (warnings only) | Valhalla-backed height/weight-aware routing (Phase 6 unlocks this honestly) |
| Height / weight / axle warnings | Coded (warnings) | Included |
| Advanced parking intelligence | Parking exists for all | Pro: max-stay + restriction filters, "compliant for my vehicle" check |
| Offline regions | Not built | Pro: download a region's tiles + routing cache for dead zones |
| Multi-stop routing | Not built | Pro: up to 10 waypoints per route |

## Recommended pricing
- **£4.99/month or £24.99/year** (annual = the anchor; 4 months free vs monthly).
  Rationale: sits between Quashkit (£6.99 once, single-purpose drafter) and CertPocket (£19.99/yr,
  business-critical wallet). Truck drivers get daily utility — subscription is defensible — but the
  market reference (Google Maps/Waze free, TruckRoute Pro $9.99 once) caps tolerance. Launch offer:
  **£19.99 first year** (TRUCKLAUNCH-style).
- One-time lifetime £39.99 as a grandfather option (estate precedent: pro_lifetime in sibling apps).
- Pro is NOT purchasable at launch (no checkout) — that is correct: the app must be able to honestly
  deliver Valhalla truck routing before charging for it (misleading-claims guardrail).

## Wiring plan (when the owner green-lights pricing)
1. Stripe Payment Link (estate shared account, Loadcircle Ltd) → `NEXT_PUBLIC_UPGRADE_URL` (hook exists).
2. Worker: `/api/auth/upgrade` verifying a Stripe checkout session → set `subscription_tier='pro'`.
3. Play build later: Play Billing one-product `solidmaps_pro_yearly` (estate RC/console pattern), price
   NET of VAT in console (estate rule), currency gate before any upload.
4. Upsell modal already honest; swap "Checkout not configured" for the live link.
