/**
 * Darstellung des Spielerautos (lokal: x = vorn, y = links) – Draufsicht und 3D,
 * Proportionen je Karosserieform.
 */
import * as THREE from 'three';
import type { Car } from './Car.ts';
import type { Body } from '../garage/Cars.ts';

const mat = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });

function shape(pts: Array<[number, number]>): THREE.ShapeGeometry {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ShapeGeometry(s);
}

function roundedRect(l: number, w: number, r: number): Array<[number, number]> {
  const hl = l / 2;
  const hw = w / 2;
  const pts: Array<[number, number]> = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(hl - r, hw - r, 0);
  corner(-hl + r, hw - r, Math.PI / 2);
  corner(-hl + r, -hw + r, Math.PI);
  corner(hl - r, -hw + r, (3 * Math.PI) / 2);
  return pts;
}

/** Proportionen relativ zur Länge L: Dach, Scheiben, Höhen in Metern */
const BODY: Record<Body, { roofL: number; roofX: number; wsX: number; rwX: number | null; baseH: number; cabH: number; cabL: number; cabX: number; corner: number }> = {
  small: { roofL: 0.44, roofX: -0.06, wsX: 0.19, rwX: -0.32, baseH: 0.62, cabH: 0.52, cabL: 0.52, cabX: -0.06, corner: 0.5 },
  compact: { roofL: 0.42, roofX: -0.06, wsX: 0.2, rwX: -0.33, baseH: 0.62, cabH: 0.5, cabL: 0.5, cabX: -0.08, corner: 0.42 },
  wagon: { roofL: 0.56, roofX: -0.14, wsX: 0.2, rwX: -0.44, baseH: 0.62, cabH: 0.52, cabL: 0.64, cabX: -0.14, corner: 0.38 },
  van: { roofL: 0.74, roofX: -0.12, wsX: 0.33, rwX: null, baseH: 1.25, cabH: 0.66, cabL: 0.78, cabX: -0.1, corner: 0.3 },
  sedan: { roofL: 0.4, roofX: -0.04, wsX: 0.17, rwX: -0.28, baseH: 0.62, cabH: 0.46, cabL: 0.46, cabX: -0.04, corner: 0.4 },
  sport: { roofL: 0.3, roofX: -0.08, wsX: 0.12, rwX: -0.26, baseH: 0.5, cabH: 0.36, cabL: 0.36, cabX: -0.06, corner: 0.45 },
  hyper: { roofL: 0.26, roofX: -0.04, wsX: 0.1, rwX: -0.22, baseH: 0.45, cabH: 0.32, cabL: 0.32, cabX: -0.04, corner: 0.6 },
  tow: { roofL: 0.28, roofX: 0.28, wsX: 0.46, rwX: null, baseH: 1.0, cabH: 0.85, cabL: 0.3, cabX: 0.3, corner: 0.25 },
  bus: { roofL: 0.94, roofX: 0, wsX: 0.49, rwX: null, baseH: 1.0, cabH: 1.6, cabL: 0.95, cabX: 0, corner: 0.35 },
};

export class CarMesh {
  group = new THREE.Group();
  /** 3D-Version (Karosserie, Kabine, Räder) */
  group3d = new THREE.Group();
  private parts2d: THREE.Object3D[] = [];
  private frontWheels: THREE.Mesh[] = [];
  private frontWheels3d: THREE.Object3D[] = [];
  private brake3d!: THREE.MeshLambertMaterial;
  private tailMat = mat(0x8a0d16);
  private reverseMat = mat(0x666666);

