/**
 * Nürnberger Wahrzeichen als eigene Modelle über den OSM-Grundrissen:
 * St. Lorenz und St. Sebald (Doppeltürme), Frauenkirche (Ziergiebel), St. Elisabeth (Kuppel),
 * Stadtmauer-Rundtürme, Sinwellturm, eckige Türme mit Spitzhelm, Fernmeldeturm („Nürnberger Ei“)
 * und der Schöne Brunnen am Hauptmarkt.
 */
import { TILE_SIZE, type Building, type Tile } from '@nrs/shared';
import type { Mesh3DBuilder } from './geometry.ts';
import type { RoofInfo } from './TileView.ts';
import { box, cylinder, dome, ellipsoid, prism, spire } from './shapes.ts';

export interface Builders {
  walls: Mesh3DBuilder;
  roofs: Mesh3DBuilder;
  flatRoofs: Mesh3DBuilder;
  solid: Mesh3DBuilder;
}

/** Fassadenstile im Shader (u = Stil * 1000 + Abwicklung) */
export const STYLE_FACHWERK = 30;
export const STYLE_SAND = 34;
export const STYLE_TOWER = 38;

export const SANDSTONE = [0xb98a70, 0xc49579, 0xab7b63, 0xcfa083];
const SLATE = 0x4b5755;
const COPPER = 0x5f8f7c;
const TILE_RED = 0x8c3e2b;

type Kind =
  | { k: 'twin'; side: number; h: number; spireFrom: number; gap: number }
  | { k: 'gable'; h: number }
  | { k: 'dome' }
  | { k: 'round'; h: number; roof: number; slim?: boolean }
  | { k: 'square'; roofScale: number }
  | { k: 'tv' }
  | { k: 'single'; side: number; h: number; spireFrom: number; onion?: boolean }
  | { k: 'schloss'; tower: number };

const LM: Record<number, Kind> = {
  144721691: { k: 'twin', side: 9.5, h: 81, spireFrom: 52, gap: 15 }, // St. Lorenz
  139460727: { k: 'twin', side: 8.5, h: 78, spireFrom: 50, gap: 13 }, // St. Sebald
  143415043: { k: 'gable', h: 36 }, // Frauenkirche
  313228637: { k: 'dome' }, // St. Elisabeth
  23447844: { k: 'round', h: 30, roof: 13 }, // Laufer Torturm
  23447845: { k: 'round', h: 30, roof: 13 }, // Frauentorturm
  23447846: { k: 'round', h: 30, roof: 13 }, // Spittlertorturm
  23448111: { k: 'round', h: 30, roof: 13 }, // Neutorturm
  23448852: { k: 'round', h: 33, roof: 11, slim: true }, // Sinwellturm
  32112923: { k: 'square', roofScale: 1.5 }, // Heidenturm
  32520210: { k: 'square', roofScale: 1.8 }, // Laufer Schlagturm
  373097073: { k: 'square', roofScale: 1.4 }, // Weißer Turm
  32492658: { k: 'square', roofScale: 1.5 }, // Anne-Frank-Turm
  32518406: { k: 'square', roofScale: 1.5 }, // ND-Turm
  32547919: { k: 'square', roofScale: 1.5 }, // Alcibiades-Turm
  32477860: { k: 'square', roofScale: 1.5 },
  23283521: { k: 'tv' }, // Fernmeldeturm
  // Roth
  123723273: { k: 'single', side: 7.5, h: 54, spireFrom: 34 }, // Evangelische Stadtkirche
  162059072: { k: 'single', side: 6, h: 42, spireFrom: 28 }, // Kath. Kirche Maria Aufnahme in den Himmel
  1000001691009: { k: 'schloss', tower: 4.2 }, // Schloss Ratibor
};

/** Altstadt (innerhalb der Stadtmauer, als Ellipse angenähert) */
export function inAltstadt(x: number, y: number): boolean {
  return (x / 790) ** 2 + ((y + 90) / 640) ** 2 < 1 || inRothAltstadt(x, y);
}

/** Altstadt von Roth (um Marktplatz, Stadtkirche und Schloss Ratibor) */
export function inRothAltstadt(x: number, y: number): boolean {
  return ((x - 1640) / 300) ** 2 + ((y + 23110) / 200) ** 2 < 1;
}

export interface LandmarkInfo {
  /** Gebäude nicht wie üblich erzeugen */
  replace: boolean;
  /** Dachhöhe relativ zur Breite (Kirchen, Türme) */
  roofScale?: number;
  style?: number;
  roofColor?: number;
}

