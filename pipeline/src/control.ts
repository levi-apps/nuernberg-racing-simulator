/**
 * Verkehrsregelung: Ampeln (Standorte aus OSM, Phasen erzeugt), Stopp/Vorfahrt,
 * Vorfahrtstraße nach Straßenklasse und rechts vor links.
 */
import type { SignalController, SignalPhase } from '@nrs/shared';
import { dm } from '@nrs/shared';
import { angleOf, dist, leftNormal, normAngle, pointAt, type Pt } from './geo.ts';
import type { Extract } from './extract.ts';
import { approachesInto, type Approach, type GNode, type LaneObj, type RoadNet, type Segment, type SegEnd } from './roadnet.ts';

export interface SignalHeadObj {
  id: number;
  ctrl: number;
  grp: number;
  p: Pt;
  hdg: number;
  w: number;
}

export interface StopLine {
  pts: Pt[];
  layer: number;
}

export interface Control {
  controllers: SignalController[];
  heads: SignalHeadObj[];
  stopLines: StopLine[];
}

const SIGNAL_REACH = 55; // m: Ampel-Knoten gehört zur Kreuzung, wenn sie so nah davor steht
const CLUSTER_LINK = 45; // m: Kreuzungsknoten, die so nah beieinander liegen, bilden eine Anlage

interface Pending {
  /** Segment, auf dem die Haltelinie liegt, und Fahrtrichtung */
  seg: Segment;
  dir: 1 | -1;
  /** Abstand der Haltelinie ab Segmentanfang (a) entlang der Mittellinie */
  sAlong: number;
}

