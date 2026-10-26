# UI/UX upgrade plan — benchmark + shipped state (2026-10-25)

## Benchmark read (what each rival teaches)
- **Apple Maps**: restraint — one accent, huge type on guidance, controls melt into the map.
- **Google Maps**: search-first layout — the search sheet is the home screen; suggestions as you type
  (SolidMaps has this), bottom sheet that grows with intent.
- **Waze**: driver-mode minimalism — during navigation everything except the next instruction and ETA
  disappears; big tap targets.
- **Arc Search**: onboarding as product promise — 4 short screens, motion, skip in reach.

## Shipped in this round (live on solidmap.app)
1. **Onboarding** (Arc-style): 4 screens — Welcome ("Drive smarter. Park legally.") / Navigation
   ("Real routing. Real voice.") / Parking Intelligence / Ready; skippable via Skip + Esc; dot
   navigation; pop/fade/glow animations with prefers-reduced-motion respect; shows once
   (localStorage `solidmaps_onboarded_v1`). ~20 s, under the 45 s bar.
2. **Brand header**: pin mark in a sky-tinted tile, refined wordmark.
3. **Map chrome**: MapLibre controls + popups dark-themed to the slate shell (rounded, bordered,
   shadowed) — the UI no longer breaks the dark map.
4. **Empty state**: planner shows example prompts ("Camden Market", plus code, lat,lon) when empty.
5. **States inventory**: loading (map spinner + Planning… button), error (map alert + planner error
   line + auth error), route fallback banner (haversine warning) — all pre-existing and re-verified.

## Next (post-launch polish lane, prioritized)
1. **Driver mode** (Waze lesson): during live navigation, collapse the planner sheet to a pill;
   instruction card with 44px+ type, next-turn icon, lane guidance when Valhalla arrives.
2. **Search sheet** (Google lesson): recents + "Home/Work" saved places (uses the existing
  `saved_routes` table), one-tap depart-from-here.
3. **Map onboarding**: first-tilt hint ("drag with two fingers") shown once when pitch control is
   first touched; cluster/3D building toggle in a layers sheet.
4. **Light mode**: Liberty is light; the shell is dark-only — add a slate/light palette pair with
   `prefers-color-scheme` and manual toggle (estate global-readiness bar).
5. **Micro-motion**: route line draw-in animation on plan (`line-dasharray` trick), marker drop
   easing on parking pins.
