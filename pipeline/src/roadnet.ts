/**
 * Straßengraph: zerlegt OSM-Wege an Kreuzungen in Abschnitte (Segmente),
 * berechnet Spuren, Kreuzungsflächen und Spurverbinder.
 */
import type { LaneControl, RoadClass, Turn } from '@nrs/shared';
import {
  angleOf,
  cross,
  dist,
  leftNormal,
  norm,
  normAngle,
  offsetPolyline,
  pointAt,
  polylineLength,
  ringArea,
  slicePolyline,
  startDirection,
  sub,
  type Pt,
} from './geo.ts';
import type { Extract, RawRestriction, RawRoad } from './extract.ts';
import { laneSpec, laneWidth, layerOf, maxSpeed, oneway, RANK, sidewalks } from './tags.ts';

export interface Segment {
  id: number;
  road: RawRoad;
  a: number; // Graph-Knoten (OSM-Knoten-ID)
  b: number;
  nodeIds: number[];
  pts: Pt[];
  len: number;
  cls: RoadClass;
  rank: number;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  fwd: number; // Spuren a->b
  bwd: number; // Spuren b->a
  /** turn:lanes gelten nur am Ende des OSM-Wegs */
  fwdTurns?: string[];
  bwdTurns?: string[];
  w: number;
  vmax: number;
  leftW: number; // Breite links der Mittellinie (bezogen auf a->b)
  rightW: number;
  /** Gehwegbreiten links/rechts (a->b) */
  swL: number;
  swR: number;
  trimA: number;
  trimB: number;
  trimmed: Pt[];
  roundabout: boolean;
  name?: string;
  /** Spur-IDs: [richtung][index] */
  lanesF: number[];
  lanesB: number[];
}

/** Ein Segment-Ende an einem Knoten, Blickrichtung vom Knoten weg. */
export interface SegEnd {
  seg: Segment;
  atA: boolean;
  dir: Pt; // vom Knoten weg
  angle: number;
  /** Breiten links/rechts relativ zur Richtung vom Knoten weg */
  lw: number;
  rw: number;
  /** Gehwegbreiten links/rechts relativ zur Richtung vom Knoten weg */
  slw: number;
  srw: number;
}

export interface GNode {
  id: number;
  p: Pt;
  ends: SegEnd[];
  idx: number;
}

export interface LaneObj {
  id: number;
  seg: Segment;
  dir: 1 | -1;
  idx: number;
  n: number;
  w: number;
  pts: Pt[];
  len: number;
  ctrl: LaneControl;
  ctrlId?: number;
  grp?: number;
  stops: Array<{ s: number; ctrl: number; grp: number }>;
  out: number[];
  turns?: string;
}

export interface ConnectorObj {
  id: number;
  node: number;
  from: number;
  to: number;
  turn: Turn;
  pts: Pt[];
  len: number;
}

export interface JunctionSurface {
  id: number;
  node: GNode;
  ring: Pt[];
  /** Umriss inklusive Gehwegen */
  swRing: Pt[];
  /** Bordsteinkanten an den Ecken (Polylinien) */
  kerbs: Pt[][];
  cls: RoadClass;
  layer: number;
}

export interface RoadNet {
  segments: Segment[];
  nodes: Map<number, GNode>;
  lanes: LaneObj[];
  connectors: ConnectorObj[];
  junctions: JunctionSurface[];
}

/** Ausfahrt (Spurgruppe, die eine Kreuzung verlässt) bzw. Zufahrt */
export interface Approach {
  end: SegEnd;
  lanes: number[]; // Spur-IDs links->rechts in Fahrtrichtung
  heading: number; // Fahrtrichtung in rad
}

export function approachesInto(node: GNode, lanes: LaneObj[]): Approach[] {
  const res: Approach[] = [];
  for (const e of node.ends) {
    // Zufahrt: Verkehr fährt auf den Knoten zu. Ende bei a => Rückwärtsspuren, bei b => Vorwärtsspuren
    const ids = e.atA ? e.seg.lanesB : e.seg.lanesF;
    if (!ids.length) continue;
    res.push({ end: e, lanes: ids, heading: angleOf([-e.dir[0], -e.dir[1]]) });
  }
  return res;
}

export function exitsFrom(node: GNode): Approach[] {
  const res: Approach[] = [];
  for (const e of node.ends) {
    const ids = e.atA ? e.seg.lanesF : e.seg.lanesB;
    if (!ids.length) continue;
    res.push({ end: e, lanes: ids, heading: e.angle });
  }
  return res;
}

