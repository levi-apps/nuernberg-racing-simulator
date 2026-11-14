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