export function buildControl(ex: Extract, net: RoadNet, log: (s: string) => void): Control {
  const { nodes, lanes } = net;

  // Knoten -> Lage auf Segmenten
  const onSeg = new Map<number, Array<{ seg: Segment; i: number }>>();
  for (const s of net.segments) {
    s.nodeIds.forEach((id, i) => {
      if (!ex.controlNodes.has(id)) return;
      const l = onSeg.get(id) ?? [];
      l.push({ seg: s, i });
      onSeg.set(id, l);
    });
  }
  const sOfIndex = (s: Segment, i: number) => {
    let acc = 0;
    for (let k = 1; k <= i; k++) acc += dist(s.pts[k - 1], s.pts[k]);
    return acc;
  };
  const degree = (id: number) => nodes.get(id)?.ends.length ?? 0;

  /** Von Segment s in Richtung dir bis zur nächsten echten Kreuzung laufen. */
  const walk = (s: Segment, dir: 1 | -1, startS: number): { node: GNode; end: SegEnd; d: number } | null => {
    let d = dir === 1 ? s.len - startS : startS;
    let seg = s;
    let dr = dir;
    for (let hop = 0; hop < 6 && d <= SIGNAL_REACH; hop++) {
      const nid = dr === 1 ? seg.b : seg.a;
      const g = nodes.get(nid)!;
      const end = g.ends.find((e) => e.seg === seg && e.atA === (dr === -1))!;
      if (g.ends.length >= 3 || g.ends.length === 1) return g.ends.length >= 3 ? { node: g, end, d } : null;
      // Grad 2: weiterlaufen
      const next = g.ends.find((e) => e !== end);
      if (!next) return null;
      seg = next.seg;
      dr = next.atA ? 1 : -1;
      if ((dr === 1 ? seg.fwd : seg.bwd) === 0) return null;
      d += seg.len;
    }
    return null;
  };

  // 1) Ampeln zuordnen
  const signalizedNodes = new Set<number>();
  /** Zufahrt (Segment-Ende) -> Haltepunkte */
  const approachStops = new Map<SegEnd, Pending[]>();
  const crossings: Array<{ p: Pt; stops: Pending[] }> = [];

  for (const cn of ex.controlNodes.values()) {
    const t = cn.tags;
    if (t.highway !== 'traffic_signals' && t.crossing !== 'traffic_signals') continue;
    const where = onSeg.get(cn.id);
    if (!where) continue;
    if (degree(cn.id) >= 3) {
      signalizedNodes.add(cn.id);
      continue;
    }
    const dirTag = t['traffic_signals:direction'] ?? t.direction;
    const found: Array<{ pend: Pending; target: { node: GNode; end: SegEnd; d: number } | null }> = [];
    // Bei Grad-2-Knoten liegt der Knoten auf zwei Segmenten – das jeweils vorgelagerte zählt
    const seen = new Set<string>();
    for (const { seg, i } of where) {
      const sAlong = sOfIndex(seg, i);
      for (const dir of [1, -1] as const) {
        if ((dir === 1 ? seg.fwd : seg.bwd) === 0) continue;
        // Richtung relativ zum OSM-Weg (Segmente laufen in Wegrichtung)
        if (dirTag === 'forward' && dir !== 1) continue;
        if (dirTag === 'backward' && dir !== -1) continue;
        // Knoten am Segmentende in Fahrtrichtung gehört zum nächsten Segment
        if (dir === 1 && i === seg.nodeIds.length - 1 && where.length > 1) continue;
        if (dir === -1 && i === 0 && where.length > 1) continue;
        const key = `${seg.road.id}:${dir}`;
        if (seen.has(key + seg.id)) continue;
        seen.add(key + seg.id);
        found.push({ pend: { seg, dir, sAlong }, target: walk(seg, dir, sAlong) });
      }
    }
    const toJunction = found.filter((f) => f.target);
    if (toJunction.length) {
      // Ohne Richtungsangabe gilt die Ampel nur für die Fahrtrichtung zur nächstgelegenen Kreuzung
      let use = toJunction;
      if (!dirTag && toJunction.length > 1) {
        const minD = Math.min(...toJunction.map((f) => f.target!.d));
        use = toJunction.filter((f) => f.target!.d <= minD + 1);
      }
      for (const f of use) {
        signalizedNodes.add(f.target!.node.id);
        const l = approachStops.get(f.target!.end) ?? [];
        l.push(f.pend);
        approachStops.set(f.target!.end, l);
      }
    } else if (found.length) {
      crossings.push({ p: cn.p, stops: found.map((f) => f.pend) });
    }
  }

  // 2) Anlagen bilden (benachbarte signalisierte Knoten zusammenfassen)
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const id of signalizedNodes) parent.set(id, id);
  for (const s of net.segments) {
    if (s.len < CLUSTER_LINK && signalizedNodes.has(s.a) && signalizedNodes.has(s.b)) {
      const ra = find(s.a);
      const rb = find(s.b);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const clusters = new Map<number, GNode[]>();
  for (const id of signalizedNodes) {
    const r = find(id);
    const l = clusters.get(r) ?? [];
    l.push(nodes.get(id)!);
    clusters.set(r, l);
  }

  const controllers: SignalController[] = [];
  const heads: SignalHeadObj[] = [];
  const stopLines: StopLine[] = [];

  const laneIdsOf = (seg: Segment, dir: 1 | -1) => (dir === 1 ? seg.lanesF : seg.lanesB);

  /** Haltepunkt auf den Spuren eines Segments eintragen und Signalkopf + Haltelinie erzeugen */
  const placeStop = (pend: Pending, ctrl: number, grp: number) => {
    const ids = laneIdsOf(pend.seg, pend.dir);
    if (!ids.length) return;
    const seg = pend.seg;
    // Position entlang der gekürzten Mittellinie in Fahrtrichtung
    let sTrim = pend.sAlong - seg.trimA;
    const trimmedLen = seg.len - seg.trimA - seg.trimB;
    sTrim = Math.min(Math.max(sTrim, 0), trimmedLen);
    const sTravel = pend.dir === 1 ? sTrim : trimmedLen - sTrim;
    for (const id of ids) {
      const ln = lanes[id];
      const s = Math.min(ln.len, Math.max(0, (sTravel / Math.max(trimmedLen, 0.01)) * ln.len));
      if (!ln.stops.some((x) => Math.abs(x.s - s) < 2 && x.ctrl === ctrl)) ln.stops.push({ s, ctrl, grp });
    }
    const first = lanes[ids[0]];
    const last = lanes[ids[ids.length - 1]];
    const s0 = Math.min(first.len, (sTravel / Math.max(trimmedLen, 0.01)) * first.len);
    const s1 = Math.min(last.len, (sTravel / Math.max(trimmedLen, 0.01)) * last.len);
    const a = pointAt(first.pts, s0);
    const b = pointAt(last.pts, s1);
    const nl = leftNormal(a.d);
    const L: Pt = [a.p[0] + nl[0] * first.w * 0.5, a.p[1] + nl[1] * first.w * 0.5];
    const R: Pt = [b.p[0] - nl[0] * last.w * 0.5, b.p[1] - nl[1] * last.w * 0.5];
    stopLines.push({ pts: [L, R], layer: seg.layer });
    heads.push({ id: heads.length, ctrl, grp, p: [R[0] - nl[0] * 0.8, R[1] - nl[1] * 0.8], hdg: angleOf(a.d), w: dist(L, R) });
  };

  const hash = (n: number) => {
    let h = n * 2654435761;
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
  };

  for (const members of clusters.values()) {
    const memberIds = new Set(members.map((m) => m.id));
    const ctrlId = controllers.length;
    // Zufahrten in die Anlage
    const aps: Array<{ ap: Approach; external: boolean; explicit: Pending[] }> = [];
    for (const g of members) {
      for (const ap of approachesInto(g, lanes)) {
        const other = ap.end.atA ? ap.end.seg.b : ap.end.seg.a;
        const internal = memberIds.has(other) && ap.end.seg.len < CLUSTER_LINK;
        const explicit = approachStops.get(ap.end) ?? [];
        if (internal && !explicit.length) {
          for (const id of ap.lanes) lanes[id].ctrl = 'yield';
          continue;
        }
        aps.push({ ap, external: !internal, explicit });
      }
    }
    if (!aps.length) continue;
    // Hauptachse: wichtigste Zufahrt
    let main = aps[0];
    for (const a of aps) if (a.ap.end.seg.rank > main.ap.end.seg.rank || (a.ap.end.seg.rank === main.ap.end.seg.rank && a.ap.lanes.length > main.ap.lanes.length)) main = a;
    const axis = main.ap.heading;
    const groups = new Set<number>();
    for (const a of aps) {
      const diff = Math.abs(normAngle(2 * (a.ap.heading - axis))) / 2;
      const grp = diff < Math.PI / 4 ? 0 : 1;
      groups.add(grp);
      for (const id of a.ap.lanes) {
        lanes[id].ctrl = 'signal';
        lanes[id].ctrlId = ctrlId;
        lanes[id].grp = grp;
      }
      if (a.explicit.length) for (const p of a.explicit) placeStop(p, ctrlId, grp);
      else {
        const seg = a.ap.end.seg;
        const dir: 1 | -1 = a.ap.end.atA ? -1 : 1;
        placeStop({ seg, dir, sAlong: dir === 1 ? seg.len - seg.trimB : seg.trimA }, ctrlId, grp);
      }
    }
    const mainRank = main.ap.end.seg.rank;
    const phases: SignalPhase[] = groups.size > 1
      ? [
          { green: [0], g: mainRank >= 6 ? 30 : 22, y: 3, r: 2 },
          { green: [1], g: mainRank >= 6 ? 18 : 16, y: 3, r: 2 },
        ]
      : [
          { green: [...groups], g: 26, y: 3, r: 2 },
          { green: [], g: 12, y: 0, r: 2 },
        ];
    const c = members.reduce<Pt>((acc, m) => [acc[0] + m.p[0] / members.length, acc[1] + m.p[1] / members.length], [0, 0]);
    const cycle = phases.reduce((t, p) => t + p.g + p.y + p.r, 0);
    controllers.push({ id: ctrlId, x: dm(c[0]), y: dm(c[1]), phases, offset: hash(ctrlId + 17) % cycle, k: 'junction' });
  }

  // Fußgängerampeln auf freier Strecke
  for (const cr of crossings) {
    const ctrlId = controllers.length;
    for (const p of cr.stops) placeStop(p, ctrlId, 0);
    const phases: SignalPhase[] = [
      { green: [0], g: 30, y: 3, r: 2 },
      { green: [], g: 12, y: 0, r: 2 },
    ];
    controllers.push({ id: ctrlId, x: dm(cr.p[0]), y: dm(cr.p[1]), phases, offset: hash(ctrlId + 91) % 47, k: 'crossing' });
  }

  // 3) Kreuzungen ohne Ampel
  let rbl = 0;
  let prio = 0;
  for (const g of nodes.values()) {
    if (signalizedNodes.has(g.id)) continue;
    const aps = approachesInto(g, lanes);
    if (g.ends.length === 1) {
      for (const ap of aps) for (const id of ap.lanes) lanes[id].ctrl = 'end';
      continue;
    }
    if (g.ends.length === 2) continue; // 'none'
    assignPriority(g, aps, lanes, ex, stopLines);
    if (aps.some((a) => lanes[a.lanes[0]].ctrl === 'rbl')) rbl++;
    else prio++;
  }

  log(`  ${controllers.filter((c) => c.k === 'junction').length} Ampelanlagen an Kreuzungen, ${crossings.length} Fußgängerampeln, ${heads.length} Signalköpfe`);
  log(`  ${prio.toLocaleString('de')} Kreuzungen mit Vorfahrtsregel, ${rbl.toLocaleString('de')} mit rechts vor links`);
  return { controllers, heads, stopLines };
}

function assignPriority(g: GNode, aps: Approach[], lanes: LaneObj[], ex: Extract, stopLines: StopLine[]): void {
  const set = (ap: Approach, c: LaneObj['ctrl']) => {
    for (const id of ap.lanes) lanes[id].ctrl = c;
  };
  const ends = g.ends;

  // Kreisverkehr: im Kreis Vorfahrt, Einfahrt wartet
  if (ends.some((e) => e.seg.roundabout)) {
    for (const ap of aps) set(ap, ap.end.seg.roundabout ? 'priority' : 'yield');
    return;
  }
  const nodeTags = ex.controlNodes.get(g.id)?.tags;
  if (nodeTags?.highway === 'mini_roundabout') {
    for (const ap of aps) set(ap, 'yield');
    return;
  }

  // Hauptstraße bestimmen: wichtigstes Ende + am geradesten fortsetzendes zweitwichtigstes Ende
  const nonService = ends.filter((e) => e.seg.cls !== 'service');
  const ranks = nonService.map((e) => e.seg.rank);
  const maxR = ranks.length ? Math.max(...ranks) : 0;
  const minR = ranks.length ? Math.min(...ranks) : 0;
  let mainEnds = new Set<SegEnd>();
  const allMinor = maxR <= 2.01 && maxR === minR; // nur Wohn-/Spielstraßen gleicher Klasse
  if (!nonService.length || allMinor) {
    for (const ap of aps) set(ap, ap.end.seg.cls === 'service' && nonService.length ? 'yield' : 'rbl');
  } else {
    const top = ends.filter((e) => e.seg.rank === maxR);
    let best: [SegEnd, SegEnd] | null = null;
    let bestScore = -Infinity;
    const cands = top.length >= 2 ? top : ends;
    for (const a of top) {
      for (const b of cands) {
        if (a === b) continue;
        const straightness = Math.abs(normAngle(a.angle - b.angle)); // PI = gerade
        const score = b.seg.rank * 10 + straightness;
        if (score > bestScore) {
          bestScore = score;
          best = [a, b];
        }
      }
    }
    if (best) mainEnds = new Set(best);
    for (const ap of aps) set(ap, mainEnds.has(ap.end) ? 'priority' : 'yield');
  }

  // Ausdrückliche Stopp-/Vorfahrt-gewähren-Schilder auf den Zufahrten (bis 30 m vor der Kreuzung)
  for (const ap of aps) {
    if (mainEnds.has(ap.end)) continue;
    const seg = ap.end.seg;
    const ids = ap.end.atA ? seg.nodeIds : seg.nodeIds.slice().reverse();
    const pts = ap.end.atA ? seg.pts : seg.pts.slice().reverse();
    for (let i = 0; i < ids.length; i++) {
      if (i > 0 && dist(pts[i], pts[0]) > 30) break;
      const t = ex.controlNodes.get(ids[i])?.tags;
      if (!t) continue;
      if (t.highway === 'stop') set(ap, 'stop');
      else if (t.highway === 'give_way') set(ap, 'yield');
      else continue;
      if (t.highway === 'stop') {
        const first = lanes[ap.lanes[0]];
        const last = lanes[ap.lanes[ap.lanes.length - 1]];
        const a = first.pts[first.pts.length - 1];
        const b = last.pts[last.pts.length - 1];
        const d = pointAt(first.pts, first.len).d;
        const nl = leftNormal(d);
        stopLines.push({
          pts: [
            [a[0] + nl[0] * first.w * 0.5, a[1] + nl[1] * first.w * 0.5],
            [b[0] - nl[0] * last.w * 0.5, b[1] - nl[1] * last.w * 0.5],
          ],
          layer: seg.layer,
        });
      }
      break;
    }
  }
}
