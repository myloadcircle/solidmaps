#!/usr/bin/env node
// Pack a built Valhalla tileset into the static release the routewasm (WebAssembly) router fetches.
//
// Valhalla writes its graph as a tree of tiles:     valhalla_tiles/<level>/<a>/<b>/<c>.gph
// routewasm fetches exactly one file per tile, at:   <tileUrlTemplate with {tilePath}>
// so every `.gph` has to gain a zstd-compressed sibling that keeps the same name and adds `.zst`,
// next to a single config.json and a locales/<language>.json.
//
//   in:   custom_files/valhalla_tiles/**/*.gph         (the server layout the VM serves from)
//         custom_files/valhalla.json                   (the config the scripted image generated)
//         custom_files/locales/*.json                  (optional; see below)
//   out:  custom_files/routewasm-release/**/*.gph.zst  (the browser layout — upload this tree as-is)
//         custom_files/routewasm-release/config.json
//         custom_files/routewasm-release/locales/en-GB.json
//         custom_files/routewasm-release/manifest.json
//
// Upload routewasm-release/ to any static host (R2 / S3 / a plain web server) and set:
//   NEXT_PUBLIC_ROUTEWASM_ENABLED=1
//   NEXT_PUBLIC_ROUTEWASM_TILE_URL=https://tiles.solidmap.app/gb-ie/{tilePath}.zst
//   NEXT_PUBLIC_ROUTEWASM_CONFIG_URL=https://tiles.solidmap.app/gb-ie/config.json
//   NEXT_PUBLIC_ROUTEWASM_LOCALES_URL=https://tiles.solidmap.app/gb-ie/locales
//   NEXT_PUBLIC_ROUTEWASM_DATASET_ID=gb-ie-2026-11-05
//
// `tileUrlTemplate` must contain `{tilePath}` *and* the extension — the SDK only substitutes the
// path, it never appends anything.
//
// Locales: if `custom_files/locales/` is absent the step is skipped with a warning, which is only
// safe while NEXT_PUBLIC_ROUTEWASM_LOCALES_URL is left blank (the SDK then falls back to its own
// hosted copy). Host them yourself to drop the last third-party dependency:
//   docker compose cp valhalla:/usr/share/valhalla/locales ./custom_files/locales
//
// Requires Node >= 22.15 for the built-in zstd codec — no external `zstd` binary needed.

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { constants as zlibConstants, createZstdCompress } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const customFiles = path.join(repo, 'infra', 'valhalla', 'custom_files');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TILES_DIR = arg('tiles', path.join(customFiles, 'valhalla_tiles'));
const CONFIG_IN = arg('config', path.join(customFiles, 'valhalla.json'));
const LOCALES_IN = arg('locales', path.join(customFiles, 'locales'));
const OUT_DIR = arg('out', path.join(customFiles, 'routewasm-release'));
const LEVEL = Number(arg('level', '10'));
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '8')));
const DATASET_ID = arg('dataset-id', `gb-ie-${new Date().toISOString().slice(0, 10)}`);

if (typeof createZstdCompress !== 'function') {
  console.error(
    `[pack] this Node build (${process.version}) has no zstd support.\n` +
      '       Use Node >= 22.15, or compress with the `zstd` CLI instead.',
  );
  process.exit(1);
}

if (!existsSync(TILES_DIR)) {
  console.error(
    `[pack] no built tiles at ${TILES_DIR}\n` +
      '       Build them first:  cd infra/valhalla && ./scripts/fetch-extracts.sh && docker compose up -d\n' +
      '       If only valhalla_tiles.tar exists (older builds kept the tarball), unpack it:\n' +
      '         tar -xf custom_files/valhalla_tiles.tar -C custom_files',
  );
  process.exit(1);
}

if (!existsSync(CONFIG_IN)) {
  console.error(
    `[pack] no Valhalla config at ${CONFIG_IN} — the scripted image writes it during the tile build.`,
  );
  process.exit(1);
}

