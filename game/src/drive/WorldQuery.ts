/**
 * Räumliche Abfragen auf den geladenen Kacheln: Untergrund, Gebäude, Stadtgrenze.
 */
import type { Area, Building, RoadSurface, Tile } from '@nrs/shared';
import type { WorldView } from '../world/WorldView.ts';

/** Polygon in Metern mit Hüllrechteck (zwischengespeichert) */
export interface Poly {
  id: number;
  outer: Float64Array;
  holes: Float64Array[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const polyCache = new WeakMap<object, Poly>();

function toPoly(id: number, outer: number[], holes: number[][] | undefined, key: object): Poly {
  let p = polyCache.get(key);
  if (p) return p;
  const o = new Float64Array(outer.length);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    const x = outer[i] / 10;
    const y = outer[i + 1] / 10;
    o[i] = x;
    o[i + 1] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const hs = (holes ?? []).map((h) => Float64Array.from(h, (v) => v / 10));
  p = { id, outer: o, holes: hs, minX, minY, maxX, maxY };
  polyCache.set(key, p);
  return p;
}

export const buildingPoly = (b: Building): Poly => toPoly(b.id, b.outer, b.holes, b);
export const surfacePoly = (s: RoadSurface): Poly => toPoly(s.id, s.ring, undefined, s);
export const areaPoly = (a: Area): Poly => toPoly(a.id, a.outer, a.holes, a);

export function ringContains(r: Float64Array, x: number, y: number): boolean {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i];
    const yi = r[i + 1];
    const xj = r[j];
    const yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polyContains(p: Poly, x: number, y: number): boolean {
  if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) return false;
  if (!ringContains(p.outer, x, y)) return false;
  for (const h of p.holes) if (ringContains(h, x, y)) return false;
  return true;
}

/** Nächster Punkt auf dem Polygonrand */
export function closestOnPoly(p: Poly, x: number, y: number): { x: number; y: number; d: number } {
  let best = { x, y, d: Infinity };
  const scan = (r: Float64Array) => {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const ax = r[j];
      const ay = r[j + 1];
      const bx = r[i];
      const by = r[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const px = ax + dx * t;
      const py = ay + dy * t;
      const d = Math.hypot(px - x, py - y);
      if (d < best.d) best = { x: px, y: py, d };
    }
  };
  scan(p.outer);
  for (const h of p.holes) scan(h);
  return best;
}

export type Ground = 'road' | 'offroad' | 'water';

export interface SurfaceInfo {
  ground: Ground;
  layer: number;
}

export class WorldQuery {
  private regions: Array<{ name: string; rings: Float64Array[]; corridor: boolean }> = [];

  constructor(private view: WorldView) {}

  init(): void {
    const m = this.view.manifest;
    const conv = (r: number[]) => Float64Array.from(r, (v) => v / 10);
    this.regions = m.regions?.length
      ? m.regions.map((g) => ({ name: g.name, rings: g.rings.map(conv), corridor: !!g.corridor }))
      : [{ name: 'Nürnberg', rings: m.boundary.map(conv), corridor: false }];
  }

  private tiles(x: number, y: number, r = 1): Tile[] {
    return this.view.tilesAround(x, y, r);
  }

  /** Fahrbahn unter dem Punkt; bevorzugt die Ebene, auf der das Auto gerade fährt */
  surfaceAt(x: number, y: number, currentLayer: number): SurfaceInfo {
    let found: number | null = null;
    let any = false;
    for (const t of this.tiles(x, y)) {
      for (const s of t.surfaces) {
        const p = surfacePoly(s);
        if (!polyContains(p, x, y)) continue;
        any = true;
        if (s.layer === currentLayer) return { ground: 'road', layer: currentLayer };
        // Übergang auf andere Ebene nur über benachbarte Ebenen (Rampen) oder auf Ebene 0
        if (found === null || Math.abs(s.layer - currentLayer) < Math.abs(found - currentLayer)) found = s.layer;
      }
    }
    if (any && found !== null) return { ground: 'road', layer: found };
    return { ground: this.isWater(x, y) ? 'water' : 'offroad', layer: 0 };
  }

  /** Liegt der Punkt auf irgendeiner Fahrbahn (egal welche Ebene)? */
  onAnyRoad(x: number, y: number): boolean {
    for (const t of this.tiles(x, y)) for (const s of t.surfaces) if (polyContains(surfacePoly(s), x, y)) return true;
    return false;
  }

  isWater(x: number, y: number): boolean {
    for (const t of this.tiles(x, y)) for (const a of t.areas) if (a.k === 'water' && polyContains(areaPoly(a), x, y)) return true;
    for (const a of this.view.bigAreaData) if (a.k === 'water' && polyContains(areaPoly(a), x, y)) return true;
    return false;
  }

  /** Gebäude, deren Hüllrechteck den Kreis berührt (ohne Duplikate über Kachelgrenzen) */
  buildingsNear(x: number, y: number, r: number): Poly[] {
    const seen = new Set<number>();
    const out: Poly[] = [];
    for (const t of this.tiles(x, y, r)) {
      for (const b of t.buildings) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        const p = buildingPoly(b);
        if (p.maxX < x - r || p.minX > x + r || p.maxY < y - r || p.minY > y + r) continue;
        out.push(p);
      }
    }
    return out;
  }

  /** Gebiet an einer Stelle (Stadt oder Verbindungsstraße), null = außerhalb der Spielwelt */
  regionAt(x: number, y: number): { name: string; corridor: boolean } | null {
    for (const g of this.regions) {
      let inside = false;
      for (const r of g.rings) if (ringContains(r, x, y)) inside = !inside;
      if (inside) return g;
    }
    return null;
  }

  insideCity(x: number, y: number): boolean {
    return this.regionAt(x, y) !== null;
  }
}
