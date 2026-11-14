/**
 * Fahrbahnflächen und Markierungen aus dem Straßengraphen.
 */
import { leftNormal, offsetPolyline, pointAt, polylineLength, type Pt } from './geo.ts';
import type { Extract } from './extract.ts';
import type { LaneObj, RoadNet, Segment } from './roadnet.ts';

export interface SurfaceObj {
  id: number;
  k: 'seg' | 'jct';
  seg?: Segment;
  ring: Pt[];
  cls: Segment['cls'];
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  /** Umriss mit Gehwegen */
  sw?: Pt[];
  /** Bordstein-/Fahrbahnränder */
  kerbs: Pt[][];
}

export interface PaintObj {
  k: 'white' | 'yellow';
  layer: number;
  ring: Pt[];
}

export interface MarkingObj {
  k: 'solid' | 'dashed' | 'stop' | 'edge';
  layer: number;
  pts: Pt[];
}

export function buildSurfaces(net: RoadNet): SurfaceObj[] {
  const out: SurfaceObj[] = [];
  for (const s of net.segments) {
    if (s.trimmed.length < 2) continue;
    const left = offsetPolyline(s.trimmed, s.leftW);
    const right = offsetPolyline(s.trimmed, -s.rightW);
    const sw = s.swL + s.swR > 0 ? [...offsetPolyline(s.trimmed, s.leftW + s.swL), ...offsetPolyline(s.trimmed, -(s.rightW + s.swR)).reverse()] : undefined;
    out.push({ id: s.id, k: 'seg', seg: s, ring: [...left, ...right.slice().reverse()], cls: s.cls, layer: s.layer, bridge: s.bridge, tunnel: s.tunnel, sw, kerbs: [left, right] });
  }
  for (const j of net.junctions) {
    out.push({
      id: j.id,
      k: 'jct',
      ring: j.ring,
      cls: j.cls,
      layer: j.layer,
      bridge: j.node.ends.some((e) => e.seg.bridge),
      tunnel: j.node.ends.every((e) => e.seg.tunnel),
      sw: j.node.ends.some((e) => e.slw + e.srw > 0) ? j.swRing : undefined,
      kerbs: j.kerbs,
    });
  }
  return out;
}

