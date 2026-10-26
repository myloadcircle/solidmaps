# Play Store readiness — SolidMaps (2026-10-25)

Audited against the estate's Play rejection guardrails (C:\DEV\play-rejection-guardrails.md, 13 sections).

## Recommended Play packaging: TWA (Trusted Web Activity)

Not a custom WebView shell. Rationale: §6/§12 of the guardrails allow shells only where content is
interactive and unbounded — a live map with real routing, GPS navigation and parking data qualifies
(Hauladay-precedent shape, stronger). A TWA via **Bubblewrap/PWABuilder** is the accepted Play pattern
for installable PWAs: no wrapper code, Chrome-rendered, automatic URL bar removal, and web fixes ship
to installed phones with no AAB rebuild.

Build path (next session):
1. `npm i -g @bubblewrap/cli && bubblewrap init --manifest https://solidmap.app/manifest.json`
2. Package `app.solidmaps.twa` (or uk.co.loadcircle.solidmaps — owner's call), min SDK 23+.
3. Sign AAB with the estate upload key (loadcircle-upload.jks is in the vault).
4. Copy the signing cert SHA-256 into `public/.well-known/assetlinks.json` on solidmap.app
   (Bubblewrap prints it; deploy via scripts/deploy.sh) — REQUIRED for the TWA to open without a browser bar.
5. Internal testing first; production "Submit" remains the owner's click (estate rule).

## Blocker audit (estate checklist)

| Guardrail | Status |
|---|---|
| §4 Data safety | READY — answers prepared below; deletion now exists in-app |
| §4 Account deletion | FIXED 25 Oct: `DELETE /api/auth/account` (deletes vehicle_profiles, saved_routes, users in one D1 batch) + in-app "Delete" control with confirm. Verified live (401 unauth gate) |
| §5 Legal on own domain | PASS — solidmap.app/privacy + /terms, 200, own identity, Loadcircle Ltd |
| §5 Legal pages open in-shell offline | TWA renders the live site; SW v3 network-first navigations + cached legal pages — verify on emulator during the AAB lane |
| §6 WebView shell rules | TWA avoids the wrapper class entirely; no ads SDK; permissions: none in manifest (Chrome prompts for geolocation in context) |
| §7 ASCII console text | Listing copy below is ASCII-only |
| §9 Name sweep | "SolidMaps" — no live Play collision found at audit time; re-run the four-axis name check before the send |
| §12 Low-effort gate | Stateful entities: users (D1), vehicle profiles (D1, real records with dimensions/fuel/emissions), saved_routes table (schema ready, feature pending), KV route/parking caches. Interactive unbounded surface (worldwide map + routing). Not a form-in-shell, not a checklist app. Aggregation test: TruckRoute is NATIVE and separately live — SolidMaps is not its feature clone; Phase 6 makes them share an ENGINE, not a store listing. Family count: new name family, no "-file" pattern — no 4+ cluster created |
| §13 Interactive elements | Every visible control is functional (verified in QA rounds: plan, modes, nav start/pause/end, vehicle profiles, parking toggle) |
| Content rating | IARC questionnaire: no violence/user content/gambling/health claims → Everyone. No AI-generated content declaration needed (no generative surfaces) |
| Location compliance | Foreground-only, in-context (Start navigation / GPS puck), never background; privacy policy states GPS stays in-browser. Precise-location Data safety entry prepared below |

## Data safety form (prepared answers)

- Data collected: **Location (approximate + precise)** — used for routing/navigation; not shared with
  third parties for advertising; deleted: not retained server-side (route queries carry points, only
  cached 5 min in aggregate KV).
- Data collected: **Email** — account management; encrypted in transit (HTTPS); deletion supported
  in-app (Delete account) and via privacy page contact.
- Contains ads: **No**. Purchases: **No** at launch (Pro is not purchasable; when Pro ships, declare IAP).
- Data security: encryption in transit (yes, HTTPS only).

## Store listing (ASCII, ready to paste)

**Title (max 30):**
`SolidMaps: Navigation & Parking`

**Short description (max 80):**
`Turn-by-turn navigation with voice guidance, live rerouting and real parking data.`

**Long description:**
```
SolidMaps is free turn-by-turn navigation that respects you: no ad trackers, no
data selling, just fast routing on an edge-fast map engine.

TURN-BY-TURN NAVIGATION
- Real road routing with distance and ETA
- Voice guidance for every maneuver
- Live GPS tracking with a moving map
- Automatic rerouting when you leave the route

PARKING INTELLIGENCE
- Find real parking around your destination
- Max-stay rules, access restrictions and paid/free at a glance
- Live data from OpenStreetMap, updated daily

BUILT FOR DRIVERS
- Truck mode with bridge-height and weight warnings (Pro)
- ULEZ compliance warnings for UK drivers
- Works with addresses, plus codes or raw coordinates
- Installable: works like a native app, updates instantly

Map data (c) OpenStreetMap contributors. Parking data via OpenStreetMap.
Height and weight limits are advisory warnings, not route guarantees.
```

**Keywords (for the hidden keyword field / ASO):**
`navigation, gps, driving directions, parking, truck routing, hgv, voice navigation, offline maps, ulez, turn by turn`

**Release notes (v1.0):**
```
First public release.
- Turn-by-turn navigation with voice guidance
- Live GPS tracking and automatic rerouting
- Real parking data around your destination
- Truck-aware route warnings for professional drivers
- Installable app (PWA), no ads, no trackers
```

## Remaining pre-send gates (next session, AAB lane)

1. Build + sign the TWA AAB; publish assetlinks.json.
2. Store assets: icon at 512 PNG (already generated), feature graphic 1024x500, 4+ phone screenshots
   of THIS build (luminance-checked per estate rule), 48dp icon preview for the owner.
3. Emulator walk: install AAB, legal pages offline, GPS nav E2E, back button behaviour.
4. Four-axis name clearance re-run, then internal testing track.
