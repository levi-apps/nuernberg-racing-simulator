/**
 * Fahrbahnflächen und Markierungen aus dem Straßengraphen.
 */
import { offsetPolyline, type Pt } from './geo.ts';
import type { RoadNet, Segment } from './roadnet.ts';

export interface SurfaceObj {
  id: number;
  k: 'seg' | 'jct';
  seg?: Segment;
  ring: Pt[];
  cls: Segment['cls'];
  layer: number;
  bridge: boolean;
  tunnel: boolean;
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
    out.push({ id: s.id, k: 'seg', seg: s, ring: [...left, ...right.reverse()], cls: s.cls, layer: s.layer, bridge: s.bridge, tunnel: s.tunnel });
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
