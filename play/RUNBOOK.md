# SolidMaps → Play Console runbook (everything is staged; this is the invocation)

State at handoff: **everything below this line is done.** Console work starts at Step 1.
Time needed: ~30 min. Only the final production "Send for review" is the owner's click.

## Done (evidence)
- TWA project: `play/twa/` (com.google.androidbrowserhelper 2.5.0, AGP 8.5.2, Gradle 8.7, minSdk 24 / target 34)
- AAB: `play/release/solidmaps-v1.0-vc1-release.aab` (2.4 MB) — signed, cert verified:
  `keytool -printcert` = CN=Loadcircle Ltd, SHA256 75:93:FC:6D…6B:57 (= assetlinks.json)
- Digital Asset Links: https://solidmap.app/.well-known/assetlinks.json → 200 (deployed both Pages projects)
- Store assets: icon-512, feature graphic, 3 phone screenshots 1080x2160 (real captures of production)
- Listing copy + Data safety answers: `play/LISTING.md`
- Rebuild command (from `play/twa`):
  `JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.19.10-hotspot" /c/DEV/tools/gradle-8.7/bin/gradle --no-daemon -PandroidStoreFile="C:/DEV/secrets/loadcircle-upload.jks" -PandroidStorePassword=<vault> bundleRelease`

## Step 1 — Create the app (Console → All apps → Create app)
- Name: `SolidMaps`; default language: en-GB; App or game: App; Free or paid: Free.
- Declarations: all No (no ads at listing level, not a news/gov/health app) → Create app.

## Step 2 — Internal testing (do this first)
1. Testers: create email list (owner + haulagehustle).
2. Releases → Internal → Create new release → upload `play/release/solidmaps-v1.0-vc1-release.aab`
   (drag into the bundle uploader; the aab-upload-chooser kit in C:\DEV\play-console-lane\scripts
   handles the OS file dialog if needed).
3. Release name auto-fills 1.0(1) — verify the ROW shows the new bundle (always-update-the-release rule).
4. Roll out → opt-in link → install on the owner phone.

## Step 3 — First-install verification (on device)
- App opens FULLSCREEN (no browser chrome) — requires Step 5's fingerprint to include Play's signing key.
- Plan a route, start navigation, check voice + GPS puck, delete account in-app.
- Legal pages open from the app; airplane-mode behaviour: shell loads, honest map toast.

## Step 4 — Store listing + App content
- Paste `play/LISTING.md` into Main store listing; upload the 4 graphics.
- App content forms: paste answers from LISTING.md (privacy URL, data safety, rating questionnaire,
  ads=no, IAP=no). All rows must go green before any production send.

## Step 5 — assetlinks two-step (CRITICAL for TWA fullscreen)
Play App Signing re-signs the delivered app with a NEW key. After Step 2's upload:
1. Console → Release → Setup → App signing → copy the **App signing key certificate SHA-256**.
2. Append it to `public/.well-known/assetlinks.json` (keep the upload-key fingerprint too) →
   redeploy both Pages projects → verify https://solidmap.app/.well-known/assetlinks.json shows both.
3. Reinstall the app on device → now opens fullscreen.
(Sideloaded/internal builds signed with the upload key keep working — both fingerprints are listed.)

## Step 6 — Production staging (owner's click)
- Production → Create release → same AAB → countries: United Kingdom first (parking/postcode depth
  is UK-strong; widen after Valhalla truck) → Save → "Send 1 change for review" = OWNER'S CLICK ONLY.

## Known gaps (documented, accepted for v1)
- Only 3 store screenshots (minimum met); capture walk-mode + live-nav + search shots from the real
  device this week and add — the truck shot's map area went black in the emulated webview (capture
  environment limitation, not the product — browser session evidence in docs/launch-audit.md).
- Pro checkout absent (by design until Valhalla); "IAP: No" must be revisited when Pro ships.
- Data safety "deletion URL": privacy page route only — a dedicated /delete page is a post-launch task.
