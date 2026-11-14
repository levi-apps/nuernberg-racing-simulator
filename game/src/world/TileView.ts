/**
 * Darstellung einer Kachel: realistische Draufsicht (Asphalt, Gehwege, Markierungen, Dächer,
 * Schatten, Bäume, Ampeln) plus Debug-Ebenen (Spuren, Verbinder, Regelung).
 */
import * as THREE from 'three';
import type { Building, LaneControl, Tile } from '@nrs/shared';
import { FillBuilder, LineBuilder, MarkerBuilder, toM } from './geometry.ts';
import { Pat, SHADOW_DIR, SHADOW_MAT, surfaceMat, TO_SUN } from './materials.ts';
import { buildTile3D } from './Tile3D.ts';
import { setLit } from './litMaterials.ts';
import {
  AREA_COLORS,
  AREA_PATTERN,
  BUILDING_EDGE_DARK,
  CONTROL_COLORS,
  KERB,
  LANE_COLOR_BWD,
  LANE_COLOR_FWD,
  LINE_STYLE,
  MARKING_WHITE,
  MARKING_YELLOW,
  PARAPET,
  RAIL_STEEL,
  ROAD_COLORS,
  ROAD_PATTERN,
  ROOF_COPPER,
  ROOF_DARK,
  ROOF_FLAT,
  ROOF_TILE,
  SIDEWALK,
  SIGNAL_COLORS,
  TREE_GREENS,
  TURN_COLORS,
} from './style.ts';

export type LayerName =
  | 'areas'
  | 'roads'
  | 'markings'
  | 'paths'
  | 'rail'
  | 'buildings'
  | 'trees'
  | 'lanes'
  | 'connectors'
  | 'controls'
  | 'signals'
  | 'signalStops'
  | 'grid';

/** Zeichenreihenfolge (2D, ohne Tiefentest) */
export const ORDER: Record<string, number> = {
  areas: 0,
  water: 0.3,
  tunnels: 1,
  paths: 1.5,
  sidewalks: 2,
  roads: 3,
  kerbs: 3.2,
  rail: 3.5,
  markings: 4,
  shadows: 6,
  bridgeSidewalks: 6.6,
  bridges: 7,
  bridgeKerbs: 7.2,
  bridgeMarkings: 7.5,
  barriers: 8,
  buildings: 10,
  buildingEdges: 10.5,
  trees: 11,
  signals: 12,
  signalGlow: 12.5,
  lanes: 13,
  connectors: 14,
  controls: 15,
  signalStops: 15.5,
  grid: 16,
  car: 20,
};

const basic = (opacity = 1, extra: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity, side: THREE.DoubleSide, ...extra });
const lineMat = (opacity = 1) => new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity });

export const MATERIALS = {
  fill: basic(),
  marking: basic(0.9),
  marker: basic(),
  glow: basic(0.5, { blending: THREE.AdditiveBlending }),
  line: lineMat(),
  lineSoft: lineMat(0.55),
};

/** Three.js-Render-Ebenen */
export const RL_MAIN = 1;
export const RL_MINI = 2;
const MINIMAP_LAYERS = new Set<LayerName>(['areas', 'roads', 'buildings', 'rail']);

/** Signalfarben der Lampen (kräftiger als in der Legende) */
const LAMP = { green: 0x3df08a, yellow: 0xffc21a, red: 0xff3b2f };
export type SignalState = keyof typeof LAMP;
export const lampColor = (s: SignalState): number => LAMP[s];

export interface SignalSlot {
  ctrl: number;
  grp: number;
  slot: { start: number; count: number };
}

/** Farbslots, die je Frame nach Ampelzustand umgefärbt werden */
export interface SignalGroup {
  attr: THREE.BufferAttribute;
  slots: SignalSlot[];
  /** Farbe je Zustand (Lampe, Schein oder Debug-Marker) */
  palette: Record<SignalState, number>;
}

export const hash = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
export const pick = <T>(arr: T[], n: number): T => arr[Math.floor(hash(n) * arr.length) % arr.length];
const tmpC = new THREE.Color();
export const shade = (c: number, f: number): number => tmpC.setHex(c).multiplyScalar(Math.max(0, f)).getHex();

