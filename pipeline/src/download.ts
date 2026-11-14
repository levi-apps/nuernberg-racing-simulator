/**
 * Lädt den aktuellen OSM-Auszug Mittelfranken von Geofabrik.
 *   npm run data:download            (überspringt, wenn die Datei schon da ist)
 *   npm run data:download -- --force
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const URL_PBF = 'https://download.geofabrik.de/europe/germany/bayern/mittelfranken-latest.osm.pbf';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = resolve(root, 'data/raw/mittelfranken-latest.osm.pbf');
const force = process.argv.includes('--force');

if (existsSync(target) && !force) {
  const s = statSync(target);
  console.log(`Schon vorhanden: ${target} (${(s.size / 1e6).toFixed(0)} MB, Stand ${s.mtime.toLocaleDateString('de')}). Mit --force neu laden.`);
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
console.log(`Lade ${URL_PBF} …`);
const res = await fetch(URL_PBF);
if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
const total = Number(res.headers.get('content-length') ?? 0);
let done = 0;
let last = 0;
const body = Readable.fromWeb(res.body as never);
body.on('data', (c: Buffer) => {
  done += c.length;
  if (done - last > 5e6) {
    last = done;
    process.stdout.write(`\r  ${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
  }
});
await pipeline(body, createWriteStream(`${target}.part`));
renameSync(`${target}.part`, target);
console.log(`\nGespeichert: ${target}`);
