import proj4 from 'proj4';

proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

/** Ursprung des lokalen Koordinatensystems: Hauptmarkt Nürnberg. */
export const ORIGIN_LONLAT: [number, number] = [11.0775, 49.4539];
const toUtm = proj4('EPSG:4326', 'EPSG:25832');
export const ORIGIN_UTM = toUtm.forward(ORIGIN_LONLAT) as [number, number];

/** WGS84 -> lokale Meter (x Ost, y Nord) relativ zum Ursprung. */
export function project(lon: number, lat: number): [number, number] {
  const [e, n] = toUtm.forward([lon, lat]) as [number, number];
  return [e - ORIGIN_UTM[0], n - ORIGIN_UTM[1]];
}

export type Pt = [number, number];

export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
export const len = (a: Pt): number => Math.hypot(a[0], a[1]);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a: Pt): Pt => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
export const leftNormal = (d: Pt): Pt => [-d[1], d[0]];
export const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0];
export const angleOf = (d: Pt): number => Math.atan2(d[1], d[0]);

/** Winkel auf (-PI, PI] normieren */
export function normAngle(a: number): number {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

export function polylineLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Teilstück einer Polylinie zwischen den Bogenlängen s0 und s1. */
export function slicePolyline(pts: Pt[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = dist(a, b);
    const segStart = acc;
    const segEnd = acc + l;
    if (segEnd >= s0 && segStart <= s1 && l > 0) {
      const t0 = Math.max(0, (s0 - segStart) / l);
      const t1 = Math.min(1, (s1 - segStart) / l);
      const p0: Pt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1: Pt = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      if (out.length === 0 || dist(out[out.length - 1], p0) > 1e-6) out.push(p0);
      if (dist(out[out.length - 1], p1) > 1e-6) out.push(p1);
    }
    acc = segEnd;
    if (acc > s1) break;
  }
  if (out.length === 1) out.push([out[0][0] + 1e-3, out[0][1]]);
  return out;
}

/** Punkt und Richtung bei Bogenlänge s. */
export function pointAt(pts: Pt[], s: number): { p: Pt; d: Pt } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = dist(a, b);
    if (acc + l >= s || i === pts.length - 1) {
      const t = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: norm(sub(b, a)) };
    }
    acc += l;
  }
  return { p: pts[0], d: [1, 0] };
}

/** Richtung am Anfang einer Polylinie, gemittelt über die ersten `over` Meter. */
export function startDirection(pts: Pt[], over = 8): Pt {
  const { p } = pointAt(pts, Math.min(over, polylineLength(pts)));
  const d = sub(p, pts[0]);
  return len(d) > 1e-6 ? norm(d) : norm(sub(pts[1], pts[0]));
}

/** Parallel versetzte Polylinie (offset > 0 = nach links). Gehrung mit Begrenzung. */
export function offsetPolyline(pts: Pt[], offset: number): Pt[] {
  if (offset === 0) return pts.slice();
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let nrm: Pt;
    if (i === 0) nrm = leftNormal(norm(sub(pts[1], pts[0])));
    else if (i === n - 1) nrm = leftNormal(norm(sub(pts[n - 1], pts[n - 2])));
    else {
      const n1 = leftNormal(norm(sub(pts[i], pts[i - 1])));
      const n2 = leftNormal(norm(sub(pts[i + 1], pts[i])));
      const m = norm(add(n1, n2));
      const c = dot(m, n1);
      const scale = c > 0.35 ? 1 / c : 1 / 0.35;
      nrm = mul(m, scale);
    }
    out.push([pts[i][0] + nrm[0] * offset, pts[i][1] + nrm[1] * offset]);
  }
  return out;
}

/** Douglas-Peucker-Vereinfachung */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const A = pts[a];
    const B = pts[b];
    const ab = sub(B, A);
    const abl = len(ab);
    for (let i = a + 1; i < b; i++) {
      const d = abl > 0 ? Math.abs(cross(ab, sub(pts[i], A))) / abl : dist(pts[i], A);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}

