/**
 * KI-Verkehr rund um den Spieler.
 *
 * - Fahrzeuge folgen dem Spurgraphen (Spur -> Verbinder -> Spur …), Route zufällig gewichtet.
 * - Längsverhalten nach dem Intelligent Driver Model (IDM): Abstand zum Vordermann,
 *   Haltelinien bei Rot/Gelb, Warten an Kreuzungen, langsamer in Kurven.
 * - Vorfahrt: Ampel, Vorfahrtstraße, Vorfahrt gewähren, Stopp, rechts vor links,
 *   Linksabbieger warten auf Gegenverkehr. Wer zu lange wartet, fährt (gegen Blockaden).
 * - Der Spieler ist für die KI ein Hindernis; Rotlichtverstöße des Spielers werden protokolliert.
 */
import { signalState, type Connector, type Lane, type LaneControl, type RoadClass } from '@nrs/shared';
import type { WorldView } from '../world/WorldView.ts';
import type { Car } from '../drive/Car.ts';
import { conKey, elemId, Graph, isCon, laneKey, type ElemKey } from './Graph.ts';

export type VType = 'car' | 'van' | 'bus';

export interface Vehicle {
  id: number;
  type: VType;
  len: number;
  width: number;
  color: number;
  route: ElemKey[];
  /** Abstand der Fahrzeugfront zum Anfang von route[i] (negativ = bereits begonnen) – je Frame neu */
  off: number[];
  prev: ElemKey | null;
  s: number;
  v: number;
  a: number;
  v0f: number;
  aMax: number;
  bComf: number;
  T: number;
  s0: number;
  stopDone: number;
  waitTime: number;
  committed: number;
  crashed: number;
  reason: string;
  x: number;
  y: number;
  hdg: number;
  dead: boolean;
}

export interface TrafficEvent {
  type: 'red_light';
  t: number;
  x: number;
  y: number;
  ctrl: number;
}

const CLASS_WEIGHT: Partial<Record<RoadClass, number>> = {
  motorway: 1.3,
  trunk: 1.3,
  primary: 1.0,
  secondary: 0.9,
  tertiary: 0.7,
  unclassified: 0.35,
  residential: 0.22,
  living_street: 0.04,
  service: 0.03,
};

const TURN_WEIGHT: Record<string, number> = { through: 1, merge: 1, right: 0.35, left: 0.3, uturn: 0.02 };
/** Abbiegetempo in m/s */
const TURN_SPEED: Record<string, number> = { left: 7.5, right: 5.5, uturn: 3, through: 99, merge: 99 };

const RANK: Record<LaneControl, number> = { priority: 3, none: 3, signal: 3, rbl: 2, yield: 1, stop: 1, end: 0 };

const COLORS = [0xf2f2f2, 0xe8e8e8, 0x1c1c1c, 0x2b2b2b, 0x9aa0a6, 0xb7bcc2, 0x6b7076, 0x1f4e8c, 0x2d6cc0, 0x8c1c1c, 0xb02a2a, 0x355e3b, 0x6b4a2b, 0xd9c7a0, 0x3a3f58];

const SPAWN_R = 440;
const DESPAWN_R = 520;
const GAP_TIME = 4.5;
const DEADLOCK_WAIT = 8;

const tmp = { x: 0, y: 0, dx: 0, dy: 0 };
const tmp2 = { x: 0, y: 0, dx: 0, dy: 0 };

export class TrafficSim {
  graph: Graph;
  vehicles: Vehicle[] = [];
  enabled = true;
  maxVehicles = 180;
  density = 1;
  events: TrafficEvent[] = [];
  onEvent?: (e: TrafficEvent) => void;
  private byElem = new Map<ElemKey, Vehicle[]>();
  private nextId = 1;
  private target = 0;
  private candidates: Array<{ lane: Lane; w: number }> = [];
  private candTotal = 0;
  private candTimer = 0;
  private filled = false;
  private playerLane: Lane | null = null;
  private playerS = 0;
  private lastViolation = new Map<number, number>();

  constructor(
    private view: WorldView,
    private player: Car,
  ) {
    this.graph = new Graph(view);
  }

