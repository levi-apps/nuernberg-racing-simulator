/**
 * 3D-Körper einer Kachel für die Verfolgerkamera: Gebäude (Fassaden mit Fenstern, Ziegeldächer,
 * Schornsteine), Bäume, Ampeln auf Masten und Straßenlaternen. Beleuchtet mit echtem Licht
 * (Farben sind reine Grundfarben; Schattierung macht der Renderer).
 */
import * as THREE from 'three';
import { TILE_SIZE, type Building, type RoadClass, type Tile } from '@nrs/shared';
import { MarkerBuilder, Mesh3DBuilder } from './geometry.ts';
import { Pat } from './materials.ts';
import { litSurface, PAT_LAMP, PAT_ROOF_FLAT } from './litMaterials.ts';
import { edgeNormal, hash, pick, ridgeProj, roofInfo, type SignalSlot } from './TileView.ts';
import { TREE_GREENS } from './style.ts';

/** Fassadenfarben: Putz, Sandstein (Nürnberger Altstadt), Beton */
const FACADE = [0xe3d9c6, 0xd8cbb2, 0xcdb895, 0xe8e2d6, 0xc7ae8c, 0xd2c2a6, 0xbfa483, 0xe0d4bd, 0xe6d3b8, 0xd9c9b0, 0xc9b9a4, 0xb39472];
const FACADE_IND = [0xb9b8b3, 0xa9aaa6, 0xc4c1b8];
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'garage', 'garages', 'carport', 'shed', 'hangar', 'manufacture', 'service', 'roof']);
const LAMP_ROADS = new Set<RoadClass>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street'] as RoadClass[]);

export interface Tile3D {
  objects: THREE.Object3D[];
  lampSlots: SignalSlot[];
  lampAttr: THREE.BufferAttribute | null;
  /** Köpfe der Straßenlaternen (für Lichtquellen in der Nähe) */
  streetLamps: Array<[number, number, number]>;
}

