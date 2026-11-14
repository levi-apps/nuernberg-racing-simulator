/**
 * 3D-Automodelle: Karosserie als extrudiertes Seitenprofil mit abgerundeten Kanten und
 * Radhäusern, Glaskabine, Dach, Räder mit Felgen, Scheinwerfer und Rückleuchten.
 * Lokales System: x = vorn, y = links, z = oben; Ursprung Mitte am Boden.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Body } from '../garage/Cars.ts';

/** Materialplätze (Gruppen der Geometrie) */
export const enum Slot {
  Paint = 0,
  Glass = 1,
  Rubber = 2,
  Metal = 3,
  Head = 4,
  Tail = 5,
  Trim = 6,
  Plate = 7,
}

interface Profile {
  gc: number;
  nose: number;
  hood: number;
  belt: number;
  roof: number;
  xH: number;
  xRF: number;
  xRR: number;
  xRG: number;
  rear: number;
  wheelR: number;
  xWr: number;
  xWf: number;
}

const P: Record<Exclude<Body, 'bus'>, Profile> = {
  small: { gc: 0.2, nose: 0.6, hood: 0.8, belt: 0.86, roof: 1.48, xH: 0.17, xRF: 0.04, xRR: -0.34, xRG: -0.44, rear: 0.98, wheelR: 0.3, xWr: -0.33, xWf: 0.32 },
  compact: { gc: 0.2, nose: 0.6, hood: 0.8, belt: 0.86, roof: 1.45, xH: 0.2, xRF: 0.04, xRR: -0.3, xRG: -0.43, rear: 0.97, wheelR: 0.32, xWr: -0.32, xWf: 0.32 },
  wagon: { gc: 0.2, nose: 0.6, hood: 0.8, belt: 0.86, roof: 1.5, xH: 0.22, xRF: 0.07, xRR: -0.44, xRG: -0.48, rear: 1.0, wheelR: 0.33, xWr: -0.32, xWf: 0.32 },
  sedan: { gc: 0.19, nose: 0.6, hood: 0.78, belt: 0.84, roof: 1.42, xH: 0.2, xRF: 0.05, xRR: -0.21, xRG: -0.31, rear: 0.9, wheelR: 0.34, xWr: -0.31, xWf: 0.33 },
  sport: { gc: 0.13, nose: 0.48, hood: 0.66, belt: 0.72, roof: 1.17, xH: 0.13, xRF: -0.05, xRR: -0.22, xRG: -0.37, rear: 0.82, wheelR: 0.34, xWr: -0.31, xWf: 0.33 },
  hyper: { gc: 0.11, nose: 0.4, hood: 0.6, belt: 0.64, roof: 1.07, xH: 0.1, xRF: -0.07, xRR: -0.2, xRG: -0.42, rear: 0.8, wheelR: 0.35, xWr: -0.32, xWf: 0.33 },
  van: { gc: 0.25, nose: 0.85, hood: 1.05, belt: 1.12, roof: 2.05, xH: 0.36, xRF: 0.3, xRR: -0.49, xRG: -0.495, rear: 2.0, wheelR: 0.36, xWr: -0.32, xWf: 0.34 },
  tow: { gc: 0.32, nose: 1.0, hood: 1.15, belt: 1.2, roof: 2.15, xH: 0.42, xRF: 0.36, xRR: 0.12, xRG: 0.1, rear: 1.15, wheelR: 0.45, xWr: -0.28, xWf: 0.33 },
};

export interface CarParts {
  /** Karosserie, Glas, Lichter (Gruppen = Slot) */
  body: THREE.BufferGeometry;
  /** ein Rad (Reifen + Felge, Gruppen Rubber/Metal), Achse = y, Mitte im Ursprung */
  wheel: THREE.BufferGeometry;
  /** Radpositionen [x, y, z], vorn zuerst */
  wheels: Array<[number, number, number]>;
}

function extrude(shape: THREE.Shape, width: number, bevel: number, curve = 6): THREE.BufferGeometry {
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: curve });
  g.translate(0, 0, -depth / 2);
  g.rotateX(Math.PI / 2);
  return g;
}

function poly(pts: Array<[number, number]>): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

function boxAt(l: number, w: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(l, w, h);
  g.translate(x, y, z);
  return g;
}