  get count(): number {
    return this.vehicles.length;
  }

  update(dt: number): void {
    if (!this.enabled || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const t = this.view.time;

    this.reindex();
    for (const v of this.vehicles) {
      this.ensureRoute(v);
      this.computeOffsets(v);
    }
    for (const v of this.vehicles) v.a = this.decide(v, t);
    for (const v of this.vehicles) this.integrate(v, dt);
    for (const v of this.vehicles) this.pose(v);

    const px = this.player.x;
    const py = this.player.y;
    this.vehicles = this.vehicles.filter((v) => {
      if (v.dead) return false;
      const d = Math.hypot(v.x - px, v.y - py);
      if (d > DESPAWN_R) return false;
      if (v.waitTime > 60 && d > 150) return false;
      return true;
    });
    this.spawn(dt);
    this.checkPlayerSignals(t);
  }

  clear(): void {
    this.vehicles = [];
    this.filled = false;
  }

  // ---------------------------------------------------------------- Routen

  private reindex(): void {
    this.byElem.clear();
    for (const v of this.vehicles) {
      const k = v.route[0];
      let l = this.byElem.get(k);
      if (!l) this.byElem.set(k, (l = []));
      l.push(v);
    }
    for (const l of this.byElem.values()) l.sort((a, b) => a.s - b.s);
  }

  private ensureRoute(v: Vehicle): void {
    const g = this.graph;
    let ahead = -v.s;
    for (const k of v.route) ahead += g.length(k);
    while (ahead < 160 && v.route.length < 14) {
      const last = v.route[v.route.length - 1];
      if (isCon(last)) {
        const c = g.con(elemId(last));
        if (!c || !g.lane(c.to)) break;
        v.route.push(laneKey(c.to));
        ahead += g.length(laneKey(c.to));
        continue;
      }
      const L = g.lane(elemId(last));
      if (!L) break;
      const opts: Connector[] = [];
      let total = 0;
      for (const cid of L.out) {
        const c = g.con(cid);
        if (!c) continue;
        const to = g.lane(c.to);
        if (!to || to.iso) continue;
        // keine Fahrt in Wohnstraßen/Zufahrten bevorzugen, wenn es Alternativen gibt
        opts.push(c);
        total += TURN_WEIGHT[c.turn] * (to.cls === 'service' ? 0.15 : 1);
      }
      if (!opts.length) break;
      let r = Math.random() * total;
      let pick = opts[0];
      for (const c of opts) {
        r -= TURN_WEIGHT[c.turn] * (g.lane(c.to)!.cls === 'service' ? 0.15 : 1);
        if (r <= 0) {
          pick = c;
          break;
        }
      }
      v.route.push(conKey(pick.id));
      ahead += g.length(conKey(pick.id));
    }
  }

  private computeOffsets(v: Vehicle): void {
    let off = -v.s;
    v.off.length = 0;
    for (const k of v.route) {
      v.off.push(off);
      off += this.graph.length(k);
    }
  }

  // ---------------------------------------------------------------- Verhalten

  private idm(v: Vehicle, v0: number, gap: number, vl: number): number {
    const sStar = v.s0 + Math.max(0, v.v * v.T + (v.v * (v.v - vl)) / (2 * Math.sqrt(v.aMax * v.bComf)));
    return v.aMax * (1 - Math.pow(v.v / Math.max(v0, 0.1), 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
  }

  private decide(v: Vehicle, t: number): number {
    if (v.crashed > 0) {
      v.reason = 'Unfall';
      return -9;
    }
    const g = this.graph;
    const cur = v.route[0];
    let v0: number;
    if (isCon(cur)) {
      const c = g.con(elemId(cur));
      const to = c ? g.lane(c.to) : undefined;
      v0 = ((to?.vmax ?? 50) / 3.6) * v.v0f;
      if (c) v0 = Math.min(v0, TURN_SPEED[c.turn]);
    } else v0 = ((g.lane(elemId(cur))?.vmax ?? 50) / 3.6) * v.v0f;

    let acc = Infinity;
    let reason = 'frei';
    const obstacle = (gap: number, vl: number, why: string) => {
      const a = this.idm(v, v0, gap, vl);
      if (a < acc) {
        acc = a;
        reason = why;
      }
    };

    // Vordermann
    const leader = this.findLeader(v);
    if (leader) obstacle(leader.gap, leader.vl, 'folgt');

    // Spieler
    const pl = this.playerAhead(v);
    if (pl) obstacle(pl.gap, pl.vl, 'Spieler');

    // Strecke voraus: Tempolimits, Ampeln, Kreuzungen
    let blockedJunction = false;
    for (let i = 0; i < v.route.length; i++) {
      const k = v.route[i];
      const off = v.off[i];
      if (off > 140) break;
      if (isCon(k)) continue;
      const L = g.lane(elemId(k));
      if (!L) break;
      // niedrigeres Tempolimit voraus
      if (i > 0) {
        const vl = (L.vmax / 3.6) * v.v0f;
        if (vl < v0) v0 = Math.min(v0, Math.sqrt(vl * vl + 2 * v.bComf * Math.max(0, off)));
      }
      // Ampeln
      if (L.stops) {
        for (const st of L.stops) {
          const d = off + st.s;
          if (d < -0.3 || d > 140) continue;
          const ctrl = this.view.controllers.get(st.ctrl);
          if (!ctrl) continue;
          const state = signalState(ctrl, st.grp, t);
          if (state === 'red' || (state === 'yellow' && d > (v.v * v.v) / (2 * 4) + 1.5)) obstacle(d - 0.4, 0, 'rot');
        }
      }
      // Kreuzung am Spurende
      const next = v.route[i + 1];
      const dEnd = off + g.length(k);
      if (next !== undefined && isCon(next) && dEnd < 80) {
        const C = g.con(elemId(next));
        if (!C) continue;
        // langsamer vor dem Abbiegen
        const vt = TURN_SPEED[C.turn];
        if (vt < 50) v0 = Math.min(v0, Math.sqrt(vt * vt + 2 * v.bComf * Math.max(0, dEnd)));
        if (!blockedJunction && v.committed !== C.id) {
          const wait = this.mustWait(v, L, C, dEnd, t) || this.exitBlocked(v, C);
          if (wait) {
            obstacle(dEnd - 0.6, 0, wait);
            blockedJunction = true;
          } else if (dEnd < (v.v * v.v) / (2 * v.bComf) + 3) v.committed = C.id;
        }
      }
      if (blockedJunction) break;
    }

    // freie Fahrt
    const free = v.aMax * (1 - Math.pow(v.v / Math.max(v0, 0.1), 4));
    if (free < acc) {
      acc = free;
      if (reason === 'frei' && v.v > v0 + 0.5) reason = 'bremst (Tempo)';
    }
    v.reason = reason;
    return Math.max(-9, acc);
  }

  /** Leerer String = darf fahren, sonst Grund fürs Warten */
  private mustWait(v: Vehicle, L: Lane, C: Connector, dEnd: number, t: number): string {
    const g = this.graph;
    let ctrl: LaneControl = L.ctrl;
    // Stoppschild: erst anhalten
    if (ctrl === 'stop') {
      if (v.stopDone !== L.id) {
        if (v.v < 0.4 && dEnd < 4) v.stopDone = L.id;
        else return 'Stopp';
      }
      ctrl = 'yield';
    }
    const myEta = Math.max(dEnd, 0) / Math.max(v.v, 3);
    const deadlock = v.waitTime > DEADLOCK_WAIT;
    for (const cf of g.conflictsOf(C)) {
      const K = g.con(cf.other);
      if (!K) continue;
      // 1) Kreuzung belegt: jemand auf dem Konfliktverbinder hat den Konfliktpunkt noch nicht geräumt
      if (dEnd + cf.sSelf < 30) {
        for (const w of this.byElem.get(conKey(K.id)) ?? []) {
          if (w.s - w.len < cf.sOther + 1.5 && w.s > cf.sOther - 30) return 'Kreuzung belegt';
        }
      }
      // 2) Annähernde Fahrzeuge mit Vorrang
      if (deadlock) continue;
      const KL = g.lane(K.from);
      if (!KL) continue;
      if (!this.yieldsTo(ctrl, L, C, KL, K, cf.merge, t)) continue;
      const kk = conKey(K.id);
      for (const w of this.vehicles) {
        if (w === v || w.crashed > 0) continue;
        const idx = w.route.indexOf(kk);
        if (idx < 1 || idx > 4) continue;
        const dW = w.off[idx];
        if (dW < -0.5 || dW > 90) continue;
        if (w.v < 0.5 && dW > 6) continue; // steht weiter hinten (z. B. an eigener Haltelinie)
        if (w.reason === 'rot' || w.reason === 'Vorfahrt' || w.reason === 'Stopp' || w.reason === 'rechts vor links') {
          if (w.v < 2) continue;
        }
        const etaW = dW / Math.max(w.v, 1);
        if (etaW < GAP_TIME && etaW < myEta + GAP_TIME) return ctrl === 'rbl' ? 'rechts vor links' : 'Vorfahrt';
      }
    }
    return '';
  }

  /** Nicht in die Kreuzung einfahren, wenn dahinter kein Platz ist (sonst blockiert man den Querverkehr) */
  private exitBlocked(v: Vehicle, C: Connector): string {
    if (v.waitTime > DEADLOCK_WAIT * 2) return '';
    let first: Vehicle | null = null;
    for (const w of this.byElem.get(laneKey(C.to)) ?? []) if (!first || w.s < first.s) first = w;
    if (first && first.s - first.len < v.len + 2 && first.v < 3) return 'Ausfahrt voll';
    for (const w of this.byElem.get(conKey(C.id)) ?? []) if (w.v < 1 && w.s < v.len + 2) return 'Ausfahrt voll';
    return '';
  }

  /** Muss ich (auf Spur L, Verbinder C) dem Verkehr von Spur KL über Verbinder K Vorrang lassen? */
  private yieldsTo(myCtrl: LaneControl, L: Lane, C: Connector, KL: Lane, K: Connector, merge: boolean, t: number): boolean {
    const theirCtrl = KL.ctrl;
    if (theirCtrl === 'signal' && this.isRedAtEnd(KL, t)) return false;
    const r1 = RANK[myCtrl];
    const r2 = RANK[theirCtrl];
    if (r1 < r2) return true;
    if (r1 > r2) return false;
    const rel = this.relHeading(L, KL);
    if (r1 <= 2) {
      // rechts vor links (auch unter gleichrangigen Nebenstraßen)
      return rel > Math.PI / 4 && rel < (3 * Math.PI) / 4;
    }
    // beide bevorrechtigt / beide grün
    if (C.turn === 'uturn') return true;
    if (C.turn === 'left' && K.turn !== 'left' && Math.abs(rel) > (3 * Math.PI) / 4) return true;
    if (merge && C.turn !== 'through' && K.turn === 'through') return true;
    return false;
  }

  /** Winkel der anderen Fahrtrichtung relativ zu meiner (gegen den Uhrzeigersinn, -PI..PI) */
  private relHeading(L: Lane, KL: Lane): number {
    const g = this.graph;
    g.at(laneKey(L.id), g.length(laneKey(L.id)) - 0.5, tmp);
    g.at(laneKey(KL.id), g.length(laneKey(KL.id)) - 0.5, tmp2);
    let d = Math.atan2(tmp2.dy, tmp2.dx) - Math.atan2(tmp.dy, tmp.dx);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  private isRedAtEnd(L: Lane, t: number): boolean {
    if (!L.stops?.length) return false;
    const st = L.stops[L.stops.length - 1];
    const c = this.view.controllers.get(st.ctrl);
    return !!c && signalState(c, st.grp, t) !== 'green';
  }

  private findLeader(v: Vehicle): { gap: number; vl: number } | null {
    let best = Infinity;
    let vl = 0;
    for (let i = 0; i < v.route.length; i++) {
      const off = v.off[i];
      if (off > 120) break;
      const list = this.byElem.get(v.route[i]);
      if (!list) continue;
      for (const w of list) {
        if (w === v) continue;
        if (i === 0 && w.s <= v.s) continue;
        const gap = off + w.s - w.len;
        if (gap < best) {
          best = gap;
          vl = w.v;
        }
      }
      if (best < Infinity) break;
    }
    return best < Infinity ? { gap: best, vl } : null;
  }

  private playerAhead(v: Vehicle): { gap: number; vl: number } | null {
    const p = this.player;
    if (Math.abs(p.x - v.x) > 70 || Math.abs(p.y - v.y) > 70) return null;
    const g = this.graph;
    for (let i = 0; i < Math.min(4, v.route.length); i++) {
      const k = v.route[i];
      const off = v.off[i];
      if (off > 60) break;
      const lane = isCon(k) ? g.lane(g.con(elemId(k))?.from ?? -1) : g.lane(elemId(k));
      if (lane && lane.layer !== p.layer) continue;
      const pr = g.project(k, p.x, p.y);
      if (!pr || pr.d > 2.5) continue;
      const along = off + pr.s - p.spec.length / 2;
      if (along < -1.5) continue;
      g.at(k, pr.s, tmp);
      const vl = Math.max(0, p.vx * tmp.dx + p.vy * tmp.dy);
      return { gap: Math.max(0.1, along), vl };
    }
    return null;
  }

  private integrate(v: Vehicle, dt: number): void {
    if (v.crashed > 0) v.crashed -= dt;
    // Wartezeit für die Auflösung von Blockaden
    const r = v.reason;
    if (v.v < 0.3 && (r === 'Vorfahrt' || r === 'Stopp' || r === 'rechts vor links' || r === 'Kreuzung belegt' || r === 'Ausfahrt voll')) v.waitTime += dt;
    else if (v.v > 2) v.waitTime = 0;
    v.v = Math.max(0, v.v + v.a * dt);
    v.s += v.v * dt;
    const g = this.graph;
    while (v.route.length && v.s > g.length(v.route[0])) {
      if (v.route.length === 1) {
        v.dead = true;
        return;
      }
      v.s -= g.length(v.route[0]);
      v.prev = v.route.shift()!;
      v.off.shift();
      if (!isCon(v.route[0])) v.committed = -1;
    }
  }

  private pose(v: Vehicle): void {
    const g = this.graph;
    const k = v.route[0];
    if (!g.at(k, v.s, tmp)) {
      v.dead = true;
      return;
    }
    const rs = v.s - v.len;
    if (rs >= 0 || v.prev === null) g.at(k, rs, tmp2);
    else g.at(v.prev, g.length(v.prev) + rs, tmp2);
    v.x = (tmp.x + tmp2.x) / 2;
    v.y = (tmp.y + tmp2.y) / 2;
    const dx = tmp.x - tmp2.x;
    const dy = tmp.y - tmp2.y;
    if (dx * dx + dy * dy > 0.01) v.hdg = Math.atan2(dy, dx);
  }

  // ---------------------------------------------------------------- Erzeugen

  private updateCandidates(): void {
    const px = this.player.x;
    const py = this.player.y;
    const seen = new Set<number>();
    this.candidates = [];
    this.candTotal = 0;
    for (const t of this.view.tilesAround(px, py, SPAWN_R)) {
      for (const l of t.lanes) {
        if (seen.has(l.id) || l.iso || l.len < 18 || !l.out.length) continue;
        seen.add(l.id);
        const w = (CLASS_WEIGHT[l.cls] ?? 0) * l.len;
        if (w <= 0) continue;
        const mx = l.pts[l.pts.length >> 1] / 10;
        if (Math.hypot(mx - px, l.pts[(l.pts.length >> 1) + 1] / 10 - py) > SPAWN_R) continue;
        this.candidates.push({ lane: l, w });
        this.candTotal += w;
      }
    }
    this.target = Math.min(this.maxVehicles, Math.round((this.candTotal / 60) * this.density));
  }

  private spawn(dt: number): void {
    this.candTimer -= dt;
    if (this.candTimer <= 0) {
      this.updateCandidates();
      this.candTimer = 1.5;
    }
    if (!this.candidates.length) return;
    const px = this.player.x;
    const py = this.player.y;
    const minDist = this.filled ? 150 : 25;
    let attempts = this.filled ? 6 : 400;
    while (this.vehicles.length < this.target && attempts-- > 0) {
      let r = Math.random() * this.candTotal;
      let lane = this.candidates[0].lane;
      for (const c of this.candidates) {
        r -= c.w;
        if (r <= 0) {
          lane = c.lane;
          break;
        }
      }
      const type: VType = Math.random() < 0.04 && RANKED_BUS.has(lane.cls) ? 'bus' : Math.random() < 0.1 ? 'van' : 'car';
      const len = type === 'bus' ? 12 : type === 'van' ? 5.4 : 4.2 + Math.random() * 0.7;
      if (lane.len < len + 4) continue;
      const s = len + 1 + Math.random() * (lane.len - len - 2);
      const k = laneKey(lane.id);
      if (!this.graph.at(k, s, tmp)) continue;
      const d = Math.hypot(tmp.x - px, tmp.y - py);
      if (d < minDist || d > SPAWN_R) continue;
      const list = this.byElem.get(k) ?? [];
      if (list.some((w) => Math.abs(w.s - s) < len + 10)) continue;
      const v: Vehicle = {
        id: this.nextId++,
        type,
        len,
        width: type === 'bus' ? 2.55 : type === 'van' ? 2.0 : 1.8,
        color: type === 'bus' ? 0xc8102e : type === 'van' ? (Math.random() < 0.7 ? 0xf4f4f4 : COLORS[(Math.random() * COLORS.length) | 0]) : COLORS[(Math.random() * COLORS.length) | 0],
        route: [k],
        off: [],
        prev: null,
        s,
        v: (lane.vmax / 3.6) * 0.6,
        a: 0,
        v0f: 0.88 + Math.random() * 0.2,
        aMax: type === 'bus' ? 1.0 : type === 'van' ? 1.3 : 1.5 + Math.random() * 0.6,
        bComf: type === 'bus' ? 1.8 : 2.4,
        T: type === 'bus' ? 1.6 : 1.0 + Math.random() * 0.5,
        s0: 2,
        stopDone: -1,
        waitTime: 0,
        committed: -1,
        crashed: 0,
        reason: '',
        x: tmp.x,
        y: tmp.y,
        hdg: Math.atan2(tmp.dy, tmp.dx),
        dead: false,
      };
      this.vehicles.push(v);
      list.push(v);
      list.sort((a, b) => a.s - b.s);
      this.byElem.set(k, list);
    }
    if (this.vehicles.length >= this.target * 0.9) this.filled = true;
  }

  // ---------------------------------------------------------------- Spieler

  /** Kollision Spieler <-> KI (Trennachsen-Test zweier Rechtecke). Gibt die Aufprallgeschwindigkeit zurück. */
  collidePlayer(): number {
    const p = this.player;
    let impact = 0;
    for (const v of this.vehicles) {
      if (Math.abs(v.x - p.x) > 9 || Math.abs(v.y - p.y) > 9) continue;
      const res = obbOverlap(p.x, p.y, p.heading, p.spec.length / 2, p.spec.width / 2, v.x, v.y, v.hdg, v.len / 2, v.width / 2);
      if (!res) continue;
      const [nx, ny, depth] = res;
      p.x += nx * (depth + 0.01);
      p.y += ny * (depth + 0.01);
      // KI-Fahrzeug fährt geradeaus: Geschwindigkeitsvektor
      const vvx = Math.cos(v.hdg) * v.v;
      const vvy = Math.sin(v.hdg) * v.v;
      const rel = (p.vx - vvx) * nx + (p.vy - vvy) * ny;
      if (rel < 0) {
        p.vx -= 1.3 * rel * nx;
        p.vy -= 1.3 * rel * ny;
        p.vx *= 0.9;
        p.vy *= 0.9;
        impact = Math.max(impact, -rel);
        if (-rel > 2) {
          v.v = 0;
          v.crashed = 2.5 + Math.min(4, -rel / 4);
        }
      }
    }
    return impact;
  }

  /** Rotlichtverstöße des Spielers erkennen */
  private checkPlayerSignals(t: number): void {
    const p = this.player;
    const speed = p.speed;
    const lane = this.findPlayerLane();
    const prevLane = this.playerLane;
    const prevS = this.playerS;
    let s = 0;
    if (lane) s = this.graph.project(laneKey(lane.id), p.x, p.y)?.s ?? 0;
    if (speed > 2 && prevLane?.stops) {
      for (const st of prevLane.stops) {
        let crossed = false;
        if (lane && lane.id === prevLane.id) crossed = prevS < st.s && s >= st.s;
        else crossed = st.s >= prevLane.len - 3 && prevS > prevLane.len - 15 && prevS <= st.s + 1;
        if (!crossed) continue;
        const c = this.view.controllers.get(st.ctrl);
        if (!c || signalState(c, st.grp, t) !== 'red') continue;
        if (t - (this.lastViolation.get(st.ctrl) ?? -99) < 8) continue;
        this.lastViolation.set(st.ctrl, t);
        const e: TrafficEvent = { type: 'red_light', t, x: p.x, y: p.y, ctrl: st.ctrl };
        this.events.push(e);
        this.onEvent?.(e);
      }
    }
    this.playerLane = lane;
    this.playerS = s;
  }

  private findPlayerLane(): Lane | null {
    const p = this.player;
    const [fx, fy] = p.forward;
    let best: Lane | null = null;
    let bestScore = Infinity;
    for (const t of this.view.tilesAround(p.x, p.y, 6)) {
      for (const l of t.lanes) {
        if (l.layer !== p.layer) continue;
        const pr = this.graph.project(laneKey(l.id), p.x, p.y);
        if (!pr || pr.d > l.w * 0.75 + 0.5) continue;
        this.graph.at(laneKey(l.id), pr.s, tmp);
        const align = tmp.dx * fx + tmp.dy * fy;
        if (align < 0.5) continue;
        const score = pr.d - align;
        if (score < bestScore) {
          bestScore = score;
          best = l;
        }
      }
    }
    return best;
  }

  /** Fahrzeug an einer Weltposition (für die Debug-Auswahl) */
  vehicleAt(x: number, y: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = 4;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < Math.max(bd, v.len / 2) && d < bd + v.len / 2) {
        bd = d;
        best = v;
      }
    }
    return best;
  }
}

const RANKED_BUS = new Set<RoadClass>(['primary', 'secondary', 'tertiary']);

/** Überlappung zweier gedrehter Rechtecke. Liefert Normale (von B nach A) und Eindringtiefe. */
function obbOverlap(
  ax: number,
  ay: number,
  ah: number,
  ahl: number,
  ahw: number,
  bx: number,
  by: number,
  bh: number,
  bhl: number,
  bhw: number,
): [number, number, number] | null {
  const axes: Array<[number, number]> = [
    [Math.cos(ah), Math.sin(ah)],
    [-Math.sin(ah), Math.cos(ah)],
    [Math.cos(bh), Math.sin(bh)],
    [-Math.sin(bh), Math.cos(bh)],
  ];
  const dx = ax - bx;
  const dy = ay - by;
  let minDepth = Infinity;
  let n: [number, number] = [0, 0];
  for (const [ux, uy] of axes) {
    const ra = ahl * Math.abs(Math.cos(ah) * ux + Math.sin(ah) * uy) + ahw * Math.abs(-Math.sin(ah) * ux + Math.cos(ah) * uy);
    const rb = bhl * Math.abs(Math.cos(bh) * ux + Math.sin(bh) * uy) + bhw * Math.abs(-Math.sin(bh) * ux + Math.cos(bh) * uy);
    const dist = dx * ux + dy * uy;
    const depth = ra + rb - Math.abs(dist);
    if (depth <= 0) return null;
    if (depth < minDepth) {
      minDepth = depth;
      n = dist >= 0 ? [ux, uy] : [-ux, -uy];
    }
  }
  return [n[0], n[1], minDepth];
}
