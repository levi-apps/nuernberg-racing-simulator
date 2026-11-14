/**
 * Schaden am Spielerauto: Dellen, abfallende Teile, Rauch aus dem Motor, weniger Leistung.
 */
import * as THREE from 'three';
import { models } from '../assets/Models.ts';
import { RL_MAIN } from '../world/TileView.ts';
import type { Car } from './Car.ts';
import type { CarMesh } from './CarMesh.ts';
import type { DriveFx } from './DriveFx.ts';

interface Piece {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  half: number;
  rest: boolean;
  age: number;
}

const BODY_PARTS = ['debris-plate-a', 'debris-plate-b', 'debris-plate-small-a', 'debris-plate-small-b'];

export class CarDamage {
  /** 0 = heil, 1 = Totalschaden */
  level = 0;
  private pieces: Piece[] = [];
  private group = new THREE.Group();
  private smokeAcc = 0;
  private lostBumperFront = false;
  private lostBumperRear = false;
  private dark = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.8, transparent: true });
  private metal = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.4, metalness: 0.7, transparent: true });
  private paintMats = new Map<number, THREE.MeshStandardMaterial>();
  private glass: THREE.Points;
  private glassPos = new Float32Array(240 * 3);
  private glassVel = new Float32Array(240 * 3);
  private glassNext = 0;
  /** Leistungsfaktor durch Schaden */
  get power(): number {
    return 1 - Math.max(0, this.level - 0.3) * 0.55;
  }

  constructor(scene: THREE.Scene) {
    this.group.layers.set(RL_MAIN);
    scene.add(this.group);
    const g = new THREE.BufferGeometry();
    this.glassPos.fill(-1000);
    g.setAttribute('position', new THREE.BufferAttribute(this.glassPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.glass = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe6f2, size: 0.06, transparent: true, opacity: 0.85, depthWrite: false }));
    this.glass.frustumCulled = false;
    this.glass.renderOrder = 26;
    this.glass.layers.set(RL_MAIN);
    scene.add(this.glass);
  }

  /**
   * Aufprall: Geschwindigkeit (m/s) und Richtung, aus der der Stoß kam (Welt, Einheitsvektor
   * vom Hindernis zum Auto). Erzeugt Delle, Teile und Glassplitter.
   */
  hit(car: Car, mesh: CarMesh, speed: number, nx: number, ny: number, in3d: boolean): void {
    if (speed < 3) return;
    const L = car.spec.length;
    const W = car.spec.width;
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    // Stelle der Karosserie, die das Hindernis getroffen hat (gegen die Stoßrichtung)
    let lx = -(nx * c + ny * s);
    let ly = -(-nx * s + ny * c);
    const k = 1 / Math.max(Math.abs(lx) / (L / 2), Math.abs(ly) / (W / 2), 1e-3);
    lx *= k * 0.98;
    ly *= k * 0.98;
    const before = this.level;
    this.level = Math.min(1, this.level + Math.min(0.35, (speed - 3) * 0.018));
    if (in3d) mesh.dent(lx, ly, 0.55, Math.min(0.3, 0.05 + speed * 0.013));
    mesh.setWear(this.level);
    if (!in3d) return;
    const wx = car.x + lx * c - ly * s;
    const wy = car.y + lx * s + ly * c;
    // Glassplitter
    const shards = Math.min(60, Math.floor(speed * 3));
    for (let i = 0; i < shards; i++) {
      const j = this.glassNext;
      this.glassNext = (this.glassNext + 1) % 240;
      this.glassPos[j * 3] = wx;
      this.glassPos[j * 3 + 1] = wy;
      this.glassPos[j * 3 + 2] = 0.9;
      this.glassVel[j * 3] = car.vx * 0.5 + nx * 2 + (Math.random() - 0.5) * 5;
      this.glassVel[j * 3 + 1] = car.vy * 0.5 + ny * 2 + (Math.random() - 0.5) * 5;
      this.glassVel[j * 3 + 2] = 1 + Math.random() * 3;
    }
    // abfallende Teile
    let n = speed > 9 ? 1 + Math.floor(Math.random() * Math.min(3, speed / 8)) : speed > 6 && Math.random() < 0.5 ? 1 : 0;
    const front = lx > L * 0.35;
    const rear = lx < -L * 0.35;
    if (speed > 11 && ((front && !this.lostBumperFront) || (rear && !this.lostBumperRear))) {
      this.spawn('debris-bumper', mesh.color, wx, wy, car, nx, ny, car.heading + Math.PI / 2);
      if (front) this.lostBumperFront = true;
      else this.lostBumperRear = true;
      n--;
    }
    for (let i = 0; i < n; i++) this.spawn(BODY_PARTS[Math.floor(Math.random() * BODY_PARTS.length)], mesh.color, wx, wy, car, nx, ny, Math.random() * 6.28);
    if (speed > 8) for (let i = 0; i < 3; i++) this.spawn('debris-bolt', -1, wx, wy, car, nx, ny, 0);
    if (this.level >= 0.6 && before < 0.6) this.spawn(Math.random() < 0.5 ? 'debris-door' : 'debris-spoiler-a', mesh.color, wx, wy, car, nx, ny, car.heading);
  }

  private spawn(name: string, color: number, x: number, y: number, car: Car, nx: number, ny: number, h: number): void {
    const geo = models.debris.get(name);
    if (!geo) return;
    let mat: THREE.Material = this.metal;
    if (name === 'debris-tire') mat = this.dark;
    else if (color >= 0) {
      let m = this.paintMats.get(color);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3, transparent: true });
        this.paintMats.set(color, m);
      }
      mat = m;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, 0.6);
    mesh.rotation.set(0, 0, h);
    mesh.renderOrder = 24;
    mesh.castShadow = true;
    mesh.layers.set(RL_MAIN);
    geo.computeBoundingBox();
    const half = Math.max(0.02, (geo.boundingBox!.max.z - geo.boundingBox!.min.z) / 2);
    this.group.add(mesh);
    this.pieces.push({
      mesh,
      vx: car.vx * 0.55 + nx * 2.5 + (Math.random() - 0.5) * 3,
      vy: car.vy * 0.55 + ny * 2.5 + (Math.random() - 0.5) * 3,
      vz: 2 + Math.random() * 3,
      wx: (Math.random() - 0.5) * 14,
      wy: (Math.random() - 0.5) * 14,
      wz: (Math.random() - 0.5) * 8,
      half,
      rest: false,
      age: 0,
    });
    if (this.pieces.length > 40) {
      const p = this.pieces.shift()!;
      this.group.remove(p.mesh);
    }
  }

  update(dt: number, car: Car, fx: DriveFx, in3d: boolean): void {
    this.group.visible = in3d;
    this.glass.visible = in3d;
    car.power = this.power * car.userPower;
    for (const p of this.pieces) {
      p.age += dt;
      if (p.rest) continue;
      const m = p.mesh;
      p.vz -= 9.81 * dt;
      m.position.x += p.vx * dt;
      m.position.y += p.vy * dt;
      m.position.z += p.vz * dt;
      m.rotation.x += p.wx * dt;
      m.rotation.y += p.wy * dt;
      m.rotation.z += p.wz * dt;
      const floor = p.half * 0.6;
      if (m.position.z < floor) {
        m.position.z = floor;
        if (Math.abs(p.vz) < 1.3) {
          p.rest = true;
          // flach hinlegen
          m.rotation.x = Math.round(m.rotation.x / Math.PI) * Math.PI;
          m.rotation.y = Math.round(m.rotation.y / Math.PI) * Math.PI;
          m.position.z = p.half * 0.5;
          continue;
        }
        p.vz = -p.vz * 0.3;
        p.vx *= 0.55;
        p.vy *= 0.55;
        p.wx *= 0.5;
        p.wy *= 0.5;
        p.wz *= 0.5;
      }
    }
    // Teile weit weg verschwinden
    this.pieces = this.pieces.filter((p) => {
      if (Math.hypot(p.mesh.position.x - car.x, p.mesh.position.y - car.y) > 300 || p.age > 240) {
        this.group.remove(p.mesh);
        return false;
      }
      return true;
    });
    // Glassplitter
    const gp = this.glassPos;
    for (let i = 0; i < 240; i++) {
      const k = i * 3;
      if (gp[k + 2] <= 0.015) continue;
      this.glassVel[k + 2] -= 9.81 * dt;
      gp[k] += this.glassVel[k] * dt;
      gp[k + 1] += this.glassVel[k + 1] * dt;
      gp[k + 2] += this.glassVel[k + 2] * dt;
      if (gp[k + 2] < 0.015) gp[k + 2] = 0.015;
    }
    (this.glass.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // Motorrauch
    if (this.level > 0.4 && in3d) {
      const rate = (this.level - 0.4) * 30;
      this.smokeAcc += dt * rate;
      const c = Math.cos(car.heading);
      const s = Math.sin(car.heading);
      const fx0 = car.spec.length * 0.36;
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        fx.engineSmoke(car.x + c * fx0, car.y + s * fx0, 1.0, Math.min(1, (this.level - 0.4) * 1.8), car.vx, car.vy);
      }
    }
  }

  repair(mesh: CarMesh): void {
    this.level = 0;
    this.lostBumperFront = false;
    this.lostBumperRear = false;
    mesh.repair();
  }
}
