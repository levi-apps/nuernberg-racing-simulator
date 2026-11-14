/**
 * Darstellung des Autos von oben (lokal: x = vorn, y = links).
 */
import * as THREE from 'three';
import type { Car } from './Car.ts';

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

export class CarMesh {
  group = new THREE.Group();
  private frontWheels: THREE.Mesh[] = [];
  private tailMat = mat(0x8a0d16);
  private reverseMat = mat(0x666666);

  constructor(car: Car, color = 0xd7263d) {
    const L = car.spec.length;
    const W = car.spec.width;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, order: number, x = 0, y = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, 0);
      mesh.renderOrder = 20 + order;
      mesh.frustumCulled = false;
      mesh.layers.set(1); // nur Hauptansicht
      this.group.add(mesh);
      return mesh;
    };
    // Schatten
    add(shape(roundedRect(L + 0.3, W + 0.3, 0.5)), mat(0x000000, 0.22), 0, -0.25, -0.3);
    // Räder (schauen leicht unter der Karosserie hervor)
    const wheelGeo = new THREE.PlaneGeometry(0.72, 0.26);
    const wheelMat = mat(0x1b1b1b);
    for (const sx of [1, -1])
      for (const sy of [1, -1]) {
        const m = add(wheelGeo, wheelMat, 1, sx * L * 0.31, sy * (W / 2 - 0.02));
        if (sx === 1) this.frontWheels.push(m);
      }
    // Karosserie
    add(shape(roundedRect(L, W, 0.42)), mat(color), 2);
    // Dach etwas heller
    add(shape(roundedRect(L * 0.42, W * 0.78, 0.25)), mat(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.18).getHex()), 3, -L * 0.06, 0);
    // Frontscheibe und Heckscheibe
    const glass = mat(0x2a3540);
    add(
      shape([
        [L * 0.2, W * 0.4],
        [L * 0.2, -W * 0.4],
        [L * 0.06, -W * 0.36],
        [L * 0.06, W * 0.36],
      ]),
      glass,
      4,
    );
    add(
      shape([
        [-L * 0.28, W * 0.36],
        [-L * 0.28, -W * 0.36],
        [-L * 0.36, -W * 0.38],
        [-L * 0.36, W * 0.38],
      ]),
      glass,
      4,
    );
    // Scheinwerfer
    const head = mat(0xfff3b0);
    for (const sy of [1, -1]) add(new THREE.PlaneGeometry(0.16, 0.42), head, 5, L / 2 - 0.1, sy * (W / 2 - 0.32));
    // Rückleuchten
    for (const sy of [1, -1]) add(new THREE.PlaneGeometry(0.14, 0.42), this.tailMat, 5, -L / 2 + 0.09, sy * (W / 2 - 0.32));
    add(new THREE.PlaneGeometry(0.12, 0.3), this.reverseMat, 5, -L / 2 + 0.08, 0);
  }

  update(car: Car): void {
    this.group.position.set(car.x, car.y, 0);
    this.group.rotation.z = car.heading;
    for (const w of this.frontWheels) w.rotation.z = car.steer * 0.5;
    this.tailMat.color.setHex(car.braking ? 0xff2a2a : 0x8a0d16);
    this.reverseMat.color.setHex(car.reversing ? 0xffffff : 0x666666);
  }
}
