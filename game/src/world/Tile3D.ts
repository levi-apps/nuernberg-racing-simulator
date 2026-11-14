/**
 * 3D-Körper einer Kachel für die Verfolgerkamera: Gebäude (Wände mit Fenstern, Dächer in Höhe),
 * Bäume (Stamm und Krone), Ampeln auf Masten.
 */
import * as THREE from 'three';
import type { Building, Tile } from '@nrs/shared';
import { MarkerBuilder, Mesh3DBuilder } from './geometry.ts';
import { Pat, surfaceMat, TO_SUN } from './materials.ts';
import { edgeNormal, hash, pick, ridgeProj, roofInfo, shade, type SignalSlot } from './TileView.ts';
import { TREE_GREENS } from './style.ts';

/** Fassadenfarben: Putz, Sandstein (Nürnberger Altstadt), Beton */
const FACADE = [0xe3d9c6, 0xd8cbb2, 0xcdb895, 0xe8e2d6, 0xc7ae8c, 0xd2c2a6, 0xbfa483, 0xe0d4bd];
const FACADE_IND = [0xb9b8b3, 0xa9aaa6, 0xc4c1b8];
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'garage', 'garages', 'carport', 'shed', 'hangar', 'manufacture', 'service', 'roof']);

const LIGHT: [number, number, number] = (() => {
  const v = [TO_SUN[0] * 0.6, TO_SUN[1] * 0.6, 0.8];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

/** Helligkeit einer Fläche mit Normale n (Umgebungslicht + Sonne) */
const lightF = (nx: number, ny: number, nz: number) => 0.62 + 0.5 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);

export interface Tile3D {
  objects: THREE.Object3D[];
  lampSlots: SignalSlot[];
  lampAttr: THREE.BufferAttribute | null;
}

export function buildTile3D(t: Tile): Tile3D {
  const walls = new Mesh3DBuilder();
  const roofs = new Mesh3DBuilder();
  for (const b of t.buildings) building(b, walls, roofs);

  // Bäume: Stamm (sechseckig) und Krone (gedrungene Kugel)
  const trees = new Mesh3DBuilder();
  const tr = t.trees ?? [];
  for (let i = 0; i < tr.length; i += 3) {
    const x = tr[i] / 10;
    const y = tr[i + 1] / 10;
    const seed = (tr[i] * 73856093) ^ (tr[i + 1] * 19349663);
    const r = tr[i + 2] > 0 ? tr[i + 2] / 10 : 2.6 + hash(seed) * 2.2;
    const trunkH = 2.2 + r * 0.4;
    cylinder(trees, x, y, 0.18 + r * 0.03, 0, trunkH + r * 0.3, 0x6b5340, 6);
    ellipsoid(trees, x, y, trunkH + r * 0.75, r, r * 0.85, pick(TREE_GREENS, seed));
  }

  // Ampeln: Mast, Gehäuse oben, Lampe als waagerechte Scheibe (von schräg oben gut sichtbar)
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
      const s = lamps.disc(cx - fx * 0.3, cy - fy * 0.3, 0.32, 0xff3b2f, z + 0.6);
      lampSlots.push({ ctrl: h.ctrl, grp: h.grp, slot: lamps.slots[s] });
    };
    cylinder(poles, x, y, 0.08, 0, 4.2, 0x7a7d82, 6);
    head(x, y, 3.4);
    if (h.w > 6.5) {
      const reach = Math.min(h.w * 0.55, 7);
      const ex = x + lx * reach;
      const ey = y + ly * reach;
      beam(poles, x, y, ex, ey, 5.2, 0.1, 0x6e7176);
      head(ex, ey, 4.6);
    }
  }

  const objects: THREE.Object3D[] = [];
  const add = (b: Mesh3DBuilder, mat: THREE.Material, order: number, layer: string) => {
    if (b.empty) return;
    const m = new THREE.Mesh(b.build(), mat);
    m.renderOrder = order;
    m.frustumCulled = false;
    m.userData.layer = layer;
    objects.push(m);
  };
  add(walls, surfaceMat(Pat.Facade, 1, true), 10, 'buildings');
  add(roofs, surfaceMat(Pat.Roof, 1, true), 10.2, 'buildings');
  add(trees, surfaceMat(Pat.Canopy, 1, true), 11, 'trees');
  add(poles, surfaceMat(Pat.Plain, 1, true), 12, 'signals');
  let lampAttr: THREE.BufferAttribute | null = null;
  if (!lamps.empty) {
    const g = lamps.build();
    lampAttr = g.getAttribute('color') as THREE.BufferAttribute;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: true, depthWrite: true, transparent: true, side: THREE.DoubleSide }));
    m.renderOrder = 12.1;
    m.frustumCulled = false;
    m.userData.layer = 'signals';
    objects.push(m);
  }
  return { objects, lampSlots, lampAttr };
}

