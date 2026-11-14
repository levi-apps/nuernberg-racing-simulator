/**
 * Navigation: Route zum Ziel, Linie auf der Straße und in der Minikarte,
 * Fortschritt, Abbiegehinweise und Neuberechnung bei Abweichung.
 */
import * as THREE from 'three';
import { TURN_CODES } from '@nrs/shared';
import type { WorldView } from '../world/WorldView.ts';
import { projectOnPolyline } from '../world/WorldView.ts';
import type { Car } from '../drive/Car.ts';
import { RL_MAIN, RL_MINI } from '../world/TileView.ts';
import type { NavData, Target } from './NavData.ts';
import { Router, type RouteResult } from './Router.ts';

export interface Maneuver {
  at: number; // Distanz entlang der Route (m)
  turn: 'left' | 'right' | 'uturn';
  road: string | null;
}

type P = [number, number];

const OFF_ROUTE = 22; // m
const ROUTE_COLOR = 0x2f7de1;

export class Navigator {
  router: Router;
  target: Target | null = null;
  route: RouteResult | null = null;
  path: P[] = [];
  cum: number[] = [];
  progress = 0;
  maneuvers: Maneuver[] = [];
  /** Sekunden je Meter (aus der Routenberechnung) für die Restzeit */
  private secPerM = 0.1;
  private offTime = 0;
  private recalcCooldown = 0;
  private approxLanes = false;
  private refreshTimer = 0;
  private mainLine = new THREE.Group();
  private miniLine = new THREE.Group();
  private marker = new THREE.Group();
  private miniMarker = new THREE.Group();
  readonly playerArrow: THREE.Mesh;
  onRecalc?: () => void;

