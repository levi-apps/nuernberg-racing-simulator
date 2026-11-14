/**
 * Straßenrennen: KI-Gegner fahren die Rennstrecke (Routenlinie) mit einem Tempoprofil
 * aus Kurvenradien – ohne Verkehrsregeln. Sie sind Geister für den übrigen Verkehr.
 */
import * as THREE from 'three';
import { Car } from '../drive/Car.ts';
import { CarMesh } from '../drive/CarMesh.ts';
import type { Body } from '../garage/Cars.ts';

type P = [number, number];

export interface Rival {
  name: string;
  s: number;
  v: number;
  top: number;
  aMax: number;
  latG: number;
  skill: number;
  car: Car;
  mesh: CarMesh;
  finished: number; // Zeit im Ziel oder -1
}

export class RacePath {
  cum: number[] = [];
  /** erlaubte Geschwindigkeit je Punkt für einen Fahrer mit Querbeschleunigung 1 m/s² (wird skaliert) */
  private radius: number[] = [];
  constructor(public pts: P[]) {
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    // Kurvenradius aus Richtungsänderung über ±8 m
    for (let i = 0; i < pts.length; i++) {
      const a = this.at(this.cum[i] - 8);
      const b = this.at(this.cum[i] + 8);
      const d1 = Math.atan2(pts[i][1] - a.y, pts[i][0] - a.x);
      const d2 = Math.atan2(b.y - pts[i][1], b.x - pts[i][0]);
      let dd = Math.abs(d2 - d1);
      if (dd > Math.PI) dd = 2 * Math.PI - dd;
      this.radius.push(dd > 1e-3 ? 16 / dd : 1e4);
    }
  }

  get length(): number {
    return this.cum[this.cum.length - 1];
  }

  at(s: number): { x: number; y: number; dx: number; dy: number } {
    const p = this.pts;
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = p.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] < s) lo = m;
      else hi = m;
    }
    const l = this.cum[hi] - this.cum[lo] || 1;
    const t = (s - this.cum[lo]) / l;
    const dx = (p[hi][0] - p[lo][0]) / l;
    const dy = (p[hi][1] - p[lo][1]) / l;
    return { x: p[lo][0] + (p[hi][0] - p[lo][0]) * t, y: p[lo][1] + (p[hi][1] - p[lo][1]) * t, dx, dy };
  }

  /** Höchsttempo an Stelle s für Querbeschleunigung latG, mit Vorausschau zum Bremsen */
  limit(s: number, latG: number, brake: number, top: number): number {
    let v = top;
    for (let look = 0; look <= 120; look += 6) {
      const r = this.radiusAt(s + look);
      const vc = Math.sqrt(latG * r);
      // so schnell darf man jetzt sein, um bis dorthin auf vc zu bremsen
      v = Math.min(v, Math.sqrt(vc * vc + 2 * brake * look));
    }
    return v;
  }

  private radiusAt(s: number): number {
    if (s >= this.length) return 1e4;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] < s) lo = m;
      else hi = m;
    }
    return Math.min(this.radius[lo], this.radius[hi]);
  }
}

const NAMES = ['Kevin', 'Jessy', 'Dragan', 'Mo', 'Lena', 'Toni', 'Chris', 'Sascha'];
const BODIES: Body[] = ['sport', 'compact', 'sedan', 'hyper'];
const COLORS = [0x1f4e8c, 0xe8701a, 0x355e3b, 0xf2f2f2, 0x6d2a8a, 0x111111];

export class RaceRivals {
  rivals: Rival[] = [];
  constructor(
    private scene: THREE.Scene,
    public path: RacePath,
  ) {}

  /** Gegner hinter/neben der Startlinie aufstellen; Stärke relativ zum Spielerauto */
  spawn(count: number, playerTop: number, playerAccel: number, use3d: boolean): void {
    for (let i = 0; i < count; i++) {
      const car = new Car({ ...new Car().spec, length: 4.5, width: 1.9 });
      const body = BODIES[i % BODIES.length];
      const mesh = new CarMesh(car, COLORS[(i + Math.floor(Math.random() * 3)) % COLORS.length], body);
      mesh.set3D(use3d);
      this.scene.add(mesh.group, mesh.group3d);
      const skill = 0.86 + Math.random() * 0.12;
      this.rivals.push({
        name: NAMES[(Math.random() * NAMES.length) | 0],
        s: -10 - i * 7,
        v: 0,
        top: playerTop * (0.9 + Math.random() * 0.12),
        aMax: playerAccel * (0.85 + Math.random() * 0.2),
        latG: 6.5 * skill,
        skill,
        car,
        mesh,
        finished: -1,
      });
    }
  }

  update(dt: number, t: number, started: boolean): void {
    for (const r of this.rivals) {
      if (started && r.finished < 0) {
        const vmax = this.path.limit(Math.max(0, r.s), r.latG, 6, r.top);
        if (r.v < vmax) r.v = Math.min(vmax, r.v + r.aMax * (1 - r.v / (r.top + 1)) * dt);
        else r.v = Math.max(vmax, r.v - 9 * dt);
        r.s += r.v * dt;
        if (r.s >= this.path.length) r.finished = t;
      }
      const s = Math.max(0, Math.min(r.s, this.path.length));
      const p = this.path.at(s);
      // seitlich versetzt, damit sie nicht exakt übereinander fahren
      const lane = ((this.rivals.indexOf(r) % 2) * 2 - 1) * 1.2;
      const back = r.s < 0 ? r.s : 0;
      r.car.x = p.x + p.dx * back - p.dy * lane;
      r.car.y = p.y + p.dy * back + p.dx * lane;
      r.car.heading = Math.atan2(p.dy, p.dx);
      r.car.vx = p.dx * r.v;
      r.car.vy = p.dy * r.v;
      r.car.braking = false;
      r.mesh.update(r.car);
    }
  }

  dispose(): void {
    for (const r of this.rivals) {
      this.scene.remove(r.mesh.group, r.mesh.group3d);
      r.mesh.dispose();
    }
    this.rivals = [];
  }
}