export type Dim = '2d' | '3d';

export class TileView {
  group = new THREE.Group();
  layers = new Map<LayerName, THREE.Object3D[]>();
  signalGroups: SignalGroup[] = [];
  /** aktuelle Darstellung: Draufsicht oder 3D */
  dim: Dim = '2d';
  private built3d = false;
  /** Köpfe der Straßenlaternen (nach ensure3D) */
  streetLamps: Array<[number, number, number]> = [];
  private litOn = false;

  constructor(public tile: Tile) {
    this.build();
  }

  /** dim: Objekt nur in dieser Darstellung zeigen */
  private add(layer: LayerName, obj: THREE.Object3D, order: number, dim?: Dim) {
    obj.renderOrder = order;
    obj.frustumCulled = false;
    if (dim) obj.userData.dim = dim;
    if (layer === 'signals' || layer === 'signalStops' || layer === 'lanes' || layer === 'connectors' || layer === 'controls' || layer === 'grid') obj.userData.unlit = true;
    if (!MINIMAP_LAYERS.has(layer)) obj.layers.set(RL_MAIN);
    this.group.add(obj);
    const l = this.layers.get(layer) ?? [];
    l.push(obj);
    this.layers.set(layer, l);
  }

  private mesh(layer: LayerName, b: FillBuilder, mat: THREE.Material, order: number, dim?: Dim) {
    if (!b.empty) this.add(layer, new THREE.Mesh(b.build(), mat), order, dim);
  }

  /** 3D-Körper bei Bedarf erzeugen (erst beim ersten Wechsel in die 3D-Ansicht) */
  get has3D(): boolean {
    return this.built3d;
  }

  ensure3D(): boolean {
    if (this.built3d) return false;
    this.built3d = true;
    const t3 = buildTile3D(this.tile);
    for (const o of t3.objects) this.add(o.userData.layer as LayerName, o, o.renderOrder, '3d');
    this.streetLamps = t3.streetLamps;
    if (t3.lampAttr) this.signalGroups.push({ attr: t3.lampAttr, slots: t3.lampSlots, palette: LAMP });
    return true;
  }