  constructor(
    private view: WorldView,
    private car: Car,
    private data: NavData,
  ) {
    this.router = new Router(data.graph);
    this.mainLine.layers.set(RL_MAIN);
    view.scene.add(this.mainLine, this.miniLine, this.marker, this.miniMarker);
    // Spielerpfeil für die Minikarte
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([26, 0, 0, -16, 15, 0, -8, 0, 0, 26, 0, 0, -8, 0, 0, -16, -15, 0], 3));
    this.playerArrow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd7263d, depthTest: false, transparent: true }));
    this.playerArrow.renderOrder = 60;
    this.playerArrow.layers.set(RL_MINI);
    this.playerArrow.frustumCulled = false;
    view.scene.add(this.playerArrow);
  }

  get active(): boolean {
    return !!this.target;
  }

  get remaining(): number {
    return Math.max(0, (this.cum[this.cum.length - 1] ?? 0) - this.progress);
  }

  get remainingTime(): number {
    return this.remaining * this.secPerM;
  }

  /** Abstand zum Ziel (Luftlinie zum Punkt auf der Spur) */
  distanceToTarget(): number {
    if (!this.path.length) return Infinity;
    const e = this.path[this.path.length - 1];
    return Math.hypot(e[0] - this.car.x, e[1] - this.car.y);
  }

  setTarget(t: Target | null): boolean {
    this.target = t;
    this.clearMeshes();
    this.route = null;
    this.path = [];
    this.cum = [];
    this.maneuvers = [];
    if (!t) return true;
    this.buildMarkers(t);
    return this.recalc();
  }

  /** Spur und Position des Spielers (passend zur Fahrtrichtung, sonst nächste Spur) */
  locatePlayer(): { lane: number; s: number } | null {
    const c = this.car;
    const [fx, fy] = c.forward;
    let best: { lane: number; s: number; score: number } | null = null;
    for (const t of this.view.tilesAround(c.x, c.y, 30)) {
      for (const l of t.lanes) {
        if (l.layer !== c.layer) continue;
        const r = projectOnPolyline(l.pts, c.x, c.y);
        if (r.d > 30) continue;
        const align = r.dir[0] * fx + r.dir[1] * fy;
        const score = r.d + (1 - align) * 6 + (l.iso ? 15 : 0) + (l.cls === 'service' ? 5 : 0);
        if (!best || score < best.score) best = { lane: l.id, s: r.s, score };
      }
    }
    if (best) return best;
    const hit = this.view.nearestLane(c.x, c.y, 200, true);
    return hit ? { lane: hit.lane.id, s: hit.s } : null;
  }

  recalc(): boolean {
    const t = this.target;
    if (!t) return false;
    const from = this.locatePlayer();
    if (!from) return false;
    const r = this.router.route(from.lane, from.s, t.lane, t.s);
    this.recalcCooldown = 2;
    this.offTime = 0;
    if (!r) return false;
    this.route = r;
    this.secPerM = r.length > 0 ? r.time / r.length : 0.1;
    this.buildPath(from.s);
    this.progress = 0;
    this.onRecalc?.();
    return true;
  }

  /** Polylinie der Route: genaue Spurgeometrie, wo geladen, sonst Luftlinie zwischen Spurenden */
  private buildPath(fromS: number): void {
    const r = this.route!;
    const G = this.data.graph;
    const path: P[] = [];
    const push = (p: P) => {
      const l = path[path.length - 1];
      if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 0.3) path.push(p);
    };
    const man: Array<{ idx: number; turn: Maneuver['turn']; road: string | null }> = [];
    this.approxLanes = false;
    for (let i = 0; i < r.lanes.length; i++) {
      const id = r.lanes[i];
      const s0 = i === 0 ? fromS : 0;
      const s1 = i === r.lanes.length - 1 ? this.target!.s : Infinity;
      const lane = this.view.laneById.get(id);
      if (lane) {
        for (const p of sliceDm(lane.pts, s0, s1)) push(p);
      } else {
        this.approxLanes = true;
        push([G.x0[id] / 10, G.y0[id] / 10]);
        if (i < r.lanes.length - 1) push([G.x1[id] / 10, G.y1[id] / 10]);
      }
      if (i < r.lanes.length - 1) {
        const next = r.lanes[i + 1];
        // Kante suchen (für Abbiegeart) und Verbindergeometrie
        let turn = 'through';
        for (let e = G.outStart[id]; e < G.outStart[id + 1]; e++)
          if (G.target[e] === next) {
            turn = TURN_CODES[G.turn[e]];
            break;
          }
        if (turn === 'left' || turn === 'right' || turn === 'uturn') {
          const ni = G.name[next];
          man.push({ idx: path.length - 1, turn, road: ni >= 0 ? this.data.names[ni] : null });
        }
        const con = lane?.out.map((cid) => this.view.conById.get(cid)).find((c) => c?.to === next);
        if (con) for (const p of sliceDm(con.pts, 0, Infinity)) push(p);
      }
    }
    if (path.length < 2) path.push([path[0][0] + 0.1, path[0][1]]);
    this.path = path;
    this.cum = [0];
    for (let i = 1; i < path.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    this.maneuvers = man.map((m) => ({ at: this.cum[Math.max(0, m.idx)], turn: m.turn, road: m.road }));
    this.buildLines();
  }

  /** Nächster Abbiegehinweis */
  nextManeuver(): (Maneuver & { dist: number }) | null {
    for (const m of this.maneuvers) if (m.at > this.progress - 2) return { ...m, dist: m.at - this.progress };
    return null;
  }

  update(dt: number): void {
    // Spielerpfeil der Minikarte
    this.playerArrow.position.set(this.car.x, this.car.y, 0);
    this.playerArrow.rotation.z = this.car.heading;
    if (!this.target || !this.path.length) return;
    this.recalcCooldown -= dt;
    // Fortschritt: Projektion auf die Route in einem Fenster um den letzten Stand
    const { s, d } = this.projectOnPath(this.car.x, this.car.y);
    this.progress = s;
    if (d > OFF_ROUTE) this.offTime += dt;
    else this.offTime = 0;
    if (this.offTime > 1.5 && this.recalcCooldown <= 0) this.recalc();
    // genauere Geometrie, sobald Kacheln geladen sind
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 1;
      if (this.approxLanes && this.recalcCooldown <= 0) this.recalc();
      else this.buildLines();
    }
  }

  private projectOnPath(x: number, y: number): { s: number; d: number } {
    const p = this.path;
    let best = Infinity;
    let bestS = this.progress;
    // Fenster: 80 m zurück bis 400 m voraus
    let i0 = 1;
    while (i0 < p.length && this.cum[i0] < this.progress - 80) i0++;
    for (let i = i0; i < p.length; i++) {
      if (this.cum[i - 1] > this.progress + 400) break;
      const ax = p[i - 1][0];
      const ay = p[i - 1][1];
      const dx = p[i][0] - ax;
      const dy = p[i][1] - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
      if (d < best) {
        best = d;
        bestS = this.cum[i - 1] + t * Math.sqrt(l2);
      }
    }
    return { s: bestS, d: best };
  }

  // ------------------------------------------------------------- Darstellung

  private clearMeshes(): void {
    for (const g of [this.mainLine, this.miniLine, this.marker, this.miniMarker])
      for (const c of [...g.children]) {
        g.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
  }

  private buildLines(): void {
    for (const g of [this.mainLine, this.miniLine])
      for (const c of [...g.children]) {
        g.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
    // nur den noch zu fahrenden Teil zeigen
    let i0 = 0;
    while (i0 < this.path.length - 2 && this.cum[i0 + 1] < this.progress) i0++;
    const pts = this.path.slice(i0);
    if (pts.length < 2) return;
    pts[0] = [this.car.x, this.car.y];
    const main = new THREE.Mesh(ribbon(pts, 1.6), new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.45, depthTest: false }));
    main.renderOrder = 15;
    main.layers.set(RL_MAIN);
    main.frustumCulled = false;
    this.mainLine.add(main);
    const mini = new THREE.Mesh(ribbon(pts, 9), new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.9, depthTest: false }));
    mini.renderOrder = 55;
    mini.layers.set(RL_MINI);
    mini.frustumCulled = false;
    this.miniLine.add(mini);
  }

  private buildMarkers(t: Target): void {
    // Ziel auf der Straße (rechter Fahrbahnrand) – Ring im Hauptbild, große Scheibe in der Minikarte
    const mk = (r0: number, r1: number, color: number, layer: number, order: number, group: THREE.Group, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }));
      m.position.set(x, y, 0);
      m.renderOrder = order;
      m.layers.set(layer);
      m.frustumCulled = false;
      group.add(m);
    };
    const p = this.targetPoint(t);
    mk(3.2, 4.2, 0xf5b400, RL_MAIN, 16, this.marker, p[0], p[1]);
    mk(0, 1.2, 0xf5b400, RL_MAIN, 16, this.marker, p[0], p[1]);
    mk(0, 16, 0xf5b400, RL_MINI, 58, this.miniMarker, p[0], p[1]);
  }

  /** Punkt auf der Zielspur */
  targetPoint(t: Target): P {
    const lane = this.view.laneById.get(t.lane);
    if (lane) {
      const pts = sliceDm(lane.pts, t.s, t.s + 0.5);
      if (pts.length) return pts[0];
    }
    const G = this.data.graph;
    const f = G.len[t.lane] > 0 ? t.s / G.len[t.lane] : 0;
    return [(G.x0[t.lane] + (G.x1[t.lane] - G.x0[t.lane]) * f) / 10, (G.y0[t.lane] + (G.y1[t.lane] - G.y0[t.lane]) * f) / 10];
  }

  /** Marker neu setzen, z. B. wenn die genaue Spurgeometrie nachgeladen wurde */
  refreshMarker(): void {
    if (!this.target) return;
    for (const g of [this.marker, this.miniMarker])
      for (const c of [...g.children]) {
        g.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
    this.buildMarkers(this.target);
  }
}

