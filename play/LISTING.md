# SolidMaps — Play Console listing package (paste-ready, ASCII-only)

App identity: package `uk.co.loadcircle.solidmaps` · AAB `release/solidmaps-v1.0-vc1-release.aab` (versionCode 1, versionName 1.0, minSdk 24, targetSdk 34, signed with estate upload key `loadcircle`)

## Main store listing
**App name** (30): `SolidMaps: Navigation & Parking`

**Short description** (80):
`Turn-by-turn navigation with voice guidance, live rerouting and real parking data.`

**Full description**:
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
- Works with addresses, UK postcodes or plus codes
- Installable: works like a native app, updates instantly

Map data (c) OpenStreetMap contributors. Parking data via OpenStreetMap.
Height and weight limits are advisory warnings, not route guarantees.
```

**Release notes** (1.0):
```
First public release.
- Turn-by-turn navigation with voice guidance
- Live GPS tracking and automatic rerouting
- Real parking data around your destination
- Truck-aware route warnings for professional drivers
- Installable app (PWA), no ads, no trackers
```

**Graphics**
| Asset | File |
|---|---|
| App icon 512x512 | `../public/icon-512.png` (use same) |
| Feature graphic 1024x500 | `../feature-graphic-1024x500.png` |
| Phone screenshot 1 | `../screenshots/01-onboarding-1080x2160.png` |
| Phone screenshot 2 | `../screenshots/02-route-parking-1080x2160.png` |
| Phone screenshot 3 | `../screenshots/03-truck-warnings-1080x2160.png` |

## App content — prepared answers
- **Privacy policy URL**: https://solidmap.app/privacy
- **Ads**: No ads. **In-app purchases**: No (Pro not purchasable yet — declare later when wired).
- **Data safety**:
  - Location (approximate + precise): collected? Yes — used for routing/navigation, not shared,
    ephemeral (5-min cache, no profiles).
  - Personal info — Email: collected for account management; encrypted in transit; deletable in-app
    (Delete account button) — matches https://solidmap.app/privacy.
  - All other categories: not collected. No data shared with third parties.
  - Security: data encrypted in transit: Yes. Users can request data deletion: Yes (in-app + URL).
- **Account deletion URL**: https://solidmap.app/privacy (in-app deletion exists; Play also asks for a
  web path — privacy page states the contact route; consider /delete page post-launch).
- **Content rating**: questionnaire → no violence/gambling/user-generated content/health → Everyone.
- **Target audience**: 18+ default (navigation app); not child-directed.
- **Government apps**: No. **Financial features**: No. **Health**: No. **News**: No. **COVID**: No.
- **AI-generated content**: No generative AI features.

## Release track recommendation
Internal testing first (upload AAB → internal track → 2-4 testers incl. owner), production listing
staged but **"Submit for review" is the owner's click only** (estate rule).
