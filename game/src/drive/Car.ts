/**
 * Arcade-Fahrphysik: Längs- und Querdynamik getrennt, Drift über reduzierte Seitenführung.
 * Einheiten: Meter, Sekunden, Radiant. Heading 0 = Osten, gegen den Uhrzeigersinn.
 */
import { closestOnPoly, polyContains, type Ground, type Poly } from './WorldQuery.ts';

export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (bremst, im Stand: rückwärts)
  steer: number; // -1 (rechts) .. 1 (links)
  handbrake: boolean;
}

export interface CarSpec {
  length: number;
  width: number;
  maxSpeed: number; // m/s vorwärts
  maxReverse: number;
  accel: number; // m/s² bei Stillstand
  brake: number;
  steerRate: number; // rad/s maximale Gierrate bei optimaler Geschwindigkeit
  grip: number; // Abbau der Seitengeschwindigkeit (1/s)
  driftGrip: number; // mit Handbremse
}

export const DEFAULT_CAR: CarSpec = {
  length: 4.4,
  width: 1.85,
  maxSpeed: 52, // ~ 187 km/h
  maxReverse: 9,
  accel: 8.5,
  brake: 16,
  steerRate: 2.3,
  grip: 9,
  driftGrip: 1.4,
};

const GROUND: Record<Ground, { drag: number; topFactor: number; grip: number }> = {
  road: { drag: 0.25, topFactor: 1, grip: 1 },
  offroad: { drag: 2.2, topFactor: 0.45, grip: 0.7 },
  water: { drag: 9, topFactor: 0.12, grip: 0.3 },
};

export interface Impact {
  speed: number; // Aufprallgeschwindigkeit senkrecht zur Wand (m/s)
  x: number;
  y: number;
}

export class Car {
  x = 0;
  y = 0;
  heading = 0;
  vx = 0;
  vy = 0;
  /** geglätteter Lenkeinschlag -1..1 */
  steer = 0;
  /** aktuelle Ebene (0 Boden, >0 Brücke, <0 Tunnel) */
  layer = 0;
  ground: Ground = 'road';
  braking = false;
  reversing = false;
  /** Nitro aktiv (0/1) */
  boost = 0;
  /** Tempo-Faktor aus dem Admin-Panel */
  power = 1;
  /** vom Admin-Panel eingestellter Leistungsfaktor (power = userPower × Schaden) */
  userPower = 1;
  /** Haftung je nach Wetter (1 = trocken) */
  gripScale = 1;

  constructor(public spec: CarSpec = DEFAULT_CAR) {}

  get forward(): [number, number] {
    return [Math.cos(this.heading), Math.sin(this.heading)];
  }

  /** Geschwindigkeit in Fahrtrichtung (m/s, negativ = rückwärts) */
  get speed(): number {
    const [fx, fy] = this.forward;
    return this.vx * fx + this.vy * fy;
  }

  place(x: number, y: number, heading: number): void {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.vx = this.vy = 0;
    this.steer = 0;
  }

