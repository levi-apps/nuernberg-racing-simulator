/**
 * Daten für Navigation und Aufträge:
 * - Routinggraph über alle Spuren (binär, routing.bin)
 * - Adressen und benannte Orte, eingerastet auf die nächste öffentliche Spur des Hauptnetzes
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dm, ROUTING_MAGIC, TURN_CODES, type AddressFile, type BusFile, type PoiFile } from '@nrs/shared';
import type { Extract } from './extract.ts';
import type { RoadNet, LaneObj } from './roadnet.ts';
import type { Pt } from './geo.ts';

const SNAP_CELL = 40;
const SNAP_MAX = 70;

/** Raster über Spursegmente für schnelles Einrasten */
class LaneGrid {
  cells = new Map<string, Array<{ lane: LaneObj; i: number; s0: number }>>();
  constructor(lanes: LaneObj[]) {
    for (const l of lanes) {
      let acc = 0;
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1];
        const b = l.pts[i];
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const x0 = Math.floor(Math.min(a[0], b[0]) / SNAP_CELL);
        const x1 = Math.floor(Math.max(a[0], b[0]) / SNAP_CELL);
        const y0 = Math.floor(Math.min(a[1], b[1]) / SNAP_CELL);
        const y1 = Math.floor(Math.max(a[1], b[1]) / SNAP_CELL);
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++) {
            const k = `${x},${y}`;
            const c = this.cells.get(k) ?? [];
            c.push({ lane: l, i, s0: acc });
            this.cells.set(k, c);
          }
        acc += seg;
      }
    }
  }
  nearest(p: Pt): { lane: LaneObj; s: number; d: number } | null {
    const cx = Math.floor(p[0] / SNAP_CELL);
    const cy = Math.floor(p[1] / SNAP_CELL);
    let best: { lane: LaneObj; s: number; d: number } | null = null;
    const r = Math.ceil(SNAP_MAX / SNAP_CELL);
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        for (const e of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const a = e.lane.pts[e.i - 1];
          const b = e.lane.pts[e.i];
          const vx = b[0] - a[0];
          const vy = b[1] - a[1];
          const l2 = vx * vx + vy * vy;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
          const d = Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1]);
          if (d < SNAP_MAX && (!best || d < best.d)) best = { lane: e.lane, s: e.s0 + t * Math.sqrt(l2), d };
        }
      }
    return best;
  }
}

export function writeNav(outDir: string, ex: Extract, net: RoadNet, mainNet: Uint8Array, log: (s: string) => void): void {
  // --- Routinggraph
  const N = net.lanes.length;
  const E = net.connectors.length;
  const names: string[] = [];
  const nameIdx = new Map<string, number>();
  const name = (n: string | undefined) => {
    if (!n) return -1;
    let i = nameIdx.get(n);
    if (i === undefined) {
      i = names.length;
      names.push(n);
      nameIdx.set(n, i);
    }
    return i;
  };
  const head = new Int32Array([ROUTING_MAGIC, N, E, 1]);
  const x0 = new Int32Array(N);
  const y0 = new Int32Array(N);
  const x1 = new Int32Array(N);
  const y1 = new Int32Array(N);
  const nm = new Int32Array(N);
  const outStart = new Uint32Array(N + 1);
  const len = new Float32Array(N);
  const target = new Int32Array(E);
  const conLen = new Float32Array(E);
  const vmax = new Uint8Array(N);
  const flags = new Uint8Array(N);
  const layer = new Int8Array(N);
  const turn = new Uint8Array(E);
  let e = 0;
  for (const l of net.lanes) {
    const i = l.id;
    const a = l.pts[0];
    const b = l.pts[l.pts.length - 1];
    x0[i] = dm(a[0]);
    y0[i] = dm(a[1]);
    x1[i] = dm(b[0]);
    y1[i] = dm(b[1]);
    nm[i] = name(l.seg.name);
    len[i] = l.len;
    vmax[i] = Math.min(255, l.seg.vmax);
    flags[i] = (mainNet[i] ? 0 : 1) | (l.ctrl === 'signal' ? 2 : 0) | (l.ctrl === 'stop' || l.ctrl === 'yield' || l.ctrl === 'rbl' ? 4 : 0) | (l.seg.cls === 'service' || l.seg.cls === 'living_street' ? 8 : 0);
    layer[i] = l.seg.layer;
    outStart[i] = e;
    for (const cid of l.out) {
      const c = net.connectors[cid];
      target[e] = c.to;
      conLen[e] = c.len;
      turn[e] = TURN_CODES.indexOf(c.turn);
      e++;
    }
  }
  outStart[N] = e;
  const parts: ArrayBufferView[] = [head, x0, y0, x1, y1, nm, outStart, len, target, conLen, vmax, flags, layer, turn];
  const total = parts.reduce((t, p) => t + p.byteLength, 0);
  const buf = Buffer.alloc(total);
  let o = 0;
  for (const p of parts) {
    Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, o);
    o += p.byteLength;
  }
  writeFileSync(join(outDir, 'routing.bin'), buf);
  writeFileSync(join(outDir, 'names.json'), JSON.stringify(names));

  // --- Einrasten auf öffentliche Spuren des Hauptnetzes
  const snapLanes = net.lanes.filter((l) => mainNet[l.id] && l.seg.cls !== 'service' && l.seg.cls !== 'living_street' && l.seg.cls !== 'motorway' && l.seg.layer === 0);
  const grid = new LaneGrid(snapLanes);

  const streets: string[] = [];
  const streetIdx = new Map<string, number>();
  const addr: AddressFile = { streets, nums: [], a: [] };
  let dropped = 0;
  for (const ad of ex.addresses) {
    const hit = grid.nearest(ad.p);
    if (!hit) {
      dropped++;
      continue;
    }
    let si = streetIdx.get(ad.street);
    if (si === undefined) {
      si = streets.length;
      streets.push(ad.street);
      streetIdx.set(ad.street, si);
    }
    addr.nums.push(ad.num);
    addr.a.push(si, dm(ad.p[0]), dm(ad.p[1]), hit.lane.id, dm(hit.s));
  }
  writeFileSync(join(outDir, 'addresses.json'), JSON.stringify(addr));

  const pois: PoiFile = { pois: [] };
  for (const p of ex.pois) {
    const hit = grid.nearest(p.p);
    if (!hit) continue;
    pois.pois.push({ n: p.name, c: p.cat, t: p.sub, x: dm(p.p[0]), y: dm(p.p[1]), l: hit.lane.id, s: dm(hit.s) });
  }
  writeFileSync(join(outDir, 'pois.json'), JSON.stringify(pois));

  // Buslinien: Haltestellen auf Spuren einrasten
  const bus: BusFile = { lines: [] };
  for (const line of ex.busLines) {
    const stops: BusFile['lines'][number]['stops'] = [];
    for (const st of line.stops) {
      const hit = grid.nearest(st.p);
      if (!hit) continue;
      stops.push({ n: st.name, x: dm(st.p[0]), y: dm(st.p[1]), l: hit.lane.id, s: dm(hit.s) });
    }
    if (stops.length >= 4) bus.lines.push({ ref: line.ref, name: line.name, stops });
  }
  writeFileSync(join(outDir, 'bus.json'), JSON.stringify(bus));
  log(`  ${bus.lines.length} Buslinien mit eingerasteten Haltestellen`);
  log(`  Routinggraph ${(total / 1e6).toFixed(1)} MB, ${addr.nums.length.toLocaleString('de')} Adressen (${dropped} ohne Straße in der Nähe), ${pois.pois.length.toLocaleString('de')} Orte`);
}
