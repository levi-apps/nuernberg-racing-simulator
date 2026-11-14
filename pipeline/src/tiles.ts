/**
 * Schreibt die Welt als Kacheln (JSON) plus globale Dateien.
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dm,
  FORMAT_VERSION,
  TILE_SIZE,
  tileKey,
  type Area,
  type Building,
  type Connector,
  type Lane,
  type Line,
  type Manifest,
  type Marking,
  type Overview,
  type Place,
  type Paint,
  type RoadLabel,
  type RoadSurface,
  type SignalHead,
  type Tile,
} from '@nrs/shared';
import { bboxOf, simplify, slicePolyline, polylineLength, type BBox, type Pt } from './geo.ts';
import type { Extract } from './extract.ts';
import type { RoadNet } from './roadnet.ts';
import type { Control } from './control.ts';
import type { MarkingObj, PaintObj, SurfaceObj } from './surfaces.ts';
import { ORIGIN_LONLAT, ORIGIN_UTM } from './geo.ts';
import { RANK } from './tags.ts';

const flat = (pts: Pt[]): number[] => {
  const out = new Array<number>(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    out[2 * i] = dm(pts[i][0]);
    out[2 * i + 1] = dm(pts[i][1]);
  }
  return out;
};

class TileSet {
  tiles = new Map<string, Tile>();
  get(tx: number, ty: number): Tile {
    const k = tileKey(tx, ty);
    let t = this.tiles.get(k);
    if (!t) {
      t = { v: FORMAT_VERSION, tx, ty, surfaces: [], markings: [], lanes: [], connectors: [], signals: [], buildings: [], areas: [], lines: [], labels: [], paint: [], trees: [] };
      this.tiles.set(k, t);
    }
    return t;
  }
  each(bb: BBox, fn: (t: Tile) => void) {
    const x0 = Math.floor(bb.minX / TILE_SIZE);
    const x1 = Math.floor(bb.maxX / TILE_SIZE);
    const y0 = Math.floor(bb.minY / TILE_SIZE);
    const y1 = Math.floor(bb.maxY / TILE_SIZE);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) fn(this.get(x, y));
  }
}

function pointAtLen(pts: Pt[], s: number): Pt {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + l >= s || i === pts.length - 1) {
      const t = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    acc += l;
  }
  return pts[pts.length - 1];
}

/** Lange Linien in Stücke von max. `maxLen` Metern zerlegen */
function chunks(pts: Pt[], maxLen: number): Pt[][] {
  const l = polylineLength(pts);
  if (l <= maxLen) return [pts];
  const n = Math.ceil(l / maxLen);
  const out: Pt[][] = [];
  for (let i = 0; i < n; i++) out.push(slicePolyline(pts, (i * l) / n, ((i + 1) * l) / n));
  return out;
}