  step(dt: number, inp: CarInput): void {
    const s = this.spec;
    const g = GROUND[this.ground];
    const fx = Math.cos(this.heading);
    const fy = Math.sin(this.heading);
    const lx = -fy;
    const ly = fx;
    let vF = this.vx * fx + this.vy * fy;
    let vL = this.vx * lx + this.vy * ly;

    // Lenkung glätten (Tastatur liefert nur -1/0/1)
    const steerSpeed = Math.abs(inp.steer) > Math.abs(this.steer) ? 5 : 8;
    this.steer += Math.max(-steerSpeed * dt, Math.min(steerSpeed * dt, inp.steer - this.steer));

    // Längsdynamik
    const top = s.maxSpeed * g.topFactor * this.power * (1 + 0.28 * this.boost);
    const acc = s.accel * this.power * (1 + 1.1 * this.boost);
    let a = 0;
    this.braking = false;
    this.reversing = false;
    if (inp.throttle > 0) {
      if (vF < -0.5) {
        a += s.brake * inp.throttle;
        this.braking = true;
      } else a += acc * inp.throttle * Math.max(0, 1 - (vF / top) ** 2);
    }
    if (inp.brake > 0) {
      if (vF > 0.5) {
        a -= s.brake * inp.brake;
        this.braking = true;
      } else {
        a -= s.accel * 0.6 * inp.brake * Math.max(0, 1 - (-vF / (s.maxReverse * g.topFactor)) ** 2);
        this.reversing = vF < 0.1;
      }
    }
    if (inp.handbrake) a -= Math.sign(vF) * 4;
    // Roll- und Luftwiderstand
    const drag = g.drag + 0.0009 * vF * vF + (inp.throttle === 0 && inp.brake === 0 ? 0.9 : 0);
    const dv = a * dt;
    const dragDv = Math.min(Math.abs(vF + dv), drag * dt) * Math.sign(vF + dv);
    vF = vF + dv - dragDv;
    if (inp.throttle === 0 && inp.brake === 0 && Math.abs(vF) < 0.15) vF = 0;

    // Gieren: bei Stillstand keine Drehung, bei hohem Tempo größerer Wendekreis
    const absV = Math.abs(vF);
    const lowSpeed = Math.min(1, absV / 5);
    const highSpeed = 1 / (1 + absV / 28);
    const yaw = this.steer * s.steerRate * lowSpeed * highSpeed * Math.sign(vF || 1);
    this.heading += yaw * dt;

    // Seitenführung
    const grip = (inp.handbrake ? s.driftGrip : s.grip) * g.grip * this.gripScale;
    vL *= Math.exp(-grip * dt);

    // neu zusammensetzen in der gedrehten Fahrtrichtung
    const nfx = Math.cos(this.heading);
    const nfy = Math.sin(this.heading);
    this.vx = nfx * vF - nfy * vL;
    this.vy = nfy * vF + nfx * vL;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** Eckpunkte und Kantenmitten des Autos (für Kollision) */
  probePoints(): Array<[number, number]> {
    const hl = this.spec.length / 2;
    const hw = this.spec.width / 2;
    const fx = Math.cos(this.heading);
    const fy = Math.sin(this.heading);
    const lx = -fy;
    const ly = fx;
    const pts: Array<[number, number]> = [];
    for (const [a, b] of [
      [hl, hw],
      [hl, -hw],
      [-hl, hw],
      [-hl, -hw],
      [hl, 0],
      [-hl, 0],
      [0, hw],
      [0, -hw],
    ]) {
      pts.push([this.x + fx * a + lx * b, this.y + fy * a + ly * b]);
    }
    return pts;
  }

  /**
   * Kollision mit Gebäuden auflösen. `passable(x, y)` erlaubt Punkte auf Fahrbahnen
   * (Durchfahrten unter Gebäuden, Datenfehler).
   */
  collide(buildings: Poly[], passable: (x: number, y: number) => boolean): Impact | null {
    let impact: Impact | null = null;
    for (let iter = 0; iter < 3; iter++) {
      let bestDepth = 0;
      let push: [number, number] = [0, 0];
      let at: [number, number] = [0, 0];
      // 1) Autopunkte in Gebäuden
      for (const [px, py] of this.probePoints()) {
        for (const b of buildings) {
          if (!polyContains(b, px, py)) continue;
          if (passable(px, py)) continue;
          const c = closestOnPoly(b, px, py);
          if (c.d > bestDepth) {
            bestDepth = c.d;
            push = [(c.x - px) / (c.d || 1), (c.y - py) / (c.d || 1)];
            at = [px, py];
          }
        }
      }
      // 2) Gebäudeecken im Auto (spitze Ecken treffen die Seite)
      const hl = this.spec.length / 2;
      const hw = this.spec.width / 2;
      const fx = Math.cos(this.heading);
      const fy = Math.sin(this.heading);
      for (const b of buildings) {
        const r = b.outer;
        for (let i = 0; i < r.length; i += 2) {
          const dx = r[i] - this.x;
          const dy = r[i + 1] - this.y;
          const u = dx * fx + dy * fy; // längs
          const v = -dx * fy + dy * fx; // quer (links +)
          if (Math.abs(u) >= hl || Math.abs(v) >= hw) continue;
          if (passable(r[i], r[i + 1])) continue;
          // kürzester Weg hinaus: über die nächstgelegene Seite
          const dU = hl - Math.abs(u);
          const dV = hw - Math.abs(v);
          let n: [number, number];
          let depth: number;
          if (dV < dU) {
            depth = dV;
            // Ecke links vom Auto -> Auto nach rechts schieben und umgekehrt
            n = [fy * (v > 0 ? 1 : -1), -fx * (v > 0 ? 1 : -1)];
          } else {
            depth = dU;
            n = [-fx * Math.sign(u), -fy * Math.sign(u)];
          }
          if (depth > bestDepth) {
            bestDepth = depth;
            push = n;
            at = [r[i], r[i + 1]];
          }
        }
      }
      if (bestDepth <= 0) break;
      // hinausschieben
      this.x += push[0] * (bestDepth + 0.01);
      this.y += push[1] * (bestDepth + 0.01);
      // Geschwindigkeit: Normalanteil abprallen lassen, Tangentialanteil bremsen
      const vn = this.vx * push[0] + this.vy * push[1];
      if (vn < 0) {
        const restitution = 0.25;
        this.vx -= (1 + restitution) * vn * push[0];
        this.vy -= (1 + restitution) * vn * push[1];
        this.vx *= 0.92;
        this.vy *= 0.92;
        if (!impact || -vn > impact.speed) impact = { speed: -vn, x: at[0], y: at[1] };
      }
    }
    return impact;
  }
}