export function landmarkInfo(b: Building, cx: number, cy: number): LandmarkInfo | null {
  const lm = LM[b.id];
  const church = b.t === 'church' || b.t === 'cathedral' || b.t === 'chapel';
  if (!lm) {
    if (church) return { replace: false, roofScale: 0.85, style: inAltstadt(cx, cy) ? STYLE_SAND + (b.id % 4) : undefined };
    if (b.t === 'tower') return { replace: false, roofScale: 1.5, style: STYLE_TOWER };
    return null;
  }
  switch (lm.k) {
    case 'single':
      return { replace: false, roofScale: 0.9, style: STYLE_SAND + 2, roofColor: TILE_RED };
    case 'schloss':
      return { replace: false, roofScale: 0.75, style: STYLE_SAND + 3, roofColor: TILE_RED };
    case 'twin':
    case 'gable':
    case 'dome':
      return { replace: false, roofScale: 0.85, style: STYLE_SAND + 1, roofColor: lm.k === 'dome' ? COPPER : SLATE };
    case 'square':
      return { replace: false, roofScale: lm.roofScale, style: STYLE_TOWER, roofColor: TILE_RED };
    default:
      return { replace: true };
  }
}

const centroid = (pts: Array<[number, number]>): [number, number] => {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
};

/** Turmkörper mit Fassaden-UVs (für Sandsteinquader und Schlitzfenster) */
function towerBlock(m: Mesh3DBuilder, cx: number, cy: number, s: number, ang: number, z0: number, z1: number, color: number, style: number): void {
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const corner = (u: number, v: number): [number, number] => [cx + c * u - sn * v, cy + sn * u + c * v];
  const pts = [corner(-s / 2, -s / 2), corner(s / 2, -s / 2), corner(s / 2, s / 2), corner(-s / 2, s / 2)];
  let u = 0;
  for (let i = 0; i < 4; i++) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % 4];
    const su = style * 1000 + u;
    m.quad(m.vert(px, py, z0, color, su, z0), m.vert(qx, qy, z0, color, su + s, z0), m.vert(qx, qy, z1, color, su + s, z1), m.vert(px, py, z1, color, su, z1));
    u += s;
  }
}