/** Teilstück einer dm-Polylinie (Meter-Bogenlängen) */
function sliceDm(pts: number[], s0: number, s1: number): P[] {
  const out: P[] = [];
  let acc = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2] / 10;
    const ay = pts[i - 1] / 10;
    const bx = pts[i] / 10;
    const by = pts[i + 1] / 10;
    const l = Math.hypot(bx - ax, by - ay);
    const a = acc;
    const b = acc + l;
    acc = b;
    if (b < s0 || a > s1 || l === 0) continue;
    const t0 = Math.max(0, (s0 - a) / l);
    const t1 = Math.min(1, (s1 - a) / l);
    if (!out.length) out.push([ax + (bx - ax) * t0, ay + (by - ay) * t0]);
    out.push([ax + (bx - ax) * t1, ay + (by - ay) * t1]);
  }
  return out;
}

/** Band entlang einer Polylinie */
function ribbon(pts: P[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const hw = width / 2;
  const n = pts.length;
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    left.push([pts[i][0] - dy * hw, pts[i][1] + dx * hw]);
    right.push([pts[i][0] + dy * hw, pts[i][1] - dx * hw]);
  }
  for (let i = 1; i < n; i++) {
    const a = left[i - 1];
    const b = right[i - 1];
    const c = left[i];
    const d = right[i];
    pos.push(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0, c[0], c[1], 0, b[0], b[1], 0, d[0], d[1], 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
