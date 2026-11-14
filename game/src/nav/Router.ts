/**
 * Routensuche (A*) über den Spurgraphen. Kosten = geschätzte Fahrzeit in Sekunden.
 */
import { LANE_ISO, LANE_MINOR_CTRL, LANE_SERVICE, LANE_SIGNAL, TURN_CODES, type RoutingGraph } from '@nrs/shared';

const TURN_PENALTY: Record<string, number> = { through: 0, merge: 1, left: 7, right: 3.5, uturn: 45 };
const H_SPEED = 19; // m/s für die Schätzung der Restzeit (leicht optimistisch)

export interface RouteResult {
  lanes: number[];
  /** Fahrzeit in s und Länge in m (ab Startposition bis Ziel) */
  time: number;
  length: number;
}

export class Router {
  private g: Float64Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private gen = 0;
  constructor(private G: RoutingGraph) {
    this.g = new Float64Array(G.n);
    this.came = new Int32Array(G.n);
    this.stamp = new Uint32Array(G.n);
  }

  private speed(l: number): number {
    const G = this.G;
    let v = Math.max(5, (G.vmax[l] / 3.6) * 0.85);
    if (G.flags[l] & LANE_SERVICE) v *= 0.5;
    if (G.flags[l] & LANE_ISO) v *= 0.4;
    return v;
  }

  route(fromLane: number, fromS: number, toLane: number, toS: number): RouteResult | null {
    const G = this.G;
    if (fromLane < 0 || toLane < 0 || fromLane >= G.n || toLane >= G.n) return null;
    if (fromLane === toLane && toS >= fromS) {
      const len = toS - fromS;
      return { lanes: [fromLane], time: len / this.speed(fromLane), length: len };
    }
    const gen = ++this.gen;
    const tx = (G.x0[toLane] + G.x1[toLane]) / 20;
    const ty = (G.y0[toLane] + G.y1[toLane]) / 20;
    const h = (l: number) => Math.hypot(G.x1[l] / 10 - tx, G.y1[l] / 10 - ty) / H_SPEED;
    const heap = new MinHeap();
    const startCost = Math.max(0, G.len[fromLane] - fromS) / this.speed(fromLane);
    // Start: alle Nachfolger der Startspur (so geht auch "Ziel liegt hinter mir auf derselben Spur")
    const relax = (u: number, gu: number, prevMarker: number) => {
      const ctrlPenalty = G.flags[u] & LANE_SIGNAL ? 12 : G.flags[u] & LANE_MINOR_CTRL ? 3 : 0;
      for (let e = G.outStart[u]; e < G.outStart[u + 1]; e++) {
        const v = G.target[e];
        const vSpeed = this.speed(v);
        const laneCost = v === toLane ? toS / vSpeed : G.len[v] / vSpeed;
        const c = gu + G.conLen[e] / Math.min(vSpeed, 12) + TURN_PENALTY[TURN_CODES[G.turn[e]]] + ctrlPenalty + laneCost;
        if (this.stamp[v] !== gen || c < this.g[v]) {
          this.stamp[v] = gen;
          this.g[v] = c;
          this.came[v] = prevMarker;
          heap.push(v, c + (v === toLane ? 0 : h(v)));
        }
      }
    };
    relax(fromLane, startCost, -2);
    let found = false;
    let expanded = 0;
    while (heap.size) {
      const u = heap.pop();
      if (u === toLane) {
        found = true;
        break;
      }
      if (++expanded > 200000) break;
      relax(u, this.g[u], u);
    }
    if (!found) return null;
    const lanes: number[] = [];
    for (let l = toLane, guard = 0; l !== -2 && guard < 100000; l = this.came[l], guard++) lanes.push(l);
    lanes.push(fromLane);
    lanes.reverse();
    let length = G.len[fromLane] - fromS + toS;
    for (let i = 1; i < lanes.length - 1; i++) length += G.len[lanes[i]];
    return { lanes, time: this.g[toLane], length };
  }
}

/** Binärer Min-Heap für (Knoten, Priorität) */
class MinHeap {
  private ids: number[] = [];
  private pr: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, p: number): void {
    const ids = this.ids;
    const pr = this.pr;
    let i = ids.length;
    ids.push(id);
    pr.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= p) break;
      ids[i] = ids[parent];
      pr[i] = pr[parent];
      i = parent;
    }
    ids[i] = id;
    pr[i] = p;
  }
  pop(): number {
    const ids = this.ids;
    const pr = this.pr;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastP = pr.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && pr[r] < pr[l] ? r : l;
        if (pr[c] >= lastP) break;
        ids[i] = ids[c];
        pr[i] = pr[c];
        i = c;
      }
      ids[i] = lastId;
      pr[i] = lastP;
    }
    return top;
  }
}