export function buildRoadNet(ex: Extract, log: (s: string) => void): RoadNet {
  // 1) Knotennutzung zählen -> Teilungspunkte
  const use = new Map<number, number>();
  for (const r of ex.roads) {
    for (let i = 0; i < r.nodes.length; i++) {
      const id = r.nodes[i];
      const isEnd = i === 0 || i === r.nodes.length - 1;
      use.set(id, (use.get(id) ?? 0) + (isEnd ? 1 : 2) / 1);
    }
  }
  const isSplit = (id: number, i: number, n: number) => i === 0 || i === n - 1 || (use.get(id) ?? 0) > 2;

  // 2) Segmente bilden
  const segments: Segment[] = [];
  for (const r of ex.roads) {
    const ow = oneway(r.tags);
    const spec = laneSpec(r.tags, r.cls, ow);
    const total = spec.fwd + spec.bwd;
    const w = laneWidth(r.tags, r.cls, total);
    const vmax = maxSpeed(r.tags, r.cls);
    const layer = layerOf(r.tags);
    const roundabout = r.tags.junction === 'roundabout' || r.tags.junction === 'circular';
    const [swL, swR] = sidewalks(r.tags, r.cls);
    const prioBoost = r.tags.priority_road === 'designated' || r.tags.priority_road === 'yes_unposted' ? 0.5 : 0;
    let start = 0;
    const n = r.nodes.length;
    const pieces: Array<[number, number]> = [];
    for (let i = 1; i < n; i++) {
      if (isSplit(r.nodes[i], i, n)) {
        pieces.push([start, i]);
        start = i;
      }
    }
    pieces.forEach(([s, e], pi) => {
      const pts = r.pts.slice(s, e + 1);
      const l = polylineLength(pts);
      if (l < 0.05) return;
      const oneDir = spec.fwd === 0 || spec.bwd === 0;
      const width = total * w;
      const seg: Segment = {
        id: segments.length,
        road: r,
        a: r.nodes[s],
        b: r.nodes[e],
        nodeIds: r.nodes.slice(s, e + 1),
        pts,
        len: l,
        cls: r.cls,
        rank: RANK[r.cls] + prioBoost,
        layer,
        bridge: !!r.tags.bridge && r.tags.bridge !== 'no',
        tunnel: !!r.tags.tunnel && r.tags.tunnel !== 'no',
        fwd: spec.fwd,
        bwd: spec.bwd,
        fwdTurns: pi === pieces.length - 1 ? spec.fwdTurns : undefined,
        bwdTurns: pi === 0 ? spec.bwdTurns : undefined,
        w,
        vmax,
        leftW: oneDir ? width / 2 : spec.bwd * w,
        rightW: oneDir ? width / 2 : spec.fwd * w,
        swL,
        swR,
        trimA: 0,
        trimB: 0,
        trimmed: pts,
        roundabout,
        name: r.tags.name ?? r.tags.ref,
        lanesF: [],
        lanesB: [],
      };
      segments.push(seg);
    });
  }

  // 3) Knoten mit Segment-Enden
  const nodes = new Map<number, GNode>();
  const getNode = (id: number, p: Pt) => {
    let g = nodes.get(id);
    if (!g) {
      g = { id, p, ends: [], idx: nodes.size };
      nodes.set(id, g);
    }
    return g;
  };
  for (const s of segments) {
    for (const atA of [true, false]) {
      const outward = atA ? s.pts : s.pts.slice().reverse();
      const dir = startDirection(outward, 6);
      const g = getNode(atA ? s.a : s.b, outward[0]);
      g.ends.push({
        seg: s,
        atA,
        dir,
        angle: angleOf(dir),
        lw: atA ? s.leftW : s.rightW,
        rw: atA ? s.rightW : s.leftW,
        slw: atA ? s.swL : s.swR,
        srw: atA ? s.swR : s.swL,
      });
    }
  }
  for (const g of nodes.values()) g.ends.sort((x, y) => x.angle - y.angle);
  log(`  ${segments.length.toLocaleString('de')} Abschnitte, ${nodes.size.toLocaleString('de')} Knoten`);

  // 4) Kreuzungen freischneiden
  for (const g of nodes.values()) computeTrims(g);
  for (const s of segments) {
    const maxSum = Math.max(0, s.len - 0.5);
    if (s.trimA + s.trimB > maxSum) {
      const f = maxSum / (s.trimA + s.trimB);
      s.trimA *= f;
      s.trimB *= f;
    }
    s.trimmed = s.trimA > 0 || s.trimB > 0 ? slicePolyline(s.pts, s.trimA, s.len - s.trimB) : s.pts;
  }

  // 5) Spuren
  const lanes: LaneObj[] = [];
  for (const s of segments) {
    const center = s.trimmed;
    const oneDir = s.fwd === 0 || s.bwd === 0;
    for (const dir of [1, -1] as const) {
      const n = dir === 1 ? s.fwd : s.bwd;
      const turns = dir === 1 ? s.fwdTurns : s.bwdTurns;
      const ids: number[] = [];
      for (let i = 0; i < n; i++) {
        // seitlicher Versatz bezogen auf a->b, positiv = links
        const offTravel = oneDir ? (n * s.w) / 2 - (i + 0.5) * s.w : -(i + 0.5) * s.w; // in Fahrtrichtung (links +)
        const offAB = dir === 1 ? offTravel : -offTravel;
        let pts = offsetPolyline(center, offAB);
        if (dir === -1) pts = pts.reverse();
        const lane: LaneObj = {
          id: lanes.length,
          seg: s,
          dir,
          idx: i,
          n,
          w: s.w,
          pts,
          len: polylineLength(pts),
          ctrl: 'none',
          stops: [],
          out: [],
          turns: turns?.[i],
        };
        lanes.push(lane);
        ids.push(lane.id);
      }
      if (dir === 1) s.lanesF = ids;
      else s.lanesB = ids;
    }
  }

  // 6) Kreuzungsflächen
  const junctions: JunctionSurface[] = [];
  for (const g of nodes.values()) {
    if (g.ends.length < 2) continue;
    const ring: Pt[] = [];
    const swRing: Pt[] = [];
    const kerbs: Pt[][] = [];
    let cls: RoadClass = g.ends[0].seg.cls;
    let best = -1;
    let layer = 0;
    // Eckpunkte je Ende: rechts/links an der Schnittkante, für Fahrbahn und Gehweg
    const corners = g.ends.map((e) => {
      const outward = e.atA ? e.seg.trimmed : e.seg.trimmed.slice().reverse();
      const p = outward[0];
      const d = startDirection(outward, 3);
      const ln = leftNormal(d);
      return {
        e,
        R: [p[0] - ln[0] * e.rw, p[1] - ln[1] * e.rw] as Pt,
        L: [p[0] + ln[0] * e.lw, p[1] + ln[1] * e.lw] as Pt,
        sR: [p[0] - ln[0] * (e.rw + e.srw), p[1] - ln[1] * (e.rw + e.srw)] as Pt,
        sL: [p[0] + ln[0] * (e.lw + e.slw), p[1] + ln[1] * (e.lw + e.slw)] as Pt,
      };
    });
    const nE = corners.length;
    for (let i = 0; i < nE; i++) {
      const c = corners[i];
      const nx = corners[(i + 1) % nE];
      ring.push(c.R, c.L);
      swRing.push(c.sR, c.sL);
      {
        // abgerundete Ecke zwischen linkem Rand von c und rechtem Rand des nächsten Endes
        const curve = cornerCurve(g.p, c.e, nx.e, c.L, nx.R, c.e.lw, nx.e.rw);
        ring.push(...curve);
        kerbs.push([c.L, ...curve, nx.R]);
        swRing.push(...cornerCurve(g.p, c.e, nx.e, c.sL, nx.sR, c.e.lw + c.e.slw, nx.e.rw + nx.e.srw));
      }
      const e = c.e;
      if (e.seg.rank > best) {
        best = e.seg.rank;
        cls = e.seg.cls;
      }
      layer = Math.max(layer, e.seg.layer);
    }
    if (Math.abs(ringArea(ring)) < 0.5) continue;
    junctions.push({ id: 10_000_000 + g.idx, node: g, ring, swRing, kerbs, cls, layer: g.ends.every((e) => e.seg.layer < 0) ? Math.max(...g.ends.map((e) => e.seg.layer)) : layer });
  }

  // 7) Verbinder
  const restr = new Map<string, RawRestriction[]>();
  for (const r of ex.restrictions) {
    const k = `${r.from}:${r.via}`;
    const l = restr.get(k) ?? [];
    l.push(r);
    restr.set(k, l);
  }
  const connectors: ConnectorObj[] = [];
  for (const g of nodes.values()) buildConnectors(g, lanes, connectors, restr);
  log(`  ${lanes.length.toLocaleString('de')} Spuren, ${connectors.length.toLocaleString('de')} Verbinder, ${junctions.length.toLocaleString('de')} Kreuzungsflächen`);

  return { segments, nodes, lanes, connectors, junctions };
}