export function buildTile3D(t: Tile): Tile3D {
  const walls = new Mesh3DBuilder();
  const roofs = new Mesh3DBuilder();
  const flatRoofs = new Mesh3DBuilder();
  const solid = new Mesh3DBuilder();
  for (const b of t.buildings) building(b, walls, roofs, flatRoofs, solid);

  // Bäume: Stamm und Krone aus mehreren Ballen
  const trunks = new Mesh3DBuilder();
  const crowns = new Mesh3DBuilder();
  const tr = t.trees ?? [];
  for (let i = 0; i < tr.length; i += 3) {
    const x = tr[i] / 10;
    const y = tr[i + 1] / 10;
    const seed = (tr[i] * 73856093) ^ (tr[i + 1] * 19349663);
    const r = tr[i + 2] > 0 ? tr[i + 2] / 10 : 2.6 + hash(seed) * 2.2;
    const trunkH = 2.0 + r * 0.45;
    cylinder(trunks, x, y, 0.16 + r * 0.035, 0, trunkH + r * 0.5, 0x5e4a38, 7);
    const g = pick(TREE_GREENS, seed);
    const lobes = 3 + Math.floor(hash(seed + 1) * 3);
    blob(crowns, x, y, trunkH + r * 0.8, r * 0.82, r * 0.72, g, seed);
    for (let k = 0; k < lobes; k++) {
      const a = (k / lobes) * Math.PI * 2 + hash(seed + k) * 1.2;
      const d = r * (0.38 + hash(seed + k * 3) * 0.2);
      blob(crowns, x + Math.cos(a) * d, y + Math.sin(a) * d, trunkH + r * (0.55 + hash(seed + k * 5) * 0.45), r * 0.58, r * 0.5, shadeHex(g, 0.85 + hash(seed + k * 7) * 0.3), seed + k);
    }
  }

  // Ampeln: Mast, Gehäuse, Lampenscheibe (leuchtet, wird nach Zustand umgefärbt)
  const poles = new Mesh3DBuilder();
  const lamps = new MarkerBuilder();
  const lampSlots: SignalSlot[] = [];
  for (const h of t.signals) {
    const x = h.x / 10;
    const y = h.y / 10;
    const a = (h.hdg * Math.PI) / 180;
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    const lx = -fy;
    const ly = fx;
    const head = (cx: number, cy: number, z: number) => {
      box(poles, cx, cy, z - 0.55, z + 0.55, 0.35, 0.4, a, 0x1d1f22);
      // Lampe vorn am Gehäuse, zum ankommenden Verkehr gerichtet
      const s = lamps.vdisc(cx - fx * 0.2, cy - fy * 0.2, z + 0.05, 0.17, 0xff3b2f, -fx, -fy);
      lampSlots.push({ ctrl: h.ctrl, grp: h.grp, slot: lamps.slots[s] });
    };
    cylinder(poles, x, y, 0.08, 0, 4.2, 0x6f7276, 8);
    head(x, y, 3.4);
    if (h.w > 6.5) {
      const reach = Math.min(h.w * 0.55, 7);
      const ex = x + lx * reach;
      const ey = y + ly * reach;
      beam(poles, x, y, ex, ey, 5.2, 0.1, 0x6e7176);
      head(ex, ey, 4.6);
    }
  }

  // Straßenlaternen entlang der Bordsteine
  const lampHeads = new Mesh3DBuilder();
  const streetLamps: Array<[number, number, number]> = [];
  const x0 = t.tx * TILE_SIZE;
  const y0 = t.ty * TILE_SIZE;
  for (const s of t.surfaces) {
    if (s.k !== 'seg' || s.layer !== 0 || !s.kerbs || !LAMP_ROADS.has(s.cls)) continue;
    const ring = s.ring;
    const spacing = s.cls === 'residential' || s.cls === 'living_street' || s.cls === 'unclassified' ? 34 : 28;
    s.kerbs.forEach((k, ki) => {
      let next = hash(s.id * 31 + ki) * spacing;
      let acc = 0;
      for (let i = 2; i < k.length; i += 2) {
        const ax = k[i - 2] / 10;
        const ay = k[i - 1] / 10;
        const bx = k[i] / 10;
        const by = k[i + 1] / 10;
        const seg = Math.hypot(bx - ax, by - ay);
        while (seg > 0 && next <= acc + seg) {
          const f = (next - acc) / seg;
          const px = ax + (bx - ax) * f;
          const py = ay + (by - ay) * f;
          next += spacing;
          if (px < x0 || py < y0 || px >= x0 + TILE_SIZE || py >= y0 + TILE_SIZE) continue;
          // außen = die Seite, die nicht in der Fahrbahn liegt
          let nx = -(by - ay) / seg;
          let ny = (bx - ax) / seg;
          if (inRing(ring, (px + nx * 1.2) * 10, (py + ny * 1.2) * 10)) {
            nx = -nx;
            ny = -ny;
          }
          const qx = px + nx * 0.7;
          const qy = py + ny * 0.7;
          streetLamp(poles, lampHeads, qx, qy, -nx, -ny);
          streetLamps.push([qx - nx * 1.5, qy - ny * 1.5, 7.0]);
        }
        acc += seg;
      }
    });
  }

  const objects: THREE.Object3D[] = [];
  const add = (b: Mesh3DBuilder, mat: THREE.Material, order: number, layer: string, cast = true) => {
    if (b.empty) return;
    const g = b.build();
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = order;
    m.frustumCulled = false;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.userData.layer = layer;
    m.userData.is3d = true;
    objects.push(m);
  };
  add(walls, litSurface(Pat.Facade, 1, true), 10, 'buildings');
  add(roofs, litSurface(Pat.Roof, 1, true), 10.2, 'buildings');
  add(flatRoofs, litSurface(PAT_ROOF_FLAT, 1, true), 10.2, 'buildings');
  add(solid, litSurface(Pat.Plain, 1, true), 10.3, 'buildings');
  add(trunks, litSurface(Pat.Plain, 1, true), 11, 'trees');
  add(crowns, litSurface(Pat.Canopy, 1, true), 11.1, 'trees');
  add(poles, litSurface(Pat.Plain, 1, true), 12, 'signals');
  add(lampHeads, litSurface(PAT_LAMP, 1, true), 12.05, 'signals', false);
  let lampAttr: THREE.BufferAttribute | null = null;
  if (!lamps.empty) {
    const g = lamps.build();
    lampAttr = g.getAttribute('color') as THREE.BufferAttribute;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: true, depthWrite: true, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
    m.renderOrder = 12.1;
    m.frustumCulled = false;
    m.userData.layer = 'signals';
    m.userData.unlit = true;
    m.userData.is3d = true;
    objects.push(m);
  }
  return { objects, lampSlots, lampAttr, streetLamps };
}

const tmpC = new THREE.Color();
function shadeHex(c: number, f: number): number {
  return tmpC.setHex(c).multiplyScalar(f).getHex();
}

