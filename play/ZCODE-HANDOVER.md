# Zcode handover — SolidMaps → Google Play

Status: **handover** · App: SolidMaps · Package `uk.co.loadcircle.solidmaps`
Owner: Loadcircle Ltd · Lane artefacts: `C:\DEV\solidmaps\play\` + `C:\DEV\play-console-lane\`

> Read this top-to-bottom once before touching anything. The lane is **90% done**;
> what remains is one rebuild + upload, the assetlinks two-step, the store listing,
> and the owner's production send. Do **not** re-do completed work.

---

## 1. What Zcode is being asked to do

Drive the SolidMaps Google Play submission to **production / live in the market**:

1. Finish the **AAB rebuild** (epoch versionCode) and **upload** it to the internal-testing track.
2. Roll out internal testing → testers opt-in link → on-device verification.
3. Complete the **store listing** (copy + 4 graphics) and the last **App content** row.
4. Do the **assetlinks two-step** so the TWA opens fullscreen.
5. Stage the **production** release (UK) and stop with **Submit armed** — the submit click is the owner's.

The original intent (verbatim): *"drive the questionnaire lane, push it into review — internal test
is fine mid-step but it needs to be live now and out in the market — and price it appropriately for
Android."* Pricing decisions already taken: **Free now, no purchases; Pro later** at **£19.99 one-time**.

---

## 2. Identity facts (do not get these wrong)

| Item | Value |
|---|---|
| App name | SolidMaps |
| Package | `uk.co.loadcircle.solidmaps` |
| Play app id (dev account) | `7766316863251645763` |
| Play app id (SolidMaps app) | `4972266415214389250` |
| Internal-testing **track id** | `4701007709326835720` |
| Release editor URL | `/app/4972266415214389250/tracks/4701007709326835720/releases/1/prepare` |
| Release signing cert | `CN=Loadcircle Ltd` |
| Upload-key SHA-256 | `75:93:FC:6D…6B:57` (full value: read `C:\DEV\solidmaps\public\.well-known\assetlinks.json`) |
| **Play App Signing SHA-256** | `6E:04:A2:47:D2:F7:8E:60:7C:0A:E3:B4:6F:E1:C2:2B:53:DD:01:43:AD:7E:5F:04:94:CD:53:C1:77:DE:7E:1B` |
| Keystore | `C:\DEV\secrets\loadcircle-upload.jks`, alias `loadcircle`; password is in `C:\DEV\secrets\loadcircle-upload-key.txt` (NEVER commit) |
| Site / TWA host | `https://solidmap.app/` |
| minSdk / targetSdk / compileSdk | 24 / **36** / 36 |

---

## 3. Toolchain + build (the exact incantation that works)

- Gradle: `C:\DEV\tools\gradle-8.7\bin\gradle.bat`
- JDK: `JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot`
- AGP **8.5.2** (pinned in `play/twa/build.gradle`); `android.suppressUnsupportedCompileSdk=36` in `play/twa/gradle.properties`
- `GRADLE_USER_HOME = D:\Cache\.gradle` (daemon logs: `D:\Cache\.gradle\daemon\8.7\daemon-<pid>.out.log`)
- Configuration cache OFF. `org.gradle.jvmargs=-Xmx2048m` ⇒ Gradle forks a **single-use daemon** even with `--no-daemon` (this is normal; the client relays daemon output).
- **NEVER pass `--offline`** — this project's `:classpath` needs `jose4j-0.9.5`, `jdom2-2.0.6`, `commons-codec-1.11`, `javawriter-2.5.0` which are not cached. Offline fails after ~6 min.
- Baseline wall time ≈ **3 m 55 s** (23 executed / 28 up-to-date tasks).

**Build command (from `C:\DEV\solidmaps\play\twa`):**

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
& 'C:\DEV\tools\gradle-8.7\bin\gradle.bat' --no-daemon --console=plain `
  -p C:\DEV\solidmaps\play\twa `
  -PandroidStoreFile="C:/DEV/secrets/loadcircle-upload.jks" `
  -PandroidStorePassword="<from vault>" `
  assembleRelease bundleRelease 2>&1 | Tee-Object -FilePath C:\DEV\solidmaps\play\gradle-build-vc2.log