/** zusätzliche Körper eines Wahrzeichens (nach dem Grundbau) */
export function buildLandmark(b: Building, r: RoofInfo, top: number, B: Builders): void {
  const lm = LM[b.id];
  if (!lm) return;
  const pts = r.pts;
  const [cx, cy] = centroid(pts);
  // Kirchenachse: West -> Ost
  let ax = r.r1[0] - r.r0[0];
  let ay = r.r1[1] - r.r0[1];
  const al = Math.hypot(ax, ay) || 1;
  ax /= al;
  ay /= al;
  if (ax > 0) {
    ax = -ax;
    ay = -ay;
  }
  // (ax, ay) zeigt jetzt nach Westen; westlichstes Ende des Grundrisses
  let maxP = -Infinity;
  for (const [x, y] of pts) maxP = Math.max(maxP, (x - cx) * ax + (y - cy) * ay);
  const wx = cx + ax * maxP;
  const wy = cy + ay * maxP;
  const px = -ay;
  const py = ax;
  const ang = Math.atan2(ay, ax);
  const sand = SANDSTONE[1];

  switch (lm.k) {
    case 'twin': {
      for (const sgn of [1, -1]) {
        const tx = wx - ax * lm.side * 0.55 + px * sgn * lm.gap * 0.5;
        const ty = wy - ay * lm.side * 0.55 + py * sgn * lm.gap * 0.5;
        towerBlock(B.walls, tx, ty, lm.side, ang, 0, lm.spireFrom, sand, STYLE_TOWER);
        box(B.solid, tx, ty, lm.spireFrom, lm.spireFrom + 0.7, lm.side + 1, lm.side + 1, ang, 0xa77a62);
        // Achteckgeschoss und Spitzhelm
        prism(B.walls, tx, ty, lm.side * 0.46, lm.spireFrom + 0.7, lm.spireFrom + 9, sand, 8, ang + Math.PI / 8, STYLE_TOWER * 1000);
        spire(B.roofs, tx, ty, lm.side * 0.5, lm.spireFrom + 9, lm.h, SLATE, 8, ang + Math.PI / 8);
        // Ecktürmchen
        for (const [u, v] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const ex = tx + (ax * u + px * v) * lm.side * 0.48;
          const ey = ty + (ay * u + py * v) * lm.side * 0.48;
          spire(B.roofs, ex, ey, 0.55, lm.spireFrom + 0.7, lm.spireFrom + 6, SLATE, 6);
        }
      }
      // Westportal mit Rosette
      box(B.solid, wx + ax * 0.3, wy + ay * 0.3, 0, 14, 0.8, lm.gap - lm.side * 0.6, ang, sand);
      cylinder(B.solid, wx + ax * 0.75, wy + ay * 0.75, 2.4, 9.5, 9.6, 0x2c2a3a, 16, 1);
      break;
    }
    case 'gable': {
      // Ziergiebel nach Westen zum Hauptmarkt, mit Stufen, Fialen und Uhr
      const w = Math.min(r.wid * 1.05, 22);
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const f0 = i / steps;
        const ww = w * (1 - f0 * 0.85);
        const z0 = top - 2 + (lm.h - top + 2) * f0;
        const z1 = top - 2 + (lm.h - top + 2) * ((i + 1) / steps);
        box(B.walls, wx + ax * 0.2, wy + ay * 0.2, z0, z1, 1.2, ww, ang, sand);
        // Fialen an den Stufen
        for (const sgn of [1, -1]) spire(B.roofs, wx + ax * 0.2 + px * sgn * ww * 0.5, wy + ay * 0.2 + py * sgn * ww * 0.5, 0.35, z1, z1 + 2.2, 0xd8b26a, 4);
      }
      spire(B.roofs, wx + ax * 0.2, wy + ay * 0.2, 1.1, lm.h, lm.h + 7, 0xd8b26a, 8);
      // Uhr (Männleinlaufen) und Chörlein über dem Portal
      cylinder(B.solid, wx + ax * 0.85, wy + ay * 0.85, 1.6, top + 3.5, top + 3.6, 0x2a3f8a, 20, 1);
      cylinder(B.solid, wx + ax * 0.9, wy + ay * 0.9, 1.25, top + 3.6, top + 3.7, 0xe9c25a, 20, 1);
      box(B.solid, wx + ax * 1.4, wy + ay * 1.4, 7, 12, 2.2, 3.4, ang, 0xc89a7c);
      spire(B.roofs, wx + ax * 1.4, wy + ay * 1.4, 1.8, 12, 15.5, SLATE, 6);
      break;
    }
    case 'single': {
      // ein Westturm mit Achteckgeschoss und Spitzhelm (oder Zwiebel)
      const tx = wx - ax * lm.side * 0.45;
      const ty = wy - ay * lm.side * 0.45;
      towerBlock(B.walls, tx, ty, lm.side, ang, 0, lm.spireFrom, sand, STYLE_TOWER);
      box(B.solid, tx, ty, lm.spireFrom, lm.spireFrom + 0.6, lm.side + 0.8, lm.side + 0.8, ang, 0xa77a62);
      prism(B.walls, tx, ty, lm.side * 0.45, lm.spireFrom + 0.6, lm.spireFrom + 7, 0xe9e1cf, 8, ang + Math.PI / 8, STYLE_TOWER * 1000);
      // Uhr auf allen Seiten
      for (let i = 0; i < 4; i++) {
        const a = ang + (i * Math.PI) / 2;
        cylinder(B.solid, tx + Math.cos(a) * (lm.side * 0.5 + 0.05), ty + Math.sin(a) * (lm.side * 0.5 + 0.05), 1.1, lm.spireFrom - 4, lm.spireFrom - 3.9, 0xe9c25a, 16, 1);
      }
      if (lm.onion) {
        ellipsoid(B.roofs, tx, ty, lm.spireFrom + 9, lm.side * 0.5, 3, 0x3f6b55);
        spire(B.roofs, tx, ty, 0.6, lm.spireFrom + 11, lm.h, 0x3f6b55, 8);
      } else spire(B.roofs, tx, ty, lm.side * 0.5, lm.spireFrom + 7, lm.h, SLATE, 8, ang + Math.PI / 8);
      spire(B.solid, tx, ty, 0.12, lm.h, lm.h + 2.5, 0xe0b84c, 4);
      break;
    }
    case 'schloss': {
      // Renaissance-Schloss: runde Ecktürme mit Spitzdach an den Ecken des Grundrisses
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const [x, y] of pts) {
        const a = (x - cx) * ax + (y - cy) * ay;
        const bb = (x - cx) * px + (y - cy) * py;
        minA = Math.min(minA, a);
        maxA = Math.max(maxA, a);
        minB = Math.min(minB, bb);
        maxB = Math.max(maxB, bb);
      }
      for (const a of [minA, maxA])
        for (const bb of [minB, maxB]) {
          const tx = cx + ax * a + px * bb;
          const ty = cy + ay * a + py * bb;
          prism(B.walls, tx, ty, lm.tower, 0, top + 5, SANDSTONE[3], 20, 0, STYLE_TOWER * 1000);
          cylinder(B.solid, tx, ty, lm.tower + 0.3, top + 4.6, top + 5, 0x9d7058, 20, 1);
          spire(B.roofs, tx, ty, lm.tower + 0.5, top + 5, top + 5 + lm.tower * 2.6, TILE_RED, 20);
          spire(B.solid, tx, ty, 0.1, top + 5 + lm.tower * 2.6, top + 7.5 + lm.tower * 2.6, 0xe0b84c, 4);
        }
      break;
    }
    case 'dome': {
      const rr = Math.min(r.wid * 0.36, 14);
      prism(B.walls, cx, cy, rr, top - 1, top + 7, sand, 16, 0, STYLE_TOWER * 1000);
      dome(B.roofs, cx, cy, top + 7, rr * 1.02, rr * 0.95, COPPER);
      prism(B.solid, cx, cy, rr * 0.18, top + 7 + rr * 0.9, top + 11 + rr * 0.9, 0xd7d0c0, 8);
      spire(B.roofs, cx, cy, rr * 0.2, top + 11 + rr * 0.9, top + 14 + rr * 0.9, COPPER, 8);
      break;
    }
  }
}