/** Geometrien eines Slots zusammenfassen und als Gruppe markieren */
function assemble(parts: Array<[Slot, THREE.BufferGeometry]>): THREE.BufferGeometry {
  const bySlot = new Map<Slot, THREE.BufferGeometry[]>();
  for (const [s, g] of parts) {
    const clean = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(clean.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') clean.deleteAttribute(k);
    if (!clean.getAttribute('uv')) clean.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((clean.getAttribute('position').count) * 2), 2));
    const a = bySlot.get(s) ?? [];
    a.push(clean);
    bySlot.set(s, a);
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  const merged = slots.map((s) => mergeGeometries(bySlot.get(s)!)!);
  const out = mergeGeometries(merged, true)!;
  // Gruppen auf Materialplätze abbilden
  out.groups.forEach((g, i) => (g.materialIndex = slots[i]));
  out.computeBoundingSphere();
  return out;
}

const cache = new Map<string, CarParts>();

export function carParts(body: Body, L: number, W: number): CarParts {
  const key = `${body}:${L.toFixed(2)}:${W.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const parts: Array<[Slot, THREE.BufferGeometry]> = [];
  let wheelR = 0.33;
  let wheels: Array<[number, number, number]>;
  if (body === 'bus') {
    wheelR = 0.5;
    const xr = -L * 0.28;
    const xf = L * 0.36;
    const s = new THREE.Shape();
    const gc = 0.3;
    s.moveTo(-L / 2, gc + 0.1);
    s.lineTo(xr - wheelR - 0.08, gc);
    s.absarc(xr, wheelR, wheelR + 0.08, Math.PI, 0, true);
    s.lineTo(xf - wheelR - 0.08, gc);
    s.absarc(xf, wheelR, wheelR + 0.08, Math.PI, 0, true);
    s.lineTo(L / 2, gc + 0.1);
    s.lineTo(L / 2, 1.15);
    s.lineTo(-L / 2, 1.15);
    s.closePath();
    parts.push([Slot.Paint, extrude(s, W, 0.1)]);
    // Fensterband rundum
    parts.push([Slot.Glass, extrude(poly([[-L / 2 + 0.05, 1.12], [L / 2 - 0.02, 1.12], [L / 2 - 0.06, 2.75], [-L / 2 + 0.08, 2.75]]), W * 0.985, 0.03)]);
    // Dach mit Klimaanlage
    parts.push([Slot.Paint, extrude(poly([[-L / 2 + 0.05, 2.72], [L / 2 - 0.1, 2.72], [L / 2 - 0.25, 3.0], [-L / 2 + 0.12, 3.0]]), W, 0.08)]);
    parts.push([Slot.Trim, boxAt(L * 0.25, W * 0.6, 0.3, -L * 0.12, 0, 3.12)]);
    // Fenstersprossen
    for (let x = -L / 2 + 1.4; x < L / 2 - 1.5; x += 1.35) parts.push([Slot.Paint, boxAt(0.12, W + 0.01, 1.6, x, 0, 1.95)]);
    parts.push([Slot.Head, boxAt(0.06, 0.4, 0.18, L / 2 + 0.02, W / 2 - 0.35, 0.65)]);
    parts.push([Slot.Head, boxAt(0.06, 0.4, 0.18, L / 2 + 0.02, -W / 2 + 0.35, 0.65)]);
    parts.push([Slot.Tail, boxAt(0.06, 0.25, 0.5, -L / 2 - 0.02, W / 2 - 0.2, 0.9)]);
    parts.push([Slot.Tail, boxAt(0.06, 0.25, 0.5, -L / 2 - 0.02, -W / 2 + 0.2, 0.9)]);
    // Zielanzeige
    parts.push([Slot.Head, boxAt(0.05, W * 0.6, 0.22, L / 2 - 0.04, 0, 2.6)]);
    wheels = [
      [xf, W / 2 - 0.22, wheelR],
      [xf, -W / 2 + 0.22, wheelR],
      [xr, W / 2 - 0.22, wheelR],
      [xr, -W / 2 + 0.22, wheelR],
    ];
  } else {
    const p = P[body];
    wheelR = p.wheelR;
    const xr = L * p.xWr;
    const xf = L * p.xWf;
    const R = wheelR + 0.06;
    const s = new THREE.Shape();
    const gc = p.gc;
    s.moveTo(-L / 2, gc + 0.16);
    s.lineTo(-L / 2 + 0.14, gc);
    s.lineTo(xr - R, gc);
    s.absarc(xr, wheelR, R, Math.PI, 0, true);
    s.lineTo(xf - R, gc);
    s.absarc(xf, wheelR, R, Math.PI, 0, true);
    s.lineTo(L / 2 - 0.16, gc);
    s.lineTo(L / 2, gc + 0.16);
    s.lineTo(L / 2, p.nose);
    s.quadraticCurveTo(L / 2 - 0.05, p.hood, L / 2 - 0.4, p.hood);
    s.lineTo(L * p.xH, p.belt);
    if (body === 'tow') {
      s.lineTo(-L / 2, p.belt);
    } else {
      s.lineTo(L * p.xRG, p.belt);
      s.quadraticCurveTo(-L / 2 + 0.05, p.rear + 0.02, -L / 2, p.rear - 0.12);
    }
    s.closePath();
    const bevel = body === 'van' || body === 'tow' ? 0.08 : 0.11;
    parts.push([Slot.Paint, extrude(s, W, bevel, 10)]);
    // Glaskabine
    const g = poly([
      [L * p.xH - 0.02, p.belt - 0.02],
      [L * p.xRF, p.roof - 0.03],
      [L * p.xRR, p.roof - 0.03],
      [L * p.xRG + 0.02, p.belt - 0.02],
    ]);
    parts.push([Slot.Glass, extrude(g, W * 0.82, 0.06, 2)]);
    // Dach und Säulen
    const rf = L * p.xRF;
    const rr = L * p.xRR;
    parts.push([Slot.Paint, extrude(poly([[rf + 0.06, p.roof - 0.06], [rr - 0.03, p.roof - 0.06], [rr + 0.02, p.roof + 0.01], [rf + 0.02, p.roof + 0.01]]), W * 0.86, 0.05, 2)]);
    const pillar = (x0: number, z0: number, x1: number, z1: number) => {
      for (const side of [1, -1]) {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const b = new THREE.BoxGeometry(len, 0.05, 0.09);
        b.rotateY(-Math.atan2(z1 - z0, x1 - x0));
        b.translate((x0 + x1) / 2, side * W * 0.43, (z0 + z1) / 2);
        parts.push([Slot.Paint, b]);
      }
    };
    pillar(L * p.xH, p.belt, rf, p.roof - 0.03);
    pillar(L * p.xRG, p.belt, rr, p.roof - 0.03);
    // Kühlergrill, Stoßfänger, Spiegel
    parts.push([Slot.Trim, boxAt(0.05, W * 0.5, Math.max(0.12, (p.nose - gc) * 0.35), L / 2 + 0.07, 0, gc + (p.nose - gc) * 0.5)]);
    parts.push([Slot.Trim, boxAt(0.1, W * 0.96, 0.13, L / 2 + 0.05, 0, gc + 0.1)]);
    parts.push([Slot.Trim, boxAt(0.1, W * 0.96, 0.13, -L / 2 - 0.05, 0, gc + 0.12)]);
    for (const side of [1, -1]) parts.push([Slot.Paint, boxAt(0.14, 0.22, 0.1, L * p.xH - 0.05, side * (W / 2 + 0.1), p.belt + 0.08)]);
    // Lichter (vor der Rundung der Karosserie, die um ~9 cm übersteht)
    const hz = p.nose - 0.1;
    const tz = body === 'van' ? 1.05 : body === 'tow' ? 0.8 : p.rear - 0.2;
    for (const side of [1, -1]) {
      parts.push([Slot.Head, boxAt(0.06, W * 0.22, 0.12, L / 2 + 0.07, side * (W / 2 - W * 0.16), hz)]);
      parts.push([Slot.Tail, boxAt(0.05, W * 0.26, 0.13, -L / 2 - 0.07, side * (W / 2 - W * 0.16), tz)]);
    }
    // Kennzeichen hinten und vorn
    parts.push([Slot.Plate, boxAt(0.03, 0.52, 0.12, -L / 2 - 0.08, 0, Math.min(tz - 0.12, gc + 0.38))]);
    parts.push([Slot.Plate, boxAt(0.03, 0.52, 0.12, L / 2 + 0.08, 0, gc + 0.3)]);
    if (body === 'sport' || body === 'hyper') {
      // Heckflügel
      parts.push([Slot.Trim, boxAt(0.32, W * 0.92, 0.05, -L / 2 + 0.22, 0, p.rear + 0.24)]);
      for (const side of [1, -1]) parts.push([Slot.Trim, boxAt(0.12, 0.05, 0.22, -L / 2 + 0.25, side * W * 0.32, p.rear + 0.1)]);
    }
    if (body === 'tow') {
      // Ladefläche, Seitenwände und Kran
      parts.push([Slot.Trim, boxAt(L * 0.56, W * 0.98, 0.1, -L * 0.2, 0, p.belt + 0.05)]);
      parts.push([Slot.Trim, boxAt(0.12, 0.12, 1.6, -L * 0.42, 0, p.belt + 0.8)]);
      const arm = new THREE.BoxGeometry(L * 0.42, 0.16, 0.16);
      arm.rotateY(0.45);
      arm.translate(-L * 0.25, 0, p.belt + 1.25);
      parts.push([Slot.Paint, arm]);
      parts.push([Slot.Head, boxAt(0.25, 0.5, 0.1, L * 0.24, 0, p.roof + 0.06)]); // Rundumleuchte
    }
    const wy = W / 2 - 0.13;
    wheels = [
      [xf, wy, wheelR],
      [xf, -wy, wheelR],
      [xr, wy, wheelR],
      [xr, -wy, wheelR],
    ];
  }
  // Rad: Reifen und Felge mit Speichen
  const tire = new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 20, 1);
  const rim = new THREE.CylinderGeometry(wheelR * 0.62, wheelR * 0.62, 0.25, 16, 1);
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.BoxGeometry(wheelR * 1.15, 0.03, 0.06);
    sp.rotateY((i / 5) * Math.PI);
    sp.translate(0, 0.13, 0);
    spokes.push(sp);
    const sp2 = sp.clone();
    sp2.translate(0, -0.26, 0);
    spokes.push(sp2);
  }
  const wheel = assemble([[Slot.Rubber, tire], [Slot.Metal, rim], ...spokes.map((g): [Slot, THREE.BufferGeometry] => [Slot.Metal, g])]);
  const out: CarParts = { body: assemble(parts), wheel, wheels };
  cache.set(key, out);
  return out;
}

/** Karosserie + Räder als eine Geometrie (für instanzierte KI-Fahrzeuge) */
export function carMerged(body: Body, L: number, W: number): THREE.BufferGeometry {
  const p = carParts(body, L, W);
  const wheelsBySlot: Array<[Slot, THREE.BufferGeometry]> = [];
  for (const [x, y, z] of p.wheels) {
    for (const g of p.wheel.groups) {
      const part = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) {
        const a = p.wheel.getAttribute(k) as THREE.BufferAttribute;
        part.setAttribute(k, new THREE.BufferAttribute((a.array as Float32Array).slice(g.start * a.itemSize, (g.start + g.count) * a.itemSize), a.itemSize));
      }
      part.translate(x, y, z);
      wheelsBySlot.push([g.materialIndex as Slot, part]);
    }
  }
  const bodyParts: Array<[Slot, THREE.BufferGeometry]> = [];
  for (const g of p.body.groups) {
    const part = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) {
      const a = p.body.getAttribute(k) as THREE.BufferAttribute;
      part.setAttribute(k, new THREE.BufferAttribute((a.array as Float32Array).slice(g.start * a.itemSize, (g.start + g.count) * a.itemSize), a.itemSize));
    }
    bodyParts.push([g.materialIndex as Slot, part]);
  }
  return assemble([...bodyParts, ...wheelsBySlot]);
}

/** gemeinsame Materialien (Lichter werden nachts heller) */
export const carLights = {
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 0.4, roughness: 0.2, transparent: true }),
  tail: new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a10, emissiveIntensity: 0.4, roughness: 0.3, transparent: true }),
  setNight(n: number): void {
    this.head.emissiveIntensity = 0.4 + 5 * n;
    this.tail.emissiveIntensity = 0.4 + 2.2 * n;
  },
};

export function carMaterials(paint: THREE.Material, brake?: THREE.Material): THREE.Material[] {
  return [
    paint,
    new THREE.MeshStandardMaterial({ color: 0x0b1015, metalness: 0.2, roughness: 0.06, transparent: true }),
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, transparent: true }),
    new THREE.MeshStandardMaterial({ color: 0xbfc3c8, metalness: 1, roughness: 0.28, transparent: true }),
    carLights.head,
    brake ?? carLights.tail,
    new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6, metalness: 0.2, transparent: true }),
    new THREE.MeshStandardMaterial({ color: 0xe9ebe6, roughness: 0.5, transparent: true }),
  ];
}