export function ringCentroid(ring: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

export function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(pts: Pt[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    if (p[0] < b.minX) b.minX = p[0];
    if (p[1] < b.minY) b.minY = p[1];
    if (p[0] > b.maxX) b.maxX = p[0];
    if (p[1] > b.maxY) b.maxY = p[1];
  }
  return b;
}

/**
 * Schnelle Punkt-in-Polygon-Abfrage über ein Raster (für die Stadtgrenze).
 */
export class PolygonIndex {
  private cells: Uint8Array; // 0 = außen, 1 = innen, 2 = Rand (exakt prüfen)
  private bb: BBox;
  private nx: number;
  private ny: number;
  constructor(
    private rings: Pt[][],
    private cell = 100,
  ) {
    this.bb = bboxOf(rings.flat());
    this.nx = Math.ceil((this.bb.maxX - this.bb.minX) / cell) + 1;
    this.ny = Math.ceil((this.bb.maxY - this.bb.minY) / cell) + 1;
    this.cells = new Uint8Array(this.nx * this.ny);
    // Randzellen markieren
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const steps = Math.ceil(dist(a, b) / (cell / 4)) + 1;
        for (let s = 0; s <= steps; s++) {
          const x = a[0] + ((b[0] - a[0]) * s) / steps;
          const y = a[1] + ((b[1] - a[1]) * s) / steps;
          const cx = Math.floor((x - this.bb.minX) / cell);
          const cy = Math.floor((y - this.bb.minY) / cell);
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++) {
              const ix = cx + dx;
              const iy = cy + dy;
              if (ix >= 0 && iy >= 0 && ix < this.nx && iy < this.ny) this.cells[iy * this.nx + ix] = 2;
            }
        }
      }
    }
    for (let iy = 0; iy < this.ny; iy++)
      for (let ix = 0; ix < this.nx; ix++) {
        const k = iy * this.nx + ix;
        if (this.cells[k] === 2) continue;
        const c: Pt = [this.bb.minX + (ix + 0.5) * cell, this.bb.minY + (iy + 0.5) * cell];
        this.cells[k] = this.exact(c) ? 1 : 0;
      }
  }
  private exact(p: Pt): boolean {
    let inside = false;
    for (const r of this.rings) if (pointInRing(p, r)) inside = !inside;
    return inside;
  }
  contains(p: Pt): boolean {
    if (p[0] < this.bb.minX || p[1] < this.bb.minY || p[0] > this.bb.maxX || p[1] > this.bb.maxY) return false;
    const ix = Math.floor((p[0] - this.bb.minX) / this.cell);
    const iy = Math.floor((p[1] - this.bb.minY) / this.cell);
    const c = this.cells[iy * this.nx + ix];
    if (c === 2) return this.exact(p);
    return c === 1;
  }
}

/** Fügt Wege (als Punktlisten mit Knoten-IDs) zu geschlossenen Ringen zusammen. */
export function assembleRings(ways: Array<{ ids: number[]; pts: Pt[] }>): Pt[][] {
  const rings: Pt[][] = [];
  const open = ways.filter((w) => w.ids.length >= 2).map((w) => ({ ids: w.ids.slice(), pts: w.pts.slice() }));
  const closed = (w: { ids: number[] }) => w.ids[0] === w.ids[w.ids.length - 1];
  for (let i = open.length - 1; i >= 0; i--) {
    if (closed(open[i]) && open[i].ids.length >= 4) {
      rings.push(open[i].pts.slice(0, -1));
      open.splice(i, 1);
    }
  }
  while (open.length) {
    const cur = open.pop()!;
    let progress = true;
    while (!closed(cur) && progress) {
      progress = false;
      const last = cur.ids[cur.ids.length - 1];
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        if (o.ids[0] === last) {
          cur.ids.push(...o.ids.slice(1));
          cur.pts.push(...o.pts.slice(1));
        } else if (o.ids[o.ids.length - 1] === last) {
          cur.ids.push(...o.ids.slice(0, -1).reverse());
          cur.pts.push(...o.pts.slice(0, -1).reverse());
        } else continue;
        open.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (closed(cur) && cur.ids.length >= 4) rings.push(cur.pts.slice(0, -1));
  }
  return rings;
}

/** mehrere Gebiete (je eigene Ringe, gerade/ungerade-Regel), Punkt liegt drin, wenn in irgendeinem */
export class RegionSet {
  private parts: PolygonIndex[];
  constructor(regions: Pt[][][], cell = 100) {
    this.parts = regions.filter((r) => r.length).map((r) => new PolygonIndex(r, cell));
  }
  contains(p: Pt): boolean {
    for (const r of this.parts) if (r.contains(p)) return true;
    return false;
  }
}

/** Polylinie zu einem Schlauch-Polygon (Ring) mit halber Breite w aufweiten */
export function bufferLine(pts: Pt[], w: number): Pt[] {
  const n = pts.length;
  if (n < 2) return [];
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    // Gehrung begrenzen
    let k = 1;
    if (i > 0 && i < n - 1) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
      const d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
      const c = ((p1[0] - p0[0]) * (p2[0] - p1[0]) + (p1[1] - p0[1]) * (p2[1] - p1[1])) / (d1 * d2);
      k = Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + c) / 2)));
    }
    const p = pts[i];
    left.push([p[0] - dy * w * k, p[1] + dx * w * k]);
    right.push([p[0] + dy * w * k, p[1] - dx * w * k]);
  }
  // Enden etwas verlängern
  return [...left, ...right.reverse()];
}