export function writeWorld(
  outDir: string,
  ex: Extract,
  net: RoadNet,
  ctl: Control,
  surfaces: SurfaceObj[],
  markings: MarkingObj[],
  paint: PaintObj[],
  mainNet: Uint8Array,
  log: (s: string) => void,
): void {
  const ts = new TileSet();

  for (const s of surfaces) {
    const r: RoadSurface = { id: s.id, k: s.k, cls: s.cls, layer: s.layer, ring: flat(s.ring) };
    if (s.bridge) r.bridge = 1;
    if (s.tunnel) r.tunnel = 1;
    if (s.sw) r.sw = flat(s.sw);
    if (s.kerbs.length) r.kerbs = s.kerbs.filter((k) => k.length >= 2).map(flat);
    ts.each(bboxOf(s.sw ?? s.ring), (t) => t.surfaces.push(r));
  }
  for (const pt of paint) {
    const pp: Paint = { k: pt.k, layer: pt.layer, ring: flat(pt.ring) };
    ts.each(bboxOf(pt.ring), (t) => t.paint!.push(pp));
  }
  for (const [x, y, r] of ex.trees) {
    const t = ts.get(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
    t.trees!.push(dm(x), dm(y), dm(r));
  }
  for (const m of markings) {
    for (const part of chunks(m.pts, 120)) {
      const mk: Marking = { k: m.k, layer: m.layer, pts: flat(part) };
      ts.each(bboxOf(part), (t) => t.markings.push(mk));
    }
  }
  for (const sl of ctl.stopLines) {
    const mk: Marking = { k: 'stop', layer: sl.layer, pts: flat(sl.pts) };
    ts.each(bboxOf(sl.pts), (t) => t.markings.push(mk));
  }
  for (const l of net.lanes) {
    const lane: Lane = {
      id: l.id,
      seg: l.seg.id,
      dir: l.dir,
      idx: l.idx,
      n: l.n,
      w: Math.round(l.w * 100) / 100,
      vmax: l.seg.vmax,
      cls: l.seg.cls,
      layer: l.seg.layer,
      pts: flat(l.pts),
      len: Math.round(l.len * 10) / 10,
      ctrl: l.ctrl,
      out: l.out,
    };
    if (l.turns) lane.turns = l.turns;
    if (l.stops.length) lane.stops = l.stops.map((s) => ({ s: Math.round(s.s * 10) / 10, ctrl: s.ctrl, grp: s.grp }));
    if (l.seg.name) lane.name = l.seg.name;
    if (!mainNet[l.id]) lane.iso = 1;
    ts.each(bboxOf(l.pts), (t) => t.lanes.push(lane));
  }
  for (const c of net.connectors) {
    const con: Connector = { id: c.id, node: c.node, from: c.from, to: c.to, turn: c.turn, pts: flat(c.pts), len: Math.round(c.len * 10) / 10 };
    ts.each(bboxOf(c.pts), (t) => t.connectors.push(con));
  }
  // Straßennamen: ein Beschriftungspunkt je benanntem Abschnitt, lange Abschnitte alle ~180 m
  let labelCount = 0;
  for (const seg of net.segments) {
    const name = seg.road.tags.name;
    if (!name || seg.trimmed.length < 2) continue;
    const L = polylineLength(seg.trimmed);
    if (L < 18) continue;
    const n = Math.max(1, Math.round(L / 180));
    for (let k = 0; k < n; k++) {
      const s0 = (L * (k + 0.5)) / n;
      const a = pointAtLen(seg.trimmed, Math.max(0, s0 - 4));
      const b = pointAtLen(seg.trimmed, Math.min(L, s0 + 4));
      const m = pointAtLen(seg.trimmed, s0);
      const lbl: RoadLabel = {
        n: name,
        x: dm(m[0]),
        y: dm(m[1]),
        a: Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI),
        len: Math.round(L / n),
        cls: seg.cls,
        layer: seg.layer,
      };
      ts.each(bboxOf([m]), (t) => t.labels!.push(lbl));
      labelCount++;
    }
  }
  log(`  ${labelCount.toLocaleString('de')} Straßennamen-Beschriftungen`);

  for (const h of ctl.heads) {
    const sh: SignalHead = { id: h.id, ctrl: h.ctrl, grp: h.grp, x: dm(h.p[0]), y: dm(h.p[1]), hdg: Math.round((h.hdg * 180) / Math.PI), w: Math.round(h.w * 10) / 10 };
    ts.each(bboxOf([h.p]), (t) => t.signals.push(sh));
  }
  for (const b of ex.buildings) {
    const bd: Building = { id: b.id, h: Math.round(b.h * 10) / 10, t: b.t, outer: flat(b.outer) };
    if (b.rs) bd.rs = b.rs;
    if (b.rc !== undefined) bd.rc = b.rc;
    if (b.minH) bd.minH = b.minH;
    if (b.holes.length) bd.holes = b.holes.map(flat);
    if (b.name) bd.name = b.name;
    ts.each(bboxOf(b.outer), (t) => t.buildings.push(bd));
  }
  // Große Flächen (Wälder, Flüsse, Parks) global, kleine pro Kachel
  const bigAreas: Area[] = [];
  for (const a of ex.areas) {
    const bb = bboxOf(a.outer);
    const big = bb.maxX - bb.minX > TILE_SIZE * 2 || bb.maxY - bb.minY > TILE_SIZE * 2;
    const outer = big ? simplify([...a.outer, a.outer[0]], 1.5).slice(0, -1) : a.outer;
    if (outer.length < 3) continue;
    const ar: Area = { id: a.id, k: a.k, outer: flat(outer) };
    if (a.holes.length) ar.holes = a.holes.map((h) => flat(big ? simplify([...h, h[0]], 1.5).slice(0, -1) : h)).filter((h) => h.length >= 6);
    if (big) bigAreas.push(ar);
    else ts.each(bb, (t) => t.areas.push(ar));
  }
  for (const l of ex.lines) {
    chunks(l.pts, 150).forEach((part, i) => {
      const ln: Line = { id: l.id * 100 + i, k: l.k, layer: l.layer, pts: flat(part) };
      ts.each(bboxOf(part), (t) => t.lines.push(ln));
    });
  }

  // Ausgabe: Dateien überschreiben statt den Ordner zu löschen (sonst verliert ein laufender Vite-Server die Dateien)
  mkdirSync(join(outDir, 'tiles'), { recursive: true });
  const stale = new Set(existsSync(join(outDir, 'tiles')) ? readdirSync(join(outDir, 'tiles')) : []);
  let bytes = 0;
  const keys: string[] = [];
  const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [k, t] of ts.tiles) {
    const json = JSON.stringify(t);
    bytes += json.length;
    writeFileSync(join(outDir, 'tiles', `${k}.json`), json);
    stale.delete(`${k}.json`);
    keys.push(k);
    bb.minX = Math.min(bb.minX, t.tx * TILE_SIZE);
    bb.minY = Math.min(bb.minY, t.ty * TILE_SIZE);
    bb.maxX = Math.max(bb.maxX, (t.tx + 1) * TILE_SIZE);
    bb.maxY = Math.max(bb.maxY, (t.ty + 1) * TILE_SIZE);
  }
  for (const f of stale) unlinkSync(join(outDir, 'tiles', f));
  const write = (name: string, data: unknown) => {
    const json = JSON.stringify(data);
    bytes += json.length;
    writeFileSync(join(outDir, name), json);
  };

  write('areas.json', { areas: bigAreas });
  write('signals.json', { controllers: ctl.controllers });

  const overview: Overview = {
    roads: net.segments
      .filter((s) => RANK[s.cls] >= 5)
      .map((s) => ({ cls: s.cls, pts: flat(simplify(s.pts, 3)) })),
  };
  write('overview.json', overview);

  const places: Place[] = ex.places.map((p) => ({ name: p.name, x: Math.round(p.p[0]), y: Math.round(p.p[1]), kind: p.kind }));
  write('places.json', places);

  const manifest: Manifest = {
    v: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'OpenStreetMap (Geofabrik-Auszug Mittelfranken)',
    attribution: '© OpenStreetMap-Mitwirkende, ODbL 1.0',
    crs: 'EPSG:25832 (lokal verschoben)',
    origin: { e: ORIGIN_UTM[0], n: ORIGIN_UTM[1], lon: ORIGIN_LONLAT[0], lat: ORIGIN_LONLAT[1] },
    tileSize: TILE_SIZE,
    tiles: keys.sort(),
    bounds: bb,
    boundary: ex.boundary.map((r) => flat(simplify([...r, r[0]], 5))),
    regions: ex.regions.map((g) => ({ name: g.name, rings: g.rings.map((r) => flat(simplify([...r, r[0]], 5))), ...(g.corridor ? { corridor: true } : {}) })),
    stats: {
      segments: net.segments.length,
      lanes: net.lanes.length,
      connectors: net.connectors.length,
      junctions: net.junctions.length,
      signalControllers: ctl.controllers.length,
      signalHeads: ctl.heads.length,
      buildings: ex.buildings.length,
      areas: ex.areas.length,
      lines: ex.lines.length,
      mainNetworkLanes: mainNet.reduce((a, v) => a + v, 0),
    },
  };
  write('manifest.json', manifest);
  log(`  ${keys.length.toLocaleString('de')} Kacheln, ${(bytes / 1e6).toFixed(1)} MB JSON gesamt`);
}