  private build() {
    const t = this.tile;

    // ---------------------------------------------------------------- Flächen
    const areaB = new Map<Pat, FillBuilder>();
    const ab = (p: Pat) => {
      let b = areaB.get(p);
      if (!b) areaB.set(p, (b = new FillBuilder()));
      return b;
    };
    for (const a of t.areas) ab(AREA_PATTERN[a.k]).add(a.outer, a.holes, AREA_COLORS[a.k]);
    for (const [p, b] of areaB) this.mesh('areas', b, surfaceMat(p), p === Pat.Water ? ORDER.water : ORDER.areas);

    // ---------------------------------------------------------------- Straßen
    const shadows = new FillBuilder();
    const L = { sw: new FillBuilder(), kerb: new FillBuilder(), mark: new FillBuilder(), paint: new FillBuilder() };
    const B = { sw: new FillBuilder(), kerb: new FillBuilder(), mark: new FillBuilder(), paint: new FillBuilder() };
    const asphalt = new Map<string, FillBuilder>();
    const ap = (bridge: boolean, p: Pat) => {
      const k = `${bridge}:${p}`;
      let b = asphalt.get(k);
      if (!b) asphalt.set(k, (b = new FillBuilder()));
      return b;
    };
    const tunnels = new FillBuilder();
    // Gehwege und Fahrbahnen: Abschnitte zuerst, Kreuzungsflächen darüber
    const surfaces = t.surfaces.slice().sort((a, b) => (a.k === b.k ? 0 : a.k === 'seg' ? -1 : 1));
    for (const s of surfaces) {
      if (s.layer < 0) {
        tunnels.add(s.ring, undefined, 0x30333a);
        continue;
      }
      const bridge = s.layer > 0;
      const T = bridge ? B : L;
      if (s.sw) T.sw.add(s.sw, undefined, SIDEWALK);
      ap(bridge, ROAD_PATTERN[s.cls] ?? Pat.Asphalt).add(s.ring, undefined, ROAD_COLORS[s.cls]);
      if (s.kerbs && (s.sw || bridge)) for (const k of s.kerbs) T.kerb.ribbon(toM(k), bridge ? 0.5 : 0.24, bridge ? PARAPET : KERB);
      if (bridge) {
        // Schatten der Brücke auf den Boden
        const ring = toM(s.sw ?? s.ring).map(([x, y]) => [x + SHADOW_DIR[0] * 4, y + SHADOW_DIR[1] * 4] as [number, number]);
        shadows.addM(ring, 0);
      }
    }
    this.mesh('roads', tunnels, surfaceMat(Pat.Plain, 0.28), ORDER.tunnels);
    this.mesh('roads', L.sw, surfaceMat(Pat.Paving), ORDER.sidewalks);
    this.mesh('roads', B.sw, surfaceMat(Pat.Paving), ORDER.bridgeSidewalks);
    for (const [k, b] of asphalt) {
      const [bridge, p] = k.split(':');
      this.mesh('roads', b, surfaceMat(Number(p) as Pat), bridge === 'true' ? ORDER.bridges : ORDER.roads);
    }
    this.mesh('roads', L.kerb, surfaceMat(Pat.Plain), ORDER.kerbs);
    this.mesh('roads', B.kerb, surfaceMat(Pat.Plain), ORDER.bridgeKerbs);

    // Markierungen als Flächen in echter Breite
    for (const m of t.markings) {
      const T = m.layer > 0 ? B : L;
      const pts = toM(m.pts);
      if (m.k === 'dashed') T.mark.dashed(pts, 0.12, MARKING_WHITE, 3, 6);
      else if (m.k === 'stop') T.mark.ribbon(pts, 0.45, MARKING_WHITE);
      else if (m.k === 'edge') T.mark.ribbon(pts, 0.2, MARKING_WHITE);
      else T.mark.ribbon(pts, 0.12, MARKING_WHITE);
    }
    for (const p of t.paint ?? []) (p.layer > 0 ? B : L).paint.add(p.ring, undefined, p.k === 'yellow' ? MARKING_YELLOW : MARKING_WHITE);
    this.mesh('markings', L.mark, MATERIALS.marking, ORDER.markings);
    this.mesh('markings', L.paint, MATERIALS.marking, ORDER.markings);
    this.mesh('markings', B.mark, MATERIALS.marking, ORDER.bridgeMarkings);
    this.mesh('markings', B.paint, MATERIALS.marking, ORDER.bridgeMarkings);

    // ---------------------------------------------------------------- Linien: Wege, Gleise, Gewässer, Hecken/Mauern
    const lineB = new Map<string, FillBuilder>();
    const lb = (group: string, p: Pat) => {
      const k = `${group}:${p}`;
      let b = lineB.get(k);
      if (!b) lineB.set(k, (b = new FillBuilder()));
      return b;
    };
    const rails = new FillBuilder();
    for (const l of t.lines) {
      const st = LINE_STYLE[l.k];
      const pts = toM(l.pts);
      if (l.k === 'tram' || l.k === 'rail') {
        if (l.k === 'rail') lb('rail', st.pat).ribbon(pts, st.w, st.color);
        rails.ribbon(pts, 0.11, RAIL_STEEL, 0.72);
        rails.ribbon(pts, 0.11, RAIL_STEEL, -0.72);
        continue;
      }
      if (l.k === 'subway' || st.w <= 0) continue;
      const group = l.k === 'river' || l.k === 'stream' ? 'water' : l.k === 'hedge' || l.k === 'wall' || l.k === 'citywall' || l.k === 'fence' ? 'barrier' : 'path';
      lb(group, st.pat).ribbon(pts, st.w, st.color);
      // Mauern und Hecken werfen kurze Schatten
      if (group === 'barrier' && l.k !== 'fence') {
        const off = l.k === 'citywall' ? 5 : l.k === 'hedge' ? 1.2 : 0.8;
        shadows.ribbon(pts.map(([x, y]) => [x + SHADOW_DIR[0] * off, y + SHADOW_DIR[1] * off] as [number, number]), st.w + off * 0.6, 0);
      }
    }
    for (const [k, b] of lineB) {
      const [group, p] = k.split(':');
      const order = group === 'water' ? ORDER.water : group === 'barrier' ? ORDER.barriers : group === 'rail' ? ORDER.rail - 0.1 : ORDER.paths;
      this.mesh(group === 'rail' ? 'rail' : 'paths', b, surfaceMat(Number(p) as Pat), order);
    }
    this.mesh('rail', rails, surfaceMat(Pat.Plain), ORDER.rail);

    // ---------------------------------------------------------------- Gebäude
    const roofs = new FillBuilder();
    const edges = new FillBuilder();
    for (const b of t.buildings) buildRoof(b, roofs, edges, shadows);

    // ---------------------------------------------------------------- Bäume
    const trees = new FillBuilder();
    const tr = t.trees ?? [];
    for (let i = 0; i < tr.length; i += 3) {
      const x = tr[i] / 10;
      const y = tr[i + 1] / 10;
      const seed = (tr[i] * 73856093) ^ (tr[i + 1] * 19349663);
      const r = tr[i + 2] > 0 ? tr[i + 2] / 10 : 2.6 + hash(seed) * 2.2;
      const g = pick(TREE_GREENS, seed);
      shadows.disc(x + SHADOW_DIR[0] * r * 0.9, y + SHADOW_DIR[1] * r * 0.9, r * 0.95, 0, 0, 12);
      trees.disc(x, y, r, shade(g, 1.3), shade(g, 0.72), 14, x + TO_SUN[0] * r * 0.3, y + TO_SUN[1] * r * 0.3);
    }

    this.mesh('buildings', shadows, SHADOW_MAT, ORDER.shadows);
    this.mesh('buildings', roofs, surfaceMat(Pat.Roof), ORDER.buildings, '2d');
    this.mesh('buildings', edges, MATERIALS.fill, ORDER.buildingEdges, '2d');
    this.mesh('trees', trees, surfaceMat(Pat.Canopy), ORDER.trees, '2d');

    // ---------------------------------------------------------------- Ampeln
    const housing = new FillBuilder();
    const lamps = new MarkerBuilder();
    const glow = new MarkerBuilder();
    const lampSlots: SignalSlot[] = [];
    const glowSlots: SignalSlot[] = [];
    for (const h of t.signals) {
      const x = h.x / 10;
      const y = h.y / 10;
      const a = (h.hdg * Math.PI) / 180;
      const fx = Math.cos(a);
      const fy = Math.sin(a);
      const lx = -fy;
      const ly = fx;
      const head = (cx: number, cy: number) => {
        // Gehäuse quer zur Fahrtrichtung, Lampe zeigt dem Verkehr entgegen
        housing.addM(
          [
            [cx - fx * 0.2 - lx * 0.18, cy - fy * 0.2 - ly * 0.18],
            [cx + fx * 0.2 - lx * 0.18, cy + fy * 0.2 - ly * 0.18],
            [cx + fx * 0.2 + lx * 0.18, cy + fy * 0.2 + ly * 0.18],
            [cx - fx * 0.2 + lx * 0.18, cy - fy * 0.2 + ly * 0.18],
          ],
          0x1d1f22,
        );
        const s1 = lamps.disc(cx - fx * 0.24, cy - fy * 0.24, 0.17, LAMP.red);
        lampSlots.push({ ctrl: h.ctrl, grp: h.grp, slot: lamps.slots[s1] });
        const s2 = glow.disc(cx - fx * 0.9, cy - fy * 0.9, 1.1, LAMP.red);
        glowSlots.push({ ctrl: h.ctrl, grp: h.grp, slot: glow.slots[s2] });
      };
      // Mast am Fahrbahnrand
      housing.disc(x, y, 0.14, 0x6b6e72, 0x4a4c50, 8);
      head(x, y);
      // breite Zufahrt: Ausleger mit zweitem Signal über den Spuren
      if (h.w > 6.5) {
        const reach = Math.min(h.w * 0.55, 7);
        const ex = x + lx * reach;
        const ey = y + ly * reach;
        housing.ribbon(
          [
            [x, y],
            [ex, ey],
          ],
          0.12,
          0x55585c,
        );
        head(ex, ey);
      }
    }
    this.mesh('signals', housing, MATERIALS.fill, ORDER.signals, '2d');
    if (!lamps.empty) {
      const g = lamps.build();
      this.signalGroups.push({ attr: g.getAttribute('color') as THREE.BufferAttribute, slots: lampSlots, palette: LAMP });
      this.add('signals', new THREE.Mesh(g, MATERIALS.marker), ORDER.signals + 0.1, '2d');
    }
    if (!glow.empty) {
      const g = glow.build();
      this.signalGroups.push({ attr: g.getAttribute('color') as THREE.BufferAttribute, slots: glowSlots, palette: LAMP });
      this.add('signals', new THREE.Mesh(g, MATERIALS.glow), ORDER.signalGlow, '2d');
    }

    // ---------------------------------------------------------------- Debug-Ebenen
    const lanes = new LineBuilder();
    for (const l of t.lanes) {
      const c = l.dir === 1 ? LANE_COLOR_FWD : LANE_COLOR_BWD;
      lanes.add(l.pts, c);
      lanes.arrows(l.pts, c, 0, 12, 1.1);
    }
    if (!lanes.empty) this.add('lanes', new THREE.LineSegments(lanes.build(), MATERIALS.line), ORDER.lanes);

    const con = new LineBuilder();
    for (const c of t.connectors) con.add(c.pts, TURN_COLORS[c.turn]);
    if (!con.empty) this.add('connectors', new THREE.LineSegments(con.build(), MATERIALS.lineSoft), ORDER.connectors);

    const ctl = new MarkerBuilder();
    for (const l of t.lanes) {
      if (l.ctrl === 'none' || l.ctrl === 'signal') continue;
      const n = l.pts.length;
      ctl.square(l.pts[n - 2] / 10, l.pts[n - 1] / 10, 1.3, CONTROL_COLORS[l.ctrl as LaneControl]);
    }
    if (!ctl.empty) this.add('controls', new THREE.Mesh(ctl.build(), MATERIALS.marker), ORDER.controls);

    const stops = new MarkerBuilder();
    const stopSlots: SignalSlot[] = [];
    for (const l of t.lanes) {
      for (const s of l.stops ?? []) {
        const p = pointAlong(l.pts, s.s);
        const slot = stops.square(p[0], p[1], 1.0, SIGNAL_COLORS.red);
        stopSlots.push({ ctrl: s.ctrl, grp: s.grp, slot: stops.slots[slot] });
      }
    }
    if (!stops.empty) {
      const g = stops.build();
      this.signalGroups.push({ attr: g.getAttribute('color') as THREE.BufferAttribute, slots: stopSlots, palette: SIGNAL_COLORS });
      this.add('signalStops', new THREE.Mesh(g, MATERIALS.marker), ORDER.signalStops);
    }

    const grid = new LineBuilder();
    const s = 2500;
    const x0 = t.tx * s;
    const y0 = t.ty * s;
    grid.add([x0, y0, x0 + s, y0, x0 + s, y0 + s, x0, y0 + s, x0, y0], 0xff00ff);
    this.add('grid', new THREE.LineSegments(grid.build(), MATERIALS.lineSoft), ORDER.grid);
  }

