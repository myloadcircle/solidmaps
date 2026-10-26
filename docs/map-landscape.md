# SolidMaps — map landscape, competitive position, blind spots, four-axis identity audit
Date: 2026-10-26. Evidence: live checks (DNS/HTTP/SERP via search) + the estate's prior REA/Play audits.
Figures marked (†) are general-knowledge estimates needing a dedicated verification pass before use in
any external material.

## 1. Four-axis identity audit (SolidMaps / solidmap.app)

| Axis | Result | Verdict |
|---|---|---|
| 1. Domain | `solidmap.app` owned + live. `solidmaps.app`, `solidmap.io`, `solidmaps.io`, `solidmap.co.uk` all UNREGISTERED (checked via DNS). **`solidmaps.com` is held by someone else** (AWS-hosted, HTTPS dead — likely parked/aftermarket) | PASS with a caution: someone else owns the plural .com |
| 2. Apple App Store | No app named "SolidMaps" found (US search) | PASS |
| 3. Trademarks | No registered USPTO/TMview hit surfaced for "SolidMaps" in class 9/navigation. **BUT**: a "SolidMaps™" 3D-printed-tactile-map gift business actively uses the name (Instagram @solid.maps, facebook.com/solidmaps) with a common-law ™ claim — different market (physical goods/class 20-ish, not downloadable software), so coexistence is plausible but NOT clearance | CAUTION — defensible, not clean |
| 4. SERP / live collisions | Exact-name SERP: no map/navigation product named SolidMaps found; nearest names are SolidWorks (CAD), solid.software (agency) | PASS |

**Net:** 3.5/4 axes clean. Actions (cheap, owner): register `solidmaps.app` + `solidmap.co.uk` now
(defensive, ~£25/yr total); make an informal acquisition enquiry on `solidmaps.com` (parked); before
any paid marketing, run a formal TMview/USPTO class-9/42 search — the tactile-map maker is the only
known live user of the exact name.

## 2. Landscape — who owns what († where estimated)

| Player | Moat | What they own that we can't match soon |
|---|---|---|
| Google Maps | Data flywheel: POI database, live traffic (Android telemetry), Street View, reviews | Search quality, POI freshness, traffic |
| Waze | Crowdsource network: incidents, police, speed cameras; passive-driver telemetry | Real-time road events |
| Apple Maps | OS distribution (CarPlay/Watch), privacy positioning, Look Around | iOS default + ecosystem integration |
| Organic Maps / CoMaps | Offline-first OSM, FOSS trust, no tracking | Fully-offline routing + search, devoted community |
| OsmAnd | Depth: contour lines, GPX, plugins, offline | Power-user feature surface |
| HERE WeGo | Fleet-grade map data, offline | B2B/licensing channel |
| TruckRoute-adjacent (Garmin dezl, Sygic Truck, Trucker Path, SmartTruckRoute †) | Truck-attribute routing graphs; Trucker Path adds truck stops/parking/weigh stations | Verified truck attributes + driver POI density (US especially) |
| Parking (Parkopedia, JustPark, RingGo †) | Coverage breadth + live occupancy + payments integration | Bookable/occupancy data |

**Where SolidMaps honestly wins today:** no ads/trackers, installable PWA (no store gate), plus-code
input, honest failure states, UK postcodes resolve authoritatively (new), truck *warnings* gate,
edge-fast cold start (0.14 s HTML).
**Where it loses today:** no offline regions, no live traffic/incidents, no POI search depth
(Nominatim ≠ Google local search), no turnRestrictions-grade truck graph, no CarPlay/Android Auto,
single-destination only, English-only UI.

## 3. Blind spots not covered so far (prioritized; none were in prior audits)

1. **Offline everything** — our #1 differentiator opportunity (PWA + PMTiles makes it feasible) and
   our #1 credibility gap vs Organic Maps. Not started.
2. **Localization + units** — UI is English-only; no imperial-unit setting. Violates the estate's own
   global-readiness bar (units Auto/Metric/Imperial). Cheap: Intl-based formatting + a toggle.
3. **Light mode** — shell is dark-only; Liberty style is light. Jarring in daylight; estate design bar
   expects a palette pair.
4. **POI/search depth** — autocomplete only geocodes places, not businesses ("Costa Harrow" fails).
   Photon POI search or Overture/FOSSGIS places is the fix path.
5. **Live road context** — no traffic, incidents, roadworks. Even a "no live data" honest label (we
   have) doesn't stop churn to Waze for commuting. Medium-term: pull national roadworks open data
   (e.g. UK National Highways) as a start.
6. **ULEZ/LEZ zone polygons** — we warn from vehicle class, but never draw or test the actual zone
   boundary. Zone polygons are open data (TfL); drawing them on the route is a differentiating,
   honest feature.
7. **Accessibility** — no screen-reader pass on the map (canvas), no focus-visible audit; Play
   accessibility questions will ask.
8. **Truck reality gap** — until Valhalla, "truck mode" warns but doesn't avoid. Documented; still the
   biggest promise-vs-delivery gap for TruckRoute reuse.
9. **Multi-stop** — every delivery/courier competitor has it; it's the top requested feature shape in
   the truck segment (planned Pro).
10. **Name surface** — someone else owns solidmaps.com and a tactile-map business uses the name (§1);
    tighten SEO by claiming the plural .app and publishing content on solidmap.app early.

## 4. Recommended next three moves (highest value)
1. Localization + units toggle (hours, closes estate-bar violation, unlocks global Play listing).
2. Offline region MVP for one UK metro (PMTiles bbox + SW caching) — the differentiator no big
   competitor matches on web.
3. ULEZ zone polygon overlay + route-crossing test (UK-specific, honest, truck-relevant, cheap).
