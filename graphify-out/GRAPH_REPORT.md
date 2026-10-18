# Graph Report - solidmaps  (2026-10-15)

## Corpus Check
- 25 files · ~7,452 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 240 nodes · 374 edges · 17 communities (12 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- types.ts
- index.ts
- scripts
- compilerOptions
- devDependencies
- compilerOptions
- manifest.json
- OpenLocationCode
- layout.tsx
- SolidMap.tsx
- 0001_init.sql
- sw.js
- UpsellModal.tsx
- next.config.js
- next-env.d.ts
- tailwind.config.ts

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `fetch()` - 13 edges
3. `json()` - 12 edges
4. `scripts` - 11 edges
5. `fail()` - 11 edges
6. `RouteResponse` - 9 edges
7. `compilerOptions` - 9 edges
8. `OpenLocationCode` - 8 edges
9. `handleRoute()` - 8 edges
10. `ParkingZone` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Home()` --calls--> `useAuth()`  [EXTRACTED]
  app/page.tsx → lib/auth.tsx
- `AuthState` --references--> `User`  [EXTRACTED]
  lib/auth.tsx → shared/types.ts
- `LocationInput()` --calls--> `isPlusCode()`  [EXTRACTED]
  components/LocationInput.tsx → lib/pluscode.ts
- `LocationInput()` --calls--> `normalizePlusCode()`  [EXTRACTED]
  components/LocationInput.tsx → lib/pluscode.ts
- `RoutePlannerProps` --references--> `ParkingZone`  [EXTRACTED]
  components/RoutePlanner.tsx → shared/types.ts

## Import Cycles
- None detected.

## Communities (17 total, 5 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.09
Nodes (39): Home(), SolidMap, LocationInput(), LocationInputProps, MODES, RoutePlanner(), RoutePlannerProps, SolidMapProps (+31 more)

### Community 1 - "index.ts"
Cohesion: 0.11
Nodes (43): ParkingResponse, RouteRequest, ApiError, authUser(), b64url(), corsHeaders(), decodePolyline6(), engineWarnings() (+35 more)

### Community 2 - "scripts"
Cohesion: 0.07
Nodes (27): maplibre-gl, next, open-location-code, dependencies, maplibre-gl, next, open-location-code, pmtiles (+19 more)

### Community 3 - "compilerOptions"
Cohesion: 0.07
Nodes (27): dom, dom.iterable, esnext, next-env.d.ts, .next/types/**/*.ts, node_modules, **/*.ts, **/*.tsx (+19 more)

### Community 4 - "devDependencies"
Cohesion: 0.10
Nodes (21): autoprefixer, @cloudflare/workers-types, devDependencies, autoprefixer, @cloudflare/workers-types, postcss, tailwindcss, @types/geojson (+13 more)

### Community 5 - "compilerOptions"
Cohesion: 0.13
Nodes (14): @cloudflare/workers-types, ES2022, ../shared/**/*.ts, src/**/*.ts, compilerOptions, lib, module, moduleResolution (+6 more)

### Community 6 - "manifest.json"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 7 - "OpenLocationCode"
Cohesion: 0.18
Nodes (3): CodeArea, open-location-code, OpenLocationCode

### Community 8 - "layout.tsx"
Cohesion: 0.40
Nodes (3): metadata, viewport, ServiceWorkerRegister()

### Community 9 - "SolidMap.tsx"
Cohesion: 0.53
Nodes (5): baseStyle(), drawParking(), drawRoute(), protocol, SolidMap()

### Community 10 - "0001_init.sql"
Cohesion: 0.60
Nodes (4): parking_zones, saved_routes, users, vehicle_profiles

## Knowledge Gaps
- **101 isolated node(s):** `metadata`, `viewport`, `SolidMap`, `LocationInputProps`, `MODES` (+96 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `scripts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `metadata`, `viewport`, `SolidMap` to the rest of the system?**
  _101 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08897959183673469 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10505050505050505 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._