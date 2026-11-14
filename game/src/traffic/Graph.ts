/**
 * Verkehrsgraph über den geladenen Kacheln: Geometrie von Spuren und Verbindern,
 * Verbinder je Kreuzungsknoten und Konfliktpunkte zwischen Verbindern.
 */
import type { Connector, Lane, Tile } from '@nrs/shared';
import type { WorldView } from '../world/WorldView.ts';

/** Element einer Route: Spur oder Verbinder. Schlüssel: Spur = id*2, Verbinder = id*2+1 */
export type ElemKey = number;
export const laneKey = (id: number): ElemKey => id * 2;
export const conKey = (id: number): ElemKey => id * 2 + 1;
export const isCon = (k: ElemKey): boolean => (k & 1) === 1;
export const elemId = (k: ElemKey): number => k >> 1;

export interface Geom {
  /** Punkte in Metern */
  xs: Float64Array;
  ys: Float64Array;
  /** kumulierte Länge je Punkt */
  cum: Float64Array;
  len: number;
}

export interface Conflict {
  other: number; // Verbinder-ID
  sSelf: number; // Lage des Konfliktpunkts auf dem eigenen Verbinder (m)
  sOther: number;
  merge: boolean; // gleiche Zielspur
}

export class Graph {
  private geoms = new Map<ElemKey, Geom>();
  /** Verbinder je Knoten */
  nodeCons = new Map<number, Map<number, Connector>>();
  private conflicts = new Map<number, Conflict[]>();
  private dirtyNodes = new Set<number>();

  constructor(private view: WorldView) {}

  lane(id: number): Lane | undefined {
    return this.view.laneById.get(id);
  }
  con(id: number): Connector | undefined {
    return this.view.conById.get(id);
  }

  addTile(t: Tile): void {
    for (const c of t.connectors) {
      let m = this.nodeCons.get(c.node);
      if (!m) {
        m = new Map();
        this.nodeCons.set(c.node, m);
      }
      if (!m.has(c.id)) {
        m.set(c.id, c);
        this.dirtyNodes.add(c.node);
      }
    }
  }

  geom(k: ElemKey): Geom | null {
    let g = this.geoms.get(k);
    if (g) return g;
    const src = isCon(k) ? this.con(elemId(k)) : this.lane(elemId(k));
    if (!src) return null;
    const p = src.pts;
    const n = p.length / 2;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const cum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = p[2 * i] / 10;
      ys[i] = p[2 * i + 1] / 10;
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    g = { xs, ys, cum, len: Math.max(cum[n - 1], 0.01) };
    this.geoms.set(k, g);
    return g;
  }

  length(k: ElemKey): number {
    return this.geom(k)?.len ?? 0;
  }

  /** Punkt und Richtung bei Bogenlänge s */
  at(k: ElemKey, s: number, out: { x: number; y: number; dx: number; dy: number }): boolean {
    const g = this.geom(k);
    if (!g) return false;
    const n = g.xs.length;
    if (s <= 0 || n < 2) {
      const dx = g.xs[1] - g.xs[0];
      const dy = g.ys[1] - g.ys[0];
      const l = Math.hypot(dx, dy) || 1;
      out.x = g.xs[0] + (dx / l) * Math.min(0, s);
      out.y = g.ys[0] + (dy / l) * Math.min(0, s);
      out.dx = dx / l;
      out.dy = dy / l;
      return true;
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (g.cum[mid] < s) lo = mid;
      else hi = mid;
    }
    const segLen = g.cum[hi] - g.cum[lo] || 1;
    // hinter dem Ende linear weiterführen (für Fahrzeugheck/-front über die Elementgrenze)
    const t = Math.max(0, (s - g.cum[lo]) / segLen);
    const dx = (g.xs[hi] - g.xs[lo]) / segLen;
    const dy = (g.ys[hi] - g.ys[lo]) / segLen;
    out.x = g.xs[lo] + (g.xs[hi] - g.xs[lo]) * t;
    out.y = g.ys[lo] + (g.ys[hi] - g.ys[lo]) * t;
    out.dx = dx;
    out.dy = dy;
    return true;
  }

  /** Projektion eines Punkts auf ein Element: Bogenlänge und seitlicher Abstand */
  project(k: ElemKey, x: number, y: number): { s: number; d: number } | null {
    const g = this.geom(k);
    if (!g) return null;
    let best = Infinity;
    let bestS = 0;
    for (let i = 1; i < g.xs.length; i++) {
      const ax = g.xs[i - 1];
      const ay = g.ys[i - 1];
      const dx = g.xs[i] - ax;
      const dy = g.ys[i] - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
      if (d < best) {
        best = d;
        bestS = g.cum[i - 1] + t * Math.sqrt(l2);
      }
    }
    return { s: bestS, d: best };
  }

  /** Konflikte eines Verbinders mit anderen Verbindern am selben Knoten */
  conflictsOf(c: Connector): Conflict[] {
    if (this.dirtyNodes.has(c.node)) {
      for (const id of this.nodeCons.get(c.node)?.keys() ?? []) this.conflicts.delete(id);
      this.dirtyNodes.delete(c.node);
    }
    let list = this.conflicts.get(c.id);
    if (list) return list;
    list = [];
    const ga = this.geom(conKey(c.id));
    for (const o of this.nodeCons.get(c.node)?.values() ?? []) {
      if (o.id === c.id || o.from === c.from) continue;
      if (o.to === c.to) {
        list.push({ other: o.id, sSelf: ga?.len ?? 0, sOther: this.length(conKey(o.id)), merge: true });
        continue;
      }
      const gb = this.geom(conKey(o.id));
      if (!ga || !gb) continue;
      const hit = intersect(ga, gb);
      if (hit) list.push({ other: o.id, sSelf: hit[0], sOther: hit[1], merge: false });
    }
    this.conflicts.set(c.id, list);
    return list;
  }
}

/** Erster Schnittpunkt zweier Polylinien: Bogenlängen auf beiden */
function intersect(a: Geom, b: Geom): [number, number] | null {
  for (let i = 1; i < a.xs.length; i++) {
    const ax = a.xs[i - 1];
    const ay = a.ys[i - 1];
    const rx = a.xs[i] - ax;
    const ry = a.ys[i] - ay;
    for (let j = 1; j < b.xs.length; j++) {
      const bx = b.xs[j - 1];
      const by = b.ys[j - 1];
      const sx = b.xs[j] - bx;
      const sy = b.ys[j] - by;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) continue;
      const qx = bx - ax;
      const qy = by - ay;
      const t = (qx * sy - qy * sx) / den;
      const u = (qx * ry - qy * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return [a.cum[i - 1] + t * Math.hypot(rx, ry), b.cum[j - 1] + u * Math.hypot(sx, sy)];
      }
    }
  }
  return null;
}