  /** Darstellung wechseln: in 3D beleuchtete Materialien für den Boden */
  setDim(d: Dim, lit: boolean): void {
    this.dim = d;
    const on = d === '3d' && lit;
    if (on === this.litOn) return;
    this.litOn = on;
    for (const o of this.group.children) setLit(o, on);
  }

  setLayerVisible(layer: LayerName, visible: boolean) {
    for (const o of this.layers.get(layer) ?? []) o.visible = visible && (!o.userData.dim || o.userData.dim === this.dim);
  }

  dispose() {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}

// ------------------------------------------------------------------ Dächer

const FLAT_TYPES = new Set([
  'commercial',
  'industrial',
  'retail',
  'warehouse',
  'office',
  'school',
  'hospital',
  'university',
  'supermarket',
  'parking',
  'train_station',
  'public',
  'civic',
  'government',
  'sports_hall',
  'hangar',
  'manufacture',
  'kindergarten',
  'college',
  'transportation',
  'service',
  'garages',
  'garage',
  'carport',
  'roof',
]);
const GABLE = new Set(['gabled', 'half-hipped', 'gambrel', 'saltbox', 'mansard', 'round', 'side_hipped']);
const HIP = new Set(['hipped', 'pyramidal']);
const FLATS = new Set(['flat', 'skillion', 'dome', 'many', 'onion']);

export interface RoofInfo {
  pts: Array<[number, number]>;
  ccw: boolean;
  area: number;
  color: number;
  /** flach, Facetten (rechteckig, First r0-r1) oder Band (verwinkeltes Steildach) */
  kind: 'flat' | 'facet' | 'band';
  r0: [number, number];
  r1: [number, number];
  half: number;
  wid: number;
  band: number;
}

/** Form, Farbe und First eines Daches bestimmen (gemeinsam für 2D und 3D) */
export function roofInfo(b: Building): RoofInfo | null {
  const pts = toM(b.outer);
  const n = pts.length;
  if (n < 3) return null;
  let area2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area2 += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  const ccw = area2 < 0; // Formel liefert negatives Vorzeichen für CCW
  const area = Math.abs(area2) / 2;

  const t = b.t;
  const isChurch = t === 'church' || t === 'cathedral' || t === 'chapel';
  let flat = FLATS.has(b.rs ?? '') || (!b.rs && (FLAT_TYPES.has(t) || area > 1400 || b.h > 22));
  if (b.rs && (GABLE.has(b.rs) || HIP.has(b.rs))) flat = false;
  let color: number;
  if (b.rc !== undefined) color = b.rc;
  else if (isChurch) color = pick(ROOF_COPPER, b.id);
  else if (flat) color = pick(ROOF_FLAT, b.id);
  else color = hash(b.id * 7 + 3) < 0.82 ? pick(ROOF_TILE, b.id) : pick(ROOF_DARK, b.id);

  // Hauptachse: dominante Kantenrichtung (doppelter Winkel gewichtet mit Länge)
  let sx = 0;
  let sy = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const ang = Math.atan2(by - ay, bx - ax);
    const l = Math.hypot(bx - ax, by - ay);
    sx += Math.cos(2 * ang) * l;
    sy += Math.sin(2 * ang) * l;
    cx += ax / n;
    cy += ay / n;
  }
  const th = Math.atan2(sy, sx) / 2;
  let ax = Math.cos(th);
  let ay = Math.sin(th);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, y] of pts) {
    const u = (x - cx) * ax + (y - cy) * ay;
    const v = -(x - cx) * ay + (y - cy) * ax;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  if (v1 - v0 > u1 - u0) {
    [ax, ay] = [-ay, ax];
    [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
  }
  const mcx = cx + (ax * (u0 + u1)) / 2 + (-ay * (v0 + v1)) / 2;
  const mcy = cy + (ay * (u0 + u1)) / 2 + (ax * (v0 + v1)) / 2;
  const len = u1 - u0;
  const wid = v1 - v0;
  const fill = area / Math.max(1, len * wid);
  const simple = !b.holes?.length && n <= 14 && wid > 2 && fill > 0.82;
  const hip = HIP.has(b.rs ?? '') || (!b.rs && len / wid < 1.3);
  const half = hip ? Math.max(0, (len - wid) / 2) : len / 2 + 0.01;
  return {
    pts,
    ccw,
    area,
    color,
    kind: flat ? 'flat' : simple ? 'facet' : 'band',
    r0: [mcx - ax * half, mcy - ay * half],
    r1: [mcx + ax * half, mcy + ay * half],
    half,
    wid,
    band: Math.min(4, Math.max(1.5, Math.sqrt(area) * 0.18)),
  };
}

/** Nächster Punkt auf dem First */
export function ridgeProj(r: RoofInfo, x: number, y: number): [number, number] {
  const dx = r.r1[0] - r.r0[0];
  const dy = r.r1[1] - r.r0[1];
  const l2 = dx * dx + dy * dy;
  const q = l2 > 0 ? Math.max(0, Math.min(1, ((x - r.r0[0]) * dx + (y - r.r0[1]) * dy) / l2)) : 0;
  return [r.r0[0] + dx * q, r.r0[1] + dy * q];
}

/** Außennormale (normiert) der Kante i */
export function edgeNormal(r: RoofInfo, i: number): [number, number] {
  const [px, py] = r.pts[i];
  const [qx, qy] = r.pts[(i + 1) % r.pts.length];
  let nx = qy - py;
  let ny = -(qx - px);
  if (!r.ccw) {
    nx = -nx;
    ny = -ny;
  }
  const l = Math.hypot(nx, ny) || 1;
  return [nx / l, ny / l];
}

/** Dach eines Gebäudes von oben: Dachflächen je nach Form unterschiedlich hell, Kante, Schatten */
function buildRoof(b: Building, roofs: FillBuilder, edges: FillBuilder, shadows: FillBuilder): void {
  const r = roofInfo(b);
  if (!r) return;
  const { pts, color, ccw } = r;
  const n = pts.length;

  // Schatten: verschobener Grundriss plus Seitenflächen
  const L = Math.min(b.h * 0.5, 45);
  if (L > 0.5) {
    const dx = SHADOW_DIR[0] * L;
    const dy = SHADOW_DIR[1] * L;
    shadows.addM(
      pts.map(([x, y]) => [x + dx, y + dy] as [number, number]),
      0,
    );
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % n];
      shadows.tri(ax, ay, bx, by, bx + dx, by + dy, 0);
      shadows.tri(ax, ay, bx + dx, by + dy, ax + dx, ay + dy, 0);
    }
  }

  if (r.kind === 'flat') {
    roofs.add(b.outer, b.holes, color);
    if (n <= 200) edges.ribbon([...pts, pts[0]], 0.45, shade(color, 1.18), ccw ? 0.3 : -0.3);
  } else if (r.kind === 'band') {
    roofs.add(b.outer, b.holes, color);
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % n];
      if (Math.hypot(qx - px, qy - py) < 1) continue;
      const [nx, ny] = edgeNormal(r, i);
      const lit = nx * TO_SUN[0] + ny * TO_SUN[1];
      const c = shade(color, 1 + 0.2 * lit);
      const ix = -nx * r.band;
      const iy = -ny * r.band;
      roofs.tri(px, py, qx, qy, qx + ix, qy + iy, c);
      roofs.tri(px, py, qx + ix, qy + iy, px + ix, py + iy, c);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % n];
      const [nx, ny] = edgeNormal(r, i);
      const c = shade(color, 1 + 0.2 * (nx * TO_SUN[0] + ny * TO_SUN[1]));
      const [rpx, rpy] = ridgeProj(r, px, py);
      const [rqx, rqy] = ridgeProj(r, qx, qy);
      roofs.tri(px, py, qx, qy, rqx, rqy, c);
      roofs.tri(px, py, rqx, rqy, rpx, rpy, c);
    }
    if (r.half > 0.5)
      edges.ribbon(
        [
          [r.r0[0], r.r0[1]],
          [r.r1[0], r.r1[1]],
        ],
        0.18,
        shade(color, 0.75),
      );
  }
  edges.ribbon([...pts, pts[0]], 0.14, b.h > 30 ? BUILDING_EDGE_DARK : shade(color, 0.55));
}

export function pointAlong(pts: number[], s: number): [number, number] {
  let acc = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2] / 10;
    const ay = pts[i - 1] / 10;
    const bx = pts[i] / 10;
    const by = pts[i + 1] / 10;
    const l = Math.hypot(bx - ax, by - ay);
    if (acc + l >= s || i === pts.length - 2) {
      const t = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
    acc += l;
  }
  return [pts[0] / 10, pts[1] / 10];
}