  constructor(car: Car, color = 0xd7263d, body: Body = 'compact') {
    const L = car.spec.length;
    const W = car.spec.width;
    const P = BODY[body];
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, order: number, x = 0, y = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, 0);
      mesh.renderOrder = 20 + order;
      mesh.frustumCulled = false;
      mesh.layers.set(1); // nur Hauptansicht
      this.group.add(mesh);
      return mesh;
    };
    // Schatten (bleibt auch in 3D sichtbar)
    add(shape(roundedRect(L + 0.3, W + 0.3, P.corner + 0.1)), mat(0x000000, 0.22), 0, -0.25, -0.3);
    const nShadow = this.group.children.length;
    // Räder
    const wheelGeo = new THREE.PlaneGeometry(0.72, 0.26);
    const wheelMat = mat(0x1b1b1b);
    for (const sx of [1, -1])
      for (const sy of [1, -1]) {
        const m = add(wheelGeo, wheelMat, 1, sx * L * 0.31, sy * (W / 2 - 0.02));
        if (sx === 1) this.frontWheels.push(m);
      }
    // Karosserie, Dach, Scheiben
    add(shape(roundedRect(L, W, P.corner)), mat(color), 2);
    const roofC = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.18).getHex();
    add(shape(roundedRect(L * P.roofL, W * 0.78, 0.25)), mat(roofC), 3, L * P.roofX, 0);
    const glass = mat(0x2a3540);
    const ws0 = L * P.wsX;
    add(
      shape([
        [ws0, W * 0.4],
        [ws0, -W * 0.4],
        [ws0 - L * 0.13, -W * 0.36],
        [ws0 - L * 0.13, W * 0.36],
      ]),
      glass,
      4,
    );
    if (P.rwX !== null) {
      const r0 = L * P.rwX;
      add(
        shape([
          [r0, W * 0.36],
          [r0, -W * 0.36],
          [r0 - L * 0.07, -W * 0.38],
          [r0 - L * 0.07, W * 0.38],
        ]),
        glass,
        4,
      );
    }
    if (body === 'tow') {
      // Ladefläche und Kranausleger
      add(new THREE.PlaneGeometry(L * 0.55, W * 0.9), mat(0x3a3c40), 3.4, -L * 0.18, 0);
      add(new THREE.PlaneGeometry(L * 0.5, 0.25), mat(0xf5b400), 3.6, -L * 0.2, 0);
    }
    if (body === 'bus') {
      // Fensterband an den Seiten und Dachaufbauten
      add(new THREE.PlaneGeometry(L * 0.86, 0.22), glass, 3.6, -L * 0.02, W / 2 - 0.15);
      add(new THREE.PlaneGeometry(L * 0.86, 0.22), glass, 3.6, -L * 0.02, -W / 2 + 0.15);
      add(new THREE.PlaneGeometry(L * 0.18, W * 0.5), mat(0xd9d9d9), 3.7, -L * 0.15, 0);
    }
    if (body === 'sport' || body === 'hyper') {
      // Rennstreifen
      const stripe = mat(new THREE.Color(color).lerp(new THREE.Color(0x000000), 0.6).getHex());
      add(new THREE.PlaneGeometry(L * 0.95, 0.22), stripe, 3.5, 0, 0.18);
      add(new THREE.PlaneGeometry(L * 0.95, 0.22), stripe, 3.5, 0, -0.18);
    }
    const head = mat(0xfff3b0);
    for (const sy of [1, -1]) add(new THREE.PlaneGeometry(0.16, 0.42), head, 5, L / 2 - 0.1, sy * (W / 2 - 0.32));
    for (const sy of [1, -1]) add(new THREE.PlaneGeometry(0.14, 0.42), this.tailMat, 5, -L / 2 + 0.09, sy * (W / 2 - 0.32));
    add(new THREE.PlaneGeometry(0.12, 0.3), this.reverseMat, 5, -L / 2 + 0.08, 0);
    this.parts2d = this.group.children.slice(nShadow);

    // ---------------- 3D
    const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c, transparent: true });
    const box3 = (l: number, w: number, h: number, m: THREE.Material, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(l, w, h), m);
      b.position.set(x, y, z);
      b.renderOrder = 25;
      b.layers.set(1);
      b.frustumCulled = false;
      this.group3d.add(b);
      return b;
    };
    const bodyM = lam(color);
    const zb = 0.24;
    box3(L, W, P.baseH, bodyM, 0, 0, zb + P.baseH / 2);
    box3(L * P.cabL, W * 0.84, P.cabH, lam(0x2a3540), L * P.cabX, 0, zb + P.baseH + P.cabH / 2);
    box3(L * (P.cabL - 0.06), W * 0.8, 0.06, lam(roofC), L * P.cabX, 0, zb + P.baseH + P.cabH);
    box3(0.1, 0.42, 0.18, lam(0xfff3b0), L / 2, W / 2 - 0.35, zb + P.baseH * 0.6);
    box3(0.1, 0.42, 0.18, lam(0xfff3b0), L / 2, -W / 2 + 0.35, zb + P.baseH * 0.6);
    this.brake3d = lam(0x8a0d16);
    box3(0.1, 0.42, 0.16, this.brake3d, -L / 2, W / 2 - 0.35, zb + P.baseH * 0.7);
    box3(0.1, 0.42, 0.16, this.brake3d, -L / 2, -W / 2 + 0.35, zb + P.baseH * 0.7);
    if (body === 'sport' || body === 'hyper') box3(0.35, W * 0.9, 0.06, lam(0x222222), -L / 2 + 0.25, 0, zb + P.baseH + 0.25); // Heckflügel
    if (body === 'tow') {
      box3(L * 0.55, W * 0.92, 0.12, lam(0x3a3c40), -L * 0.18, 0, zb + P.baseH + 0.06); // Ladefläche
      const arm = box3(L * 0.5, 0.25, 0.25, lam(0xf5b400), -L * 0.2, 0, zb + P.baseH + 0.9);
      arm.rotation.y = 0.35;
    }
    const tire = lam(0x1b1b1b);
    for (const sx of [1, -1])
      for (const sy of [1, -1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12), tire);
        wheel.position.set(sx * L * 0.31, sy * (W / 2 - 0.05), 0.33);
        wheel.renderOrder = 25;
        wheel.layers.set(1);
        wheel.frustumCulled = false;
        this.group3d.add(wheel);
        if (sx === 1) this.frontWheels3d.push(wheel);
      }
    this.group3d.visible = false;
  }

  set3D(on: boolean): void {
    this.group3d.visible = on;
    for (const p of this.parts2d) p.visible = !on;
  }

  update(car: Car): void {
    this.group.position.set(car.x, car.y, 0);
    this.group.rotation.z = car.heading;
    this.group3d.position.set(car.x, car.y, 0);
    this.group3d.rotation.z = car.heading;
    for (const w of this.frontWheels) w.rotation.z = car.steer * 0.5;
    for (const w of this.frontWheels3d) w.rotation.z = car.steer * 0.5;
    this.tailMat.color.setHex(car.braking ? 0xff2a2a : 0x8a0d16);
    this.reverseMat.color.setHex(car.reversing ? 0xffffff : 0x666666);
    this.brake3d.color.setHex(car.braking ? 0xff2a2a : 0x8a0d16);
  }

  dispose(): void {
    for (const g of [this.group, this.group3d])
      g.traverse((o) => {
        (o as THREE.Mesh).geometry?.dispose();
      });
  }
}
