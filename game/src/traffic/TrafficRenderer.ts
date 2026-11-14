/**
 * Darstellung der KI-Fahrzeuge als Instanzen (ein Draw-Call je Bauteil).
 */
import * as THREE from 'three';
import type { Vehicle } from './TrafficSim.ts';

const MAX = 320;
const WHITE = new THREE.Color(0xffffff);

const mat = (opacity = 1) =>
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });

/** Rechteck mit abgerundeten Ecken, Einheitsgröße 1 x 1, Mitte im Ursprung */
function unitRounded(r: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  const h = 0.5;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return new THREE.ShapeGeometry(s, 3);
}

export class TrafficRenderer {
  group = new THREE.Group();
  private shadow: THREE.InstancedMesh;
  private body: THREE.InstancedMesh;
  private glass: THREE.InstancedMesh;
  private lights: THREE.InstancedMesh;
  private roof: THREE.InstancedMesh;
  /** 3D: Unterbau, Kabine (Glas), Dach, Rückleuchten */
  group3d = new THREE.Group();
  private b3!: THREE.InstancedMesh;
  private c3!: THREE.InstancedMesh;
  private r3!: THREE.InstancedMesh;
  private l3!: THREE.InstancedMesh;
  private use3d = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);
  private c = new THREE.Color();

  constructor() {
    const mk = (geo: THREE.BufferGeometry, m: THREE.Material, order: number, max = MAX) => {
      const im = new THREE.InstancedMesh(geo, m, max);
      im.count = 0;
      im.renderOrder = order;
      im.frustumCulled = false;
      im.layers.set(1); // nur Hauptansicht
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
      return im;
    };
    this.shadow = mk(unitRounded(0.2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthTest: false, depthWrite: false }), 18);
    this.body = mk(unitRounded(0.12), mat(), 19);
    this.roof = mk(unitRounded(0.2), mat(), 19.3);
    this.glass = mk(new THREE.PlaneGeometry(1, 1), mat(), 19.5, MAX * 2);
    this.lights = mk(new THREE.PlaneGeometry(1, 1), mat(), 19.6, MAX * 2);
    // Instanzfarben anlegen
    for (const im of [this.body, this.glass, this.lights, this.roof]) im.setColorAt(0, this.c.set(0xffffff));

    const mk3 = (max: number) => {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true }), max);
      im.count = 0;
      im.renderOrder = 19;
      im.frustumCulled = false;
      im.layers.set(1);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, this.c.set(0xffffff));
      this.group3d.add(im);
      return im;
    };
    this.b3 = mk3(MAX);
    this.c3 = mk3(MAX);
    this.r3 = mk3(MAX);
    this.l3 = mk3(MAX * 2);
    this.group3d.visible = false;
  }

  set3D(on: boolean): void {
    this.use3d = on;
    this.group3d.visible = on;
    for (const im of [this.body, this.roof, this.glass, this.lights]) im.visible = !on;
  }

  private box(im: THREE.InstancedMesh, i: number, v: Vehicle, l: number, w: number, h: number, ox: number, oy: number, z: number) {
    const cs = Math.cos(v.hdg);
    const sn = Math.sin(v.hdg);
    this.p.set(v.x + cs * ox - sn * oy, v.y + sn * ox + cs * oy, z);
    this.q.setFromAxisAngle(this.z, v.hdg);
    this.sc.set(l, w, h);
    this.m.compose(this.p, this.q, this.sc);
    im.setMatrixAt(i, this.m);
  }

  private update3d(vehicles: Vehicle[], n: number): void {
    let li = 0;
    for (let i = 0; i < n; i++) {
      const v = vehicles[i];
      const L = v.len;
      const W = v.width;
      const col = v.crashed > 0 ? 0x777777 : v.color;
      if (v.type === 'bus') {
        this.box(this.b3, i, v, L, W, 2.4, 0, 0, 1.55);
        this.box(this.c3, i, v, L * 0.92, W * 1.02, 1.0, L * 0.01, 0, 1.95);
        this.box(this.r3, i, v, L * 0.3, W * 0.6, 0.35, -L * 0.1, 0, 2.95);
        this.r3.setColorAt(i, this.c.setHex(0xd4d4d4));
      } else {
        const van = v.type === 'van';
        const hb = van ? 1.25 : 0.62;
        this.box(this.b3, i, v, L, W, hb, 0, 0, 0.25 + hb / 2);
        this.box(this.c3, i, v, L * (van ? 0.7 : 0.5), W * 0.86, van ? 0.6 : 0.48, van ? -L * 0.1 : -L * 0.08, 0, 0.25 + hb + (van ? 0.3 : 0.24));
        this.box(this.r3, i, v, L * (van ? 0.66 : 0.42), W * 0.82, 0.06, van ? -L * 0.1 : -L * 0.1, 0, 0.25 + hb + (van ? 0.62 : 0.5));
        this.r3.setColorAt(i, this.c.setHex(col).lerp(WHITE, 0.12));
      }
      this.b3.setColorAt(i, this.c.setHex(col));
      this.c3.setColorAt(i, this.c.setHex(0x2a3540));
      const braking = v.a < -0.8 || v.v < 0.2;
      for (const side of [1, -1]) {
        this.box(this.l3, li, v, 0.08, 0.4, 0.18, -L / 2 - 0.02, side * (W / 2 - 0.32), v.type === 'bus' ? 0.9 : 0.8);
        this.l3.setColorAt(li++, this.c.setHex(braking ? 0xff2020 : 0x7a0c12));
      }
    }
    for (const im of [this.b3, this.c3, this.r3]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.l3.count = li;
    this.l3.instanceMatrix.needsUpdate = true;
    if (this.l3.instanceColor) this.l3.instanceColor.needsUpdate = true;
  }

  private set(im: THREE.InstancedMesh, i: number, x: number, y: number, hdg: number, lx: number, ly: number, ox: number, oy: number) {
    const cs = Math.cos(hdg);
    const sn = Math.sin(hdg);
    this.p.set(x + cs * ox - sn * oy, y + sn * ox + cs * oy, 0);
    this.q.setFromAxisAngle(this.z, hdg);
    this.sc.set(lx, ly, 1);
    this.m.compose(this.p, this.q, this.sc);
    im.setMatrixAt(i, this.m);
  }

  update(vehicles: Vehicle[]): void {
    const n = Math.min(MAX, vehicles.length);
    if (this.use3d) {
      this.update3d(vehicles, n);
      // Schatten weiter zeichnen
      for (let i = 0; i < n; i++) {
        const v = vehicles[i];
        this.set(this.shadow, i, v.x, v.y, v.hdg, v.len + 0.25, v.width + 0.25, -0.2, -0.25);
      }
      this.shadow.count = n;
      this.shadow.instanceMatrix.needsUpdate = true;
      return;
    }
    let gi = 0;
    let li = 0;
    for (let i = 0; i < n; i++) {
      const v = vehicles[i];
      const L = v.len;
      const W = v.width;
      this.set(this.shadow, i, v.x, v.y, v.hdg, L + 0.25, W + 0.25, -0.2, -0.25);
      this.set(this.body, i, v.x, v.y, v.hdg, L, W, 0, 0);
      this.body.setColorAt(i, this.c.setHex(v.crashed > 0 ? 0x777777 : v.color));
      // Dach: etwas heller als die Karosserie (Bus: hellgrau mit Klimaanlage-Andeutung)
      if (v.type === 'bus') this.set(this.roof, i, v.x, v.y, v.hdg, L * 0.25, W * 0.6, -L * 0.1, 0);
      else this.set(this.roof, i, v.x, v.y, v.hdg, L * (v.type === 'van' ? 0.5 : 0.36), W * 0.74, v.type === 'van' ? -L * 0.12 : -L * 0.07, 0);
      this.c.setHex(v.type === 'bus' ? 0xd9d9d9 : v.color);
      if (v.type !== 'bus') this.c.lerp(WHITE, 0.14);
      this.roof.setColorAt(i, this.c);
      if (v.type === 'bus') {
        // Fensterband
        this.set(this.glass, gi, v.x, v.y, v.hdg, L * 0.86, W * 0.78, L * 0.02, 0);
        this.glass.setColorAt(gi++, this.c.setHex(0x30363d));
      } else {
        // Frontscheibe und Heckscheibe
        this.set(this.glass, gi, v.x, v.y, v.hdg, L * (v.type === 'van' ? 0.1 : 0.13), W * 0.76, L * (v.type === 'van' ? 0.3 : 0.14), 0);
        this.glass.setColorAt(gi++, this.c.setHex(0x2a3540));
        if (v.type === 'car') {
          this.set(this.glass, gi, v.x, v.y, v.hdg, L * 0.08, W * 0.72, -L * 0.31, 0);
          this.glass.setColorAt(gi++, this.c.setHex(0x2a3540));
        }
      }
      // Bremslichter
      const braking = v.a < -0.8 || v.v < 0.2;
      for (const side of [1, -1]) {
        this.set(this.lights, li, v.x, v.y, v.hdg, 0.14, 0.38, -L / 2 + 0.08, side * (W / 2 - 0.3));
        this.lights.setColorAt(li++, this.c.setHex(braking ? 0xff2020 : 0x7a0c12));
      }
    }
    this.shadow.count = n;
    this.body.count = n;
    this.roof.count = n;
    this.glass.count = gi;
    this.lights.count = li;
    for (const im of [this.shadow, this.body, this.roof, this.glass, this.lights]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