function computeTrims(g: GNode): void {
  const ends = g.ends;
  const deg = ends.length;
  if (deg < 2) return;
  const trims = new Array<number>(deg).fill(0);

  if (deg === 2) {
    const [e1, e2] = ends;
    const straight = Math.abs(normAngle(e1.angle - e2.angle)) > (160 * Math.PI) / 180;
    const sameShape = Math.abs(e1.lw - e2.rw) < 0.01 && Math.abs(e1.rw - e2.lw) < 0.01;
    const sameLanes = lanesInto(e1) === lanesOutOf(e2) && lanesInto(e2) === lanesOutOf(e1);
    if (straight && sameShape && sameLanes) return; // nahtloser Übergang
  }

  for (let i = 0; i < deg; i++) {
    const s = ends[i];
    const t = ends[(i + 1) % deg];
    if (deg === 2 && i === 1) break;
    // linke Kante von s schneidet rechte Kante von t (t liegt gegen den Uhrzeigersinn neben s)
    const Ls = leftNormal(s.dir);
    const Rt: Pt = [-leftNormal(t.dir)[0], -leftNormal(t.dir)[1]];
    const rhs: Pt = [Rt[0] * t.rw - Ls[0] * s.lw, Rt[1] * t.rw - Ls[1] * s.lw];
    // s.dir*u - t.dir*v = rhs
    const det = cross(s.dir, [-t.dir[0], -t.dir[1]]);
    const gap = normAngle(t.angle - s.angle + (i === deg - 1 ? 0 : 0));
    if (Math.abs(det) < 0.17) {
      // nahezu parallel: gegenüber (gerade weiter) -> kein Schnitt nötig; gleiche Richtung -> großzügig schneiden
      if (Math.abs(gap) < Math.PI / 2) {
        const need = (s.lw + t.rw) * 2.5;
        trims[i] = Math.max(trims[i], need);
        trims[(i + 1) % deg] = Math.max(trims[(i + 1) % deg], need);
      }
      continue;
    }
    const u = cross(rhs, [-t.dir[0], -t.dir[1]]) / det;
    const v = cross(s.dir, rhs) / det;
    if (u > 0 && v > 0) {
      trims[i] = Math.max(trims[i], u);
      trims[(i + 1) % deg] = Math.max(trims[(i + 1) % deg], v);
    }
  }
  const margin = deg >= 3 ? 1.5 : 0.8;
  const minTrim = deg >= 3 ? 2.5 : 1.0;
  for (let i = 0; i < deg; i++) {
    const t = Math.min(35, Math.max(minTrim, trims[i] + margin));
    const e = ends[i];
    if (e.atA) e.seg.trimA = Math.max(e.seg.trimA, t);
    else e.seg.trimB = Math.max(e.seg.trimB, t);
  }
}

