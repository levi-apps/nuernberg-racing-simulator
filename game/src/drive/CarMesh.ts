/**
 * Darstellung des Spielerautos (lokal: x = vorn, y = links) – Draufsicht und 3D,
 * Proportionen je Karosserieform.
 */
import * as THREE from 'three';
import type { Car } from './Car.ts';
import type { Body } from '../garage/Cars.ts';
import { carLights, carMaterials, carParts } from './CarModel.ts';
import { carMaterialList, models, paintMaterial } from '../assets/Models.ts';

/** Karosserieform -> Kenney-Modell */
export const BODY_MODEL: Partial<Record<Body, string>> = {
  small: 'hatchback_sports',
  compact: 'sedan',
  wagon: 'suv',
  van: 'van',
  sedan: 'suv_luxury',
  sport: 'sedan_sports',
  hyper: 'race_car_future',
  tow: 'truck_flat',
};
import { render3d } from '../world/render3d.ts';

const mat = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });

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
  private brake3d!: THREE.MeshStandardMaterial;
  private wheels3d: THREE.Mesh[] = [];
  private wheelR = 0.33;
  private spin = 0;
  private lastX = 0;
  private lastY = 0;
  private shadow2d!: THREE.Object3D;
  private paint: THREE.MeshStandardMaterial | null = null;
  /** Karosserie-Mesh (für Dellen) */
  bodyMesh: THREE.Mesh | null = null;
  /** Ausgangspositionen der Karosserie (für Dellen-Begrenzung und Reparatur) */
  private basePos: Float32Array | null = null;
  private bodyScale = 1;
  /** Lackfarbe (für abfallende Teile) */
  color: number;
  private tailMat = mat(0x8a0d16);
  private flames: THREE.Mesh[] = [];
  private reverseMat = mat(0x666666);

  constructor(car: Car, color = 0xd7263d, body: Body = 'compact') {
    this.color = color;
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
    this.shadow2d = add(shape(roundedRect(L + 0.3, W + 0.3, P.corner + 0.1)), mat(0x000000, 0.22), 0, -0.25, -0.3);
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

    // ---------------- 3D: Kenney-Modell (falls geladen), sonst gerundete Eigenkonstruktion
    this.brake3d = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a10, emissiveIntensity: 0.4, roughness: 0.3, transparent: true });
    const setup = (o: THREE.Object3D) => {
      o.renderOrder = 25;
      o.layers.set(1);
      o.frustumCulled = false;
      o.castShadow = true;
      o.receiveShadow = true;
    };
    const proto = models.ready ? models.cars.get(BODY_MODEL[body] ?? '') : undefined;
    if (proto) {
      const sc = L / proto.length;
      const tex = proto.material.map!;
      this.paint = paintMaterial(tex, proto.paintCell, proto.cellLum);
      (this.paint.userData.uPaint as { value: THREE.Color }).value.setHex(color);
      const mats = carMaterialList(proto, this.brake3d);
      mats[0] = this.paint;
      const bodyMesh = new THREE.Mesh(proto.body, mats);
      bodyMesh.scale.setScalar(sc);
      this.bodyScale = sc;
      setup(bodyMesh);
      this.group3d.add(bodyMesh);
      this.bodyMesh = bodyMesh;
      for (const w of proto.wheels) {
        const pivot = new THREE.Group();
        pivot.position.set(w.x * sc, w.y * sc, w.z * sc);
        const wm = new THREE.Mesh(w.geo, this.paint);
        wm.scale.setScalar(sc);
        setup(wm);
        pivot.add(wm);
        this.group3d.add(pivot);
        this.wheels3d.push(wm);
        if (w.front) this.frontWheels3d.push(pivot);
      }
      this.wheelR = Math.max(0.2, (proto.wheels[0]?.z ?? 0.33) * sc);
    } else {
      const parts = carParts(body, L, W);
      const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.14, transparent: true });
      const mats = carMaterials(paint, this.brake3d);
      const bodyMesh = new THREE.Mesh(parts.body, mats);
      setup(bodyMesh);
      this.group3d.add(bodyMesh);
      this.bodyMesh = bodyMesh;
      parts.wheels.forEach(([x, y, z], i) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, y, z);
        const w = new THREE.Mesh(parts.wheel, mats);
        setup(w);
        if (y < 0) w.rotation.z = Math.PI; // Felge nach außen
        pivot.add(w);
        this.group3d.add(pivot);
        this.wheels3d.push(w);
        if (i < 2) this.frontWheels3d.push(pivot);
      });
      this.wheelR = parts.wheels[0][2];
    }

    // Nitro-Flamme hinter dem Auto
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x4fc3ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const flameGeo = new THREE.ConeGeometry(0.28, 1.6, 10);
    flameGeo.rotateZ(Math.PI / 2);
    for (const sy of [0.35, -0.35]) {
      const f2 = new THREE.Mesh(flameGeo, flameMat);
      f2.position.set(-L / 2 - 0.75, sy * W * 0.6, 0);
      f2.renderOrder = 27;
      f2.layers.set(1);
      f2.frustumCulled = false;
      f2.visible = false;
      this.group.add(f2);
      this.flames.push(f2);
      const f3 = f2.clone();
      f3.position.z = 0.45;
      this.group3d.add(f3);
      this.flames.push(f3);
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
    this.brake3d.emissiveIntensity = car.braking ? 1.6 + carLights.tail.emissiveIntensity * 0.5 : carLights.tail.emissiveIntensity;
    // Räder drehen sich mit der gefahrenen Strecke
    const moved = (car.x - this.lastX) * Math.cos(car.heading) + (car.y - this.lastY) * Math.sin(car.heading);
    this.lastX = car.x;
    this.lastY = car.y;
    if (Math.abs(moved) < 5) this.spin += moved / this.wheelR;
    for (const w of this.wheels3d) w.rotation.y = w.rotation.z ? -this.spin : this.spin;
    this.shadow2d.visible = !(this.group3d.visible && render3d.shadows);
    const on = car.boost > 0;
    for (const f of this.flames) {
      f.visible = on;
      if (on) f.scale.set(0.8 + Math.random() * 0.5, 1, 1);
    }
  }

  /**
   * Delle an einer Stelle der Karosserie (lokale Koordinaten in m, x vorn, y links).
   * strength: Eindrücktiefe in m
   */
  /** bisherige Dellen (zum Übertragen auf ein neu aufgebautes Mesh desselben Autos) */
  dents: Array<[number, number, number, number]> = [];

  dent(lx: number, ly: number, lz: number, strength: number): void {
    const mesh = this.bodyMesh;
    if (!mesh) return;
    this.dents.push([lx, ly, lz, strength]);
    if (!this.basePos) {
      // eigene Kopie, die Vorlage teilen sich alle Autos dieses Typs
      const g = mesh.geometry.clone();
      mesh.geometry = g;
      this.basePos = (g.getAttribute('position').array as Float32Array).slice();
    }
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const base = this.basePos;
    const sc = this.bodyScale;
    const hx = lx / sc;
    const hy = ly / sc;
    const hz = lz / sc;
    const R = (0.75 + strength * 1.5) / sc;
    // nach innen, Richtung Mitte
    const il = Math.hypot(hx, hy) || 1;
    const ix = -hx / il;
    const iy = -hy / il;
    const depth = strength / sc;
    const maxD = 0.38 / sc;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - hx;
      const dy = a[i + 1] - hy;
      const dz = (a[i + 2] - hz) * 1.4;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d >= R) continue;
      const f = (1 - d / R) * (1 - d / R);
      // leicht unregelmäßig, wie zerknülltes Blech
      const n = 0.75 + 0.5 * Math.sin(a[i] * 37.1 + a[i + 1] * 17.3 + a[i + 2] * 23.7);
      a[i] += ix * depth * f * n;
      a[i + 1] += iy * depth * f * n;
      a[i + 2] -= depth * f * 0.35 * n;
      // nicht beliebig tief
      const ox = a[i] - base[i];
      const oy = a[i + 1] - base[i + 1];
      const oz = a[i + 2] - base[i + 2];
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (ol > maxD) {
        const k = maxD / ol;
        a[i] = base[i] + ox * k;
        a[i + 1] = base[i + 1] + oy * k;
        a[i + 2] = base[i + 2] + oz * k;
      }
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  }

  /** Lack stumpfer und dunkler mit zunehmendem Schaden (0..1) */
  setWear(level: number): void {
    const m = (this.paint ?? (Array.isArray(this.bodyMesh?.material) ? this.bodyMesh!.material[0] : null)) as THREE.MeshStandardMaterial | null;
    if (!m) return;
    m.userData.baseRough ??= m.roughness;
    m.roughness = Math.min(1, (m.userData.baseRough as number) + level * 0.5);
    const phys = m as THREE.MeshPhysicalMaterial;
    if (phys.isMeshPhysicalMaterial) phys.clearcoat = 1 - level * 0.9;
  }

  /** Dellen entfernen */
  repair(): void {
    if (!this.bodyMesh || !this.basePos) return;
    const pos = this.bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(this.basePos);
    this.dents = [];
    pos.needsUpdate = true;
    this.bodyMesh.geometry.computeVertexNormals();
    this.setWear(0);
  }

  dispose(): void {
    // nur eigene Geometrien freigeben (Modell-Vorlagen werden geteilt)
    const own = this.basePos ? this.bodyMesh?.geometry : null;
    for (const o of this.group.children) (o as THREE.Mesh).geometry?.dispose();
    own?.dispose();
  }
}