/** Ersatzmodelle (Rundtürme, Fernmeldeturm) anstelle des üblichen Gebäudes */
export function buildReplacement(b: Building, r: RoofInfo, B: Builders): void {
  const lm = LM[b.id];
  if (!lm) return;
  const pts = r.pts;
  const [cx, cy] = centroid(pts);
  let rad = 0;
  for (const [x, y] of pts) rad += Math.hypot(x - cx, y - cy);
  rad /= pts.length;
  if (lm.k === 'round') {
    const R = lm.slim ? Math.min(rad, 5.5) : rad;
    prism(B.walls, cx, cy, R, 0, lm.h, SANDSTONE[0], 28, 0, STYLE_TOWER * 1000);
    // Wehrgang-Kranz und Kegeldach
    cylinder(B.solid, cx, cy, R + 0.5, lm.h - 0.6, lm.h, 0x9d7058, 28, 1);
    spire(B.roofs, cx, cy, R + 0.8, lm.h, lm.h + lm.roof, TILE_RED, 28);
    // Dachgauben-Türmchen und Spitze
    prism(B.solid, cx, cy, 0.7, lm.h + lm.roof - 0.5, lm.h + lm.roof + 1.5, 0x8a5a3c, 8);
    spire(B.roofs, cx, cy, 0.9, lm.h + lm.roof + 1.5, lm.h + lm.roof + 4, SLATE, 8);
    return;
  }
  if (lm.k === 'tv') {
    // Nürnberger Fernmeldeturm: Betonschaft, Turmkorb („Ei“), Antenne
    cylinder(B.solid, cx, cy, 7.5, 0, 172, 0xc9c8c2, 24, 0.55);
    ellipsoid(B.solid, cx, cy, 186, 16, 15, 0xe8e6e0);
    cylinder(B.walls, cx, cy, 16.2, 182, 190, 0x24303a, 32, 1);
    cylinder(B.solid, cx, cy, 2.2, 200, 240, 0xd9d9d9, 12, 0.7);
    cylinder(B.solid, cx, cy, 0.9, 240, 292, 0xc93a2c, 8, 0.4);
  }
}

/** Wahrzeichen, die nicht an einem Gebäude hängen (Schöner Brunnen) */
export function pointLandmarks(t: Tile, B: Builders): void {
  const x0 = t.tx * TILE_SIZE;
  const y0 = t.ty * TILE_SIZE;
  const inTile = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + TILE_SIZE && y < y0 + TILE_SIZE;
  // Schöner Brunnen (Hauptmarkt): achteckiges Becken mit goldenem Gitter, 19 m hohe gotische Pyramide
  const [bx, by] = [-34, 36];
  if (inTile(bx, by)) {
    prism(B.solid, bx, by, 4.6, 0, 0.9, 0x9c9184, 8, Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
      box(B.solid, bx + Math.cos(a) * 4.9, by + Math.sin(a) * 4.9, 0, 2.2, 0.08, 3.8, a + Math.PI / 2, 0xd9b44a);
    }
    const tiers: Array<[number, number, number, number]> = [
      [1.9, 0.9, 4.2, 0xc8a07e],
      [1.55, 4.2, 7.4, 0xb5876a],
      [1.2, 7.4, 10.4, 0xd0a682],
      [0.9, 10.4, 13.2, 0xb5876a],
      [0.6, 13.2, 15.8, 0xd0a682],
    ];
    for (const [rr, z0, z1, col] of tiers) {
      prism(B.solid, bx, by, rr, z0, z1, col, 8, Math.PI / 8);
      // vergoldete Fialen an den Ecken
      for (let i = 0; i < 8; i += 2) {
        const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
        spire(B.roofs, bx + Math.cos(a) * rr * 1.1, by + Math.sin(a) * rr * 1.1, rr * 0.22, z1 - 0.4, z1 + 1.6, 0xe0b84c, 4);
      }
      cylinder(B.solid, bx, by, rr * 1.05, z1 - 0.15, z1, 0x3b4fa0, 8, 1);
    }
    spire(B.roofs, bx, by, 0.55, 15.8, 19, 0xe0b84c, 8);
  }
}