echo "EXIT=$LASTEXITCODE"
```

Outputs land in `C:\DEV\solidmaps\play\twa\app\build\outputs\bundle\release\app-release.aab`
(and `…\outputs\apk\release\app-release.apk`).

### versionCode rule (CRITICAL)
Play **burns** a versionCode the moment a bundle lands in the app's artifact library, even if you
later remove it from the release. vc1 was burned ("Version code 1 has already been used"). The estate
convention is **versionCode = epoch minutes**, already implemented in `play/twa/app/build.gradle`:

```gradle
def buildVersionCode = (int) (System.currentTimeMillis() / 60000L)
...
versionCode buildVersionCode
```

So every rebuild is unique — never hand-set versionCode.

---

## 4. Pre-upload gates (mandatory, in this order)

1. **Build log must contain `> Task :app:signReleaseBundle`** — if it doesn't, the AAB is unsigned; reload the signing env and rebuild.
   `Select-String -Path C:\DEV\solidmaps\play\gradle-build-vc2.log -Pattern 'signReleaseBundle'`
2. **Currency gate must print `RESULT: PASS`** before ANY upload:

```powershell
& "C:\Users\fbire\AppData\Local\hermes\git\bin\bash.exe" -c 'cd /c/DEV/play-console-lane/scripts && bash currency-gate.sh /c/DEV/solidmaps/play/twa <path-to-new.aab>; echo GATE_EXIT=$?' 2>&1 | Out-String
```
   Scans source (.kt/.java/.xml, comments stripped) **and** the AAB string tables for hardcoded
   `£`/`$`/`€`/`₹` and `price_fallback*`/`price_display` tokens. Exemptions → `currency-allow.txt`.
   (Price must only ever come from Play's `formattedPrice`.)
3. (At production-send time) `pre-send-gate.sh` must pass before the owner clicks Send.

---

## 5. Upload to internal testing

Console route: `Tracks → Internal testing → release 1 → Edit release`
(`/tracks/4701007709326835720/releases/1/prepare`). The stale vc1 bundle is **already removed**;
the upload zone is empty and awaiting the new AAB.

Driver script: `node C:\DEV\play-console-lane\scripts\sm.mjs upload "<abs-aab-path>" "Upload"`

If you must clear a bundle row, the proven sequence (option centres are at **x = 761**):

1. `[aria-label="Manage artifact"]` → `scrollIntoView({block:'center'})` + ~800 ms → click its centre.
2. Popup items appear ≈ (`761,358`) Upload ReTrace · (`761,406`) Upload native debug symbols · (`761,454`) **Remove app bundle**.
3. Click **`761 454`** → confirm **"Remove"**.

Do NOT click blind: a hit-test showing `DIV.pane modal visible` means a modal is intercepting every
click — dismiss it first (`p.remove()` or its `Done` button).

---

## 6. assetlinks two-step (CRITICAL for TWA fullscreen)

Play App Signing re-signs the delivered app with a *new* key. Until both fingerprints are published,
the TWA shows browser chrome instead of opening fullscreen.

1. Console → **Release → Setup → App signing** → copy the **App signing key certificate SHA-256**.
   (Route is `/keymanage`; the misleading `app-signing` and `app-integrity/app-signing` routes BOUNCE to `/home`.)
2. Append it to `C:\DEV\solidmaps\public\.well-known\assetlinks.json` — **keep the upload-key
   fingerprint** (`75:93:FC:6D…6B:57`) alongside the Play one
   (`6E:04:A2:47…7E:1B`).
3. Redeploy **both** Cloudflare Pages projects; verify
   `https://solidmap.app/.well-known/assetlinks.json` shows both fingerprints.
4. Reinstall on device → app opens fullscreen.

> **Owner sign-off required before step 2.** `C:\DEV\solidmaps` is a Next.js repo on `master` with
> ~25 pre-existing uncommitted changes. Do not touch the repo or deploy without the owner's go-ahead.

---

## 7. Store listing + App content

- Copy is paste-ready in `C:\DEV\solidmaps\play\LISTING.md` (ASCII-only).
- Listing editor route: `/app/<id>/store-listings/default/edit` — 2 steps: **Assets → Next → Review → Save**
  (there is NO Save on step 1). Fields have empty aria-labels; identify by char counter
  (`/ 30` = app name, `/ 80` = short description, `/ 4000` = full description textarea).
  Review-step buttons: Discard · Back · Save as draft · **Save** (Next ≈ `1220,690`, Save ≈ `1220,690`).
- Graphics to upload: icon-512 (`public/icon-512.png`), `play/feature-graphic-1024x500.png`,
  `play/screenshots/01..03-1080x2160.png`. (Only 3 screenshots exist — minimum is met; add
  walk-mode / live-nav / search shots after launch.)
- App content declarations: 11 of 12 done; dashboard reads **"10 of 12 complete"**. Remaining row =
  **app category + contact details**. Paste answers from `LISTING.md` §"App content".

---

## 8. Production staging (OWNER'S CLICK ONLY)

- Production → Create release → **same AAB** → countries: **United Kingdom first**
  (parking/postcode depth is UK-strong; widen after Valhalla truck ships) → Save.
- Stop with **"Send 1 change for review" armed. The send is the owner's click, always.**
- **One review slot at a time** — Barbelldeck currently holds the slot. Do not send SolidMaps
  until that slot is free.

---

## 9. Environment / traps (learned the hard way)