export function buildMarkings(net: RoadNet): MarkingObj[] {
  const out: MarkingObj[] = [];
  for (const s of net.segments) {
    if (s.trimmed.length < 2 || s.len - s.trimA - s.trimB < 3) continue;
    const major = s.rank >= 5; // ab Kreisstraße/tertiary
    const multi = s.fwd >= 2 || s.bwd >= 2;
    if (!major && !multi) continue;
    const c = s.trimmed;
    const oneDir = s.fwd === 0 || s.bwd === 0;
    // Mittellinie zwischen den Richtungen
    if (!oneDir) {
      const off = 0; // Mittellinie liegt auf der OSM-Achse
      out.push({ k: s.rank >= 7 || multi ? 'solid' : 'dashed', layer: s.layer, pts: offsetPolyline(c, off) });
    }
    // Leitlinien zwischen Spuren gleicher Richtung
    const n = s.fwd + s.bwd;
    const start = s.leftW; // linker Rand (bezogen auf a->b)
    for (let i = 1; i < n; i++) {
      const off = start - i * s.w;
      if (!oneDir && Math.abs(off) < 0.01) continue;
      out.push({ k: 'dashed', layer: s.layer, pts: offsetPolyline(c, off) });
    }
    // Randlinien bei großen Straßen
    if (s.rank >= 7) {
      out.push({ k: 'edge', layer: s.layer, pts: offsetPolyline(c, s.leftW - 0.25) });
      out.push({ k: 'edge', layer: s.layer, pts: offsetPolyline(c, -s.rightW + 0.25) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ Bodenfarbe

/** Rechteck im lokalen System (u längs, v quer) eines Punkts mit Richtung */
function rect(p: Pt, d: Pt, u0: number, u1: number, v0: number, v1: number): Pt[] {
  const n = leftNormal(d);
  const at = (u: number, v: number): Pt => [p[0] + d[0] * u + n[0] * v, p[1] + d[1] * u + n[1] * v];
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

function tri(p: Pt, d: Pt, a: [number, number], b: [number, number], c: [number, number]): Pt[] {
  const n = leftNormal(d);
  const at = ([u, v]: [number, number]): Pt => [p[0] + d[0] * u + n[0] * v, p[1] + d[1] * u + n[1] * v];
  return [at(a), at(b), at(c)];
}

/** Abbiegepfeil (Glyphe 5 m lang) aus Rechtecken und Dreiecken */
function arrowGlyph(p: Pt, d: Pt, turn: 'through' | 'left' | 'right'): Pt[][] {
  if (turn === 'through') return [rect(p, d, 0, 3.2, -0.12, 0.12), tri(p, d, [3.1, -0.5], [5.0, 0], [3.1, 0.5])];
  const sgn = turn === 'left' ? 1 : -1;
  return [
    rect(p, d, 0, 2.7, -0.12, 0.12),
    rect(p, d, 2.4, 2.75, 0, sgn * 0.8),
    tri(p, d, [2.05, sgn * 0.75], [3.1, sgn * 0.75], [2.575, sgn * 1.45]),
  ];
}

/** Zebrastreifen, Fußgängerfurten an Ampeln und Abbiegepfeile */
export function buildPaint(ex: Extract, net: RoadNet): PaintObj[] {
  const out: PaintObj[] = [];
  const done = new Set<number>();
  for (const s of net.segments) {
    let acc = 0;
    for (let i = 0; i < s.nodeIds.length; i++) {
      if (i > 0) acc += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
      const id = s.nodeIds[i];
      if (done.has(id)) continue;
      const t = ex.controlNodes.get(id)?.tags;
      if (!t) continue;
      const isCrossing = t.highway === 'crossing' || t.crossing === 'traffic_signals';
      if (!isCrossing) continue;
      const ct = t.crossing;
      const zebra = ct === 'zebra' || ct === 'marked' || ct === 'uncontrolled' || t.crossing_ref === 'zebra' || t['crossing:markings'] === 'zebra';
      const furt = ct === 'traffic_signals';
      if (!zebra && !furt) continue;
      done.add(id);
      const { p, d } = pointAt(s.pts, acc);
      const v0 = -s.rightW + 0.3;
      const v1 = s.leftW - 0.3;
      if (zebra) {
        for (let v = v0; v + 0.5 <= v1 + 0.01; v += 1.0) out.push({ k: 'white', layer: s.layer, ring: rect(p, d, -2, 2, v, v + 0.5) });
      } else {
        for (const u of [-2.2, 2.2])
          for (let v = v0; v + 0.5 <= v1 + 0.01; v += 1.0) out.push({ k: 'white', layer: s.layer, ring: rect(p, d, u - 0.25, u + 0.25, v, v + 0.5) });
      }
    }
  }
  // Pfeile auf Spuren mit turn:lanes (vor dem Spurende)
  for (const l of net.lanes) {
    if (!l.turns || l.len < 16) continue;
    const parts = l.turns.split(';');
    const kinds = new Set<'through' | 'left' | 'right'>();
    for (const t of parts) {
      if (/left/.test(t) && !/merge/.test(t)) kinds.add('left');
      else if (/right/.test(t) && !/merge/.test(t)) kinds.add('right');
      else if (t === 'through' || t === 'none') kinds.add('through');
    }
    if (!kinds.size) continue;
    const positions = l.len > 60 ? [l.len - 12, l.len - 40] : [l.len - 12];
    for (const s0 of positions) {
      if (s0 < 1) continue;
      const { p, d } = pointAt(l.pts, s0);
      for (const k of kinds) for (const ring of arrowGlyph(p, d, k)) out.push({ k: 'white', layer: l.seg.layer, ring });
    }
  }
  return out;
}
void polylineLength;
export type { LaneObj };
