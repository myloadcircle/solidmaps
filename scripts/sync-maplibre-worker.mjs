// Copy MapLibre's worker bundle out of node_modules into the static output.
//
// MapLibre 6 resolves its worker from `import.meta.url`, and the bundler bakes that to a
// build-machine file path ("file:///C:/DEV/..." in this repo). The shipped bundle therefore asks
// the browser for a worker at "" — the engine's own guard is
// `if (!/^https?:/.test(t)) return ""` — so it reports "Worker failed to load" and the vector
// style never appears, silently degrading every user to the raster fallback.
// SolidMap.tsx points MapLibre at this copy with setWorkerUrl() instead.
//
// Served as .js, not .mjs: a module worker fails outright if the response is not javascript, and
// .js is the extension every static host maps to text/javascript.
//
// Wired as `predev`/`prebuild` so public/maplibre-gl-worker.js can stay out of git.

import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'node_modules', 'maplibre-gl');
const source = path.join(pkgDir, 'dist', 'maplibre-gl-worker.mjs');
const dest = path.join(root, 'public', 'maplibre-gl-worker.js');

if (!existsSync(source)) {
  console.error(`[maplibre-worker] expected asset missing: ${source}\n           Run: npm install`);
  process.exit(1);
}

await mkdir(path.dirname(dest), { recursive: true });
await copyFile(source, dest);

const { version } = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
console.log(`[maplibre-worker] copied maplibre-gl ${version} worker into public/maplibre-gl-worker.js`);