- **CDP port is 9333** (NOT 9222). Edge launched with `--remote-debugging-port=9333`.
  `sm.mjs` targets the tab whose URL contains `/app/${APP}`. If the SolidMaps tab vanishes:
  `node sm.mjs newtab "<url>"`.
- Console viewport innerH is only **605–632 px** → anything below the fold returns `null` from
  `elementFromPoint`. Always `scrollIntoView({block:'center'})` + ~800 ms + hit-test **inside one
  evaluate**, then click immediately (the release wizard scroll-resets).
- **"Loading Google Play Console" in innerText is a STALE SPLASH NODE**, not a loading signal.
- Blocking overlays are `DIV.pane.modal.visible` (not `.cdk-overlay-pane`). Dismiss before clicking.
  A stray click on a bundle row's `more_vert` opens an **"Upload ReTrace mapping file"** modal (and a
  neighbouring option opens **"Upload native debug symbols"**) — both close with their **`Done`** button.
- The row overflow control is a **`dropdown-button`** (`aria-label="Manage artifact"`,
  `aria-haspopup="listbox"`), not a cdk menu.
- Git-Bash: invoke as `& $b -c '<script>' 2>&1 | Out-String` where
  `$b = "C:\Users\fbire\AppData\Local\hermes\git\bin\bash.exe"` (cygwin 5.3.9). `perl` = `/usr/bin/perl`,
  `unzip` = `/usr/bin/unzip`.
- Do **not** conclude "the build is hung" from a quiet log + low short-window CPU delta. Take a
  `jstack` first — on this project a quiet log usually means slow script-compile + dependency
  resolution (network), not a deadlock. (Evidence: `play\jstack.txt`, `play\jstack2.txt`.)
- `StopCommand` does not clear Gradle file locks. To release locks: `gradle.bat --stop`, then delete
  `play\twa\.gradle` and `D:\Cache\.gradle\daemon\8.7\registry.bin*`.

---

## 10. Rules that are NOT negotiable

- **The submit / "Send for review" is the owner's click. Always.** The lane stops with Submit armed.
- **One review slot at a time.**
- `currency-gate.sh` → `RESULT: PASS` before **any** upload; price only via Play's `formattedPrice`.
- Do not touch `C:\DEV\solidmaps` repo/deploy without owner sign-off.
- Never commit the keystore password or keystore file.

---

## 11. Open items checklist

- [ ] Rebuild (epoch versionCode) → `BUILD SUCCESSFUL` + `signReleaseBundle` present.
- [ ] currency-gate on the **new** AAB → `RESULT: PASS`.
- [ ] Upload new AAB to `/tracks/4701007709326835720/releases/1/prepare`.
- [ ] Preview & confirm the release → Save as draft → roll out internal → testers opt-in link.
- [ ] assetlinks two-step (owner sign-off) → verify both fingerprints on `solidmap.app`.
- [ ] Store listing: paste copy + upload icon/feature/3 screenshots.
- [ ] App content: last row (category + contact details) → all rows green.
- [ ] On-device first-install verification (fullscreen, routing, voice, delete-account).
- [ ] Production staging (UK) → **arm** Send for review (owner clicks; slot must be free).
- [ ] Housekeeping: fix `LISTING.md` line 3 (stale AAB name / vc1 / targetSdk 34) and
      `RUNBOOK.md` line 10 (stale "target 34"); fix `PRODUCT_STATUS.md` line 31 (`solidmaps.app` → `solidmap.app`).
- [ ] Outstanding axis leg: **TM (mark) check** (the other three axes are CLEAR).
- [ ] Missed-feature-add synthesis write-up (the "what did I miss" lens).

---

## 12. Reference index

| File | What it is |
|---|---|
| `C:\DEV\solidmaps\play\RUNBOOK.md` | The lane plan (Steps 1–6). |
| `C:\DEV\solidmaps\play\LISTING.md` | Paste-ready listing copy + App content answers. |
| `C:\DEV\play-console-lane\RELEASE-CHECKLIST.md` | Estate release checklist, failure modes (FM-001/002), DoD. |
| `C:\DEV\play-console-lane\README.md` | Script kit, Console route map, clicking doctrine, currency/monetization gates. |
| `C:\DEV\play-console-lane\scripts\sm.mjs` | SolidMaps Play Console driver (CDP 9333). Commands: `list｜newtab｜nav｜eval｜shot｜decl｜click｜type｜clicktext｜upload｜wait`. |
| `C:\DEV\play-console-lane\scripts\currency-gate.sh` | The currency gate (`RESULT: PASS` required). |
| `C:\DEV\solidmaps\play\twa\app\build.gradle` | Build identity (epoch versionCode, SDKs, signing). |
| `C:\DEV\app-lane-check-template.md` | The four-axis "Name Gate" (TM leg still outstanding). |