/**
 * Abgerundete Ecke zwischen zwei benachbarten Straßenenden: quadratische Kurve von A nach B,
 * Kontrollpunkt = Schnittpunkt der beiden Fahrbahnränder. Liefert die Zwischenpunkte.
 */
function cornerCurve(node: Pt, s: SegEnd, t: SegEnd, A: Pt, B: Pt, ws: number, wt: number): Pt[] {
  const Ls = leftNormal(s.dir);
  const Rt: Pt = [t.dir[1], -t.dir[0]];
  const rhs: Pt = [Rt[0] * wt - Ls[0] * ws, Rt[1] * wt - Ls[1] * ws];
  const det = cross(s.dir, [-t.dir[0], -t.dir[1]]);
  if (Math.abs(det) < 0.2) return [];
  const u = cross(rhs, [-t.dir[0], -t.dir[1]]) / det;
  const v = cross(s.dir, rhs) / det;
  if (u <= 0 || v <= 0) return [];
  const C: Pt = [node[0] + Ls[0] * ws + s.dir[0] * u, node[1] + Ls[1] * ws + s.dir[1] * u];
  // Kontrollpunkt darf nicht weiter weg liegen als die Schnittkanten (sonst Ausreißer)
  if (dist(C, A) > dist(A, B) * 1.5 + 2 || dist(C, B) > dist(A, B) * 1.5 + 2) return [];
  const out: Pt[] = [];
  const n = 6;
  for (let k = 1; k < n; k++) {
    const q = k / n;
    const a = (1 - q) * (1 - q);
    const b = 2 * (1 - q) * q;
    const c = q * q;
    out.push([a * A[0] + b * C[0] + c * B[0], a * A[1] + b * C[1] + c * B[1]]);
  }
  return out;
}

