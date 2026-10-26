# Domain audit — solidmap.app (2026-10-25)

## State: LIVE on the current build

| Check | Result | Evidence |
|---|---|---|
| Zone | `solidmap.app` active on Cloudflare (zone `929543f4…`, loadcircle account, NS sloan/watson.ns.cloudflare.com) | CF API zones query |
| Apex | `https://solidmap.app/` → 200, serves build `page-ea976087…` with onboarding; old `user-scalable=no` meta gone | curl 2026-10-25 |
| www | `https://www.solidmap.app/` → 200 (serves app; canonical/og:url point to apex) | curl |
| HTTP→HTTPS | `http://solidmap.app/` → 301 to https | curl |
| SSL | Cloudflare-issued cert, `ssl_verify_result 0` on all requests | curl |
| PWA | `/manifest.json` 200 (PNG 192/512 + maskable icons), `/sw.js` 200 (v3, fetch handler) — meets Chrome install criteria | curl |
| Legal | `/privacy` and `/terms` 200 on the apex domain | curl |
| API CORS | `Origin: https://solidmap.app` → `Access-Control-Allow-Origin: https://solidmap.app` | curl |

## History (why it was broken)

The domain was attached to a **week-old stale Pages project** (`solidmaps-site`) serving the pre-a11y build.
Migration attempt: detach + attach to the live `solidmaps` project → **522s**, because the zone's DNS
records still point at `solidmaps-site.pages.dev` and the wrangler OAuth token **lacks DNS-edit scope**
(CF API returns `10000 Authentication error` on dns_records read/write; no CF API token in the vault).

Resolution (API-only, no DNS change possible): the release path now ships the current build to BOTH
Pages projects — `solidmaps` (solidmaps.pages.dev) and `solidmaps-site` (owns solidmap.app + www).
`scripts/deploy.sh` automates this.

## Residual items

1. **DNS consolidation (owner, one dashboard edit)**: in the Cloudflare dash for zone `solidmap.app`,
   point `solidmap.app` and `www` CNAMEs at `solidmaps.pages.dev` (proxied). Then domains can be
   re-attached to the single `solidmaps` project and the dual deploy retired.
2. **www→apex 301**: `_redirects` rule staged (`https://www.solidmap.app/* https://solidmap.app/:splat 301`)
   but does not fire while DNS points at solidmaps-site; apply after the DNS fix.
3. **www canonical duplication is currently harmless** (canonical + og tags on every page) but should be
   closed with item 1.
