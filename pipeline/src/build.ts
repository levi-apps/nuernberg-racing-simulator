/**
 * Erzeugt die Spielwelt aus dem OSM-Auszug.
 *
 *   npm run data:build              (nutzt data/raw/mittelfranken-latest.osm.pbf)
 *   npm run data:build -- <pfad.pbf>
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from './extract.ts';
import { buildRoadNet } from './roadnet.ts';
import { buildControl } from './control.ts';
import { buildMarkings, buildSurfaces } from './surfaces.ts';
import { writeWorld } from './tiles.ts';
import { validate } from './validate.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** Ohne Argument: neueste .osm.pbf-Datei in data/raw */
function defaultInput(): string {
  const dir = join(root, 'data/raw');
  if (!existsSync(dir)) return join(dir, 'mittelfranken-latest.osm.pbf');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.osm.pbf'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return join(dir, files[0]?.f ?? 'mittelfranken-latest.osm.pbf');
}
const input = resolve(process.argv[2] ?? defaultInput());
const outDir = resolve(`${root}/game/public/world`);

if (!existsSync(input)) {
  console.error(`OSM-Datei fehlt: ${input}\nZuerst "npm run data:download" ausführen.`);
  process.exit(1);
}

const t0 = Date.now();
let tStep = t0;
const log = (s: string) => console.log(s);
const step = (name: string) => {
  const now = Date.now();
  console.log(`✓ ${name} (${((now - tStep) / 1000).toFixed(1)} s)\n`);
  tStep = now;
};

console.log(`Eingabe: ${input}\nAusgabe: ${outDir}\n`);
const ex = extract(input, log);
step('Extraktion');
log('Straßengraph …');
const net = buildRoadNet(ex, log);
step('Straßengraph');
log('Verkehrsregelung …');
const ctl = buildControl(ex, net, log);
step('Verkehrsregelung');
log('Prüfung Spurgraph …');
const val = validate(net, log);
for (const l of net.lanes) if (!l.out.length && l.ctrl !== 'end') l.ctrl = 'end';
step('Prüfung');
log('Flächen und Markierungen …');
const surfaces = buildSurfaces(net);
const markings = buildMarkings(net);
log(`  ${surfaces.length.toLocaleString('de')} Fahrbahnflächen, ${markings.length.toLocaleString('de')} Markierungslinien`);
step('Flächen');
log('Kacheln schreiben …');
writeWorld(outDir, ex, net, ctl, surfaces, markings, val.sccLanes, log);
step('Kacheln');
console.log(`Fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