function lanesInto(e: SegEnd): number {
  return e.atA ? e.seg.bwd : e.seg.fwd;
}
function lanesOutOf(e: SegEnd): number {
  return e.atA ? e.seg.fwd : e.seg.bwd;
}

type TurnClass = 'through' | 'left' | 'right' | 'uturn';

function classify(delta: number): TurnClass {
  const d = (delta * 180) / Math.PI;
  if (Math.abs(d) <= 40) return 'through';
  if (d > 40 && d <= 155) return 'left';
  if (d < -40 && d >= -155) return 'right';
  return 'uturn';
}

function turnsAllow(spec: string | undefined, cls: TurnClass, delta: number): boolean {
  if (!spec) return true;
  const parts = spec.split(';');
  for (const p of parts) {
    if (cls === 'left' && /left/.test(p) && !/merge/.test(p)) return true;
    if (cls === 'right' && /right/.test(p) && !/merge/.test(p)) return true;
    if (cls === 'uturn' && (p === 'reverse' || /left/.test(p))) return true;
    if (cls === 'through') {
      if (p === 'through' || p === 'none' || /merge/.test(p)) return true;
      if (p === 'slight_left' && delta > 0) return true;
      if (p === 'slight_right' && delta < 0) return true;
    }
  }
  return false;
}

