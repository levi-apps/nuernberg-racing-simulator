/**
 * Grundformen für 3D-Körper (alle in Metern, z nach oben), geschrieben in einen Mesh3DBuilder.
 */
import type { Mesh3DBuilder } from './geometry.ts';

/** Zylinder (oben optional schmaler) */
export function cylinder(m: Mesh3DBuilder, x: number, y: number, r: number, z0: number, z1: number, color: number, seg: number, topScale = 0.85): void {
  const base = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    base.push([m.vert(x + Math.cos(a) * r, y + Math.sin(a) * r, z0, color), m.vert(x + Math.cos(a) * r * topScale, y + Math.sin(a) * r * topScale, z1, color)]);
  }
  for (let i = 0; i < seg; i++) {
    const [a, b] = base[i];
    const [c, d] = base[i + 1];
    m.quad(a, c, d, b);
  }
}

/** Quader (Grundfläche w x d, gedreht um a) */
export function box(m: Mesh3DBuilder, x: number, y: number, z0: number, z1: number, w: number, d: number, a: number, color: number): void {
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
export function beam(m: Mesh3DBuilder, ax: number, ay: number, bx: number, by: number, z: number, t: number, color: number): void {
  const l = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / l) * t;
  const ny = ((bx - ax) / l) * t;
  m.quad(m.vert(ax + nx, ay + ny, z, color), m.vert(bx + nx, by + ny, z, color), m.vert(bx - nx, by - ny, z, color), m.vert(ax - nx, ay - ny, z, color));
  m.quad(m.vert(ax + nx, ay + ny, z - t * 2, color), m.vert(bx + nx, by + ny, z - t * 2, color), m.vert(bx + nx, by + ny, z, color), m.vert(ax + nx, ay + ny, z, color));
}

/** n-eckiges Prisma (Achteck usw.), optional mit Fassaden-UVs (u = Umfang + Stil, v = Höhe) */
export function prism(m: Mesh3DBuilder, x: number, y: number, r: number, z0: number, z1: number, color: number, seg: number, rot = 0, uBase = -1): void {
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= seg; i++) {
    const a = rot + (i / seg) * Math.PI * 2;
    ring.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  let u = 0;
  for (let i = 0; i < seg; i++) {
    const [px, py] = ring[i];
    const [qx, qy] = ring[i + 1];
    const el = Math.hypot(qx - px, qy - py);
    const uu = uBase >= 0 ? uBase + u : 0;
    const ue = uBase >= 0 ? uBase + u + el : 0;
    const h = uBase >= 0 ? z1 - z0 : 0;
    m.quad(m.vert(px, py, z0, color, uu, 0), m.vert(qx, qy, z0, color, ue, 0), m.vert(qx, qy, z1, color, ue, h), m.vert(px, py, z1, color, uu, h));
    u += el;
  }
  // Deckel
  const c = m.vert(x, y, z1, color);
  for (let i = 0; i < seg; i++) m.tri(m.vert(ring[i][0], ring[i][1], z1, color), m.vert(ring[i + 1][0], ring[i + 1][1], z1, color), c);
}

/** Spitze (Kegel/Pyramide) über einem Kreis/Vieleck; uv für Ziegelmuster entlang der Flanke */
export function spire(m: Mesh3DBuilder, x: number, y: number, r: number, z0: number, z1: number, color: number, seg: number, rot = 0): void {
  const slant = Math.hypot(r, z1 - z0);
  for (let i = 0; i < seg; i++) {
    const a0 = rot + (i / seg) * Math.PI * 2;
    const a1 = rot + ((i + 1) / seg) * Math.PI * 2;
    const w = 2 * r * Math.sin(Math.PI / seg);
    m.tri(m.vert(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z0, color, 0, 0), m.vert(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z0, color, w, 0), m.vert(x, y, z1, color, w / 2, slant));
  }
}

/** Kuppel (Halbkugel, in z gestaucht/gestreckt) */
export function dome(m: Mesh3DBuilder, x: number, y: number, z: number, r: number, rz: number, color: number): void {
  const rings = 7;
  const seg = 18;
  const idx: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * (Math.PI / 2);
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      row.push(m.vert(x + Math.cos(th) * Math.cos(phi) * r, y + Math.sin(th) * Math.cos(phi) * r, z + Math.sin(phi) * rz, color));
    }
    idx.push(row);
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) m.quad(idx[i][j], idx[i][(j + 1) % seg], idx[i + 1][(j + 1) % seg], idx[i + 1][j]);
}

/** Ellipsoid (z.B. Turmkorb) */
export function ellipsoid(m: Mesh3DBuilder, x: number, y: number, z: number, r: number, rz: number, color: number): void {
  dome(m, x, y, z, r, rz, color);
  dome(m, x, y, z, r, -rz, color);
}