/** Every `.gph` under the tile root, as { tilePath, absolute }, where tilePath keeps its slashes. */
async function collectTiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectTiles(full)));
    } else if (entry.name.endsWith('.gph')) {
      out.push({
        tilePath: path.relative(TILES_DIR, full).split(path.sep).join('/'),
        absolute: full,
      });
    }
  }
  return out;
}

console.log(`[pack] scanning ${TILES_DIR} ...`);
const tiles = await collectTiles(TILES_DIR);
if (!tiles.length) {
  console.error('[pack] no .gph tiles found — did the tile build actually finish?');
  process.exit(1);
}
console.log(`[pack] ${tiles.length} tiles -> ${OUT_DIR}`);

// The WASM worker overwrites `mjolnir.tile_url` and deletes `tile_extract`/`traffic_extract` on
// load, but shipping a config that still points at host-only paths would be misleading, and
// `mjolnir` must exist for it to patch. So sanitise once, here.
const config = JSON.parse(await readFile(CONFIG_IN, 'utf8'));
config.mjolnir = config.mjolnir ?? {};
config.mjolnir.tile_url = 'wasm://{tilePath}';
delete config.mjolnir.tile_dir;
delete config.mjolnir.tile_extract;
delete config.mjolnir.traffic_extract;
await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'config.json'), JSON.stringify(config), 'utf8');

let localesCopied = 0;
if (existsSync(LOCALES_IN)) {
  const localeOut = path.join(OUT_DIR, 'locales');
  await mkdir(localeOut, { recursive: true });
  for (const name of await readdir(LOCALES_IN)) {
    if (!name.endsWith('.json')) continue;
    await writeFile(path.join(localeOut, name), await readFile(path.join(LOCALES_IN, name)));
    localesCopied++;
  }
  console.log(`[pack] locales: ${localesCopied} file(s)`);
} else {
  console.warn(
    `[pack] WARNING: no locales at ${LOCALES_IN}.\n` +
      '       Leave NEXT_PUBLIC_ROUTEWASM_LOCALES_URL blank (the SDK uses its hosted copy),\n' +
      '       or copy them out of the image:\n' +
      '         docker compose cp valhalla:/usr/share/valhalla/locales ./custom_files/locales',
  );
}

// Compress with a bounded pool: a full GB + Ireland tree is tens of thousands of files and would
// otherwise open that many read handles at once.
const params = { [zlibConstants.ZSTD_c_compressionLevel]: LEVEL };
let done = 0;
let next = 0;
let inputBytes = 0;
let outputBytes = 0;

async function worker() {
  while (next < tiles.length) {
    const tile = tiles[next++];
    const dest = path.join(OUT_DIR, `${tile.tilePath}.zst`);
    await mkdir(path.dirname(dest), { recursive: true });
    await pipeline(
      createReadStream(tile.absolute),
      createZstdCompress({ params }),
      createWriteStream(dest),
    );
    inputBytes += (await stat(tile.absolute)).size;
    outputBytes += (await stat(dest)).size;
    done++;
    if (done % 2000 === 0) console.log(`[pack]   ${done}/${tiles.length}`);
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tiles.length) }, worker));

const manifest = {
  datasetId: DATASET_ID,
  generatedAt: new Date().toISOString(),
  tiles: tiles.length,
  locales: localesCopied,
  zstdLevel: LEVEL,
  bytes: { uncompressed: inputBytes, compressed: outputBytes },
  source: path.relative(repo, TILES_DIR).split(path.sep).join('/'),
};
await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const mb = (n) => `${(n / 1_000_000).toFixed(1)} MB`;
console.log(
  `[pack] done: ${tiles.length} tiles, ${mb(inputBytes)} -> ${mb(outputBytes)} ` +
    `(${((outputBytes / (inputBytes || 1)) * 100).toFixed(0)}%)`,
);
console.log(`[pack] dataset id: ${DATASET_ID}  (set NEXT_PUBLIC_ROUTEWASM_DATASET_ID to this)`);