function buildConnectors(g: GNode, lanes: LaneObj[], out: ConnectorObj[], restr: Map<string, RawRestriction[]>): void {
  const ins = approachesInto(g, lanes);
  const exits = exitsFrom(g);
  if (!ins.length) return;
  const deg = g.ends.length;

  for (const ap of ins) {
    const fromWay = ap.end.seg.road.id;
    const rules = restr.get(`${fromWay}:${g.id}`) ?? [];
    const only = rules.find((r) => r.type.startsWith('only_'));
    const options: Array<{ ex: Approach; cls: TurnClass; delta: number }> = [];
    for (const ex of exits) {
      const sameEnd = ex.end === ap.end;
      const delta = normAngle(ex.heading - ap.heading);
      let cls = sameEnd ? 'uturn' : classify(delta);
      // Abbiegeverbote
      const toWay = ex.end.seg.road.id;
      if (only && only.to !== toWay) continue;
      if (rules.some((r) => r.type.startsWith('no_') && r.to === toWay)) continue;
      if (cls === 'uturn' && !sameEnd && deg > 2) cls = delta > 0 ? 'left' : 'right';
      options.push({ ex, cls: cls as TurnClass, delta });
    }
    // Wenden nur, wenn es sonst keinen Weg gibt (Sackgasse)
    let usable = options.filter((o) => o.cls !== 'uturn' || o.ex.end !== ap.end);
    if (!usable.length) usable = options;
    if (!usable.length) continue;

    const nIn = ap.lanes.length;
    const inLanes = ap.lanes.map((id) => lanes[id]);
    // An Grad-2-Knoten (Wegteilung vor der eigentlichen Kreuzung) gelten die Pfeile noch nicht
    const hasTurnLanes = deg >= 3 && inLanes.some((l) => l.turns);
    const used = new Set<number>();
    const classes = new Set(usable.map((o) => o.cls));

    // Standardbelegung ohne turn:lanes
    const defaultAllow = (i: number, cls: TurnClass): boolean => {
      if (nIn === 1) return true;
      if (cls === 'uturn') return i === 0;
      const hasThrough = classes.has('through');
      if (cls === 'through') {
        if (!classes.has('left') && i === 0) return true;
        if (!classes.has('right') && i === nIn - 1) return true;
        return true;
      }
      if (!hasThrough) {
        // T-Kreuzung aus dem Stamm: linke Hälfte links, rechte Hälfte rechts
        const leftCount = Math.ceil(nIn / 2);
        return cls === 'left' ? i < leftCount : i >= nIn - leftCount;
      }
      if (cls === 'left') return i === 0;
      if (cls === 'right') return i === nIn - 1;
      return false;
    };

    for (const o of usable) {
      let L: number[] = [];
      for (let i = 0; i < nIn; i++) {
        const ok = hasTurnLanes ? turnsAllow(inLanes[i].turns, o.cls, o.delta) : defaultAllow(i, o.cls);
        if (ok) L.push(i);
      }
      if (!L.length) {
        // turn:lanes passt nicht zur Geometrie -> äußerste passende Spur nehmen
        L = [o.cls === 'left' || o.cls === 'uturn' ? 0 : o.cls === 'right' ? nIn - 1 : Math.floor(nIn / 2)];
      }
      const E = o.ex.lanes;
      const m = E.length;
      const k = L.length;
      const pairs = new Set<string>();
      const addPair = (li: number, ej: number) => pairs.add(`${L[li]}:${ej}`);
      if (o.cls === 'left' || o.cls === 'uturn') for (let i = 0; i < k; i++) addPair(i, Math.min(i, m - 1));
      else if (o.cls === 'right') for (let i = 0; i < k; i++) addPair(k - 1 - i, Math.max(m - 1 - i, 0));
      else if (k === m) for (let i = 0; i < k; i++) addPair(i, i);
      else {
        for (let j = 0; j < m; j++) addPair(m === 1 ? 0 : Math.round((j * (k - 1)) / (m - 1)), j);
        for (let i = 0; i < k; i++) addPair(i, k === 1 ? 0 : Math.round((i * (m - 1)) / (k - 1)));
        if (m === 1) for (let i = 0; i < k; i++) addPair(i, 0);
      }
      for (const pk of pairs) {
        const [li, ej] = pk.split(':').map(Number);
        used.add(li);
        addConnector(g, lanes[ap.lanes[li]], lanes[E[ej]], o.cls === 'through' && k > m ? 'merge' : o.cls, lanes, out);
      }
    }

    // Rückfall: Spuren ohne Ausfahrt (Pfeile passen nicht zur Geometrie / Abbiegeverbot)
    // bekommen die Ausfahrt, die zu ihrer Lage passt: links -> am weitesten links usw.
    for (let i = 0; i < nIn; i++) {
      if (used.has(i)) continue;
      const pos = nIn === 1 ? 0.5 : i / (nIn - 1); // 0 = links, 1 = rechts
      let best = usable[0];
      let bestScore = Infinity;
      for (const o of usable) {
        if (o.cls === 'uturn' && usable.length > 1) continue;
        // gewünschter Winkel: links +90°, Mitte 0°, rechts -90°
        const want = (0.5 - pos) * Math.PI;
        const score = Math.abs(o.delta - want * (usable.length > 1 ? 0.6 : 0));
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      }
      const E = best.ex.lanes;
      const ej = Math.min(E.length - 1, Math.max(0, Math.round(pos * (E.length - 1))));
      addConnector(g, lanes[ap.lanes[i]], lanes[E[ej]], best.cls, lanes, out);
    }
  }
}

function addConnector(g: GNode, from: LaneObj, to: LaneObj, turn: Turn, lanes: LaneObj[], out: ConnectorObj[]): void {
  if (from.out.some((cid) => out[cid].to === to.id)) return;
  const pts = connectorCurve(from, to, turn === 'uturn');
  const c: ConnectorObj = { id: out.length, node: g.idx, from: from.id, to: to.id, turn, pts, len: polylineLength(pts) };
  out.push(c);
  from.out.push(c.id);
  void lanes;
}

function connectorCurve(from: LaneObj, to: LaneObj, uturn: boolean): Pt[] {
  const p0 = from.pts[from.pts.length - 1];
  const p3 = to.pts[0];
  const d = dist(p0, p3);
  if (d < 0.05) return [p0, [p3[0] + 0.01, p3[1]]];
  const h0 = norm(sub(p0, pointAt(from.pts, Math.max(0, from.len - 3)).p));
  const h3 = norm(sub(pointAt(to.pts, Math.min(3, to.len)).p, p3));
  const L = uturn ? Math.max(4, d * 1.1) : d * 0.4;
  const p1: Pt = [p0[0] + h0[0] * L, p0[1] + h0[1] * L];
  const p2: Pt = [p3[0] - h3[0] * L, p3[1] - h3[1] * L];
  const n = Math.min(14, Math.max(2, Math.ceil(d / 1.5)));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t * t;
    const e = t ** 3;
    pts.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
  }
  return pts;
}
