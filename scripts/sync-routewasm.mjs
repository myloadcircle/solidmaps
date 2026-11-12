// Copy the Valhalla WebAssembly engine out of node_modules into the static output.
//
// The `routewasm` docs are explicit about why this cannot be a bundler import: `valhalla_wasm.js`
// is Emscripten glue that resolves its own `.wasm` through an internal `new URL(...)` a bundler
// never parses, so a production build can emit the glue without its binary, or rename the binary
// out from under it. The pair must be shipped unprocessed, together, under their original names.
//
// Wired as `predev`/`prebuild` so `public/wasm/` can stay out of git.

import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', 'routewasm', 'dist');
const dest = path.join(root, 'public', 'wasm');

const FILES = [
  ['worker.js', 'worker.js'],
  [path.join('wasm', 'valhalla_wasm.js'), 'valhalla_wasm.js'],
  [path.join('wasm', 'valhalla_wasm.wasm'), 'valhalla_wasm.wasm'],
];

const required = process.env.NEXT_PUBLIC_ROUTEWASM_ENABLED === '1';

if (!existsSync(source)) {
  if (required) {
    console.error(
      '[routewasm] NEXT_PUBLIC_ROUTEWASM_ENABLED=1 but the routewasm package is not installed.\n' +
        '           Run: npm install routewasm',
    );
    process.exit(1);
  }
  console.log('[routewasm] package not installed — skipping WASM asset copy (on-device routing off).');
  process.exit(0);
}

await mkdir(dest, { recursive: true });

for (const [from, to] of FILES) {
  const src = path.join(source, from);
  if (!existsSync(src)) {
    console.error(`[routewasm] expected asset missing: ${src}`);
    process.exit(1);
  }
  await copyFile(src, path.join(dest, to));
}

const version = JSON.parse(await readFile(path.join(root, 'node_modules', 'routewasm', 'package.json'), 'utf8'));
console.log(`[routewasm] copied engine ${version.version} into public/wasm/`);
