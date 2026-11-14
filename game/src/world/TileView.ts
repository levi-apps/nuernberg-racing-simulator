/**
 * Darstellung einer Kachel: alle Ebenen als zusammengefasste Meshes.
 */
import * as THREE from 'three';
import type { LaneControl, Tile } from '@nrs/shared';
import { FillBuilder, LineBuilder, MarkerBuilder } from './geometry.ts';
import {
  AREA_COLORS,
  BUILDING_EDGE,
  BUILDING_FILL,
  CONTROL_COLORS,
  LANE_COLOR_BWD,
  LANE_COLOR_FWD,
  LINE_COLORS,
  MARKING_COLORS,
  ROAD_COLORS,
  SIGNAL_COLORS,
  TURN_COLORS,
} from './style.ts';

export type LayerName =
  | 'areas'
  | 'roads'
  | 'markings'
  | 'paths'
  | 'rail'
  | 'buildings'
  | 'lanes'
  | 'connectors'
  | 'controls'
  | 'signals'
  | 'grid';

/** Zeichenreihenfolge (2D, ohne Tiefentest) */
export const ORDER: Record<string, number> = {
  areas: 0,
  tunnels: 1,
  roads: 2,
  paths: 3,
  markings: 4,
  bridges: 5,
  bridgeMarkings: 6,
  buildings: 7,
  rail: 8,
  lanes: 9,
  connectors: 10,
  controls: 11,
  signals: 12,
  grid: 13,
  car: 20,
};

// Alles läuft durch den transparenten Durchgang, damit allein renderOrder die Zeichenreihenfolge bestimmt
const meshMat = (opacity = 1) =>
  new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity, side: THREE.DoubleSide });
const lineMat = (opacity = 1) =>
  new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity });

export const MATERIALS = {
  fill: meshMat(),
  tunnel: meshMat(0.35),
  building: meshMat(1),
  line: lineMat(),
  lineSoft: lineMat(0.55),
  marker: meshMat(),
};

/** Three.js-Render-Ebenen */
export const RL_MAIN = 1;
export const RL_MINI = 2;
const MINIMAP_LAYERS = new Set<LayerName>(['areas', 'roads', 'buildings', 'rail']);

export interface SignalSlot {
  ctrl: number;
  grp: number;
  slot: { start: number; count: number };
}

export class TileView {
  group = new THREE.Group();
  layers = new Map<LayerName, THREE.Object3D[]>();
  signalAttr: THREE.BufferAttribute | null = null;
  signalSlots: SignalSlot[] = [];

  constructor(public tile: Tile) {
    this.build();
  }

  private addObj(layer: LayerName, obj: THREE.Object3D, order: number) {
    obj.renderOrder = order;
    obj.frustumCulled = false;
    // Render-Ebenen: 0 = Hauptansicht und Minikarte, 1 = nur Hauptansicht
    if (!MINIMAP_LAYERS.has(layer)) obj.layers.set(RL_MAIN);
    this.group.add(obj);
    const l = this.layers.get(layer) ?? [];
    l.push(obj);
    this.layers.set(layer, l);
  }