function inRing(ring: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function streetLamp(poles: Mesh3DBuilder, heads: Mesh3DBuilder, x: number, y: number, dx: number, dy: number): void {
  const H = 7.2;
  cylinder(poles, x, y, 0.09, 0, H, 0x4b5056, 8);
  beam(poles, x, y, x + dx * 1.6, y + dy * 1.6, H, 0.06, 0x4b5056);
  const hx = x + dx * 1.6;
  const hy = y + dy * 1.6;
  box(heads, hx, hy, H - 0.28, H - 0.06, 0.75, 0.3, Math.atan2(dy, dx), 0xf4ecd8);
}

function building(b: Building, walls: Mesh3DBuilder, roofs: Mesh3DBuilder, flatRoofs: Mesh3DBuilder, solid: Mesh3DBuilder): void {
  const r = roofInfo(b);
  if (!r) return;
  const { pts, color } = r;
  const n = pts.length;
  const z0 = b.minH ?? 0;
  const top = Math.max(z0 + 2.5, r.kind === 'flat' ? b.h : b.h - Math.min(r.wid * 0.35, 5));
  const industrial = INDUSTRIAL.has(b.t);
  const fac = b.t === 'church' || b.t === 'cathedral' ? 0xc9b08a : industrial ? pick(FACADE_IND, b.id) : pick(FACADE, b.id);
  // Fassadenstil (Fensterraster, Ladenzone) je Gebäude; niedrige Nebengebäude ohne Laden
  let style = Math.floor(hash(b.id * 13 + 5) * 30);
  if (industrial || top - z0 < 6) style = style - (style % 5) + (style % 5 === 2 ? 1 : style % 5);
  const rings = [
    pts,
    ...(b.holes ?? []).map((h) => {
      const out: Array<[number, number]> = [];
      for (let i = 0; i < h.length; i += 2) out.push([h[i] / 10, h[i + 1] / 10]);
      return out;
    }),
  ];
  // Wände (u: Abwicklung + Stil, v: Höhe über Gebäudeunterkante)
  for (const ring of rings) {
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [px, py] = ring[i];
      const [qx, qy] = ring[(i + 1) % ring.length];
      const el = Math.hypot(qx - px, qy - py);
      if (el < 0.05) continue;
      const su = style * 1000 + (u % 1000);
      const a = walls.vert(px, py, z0, fac, su, 0);
      const bb = walls.vert(qx, qy, z0, fac, su + el, 0);
      const c = walls.vert(qx, qy, top, fac, su + el, top - z0);
      const d = walls.vert(px, py, top, fac, su, top - z0);
      if (r.ccw) walls.quad(a, bb, c, d);
      else walls.quad(a, d, c, bb);
      u += el;
    }
  }
  if (r.kind === 'flat') {
    flatRoofs.polygon(pts, rings.slice(1), top, color);
    // Attika: niedrige Brüstung am Dachrand
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % n];
      if (Math.hypot(qx - px, qy - py) < 0.3) continue;
      const c = shadeHex(fac, 0.92);
      solid.quad(solid.vert(px, py, top, c), solid.vert(qx, qy, top, c), solid.vert(qx, qy, top + 0.5, c), solid.vert(px, py, top + 0.5, c));
    }
    // Dachaufbauten (Lüftung) auf großen Flachdächern
    if (r.wid > 14 && hash(b.id + 9) < 0.7) {
      const [cx, cy] = centroid(pts);
      box(solid, cx + (hash(b.id) - 0.5) * r.wid * 0.3, cy + (hash(b.id + 1) - 0.5) * r.wid * 0.3, top, top + 1.4, 2.2, 1.6, hash(b.id + 2) * 3, 0x9a9c9e);
    }
    return;
  }
  if (r.kind === 'band') {
    const rise = r.band * 0.7;
    flatRoofs.polygon(pts, rings.slice(1), top + rise, color);
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % n];
      const el = Math.hypot(qx - px, qy - py);
      if (el < 0.5) continue;
      const [nx, ny] = edgeNormal(r, i);
      const sl = Math.hypot(r.band, rise);
      const ix = -nx * r.band;
      const iy = -ny * r.band;
      const a = roofs.vert(px, py, top, color, 0, 0);
      const bb = roofs.vert(qx, qy, top, color, el, 0);
      const cc = roofs.vert(qx + ix, qy + iy, top + rise, color, el, sl);
      const d = roofs.vert(px + ix, py + iy, top + rise, color, 0, sl);
      roofs.quad(a, bb, cc, d);
    }
    return;
  }
  // Satteldach / Walmdach: Facetten zum First, Ziegel-UVs entlang Traufe und Neigung
  const rh = Math.min(r.wid * 0.45, 7);
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % n];
    const [nx, ny] = edgeNormal(r, i);
    const [rpx, rpy] = ridgeProj(r, px, py);
    const [rqx, rqy] = ridgeProj(r, qx, qy);
    const el = Math.hypot(qx - px, qy - py);
    const run = Math.max(0.5, Math.abs((rpx - px) * nx + (rpy - py) * ny));
    const sl = Math.hypot(run, rh);
    const ex = qx - px;
    const ey = qy - py;
    const along = (x: number, y: number) => (el > 0 ? ((x - px) * ex + (y - py) * ey) / el : 0);
    const a = roofs.vert(px, py, top, color, 0, 0);
    const bb = roofs.vert(qx, qy, top, color, el, 0);
    const cc = roofs.vert(rqx, rqy, top + rh, color, along(rqx, rqy), sl);
    const d = roofs.vert(rpx, rpy, top + rh, color, along(rpx, rpy), sl);
    roofs.quad(a, bb, cc, d);
  }
  // Schornsteine nahe am First
  if (r.wid > 6 && hash(b.id + 21) < 0.8) {
    const count = 1 + (hash(b.id + 22) < 0.35 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const f = 0.2 + hash(b.id + 23 + k) * 0.6;
      const cx = r.r0[0] + (r.r1[0] - r.r0[0]) * f;
      const cy = r.r0[1] + (r.r1[1] - r.r0[1]) * f;
      const ang = Math.atan2(r.r1[1] - r.r0[1], r.r1[0] - r.r0[0]);
      box(solid, cx + Math.cos(ang + 1.57) * 0.8, cy + Math.sin(ang + 1.57) * 0.8, top + rh * 0.6, top + rh + 1.1, 0.6, 0.7, ang, 0x8a4f3c);
    }
  }
}

