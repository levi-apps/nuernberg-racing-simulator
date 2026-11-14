/**
 * Darstellung der KI-Fahrzeuge als Instanzen (ein Draw-Call je Bauteil).
 */
import * as THREE from 'three';
import type { Vehicle } from './TrafficSim.ts';
import { carMaterials, carMerged } from '../drive/CarModel.ts';
import type { Body } from '../garage/Cars.ts';
import { render3d } from '../world/render3d.ts';

/** Modellvarianten für KI-Fahrzeuge (Basisgröße, wird je Fahrzeug skaliert) */
const VARIANTS: Array<{ body: Body; L: number; W: number }> = [
  { body: 'compact', L: 4.4, W: 1.8 },
  { body: 'sedan', L: 4.7, W: 1.85 },
  { body: 'small', L: 3.8, W: 1.7 },
  { body: 'wagon', L: 4.7, W: 1.85 },
  { body: 'van', L: 5.4, W: 2.0 },
  { body: 'bus', L: 12, W: 2.55 },
];

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
  /** 3D: ein instanziertes Modell je Variante (Lack über Instanzfarbe) */
  group3d = new THREE.Group();
  private models: THREE.InstancedMesh[] = [];
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

    const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.36, transparent: true });
    for (const v of VARIANTS) {
      const im = new THREE.InstancedMesh(carMerged(v.body, v.L, v.W), carMaterials(paint), v.body === 'bus' ? 40 : MAX);
      im.count = 0;
      im.renderOrder = 19;
      im.frustumCulled = false;
      im.castShadow = true;
      im.receiveShadow = true;
      im.layers.set(1);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, this.c.set(0xffffff));
      this.models.push(im);
      this.group3d.add(im);
    }
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
    const counts = this.models.map(() => 0);
    for (let i = 0; i < n; i++) {
      const v = vehicles[i];
      const vi = v.type === 'bus' ? 5 : v.type === 'van' ? 4 : v.id % 4;
      const im = this.models[vi];
      const k = counts[vi]++;
      if (k >= im.instanceMatrix.count) continue;
      const base = VARIANTS[vi];
      this.p.set(v.x, v.y, 0);
      this.q.setFromAxisAngle(this.z, v.hdg);
      this.sc.set(v.len / base.L, v.width / base.W, 1);
      this.m.compose(this.p, this.q, this.sc);
      im.setMatrixAt(k, this.m);
      im.setColorAt(k, this.c.setHex(v.crashed > 0 ? 0x777777 : v.color));
    }
    this.models.forEach((im, i) => {
      im.count = Math.min(counts[i], im.instanceMatrix.count);
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
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
      this.shadow.count = render3d.shadows ? 0 : n;
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