  private build() {
    const t = this.tile;

    // Flächen
    const areas = new FillBuilder();
    for (const a of t.areas) areas.add(a.outer, a.holes, AREA_COLORS[a.k]);
    if (!areas.empty) this.addObj('areas', new THREE.Mesh(areas.build(), MATERIALS.fill), ORDER.areas);

    // Fahrbahnen (Tunnel durchscheinend, Brücken oben)
    const ground = new FillBuilder();
    const tunnels = new FillBuilder();
    const bridges = new FillBuilder();
    const sorted = t.surfaces.slice().sort((a, b) => (a.k === b.k ? 0 : a.k === 'seg' ? -1 : 1));
    for (const s of sorted) {
      const c = ROAD_COLORS[s.cls];
      if (s.layer < 0) tunnels.add(s.ring, undefined, c);
      else if (s.layer > 0) bridges.add(s.ring, undefined, c);
      else ground.add(s.ring, undefined, c);
    }
    if (!tunnels.empty) this.addObj('roads', new THREE.Mesh(tunnels.build(), MATERIALS.tunnel), ORDER.tunnels);
    if (!ground.empty) this.addObj('roads', new THREE.Mesh(ground.build(), MATERIALS.fill), ORDER.roads);
    if (!bridges.empty) this.addObj('roads', new THREE.Mesh(bridges.build(), MATERIALS.fill), ORDER.bridges);

    // Markierungen
    const mk = new LineBuilder();
    const mkBridge = new LineBuilder();
    for (const m of t.markings) {
      const b = m.layer > 0 ? mkBridge : mk;
      b.add(m.pts, MARKING_COLORS[m.k], 0, m.k === 'dashed' ? [3, 6] : undefined);
    }
    if (!mk.empty) this.addObj('markings', new THREE.LineSegments(mk.build(), MATERIALS.line), ORDER.markings);
    if (!mkBridge.empty) this.addObj('markings', new THREE.LineSegments(mkBridge.build(), MATERIALS.line), ORDER.bridgeMarkings);

    // Wege, Gleise, Gewässer
    const paths = new LineBuilder();
    const rail = new LineBuilder();
    for (const l of t.lines) {
      const c = LINE_COLORS[l.k];
      if (l.k === 'rail' || l.k === 'tram' || l.k === 'subway') rail.add(l.pts, c);
      else paths.add(l.pts, c, 0, l.k === 'footway' || l.k === 'path' || l.k === 'steps' ? [2, 1.5] : undefined);
    }
    if (!paths.empty) this.addObj('paths', new THREE.LineSegments(paths.build(), MATERIALS.lineSoft), ORDER.paths);
    if (!rail.empty) this.addObj('rail', new THREE.LineSegments(rail.build(), MATERIALS.line), ORDER.rail);

    // Gebäude
    const bld = new FillBuilder();
    const bldEdge = new LineBuilder();
    for (const b of t.buildings) {
      // höhere Gebäude etwas dunkler: einfacher Tiefeneindruck von oben
      bld.add(b.outer, b.holes, shadeBuilding(b.h));
      bldEdge.add([...b.outer, b.outer[0], b.outer[1]], BUILDING_EDGE);
      for (const h of b.holes ?? []) bldEdge.add([...h, h[0], h[1]], BUILDING_EDGE);
    }
    if (!bld.empty) this.addObj('buildings', new THREE.Mesh(bld.build(), MATERIALS.building), ORDER.buildings);
    if (!bldEdge.empty) this.addObj('buildings', new THREE.LineSegments(bldEdge.build(), MATERIALS.line), ORDER.buildings);

    // Spuren mit Richtungspfeilen
    const lanes = new LineBuilder();
    for (const l of t.lanes) {
      const c = l.dir === 1 ? LANE_COLOR_FWD : LANE_COLOR_BWD;
      lanes.add(l.pts, c);
      lanes.arrows(l.pts, c, 0, 12, 1.1);
    }
    if (!lanes.empty) this.addObj('lanes', new THREE.LineSegments(lanes.build(), MATERIALS.line), ORDER.lanes);

    // Verbinder
    const con = new LineBuilder();
    for (const c of t.connectors) con.add(c.pts, TURN_COLORS[c.turn]);
    if (!con.empty) this.addObj('connectors', new THREE.LineSegments(con.build(), MATERIALS.lineSoft), ORDER.connectors);

    // Regelung am Spurende
    const ctl = new MarkerBuilder();
    for (const l of t.lanes) {
      if (l.ctrl === 'none' || l.ctrl === 'signal') continue;
      const n = l.pts.length;
      const x = l.pts[n - 2] / 10;
      const y = l.pts[n - 1] / 10;
      ctl.square(x, y, 1.3, CONTROL_COLORS[l.ctrl as LaneControl]);
    }
    if (!ctl.empty) this.addObj('controls', new THREE.Mesh(ctl.build(), MATERIALS.marker), ORDER.controls);

    // Ampeln: Signalkopf + Haltepunkte auf den Spuren
    const sig = new MarkerBuilder();
    for (const h of t.signals) {
      const slot = sig.disc(h.x / 10, h.y / 10, 0.9, SIGNAL_COLORS.red);
      this.signalSlots.push({ ctrl: h.ctrl, grp: h.grp, slot: sig.slots[slot] });
    }
    for (const l of t.lanes) {
      if (!l.stops) continue;
      for (const s of l.stops) {
        const p = pointAlong(l.pts, s.s);
        const slot = sig.square(p[0], p[1], 1.0, SIGNAL_COLORS.red);
        this.signalSlots.push({ ctrl: s.ctrl, grp: s.grp, slot: sig.slots[slot] });
      }
    }
    if (!sig.empty) {
      const g = sig.build();
      this.signalAttr = g.getAttribute('color') as THREE.BufferAttribute;
      this.addObj('signals', new THREE.Mesh(g, MATERIALS.marker), ORDER.signals);
    }

    // Kachelraster
    const grid = new LineBuilder();
    const s = 2500; // dm
    const x0 = t.tx * s;
    const y0 = t.ty * s;
    grid.add([x0, y0, x0 + s, y0, x0 + s, y0 + s, x0, y0 + s, x0, y0], 0xff00ff);
    this.addObj('grid', new THREE.LineSegments(grid.build(), MATERIALS.lineSoft), ORDER.grid);
  }

  setLayerVisible(layer: LayerName, visible: boolean) {
    for (const o of this.layers.get(layer) ?? []) o.visible = visible;
  }

  dispose() {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}

const bTmp = new THREE.Color();
const bBase = new THREE.Color(BUILDING_FILL);
function shadeBuilding(h: number): number {
  const f = 1 - Math.min(0.22, Math.max(0, (h - 6) / 120));
  return bTmp.copy(bBase).multiplyScalar(f).getHex();
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
