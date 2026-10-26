# SolidMaps launch audit — 2026-10-25 (launch manager's verdict)

## Product: READY for public launch on the web (solidmap.app). Play build = next lane, unblocked.

## Evidence summary (all verified live 2026-10-25)

**Domain**: https://solidmap.app serves the current build (chunk `page-ea976087…`), HTTPS forced
(301), CF cert valid, www 200, manifest/SW/legal 200. Full detail: docs/domain-audit.md.

**Core flows** (re-verified after every deploy):
- Geocode: 200 (~0.3 s cached) + 30/min rate limit (429 verified)
- Route: OSRM 5,993 m / 31 steps with maneuver locations; KV cache hit headers verified
- Parking: 16 live OSM zones (Leeds), 17 (Edinburgh), 18 (Camden) — real names, no empty strings
- Truck gating 403 anon; auth 401 paths; validation 400s — 22-check suite green
- Voice/GPS/reroute: code-verified logic + API inputs; real-device visual pass still owed (IAB
  webview unavailable in-session; OpenFreeMap style + London tile verified 200 instead)

**Play readiness**: blockers cleared (account deletion shipped + verified; legal live; Data safety
answers, listing copy, TWA build path prepared). docs/play-store-readiness.md.

**Onboarding/UI**: 4 screens, skippable (Esc/Skip), reduced-motion aware, ~20 s to complete —
deployed in the live bundle ("Drive smarter." verified in chunk). Header brand, dark map controls,
planner empty-state shipped.

## QA gate status
| Gate | Status |
|---|---|
| TypeScript | PASS (app + worker) |
| Production build | PASS (static export) |
| Deploy | PASS — scripts/deploy.sh ships worker + both Pages projects, verifies URLs |
| Route/geocode/parking API | PASS (above) |
| Domain + SSL | PASS |
| PWA installability | PASS (criteria met; visual install prompt untested — needs a real device) |
| Mobile browser test | OWED — same real-device session |
| Voice navigation E2E | OWED (needs device audio/GPS) |
| Play readiness | READY to build AAB (next lane) |

## Open items (owner decisions / next lanes)
1. **DNS consolidation** (5-min dashboard edit): point zone records at solidmaps.pages.dev, retire
   the dual-project deploy (docs/domain-audit.md residual items).
2. **Play AAB lane**: Bubblewrap TWA + assetlinks + store assets + emulator walk.
3. **Valhalla endpoint** decision (~$10-20/mo) → honest truck Pro → enable checkout (monetisation.md).
4. Real-device QA (phone): install prompt, voice, GPS navigation drive test.