function centroid(pts: Array<[number, number]>): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function cylinder(m: Mesh3DBuilder, x: number, y: number, r: number, z0: number, z1: number, color: number, seg: number): void {
  const base = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    base.push([m.vert(x + Math.cos(a) * r, y + Math.sin(a) * r, z0, color), m.vert(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, z1, color)]);
  }
  for (let i = 0; i < seg; i++) {
    const [a, b] = base[i];
    const [c, d] = base[i + 1];
    m.quad(a, c, d, b);
  }
}

/** Kronenballen: verbeulte Kugel (glatte Normalen über gemeinsame Ecken) */
function blob(m: Mesh3DBuilder, x: number, y: number, z: number, r: number, rz: number, color: number, seed: number): void {
  const rings = 6;
  const seg = 10;
  const idx: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(th);
      const ny = Math.sin(phi) * Math.sin(th);
      const nz = Math.cos(phi);
      const wob = 1 + 0.12 * Math.sin(th * 3 + seed) * Math.sin(phi * 2 + seed * 0.3) + 0.06 * Math.sin(th * 7 + phi * 5 + seed);
      // unten etwas dunkler (Eigenschatten im Laub)
      const c = shadeHex(color, 0.78 + 0.22 * (nz * 0.5 + 0.5));
      row.push(m.vert(x + nx * r * wob, y + ny * r * wob, z + nz * rz * (nz < 0 ? 0.7 : 1), c, nx, ny));
    }
    idx.push(row);
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = idx[i][j];
      const b = idx[i][(j + 1) % seg];
      const c = idx[i + 1][(j + 1) % seg];
      const d = idx[i + 1][j];
      m.quad(a, d, c, b);
    }
}

/** Quader (Grundfläche w x d, gedreht um a) */
function box(m: Mesh3DBuilder, x: number, y: number, z0: number, z1: number, w: number, d: number, a: number, color: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const corner = (u: number, v: number): [number, number] => [x + c * u - s * v, y + s * u + c * v];
  const pts = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
  for (let i = 0; i < 4; i++) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % 4];
    m.quad(m.vert(px, py, z0, color), m.vert(qx, qy, z0, color), m.vert(qx, qy, z1, color), m.vert(px, py, z1, color));
  }
  m.quad(m.vert(...pts[0], z1, color), m.vert(...pts[1], z1, color), m.vert(...pts[2], z1, color), m.vert(...pts[3], z1, color));
}

/** waagerechter Ausleger zwischen zwei Punkten */
function beam(m: Mesh3DBuilder, ax: number, ay: number, bx: number, by: number, z: number, t: number, color: number): void {
  const l = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / l) * t;
  const ny = ((bx - ax) / l) * t;
  m.quad(m.vert(ax + nx, ay + ny, z, color), m.vert(bx + nx, by + ny, z, color), m.vert(bx - nx, by - ny, z, color), m.vert(ax - nx, ay - ny, z, color));
  m.quad(m.vert(ax + nx, ay + ny, z - t * 2, color), m.vert(bx + nx, by + ny, z - t * 2, color), m.vert(bx + nx, by + ny, z, color), m.vert(ax + nx, ay + ny, z, color));
}
