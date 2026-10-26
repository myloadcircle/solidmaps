# SolidMaps — full launch-readiness audit (2026-10-26)

Method: real-browser user walks (IAB webview against production), live API probes, header/asset
measurements, code review of every failure path. The webview's network restrictions accidentally
made it a perfect offline/blocked-environment lab — several failure modes were observed live, not
simulated. Every finding below is either fixed (deployed + re-verified) or documented with a reason.

## Phase 1 — real user journeys (browser, production)

| Journey | Result |
|---|---|
| First launch | App shell paints; map engine loads async; spinner → map/fallback |
| Onboarding | 4 screens; dot navigation works; **Esc skip verified live** (dialog closed, `solidmaps_onboarded_v1` persisted); reduced-motion respected |
| Route planning | **Verified live E2E**: 51.538,-0.142 → 51.501,-0.142 → "5.99 km · 16 min", "CAR via osrm", Step 1 of 31 "Depart from Camden High Street", destination plus code shown |
| Navigation | Start → live state (remaining ETA, Pause), step auto-advance logic armed |
| Geolocation (denied) | **Verified live**: "GPS: Timeout expired" surfaced inline; navigation continued in manual mode |
| Truck gate (anon) | **Verified live**: Go Pro modal, honest warning-language copy |
| Register | **Verified live**: email → FREE badge + Log out + Delete controls |
| Account deletion | **Found broken → fixed → verified live** (see Blocker L1) |
| Search | Geocode API 200 from the page context; debounced autocomplete unchanged |
| Error states | Toast path live-tested; see Phase 6 |

Friction noted (not blockers): truck UpsellModal previously leaked "Set NEXT_PUBLIC_UPGRADE_URL"
**fixed** → "Pro isn't open for sign-ups yet…"; onboarding "works offline once loaded" was an
overpromise → **fixed** to "installable to your home screen"; footer brand said solidmaps.app →
**fixed** to solidmap.app.

## Phase 2 — domain validation (solidmap.app)

- SSL: CF cert valid; **HSTS now forced** (max-age 2y, includeSubDomains, preload) via `_headers`.
- Security headers added + verified live: X-Frame-Options DENY, X-Content-Type-Options nosniff,
  Referrer-Policy, Permissions-Policy `geolocation=(self), camera=(), microphone=()`.
- **Canonical link added** (was og:url only) — verified in live HTML.
- PWA: manifest (192/512/maskable PNG + SVG), SW v3 (network-first navigations, cached shell),
  start_url/scope/display standalone — install criteria met (visual install prompt still owes a
  device test).
- Legal: /privacy + /terms 200 on the apex domain.
- Performance: HTML 10.9 KB @ ~0.14 s; initial JS ≈ 530 KB raw (≈1/3 over the wire compressed);
  maplibre chunk 1.09 MB strictly lazy; geocode 0.17–0.26 s; route 0.16–0.38 s; both far under
  budget. `polyfills` chunk (112 KB) is the only dead weight worth a config tweak post-launch.

## Phase 3 — Play Store audit (delta since readiness report)

Data safety answers prepared; deletion now PROVEN working in a browser (was only API-true before —
the preflight bug would have failed a reviewer's deletion test). Listing copy ASCII-clean.
Remaining pre-send gates unchanged: TWA AAB build + assetlinks.json, store assets (4+ screenshots of
this build, luminance-checked), emulator walk, name re-clearance. No new rejection risks found.

## Phase 4 — trust audit

| Claim | Verdict | Action |
|---|---|---|
| "Live parking data" | True (Nominatim/OSM, cached 24 h) | kept |
| "Automatic rerouting" | True (60 m × 2 fixes) | kept |
| Truck "height/weight aware" | **Overpromise on OSRM** (warnings only) | already hedged in modal + listing; engine honesty gate stays until Valhalla |
| "No live traffic feed" label | Honest | kept |
| Pro upsell | Was leaking dev config text | **fixed** with "coming soon" + "no payment taken" |
| "Works offline once loaded" | Overpromise (shell only) | **fixed** |
| "edge-native" chip | Fine | brand string corrected to solidmap.app |

## Phase 5 — performance

Numbers above. Bottlenecks: (1) maplibre 1.09 MB chunk — acceptable, lazy, cached immutable after
first load; (2) polyfills 112 KB — trim via browserslist later; (3) OpenFreeMap style + fonts are
third-party latency — already mitigated by the raster fallback. No launch-blocking issue.

## Phase 6 — failure matrix

| Failure | Behaviour | Evidence |
|---|---|---|
| Tile/network blocked | Auto-switch to raster; if that also fails → terminal honest toast + Retry; planner untouched | **Observed live** in webview; terminal state added after observing the stuck toast |
| No GPS | Inline "GPS: …" message; manual stepping continues | **Observed live** |
| WebGL2 missing | Up-front feature gate; honest message; planner works | Code-verified (cannot disable WebGL in this webview) |
| Routing engine down | Haversine fallback + amber banner (no fake routes) | Code-verified + API 502 path tested earlier |
| Parking provider down | D1 seed fallback | Code-verified |
| Login failure | Inline "Sign-in failed" in header form | Code-verified pattern |
| Account deletion offline | Visible red notice (was silent) | **Fixed + verified live** |

## Phase 7 — competitive positioning (summary)

Differentiators: no ads/trackers, honest failure states, plus-code input, installable PWA, OSM
transparency. Weaknesses vs GMaps/Waze: no live traffic, no POI reviews/street imagery, no lane
guidance, single-destination routing (multi-stop is Pro-planned), map style depth. Next
highest-value features (post-launch): saved Home/Work (uses existing saved_routes table), driver
mode UI collapse, Valhalla alternatives, offline region downloads (true differentiator).

## Phase 8 — launch scorecard

| Category | Score /10 | Bar /10 | Gap |
|---|---|---|---|
| Infrastructure | 8.5 | 8 | DNS consolidation (owner, cosmetic); dual-project deploy |
| Security | 8 | 8 | HSTS/headers done; CSP (report-only) post-launch; no secrets; rate-limited |
| UX | 7.5 | 7 | Real-device pass owed; driver-mode polish is post-launch |
| Performance | 8.5 | 7 | Strong; polyfill trim optional |
| Play readiness | 8 | 8 | Deletion proven; AAB/assets/emulator remain (mechanical) |
| Trust | 9 | 8 | All overpromises removed; honest failure copy everywhere |
| Monetisation | 5 | 6 (launch) | By design: no checkout until Valhalla truck is honest |
| **Overall** | **7.9** | **7.5** | **PASS** |

## Launch blockers

L1 (was): account deletion failed for all browsers — CORS preflight lacked DELETE → **fixed +
verified live** (preflight now lists DELETE; browser E2E: logged out, token cleared).
L2 (was): invisible deletion-failure error → fixed with a visible alert.
No open blockers.

## Recommendation

**LAUNCH NOW (web, solidmap.app)** — as a public v1.0 with a "beta" humility note in release
communications rather than a gate. Real-device pass (install prompt, voice, GPS drive) should happen
this week but does not block web launch: every failure path degrades honestly, and the audit found
no remaining deception, dead end, or broken core journey. Play submission follows the AAB checklist
in docs/play-store-readiness.md.