function building(b: Building, walls: Mesh3DBuilder, roofs: Mesh3DBuilder): void {
  const r = roofInfo(b);
  if (!r) return;
  const { pts, color } = r;
  const n = pts.length;
  const z0 = b.minH ?? 0;
  const top = Math.max(z0 + 2.5, r.kind === 'flat' ? b.h : b.h - Math.min(r.wid * 0.35, 5));
  const fac = b.t === 'church' || b.t === 'cathedral' ? 0xc9b08a : INDUSTRIAL.has(b.t) ? pick(FACADE_IND, b.id) : pick(FACADE, b.id);
  const rings = [pts, ...(b.holes ?? []).map((h) => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < h.length; i += 2) out.push([h[i] / 10, h[i + 1] / 10]);
    return out;
  })];
  // Wände
  for (const ring of rings) {
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [px, py] = ring[i];
      const [qx, qy] = ring[(i + 1) % ring.length];
      const el = Math.hypot(qx - px, qy - py);
      if (el < 0.05) continue;
      let nx = (qy - py) / el;
      let ny = -(qx - px) / el;
      if (!r.ccw) {
        nx = -nx;
        ny = -ny;
      }
      const f = lightF(nx, ny, 0);
      const cTop = shade(fac, f);
      const cBot = shade(fac, f * 0.82); // unten etwas dunkler (Umgebungsverdeckung)
      const a = walls.vert(px, py, z0, cBot, u, 0);
      const bb = walls.vert(qx, qy, z0, cBot, u + el, 0);
      const c = walls.vert(qx, qy, top, cTop, u + el, top - z0);
      const d = walls.vert(px, py, top, cTop, u, top - z0);
      walls.quad(a, bb, c, d);
      u += el;
    }
  }
  // Dach
  if (r.kind === 'flat') {
    roofs.polygon(pts, rings.slice(1), top, shade(color, lightF(0, 0, 1)));
    return;
  }
  if (r.kind === 'band') {
    const rise = r.band * 0.7;
    roofs.polygon(pts, rings.slice(1), top + rise, shade(color, lightF(0, 0, 1)));
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % n];
      if (Math.hypot(qx - px, qy - py) < 0.5) continue;
      const [nx, ny] = edgeNormal(r, i);
      const s = Math.hypot(r.band, rise);
      const c = shade(color, lightF((nx * rise) / s, (ny * rise) / s, r.band / s));
      const ix = -nx * r.band;
      const iy = -ny * r.band;
      const a = roofs.vert(px, py, top, c);
      const bb = roofs.vert(qx, qy, top, c);
      const cc = roofs.vert(qx + ix, qy + iy, top + rise, c);
      const d = roofs.vert(px + ix, py + iy, top + rise, c);
      roofs.quad(a, bb, cc, d);
    }
    return;
  }
  // Facetten zum First
  const rh = Math.min(r.wid * 0.45, 7);
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % n];
    const [nx, ny] = edgeNormal(r, i);
    const [rpx, rpy] = ridgeProj(r, px, py);
    const [rqx, rqy] = ridgeProj(r, qx, qy);
    // Neigung der Fläche: Abstand Traufe -> First
    const run = Math.max(0.5, Math.abs((rpx - px) * nx + (rpy - py) * ny));
    const s = Math.hypot(run, rh);
    const c = shade(color, lightF((nx * rh) / s, (ny * rh) / s, run / s));
    const a = roofs.vert(px, py, top, c);
    const bb = roofs.vert(qx, qy, top, c);
    const cc = roofs.vert(rqx, rqy, top + rh, c);
    const d = roofs.vert(rpx, rpy, top + rh, c);
    roofs.quad(a, bb, cc, d);
  }
}

function cylinder(m: Mesh3DBuilder, x: number, y: number, r: number, z0: number, z1: number, color: number, seg: number): void {
  const base = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    const c = shade(color, lightF(nx, ny, 0));
    base.push([m.vert(x + nx * r, y + ny * r, z0, c), m.vert(x + nx * r, y + ny * r, z1, c)]);
  }
  for (let i = 0; i < seg; i++) {
    const [a, b] = base[i];
    const [c, d] = base[(i + 1) % seg];
    m.quad(a, c, d, b);
  }
}

function ellipsoid(m: Mesh3DBuilder, x: number, y: number, z: number, r: number, rz: number, color: number): void {
  const rings = 5;
  const seg = 9;
  const idx: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI; // 0 = oben
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(th);
      const ny = Math.sin(phi) * Math.sin(th);
      const nz = Math.cos(phi);
      const wob = 1 + 0.08 * Math.sin(th * 3 + x) * Math.sin(phi * 2);
      row.push(m.vert(x + nx * r * wob, y + ny * r * wob, z + nz * rz, shade(color, 0.7 + 0.55 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]))));
    }
    idx.push(row);
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = idx[i][j];
      const b = idx[i][(j + 1) % seg];
      const c = idx[i + 1][(j + 1) % seg];
      const d = idx[i + 1][j];
      m.quad(a, b, c, d);
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
    const el = Math.hypot(qx - px, qy - py) || 1;
    const col = shade(color, lightF((qy - py) / el, -(qx - px) / el, 0));
    m.quad(m.vert(px, py, z0, col), m.vert(qx, qy, z0, col), m.vert(qx, qy, z1, col), m.vert(px, py, z1, col));
  }
  const top = shade(color, lightF(0, 0, 1));
  m.quad(m.vert(...pts[0], z1, top), m.vert(...pts[1], z1, top), m.vert(...pts[2], z1, top), m.vert(...pts[3], z1, top));
}

/** waagerechter Ausleger zwischen zwei Punkten */
function beam(m: Mesh3DBuilder, ax: number, ay: number, bx: number, by: number, z: number, t: number, color: number): void {
  const l = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / l) * t;
  const ny = ((bx - ax) / l) * t;
  const c = shade(color, 1);
  m.quad(m.vert(ax + nx, ay + ny, z, c), m.vert(bx + nx, by + ny, z, c), m.vert(bx - nx, by - ny, z, c), m.vert(ax - nx, ay - ny, z, c));
  m.quad(m.vert(ax + nx, ay + ny, z - t * 2, c), m.vert(bx + nx, by + ny, z - t * 2, c), m.vert(bx + nx, by + ny, z, c), m.vert(ax + nx, ay + ny, z, c));
}
