/**
 * 3D-Körper einer Kachel für die Verfolgerkamera: Gebäude (Fassaden mit Fenstern, Ziegeldächer,
 * Schornsteine), Bäume, Ampeln auf Masten und Straßenlaternen. Beleuchtet mit echtem Licht
 * (Farben sind reine Grundfarben; Schattierung macht der Renderer).
 */
import * as THREE from 'three';
import { TILE_SIZE, type Building, type RoadClass, type Tile } from '@nrs/shared';
import { MarkerBuilder, Mesh3DBuilder } from './geometry.ts';
import { Pat } from './materials.ts';
import { litSurface, PAT_LAMP, PAT_ROOF_FLAT, PAT_SOLAR } from './litMaterials.ts';
import { beam, box, cylinder, spire } from './shapes.ts';
import { buildLandmark, buildReplacement, inAltstadt, landmarkInfo, pointLandmarks, SANDSTONE, STYLE_FACHWERK, STYLE_SAND, STYLE_TOWER, type Builders } from './Landmarks.ts';
import { edgeNormal, hash, pick, ridgeProj, roofInfo, type SignalSlot } from './TileView.ts';
import { TREE_GREENS } from './style.ts';
import { AD, adMaterial, type AdRegion } from './Ads.ts';
import { models } from '../assets/Models.ts';

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
  const ads = new Mesh3DBuilder();
  const solar = new Mesh3DBuilder();
  adMaterial(); // Texturkarte und Bereiche anlegen
  const D: Detail = { walls, roofs, flatRoofs, solid, ads, solar };
  for (const b of t.buildings) building(b, D);
  pointLandmarks(t, D);
  // Stadtmauer: Mauer mit überdachtem Wehrgang entlang der OSM-Linien
  for (const l of t.lines) if (l.k === 'citywall' && l.layer === 0) cityWall(l.pts, D);

  // Bäume: Stamm und Krone aus mehreren Ballen
  const trunks = new Mesh3DBuilder();
  const crowns = new Mesh3DBuilder();
  // mit geladenen Baummodellen zeichnet das Straßenleben die Bäume
  const tr = models.ready && models.trees.length ? [] : (t.trees ?? []);
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
          // Werbung: große Plakatwände an Hauptstraßen, Litfaßsäulen in Wohnstraßen
          const hv = hash(Math.round(px * 7) * 92821 + Math.round(py * 7));
          const big = s.cls === 'primary' || s.cls === 'secondary' || s.cls === 'trunk' || s.cls === 'tertiary';
          if (big && hv < 0.42) {
            const bx = px + nx * 3.6;
            const by = py + ny * 3.6;
            if (!insideBuilding(t, bx, by, 4)) billboard(poles, ads, bx, by, -nx, -ny, hv < 0.21 ? 1 : -1, Math.floor(hv * 1000));
          } else if (!big && hv < 0.12) {
            const lx = px + nx * 1.7;
            const ly = py + ny * 1.7;
            if (!insideBuilding(t, lx, ly, 1.2)) litfass(solid, ads, lx, ly, Math.floor(hv * 1000));
          }
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
  add(ads, adMaterial(), 12.2, 'buildings');
  add(solar, litSurface(PAT_SOLAR, 1, true), 10.25, 'buildings', false);
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

interface Detail extends Builders {
  ads: Mesh3DBuilder;
  solar: Mesh3DBuilder;
}

const PLASTER_FW = [0xefe6d2, 0xf3ead6, 0xe8dcc4, 0xf1e4cb];

function building(b: Building, D: Detail): void {
  const { walls, roofs, flatRoofs, solid, ads, solar } = D;
  const r = roofInfo(b);
  if (!r) return;
  const { pts } = r;
  const n = pts.length;
  const [bcx, bcy] = centroid(pts);
  const lmi = landmarkInfo(b, bcx, bcy);
  if (lmi?.replace) {
    buildReplacement(b, r, D);
    return;
  }
  const color = lmi?.roofColor ?? r.color;
  const z0 = b.minH ?? 0;
  const top = Math.max(z0 + 2.5, r.kind === 'flat' ? b.h : b.h - Math.min(r.wid * 0.35, 5));
  const industrial = INDUSTRIAL.has(b.t);
  const alt = inAltstadt(bcx, bcy);
  let fac = b.t === 'church' || b.t === 'cathedral' ? 0xc9b08a : industrial ? pick(FACADE_IND, b.id) : pick(FACADE, b.id);
  // Fassadenstil (Fensterraster, Ladenzone) je Gebäude; niedrige Nebengebäude ohne Laden
  let style = Math.floor(hash(b.id * 13 + 5) * 30);
  if (industrial || top - z0 < 6) style = style - (style % 5) + (style % 5 === 2 ? 1 : style % 5);
  if (lmi?.style !== undefined) style = lmi.style;
  else if (alt && !industrial) {
    // Altstadt: Sandstein oder Fachwerk
    const roll = hash(b.id * 5 + 1);
    if (roll < 0.45) style = STYLE_SAND + (b.id % 4);
    else if (roll < 0.75 && top - z0 <= 16) style = STYLE_FACHWERK + (b.id % 4);
  }
  if (style >= STYLE_SAND) fac = SANDSTONE[b.id % 4];
  else if (style >= STYLE_FACHWERK) fac = PLASTER_FW[b.id % 4];
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
  buildLandmark(b, r, top, D);
  const longest = (): number => {
    let bi = 0;
    let bl = 0;
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]);
      if (l > bl) {
        bl = l;
        bi = i;
      }
    }
    return bi;
  };
  // Chörlein (Erker) an Altstadthäusern
  if (alt && !lmi && top - z0 >= 9 && hash(b.id + 41) < 0.3) {
    const i = longest();
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % n];
    const el = Math.hypot(qx - px, qy - py);
    if (el >= 6) {
      const [nx, ny] = edgeNormal(r, i);
      const f = 0.3 + hash(b.id + 42) * 0.4;
      const ex = px + (qx - px) * f + nx * 0.45;
      const ey = py + (qy - py) * f + ny * 0.45;
      const ang = Math.atan2(ny, nx);
      const ez = z0 + 4.2;
      box(solid, ex, ey, ez, ez + 3.2, 0.9, 2.0, ang, shadeHex(fac, 0.92));
      for (const k of [-0.6, 0, 0.6]) box(solid, ex + nx * 0.46 - ny * k, ey + ny * 0.46 + nx * k, ez + 0.9, ez + 2.4, 0.02, 0.45, ang, 0x1e2732);
      box(solid, ex, ey, ez - 0.35, ez, 0.7, 1.6, ang, shadeHex(fac, 0.8));
      spire(roofs, ex, ey, 1.25, ez + 3.2, ez + 4.4, color, 4, ang + Math.PI / 4);
    }
  }
  // Balkone an Wohnblöcken außerhalb der Altstadt
  if (!alt && !lmi && (b.t === 'apartments' || b.t === 'residential') && top - z0 >= 12 && hash(b.id + 51) < 0.35) {
    const i = longest();
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % n];
    const el = Math.hypot(qx - px, qy - py);
    const [nx, ny] = edgeNormal(r, i);
    const ang = Math.atan2(ny, nx);
    const bays = Math.floor(el / 3.4);
    const floors = Math.floor((top - z0) / 3);
    const glassy = hash(b.id + 52) < 0.5;
    if (bays >= 3)
      for (let fl = 1; fl < floors; fl++)
        for (let k = 1; k < bays - 1; k++) {
          const f = (k + 0.5) / bays;
          const bx = px + (qx - px) * f;
          const by = py + (qy - py) * f;
          const z = z0 + fl * 3;
          box(solid, bx + nx * 0.65, by + ny * 0.65, z, z + 0.18, 1.3, 2.6, ang, 0xd9d6cf);
          box(solid, bx + nx * 1.27, by + ny * 1.27, z + 0.18, z + 1.1, 0.06, 2.6, ang, glassy ? 0x7a8c98 : 0x5a5d62);
        }
  }
  // Werbebanner an der Fassade (viele!)
  if (top - z0 >= 6.5 && b.t !== 'church' && b.t !== 'cathedral') {
    let placed = 0;
    for (let i = 0; i < n && placed < 3; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % n];
      const el = Math.hypot(qx - px, qy - py);
      const hb = hash(b.id * 7 + i * 131);
      if (el < 6 || hb > 0.58) continue;
      const [nx, ny] = edgeNormal(r, i);
      const portrait = el < 13 || hb < 0.12;
      const w = portrait ? Math.min(4.2, el * 0.45) : Math.min(11, el * 0.65);
      const h = portrait ? w * 1.5 : w * 0.5;
      if (top - z0 < h + 2.5) continue;
      const tt = 0.3 + hash(b.id + i * 17) * 0.4;
      const cx = px + (qx - px) * tt;
      const cy = py + (qy - py) * tt;
      const z = z0 + Math.min(top - z0 - h - 0.8, 3.6 + hash(b.id * 3 + i) * Math.max(0, top - z0 - h - 4.5));
      const regs = portrait ? AD.portrait : AD.landscape;
      adPanel(ads, cx + nx * 0.12, cy + ny * 0.12, z, nx, ny, w, h, regs[Math.floor(hb * 997) % regs.length]);
      placed++;
    }
  }
  // Leuchtreklame auf hohen Flachdächern
  if (r.kind === 'flat' && top - z0 > 14 && r.wid > 10 && hash(b.id + 77) < 0.4) {
    let best = 0;
    let bl = 0;
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]);
      if (l > bl) {
        bl = l;
        best = i;
      }
    }
    const [px, py] = pts[best];
    const [qx, qy] = pts[(best + 1) % n];
    const [nx, ny] = edgeNormal(r, best);
    const w = Math.min(14, bl * 0.75);
    const h = w * 0.25;
    const cx = (px + qx) / 2 - nx * 0.6;
    const cy = (py + qy) / 2 - ny * 0.6;
    adPanel(ads, cx, cy, top + 0.6, nx, ny, w, h, AD.neon[Math.floor(hash(b.id) * 2)]);
    for (const f of [-0.4, 0.4]) {
      const ax = -ny * w * f;
      const ay = nx * w * f;
      box(solid, cx + ax - nx * 0.3, cy + ay - ny * 0.3, top, top + 0.7 + h * 0.6, 0.12, 0.12, 0, 0x2c2e33);
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
    const rise = r.band * (lmi?.roofScale ? 1.8 : 0.7);
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
  const rh = lmi?.roofScale ? Math.min(r.wid * lmi.roofScale, 24) : Math.min(r.wid * 0.45, 7);
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
  // Gauben, Solarmodule, Antennen
  if (!lmi && rh >= 2.4)
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % n];
      const el = Math.hypot(qx - px, qy - py);
      if (el < 5) continue;
      const [nx, ny] = edgeNormal(r, i);
      const rp = ridgeProj(r, px, py);
      const rq = ridgeProj(r, qx, qy);
      // Walmflächen (Dreiecke) auslassen
      if (Math.hypot(rq[0] - rp[0], rq[1] - rp[1]) < el * 0.45) continue;
      const hv = hash(b.id * 31 + i);
      const pt = (t: number, sUp: number): [number, number, number] => {
        const ex = px + (qx - px) * t;
        const ey = py + (qy - py) * t;
        const [rx, ry] = ridgeProj(r, ex, ey);
        return [ex + (rx - ex) * sUp, ey + (ry - ey) * sUp, top + rh * sUp];
      };
      if (!alt && ny < -0.45 && hv < 0.32) {
        // Solar auf der Südseite
        const off = 0.1;
        const run = Math.hypot(rp[0] - px, rp[1] - py);
        const sl = Math.hypot(run, rh);
        const c00 = pt(0.12, 0.18);
        const c10 = pt(0.88, 0.18);
        const c11 = pt(0.88, 0.78);
        const c01 = pt(0.12, 0.78);
        const lift = (q: [number, number, number]): [number, number, number] => [q[0] + nx * off * 0.3, q[1] + ny * off * 0.3, q[2] + off];
        const [a0, a1, a2, a3] = [lift(c00), lift(c10), lift(c11), lift(c01)];
        solar.quad(solar.vert(...a0, 0x203050, 0, 0), solar.vert(...a1, 0x203050, el * 0.76, 0), solar.vert(...a2, 0x203050, el * 0.76, sl * 0.6), solar.vert(...a3, 0x203050, 0, sl * 0.6));
        continue;
      }
      if (hv > 0.62) continue;
      const count = Math.min(3, Math.floor(el / 5));
      for (let k = 0; k < count; k++) {
        const [dx, dy, dz] = pt((k + 0.5) / count, 0.28);
        const [rx2, ry2] = ridgeProj(r, dx, dy);
        const depth = Math.max(1, Math.hypot(rx2 - dx, ry2 - dy) * 0.55);
        const ang = Math.atan2(ny, nx);
        const w = 1.5;
        // Gaubenkörper (reicht ins Dach hinein), Fenster, Satteldach
        box(solid, dx - nx * depth * 0.5, dy - ny * depth * 0.5, dz - 0.4, dz + 1.4, depth, w, ang, shadeHex(fac, 0.97));
        box(solid, dx + nx * 0.02, dy + ny * 0.02, dz + 0.15, dz + 1.15, 0.02, 0.9, ang, 0x1e2732);
        const lx = -ny * w * 0.58;
        const ly = nx * w * 0.58;
        const bxx = dx - nx * depth;
        const byy = dy - ny * depth;
        const zt = dz + 1.4;
        const za = dz + 2.0;
        roofs.quad(roofs.vert(dx + lx, dy + ly, zt, color, 0, 0), roofs.vert(bxx + lx, byy + ly, zt, color, depth, 0), roofs.vert(bxx, byy, za, color, depth, 1), roofs.vert(dx, dy, za, color, 0, 1));
        roofs.quad(roofs.vert(dx, dy, za, color, 0, 1), roofs.vert(bxx, byy, za, color, depth, 1), roofs.vert(bxx - lx, byy - ly, zt, color, depth, 0), roofs.vert(dx - lx, dy - ly, zt, color, 0, 0));
        solid.tri(solid.vert(dx + lx, dy + ly, zt, fac), solid.vert(dx - lx, dy - ly, zt, fac), solid.vert(dx, dy, za, fac));
      }
    }
  // Antennen auf manchen Dächern außerhalb der Altstadt
  if (!alt && !lmi && hash(b.id + 61) < 0.2) {
    const ax = (r.r0[0] + r.r1[0]) / 2;
    const ay = (r.r0[1] + r.r1[1]) / 2;
    const z = top + rh;
    cylinder(solid, ax, ay, 0.04, z, z + 2.6, 0x8a8d90, 5, 1);
    beam(solid, ax - 0.7, ay, ax + 0.7, ay, z + 2.2, 0.025, 0x8a8d90);
    beam(solid, ax, ay - 0.5, ax, ay + 0.5, z + 1.7, 0.025, 0x8a8d90);
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



/** Werbetafel: Vorderseite zeigt in Richtung (nx, ny), Mitte unten bei (cx, cy, z) */
function adPanel(m: Mesh3DBuilder, cx: number, cy: number, z: number, nx: number, ny: number, w: number, h: number, r: AdRegion): void {
  // rechte Hand des Betrachters, der auf die Tafel schaut
  const rx = -ny;
  const ry = nx;
  const x0 = cx - (rx * w) / 2;
  const y0 = cy - (ry * w) / 2;
  const x1 = cx + (rx * w) / 2;
  const y1 = cy + (ry * w) / 2;
  const a = m.vert(x0, y0, z, 0xffffff, r.u0, r.v0);
  const b = m.vert(x1, y1, z, 0xffffff, r.u1, r.v0);
  const c = m.vert(x1, y1, z + h, 0xffffff, r.u1, r.v1);
  const d = m.vert(x0, y0, z + h, 0xffffff, r.u0, r.v1);
  m.quad(a, b, c, d);
}

/** Plakatwand auf zwei Pfosten, leicht zur Fahrbahn gedreht */
function billboard(poles: Mesh3DBuilder, ads: Mesh3DBuilder, x: number, y: number, fx: number, fy: number, turn: number, seed: number): void {
  const ang = Math.atan2(fy, fx) + turn * 0.45;
  const nx = Math.cos(ang);
  const ny = Math.sin(ang);
  const w = 7.5;
  const h = 3.6;
  const z = 2.8;
  const rx = -ny;
  const ry = nx;
  for (const f of [-0.3, 0.3]) cylinder(poles, x + rx * w * f - nx * 0.15, y + ry * w * f - ny * 0.15, 0.13, 0, z + h * 0.5, 0x3a3d42, 6);
  // Rückseite und Rahmen
  box(poles, x - nx * 0.12, y - ny * 0.12, z - 0.15, z + h + 0.15, w + 0.3, 0.18, Math.atan2(ry, rx), 0x26282d);
  adPanel(ads, x + nx * 0.01, y + ny * 0.01, z, nx, ny, w, h, AD.landscape[seed % AD.landscape.length]);
  // doppelseitig: hinten ein anderes Motiv
  adPanel(ads, x - nx * 0.22, y - ny * 0.22, z, -nx, -ny, w, h, AD.landscape[(seed + 1) % AD.landscape.length]);
  // Strahler oben
  for (const f of [-0.3, 0.3]) box(poles, x + rx * w * f + nx * 0.6, y + ry * w * f + ny * 0.6, z + h + 0.1, z + h + 0.3, 0.3, 0.3, 0, 0x1d1f22);
}

/** Litfaßsäule mit umlaufendem Plakat und Kuppel */
function litfass(solid: Mesh3DBuilder, ads: Mesh3DBuilder, x: number, y: number, seed: number): void {
  const r = 0.62;
  const reg = AD.landscape[seed % AD.landscape.length];
  const seg = 16;
  cylinder(solid, x, y, r + 0.05, 0, 0.35, 0x2f4a3a, seg);
  // Plakat zweimal herum (jede Hälfte zeigt das ganze Motiv)
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const f0 = ((i * 2) % seg) / seg;
    const f1 = f0 + 2 / seg;
    const u0 = reg.u0 + (reg.u1 - reg.u0) * f0;
    const u1 = reg.u0 + (reg.u1 - reg.u0) * f1;
    const p = (a: number, z: number, u: number, v: number) => ads.vert(x + Math.cos(a) * r, y + Math.sin(a) * r, z, 0xffffff, u, v);
    ads.quad(p(a1, 0.35, u0, reg.v0), p(a0, 0.35, u1, reg.v0), p(a0, 2.75, u1, reg.v1), p(a1, 2.75, u0, reg.v1));
  }
  cylinder(solid, x, y, r + 0.08, 2.75, 2.95, 0x2f4a3a, seg);
  blobCap(solid, x, y, 2.95, r + 0.05, 0x2f4a3a);
}

function blobCap(m: Mesh3DBuilder, x: number, y: number, z: number, r: number, color: number): void {
  const seg = 12;
  const top = m.vert(x, y, z + r * 0.6, color);
  const base: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    base.push(m.vert(x + Math.cos(a) * r, y + Math.sin(a) * r, z, color));
  }
  for (let i = 0; i < seg; i++) m.tri(base[i], base[(i + 1) % seg], top);
}

/** liegt der Punkt (mit Abstand) in einem Gebäude dieser Kachel? */
function insideBuilding(t: Tile, x: number, y: number, pad: number): boolean {
  const X = x * 10;
  const Y = y * 10;
  const P = pad * 10;
  for (const b of t.buildings) {
    const o = b.outer;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      x0 = Math.min(x0, o[i]);
      x1 = Math.max(x1, o[i]);
      y0 = Math.min(y0, o[i + 1]);
      y1 = Math.max(y1, o[i + 1]);
    }
    if (X < x0 - P || X > x1 + P || Y < y0 - P || Y > y1 + P) continue;
    if (inRing(o, X, Y) || inRing(o, X + P, Y) || inRing(o, X - P, Y) || inRing(o, X, Y + P) || inRing(o, X, Y - P)) return true;
  }
  return false;
}

/** Stadtmauer: Quadermauer (7,5 m) mit überdachtem Wehrgang */
function cityWall(ptsDm: number[], D: Detail): void {
  const H = 7.5;
  const T = 0.9;
  let u = 0;
  for (let i = 2; i < ptsDm.length; i += 2) {
    const ax = ptsDm[i - 2] / 10;
    const ay = ptsDm[i - 1] / 10;
    const bx = ptsDm[i] / 10;
    const by = ptsDm[i + 1] / 10;
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 0.2) continue;
    const nx = (-(by - ay) / l) * T;
    const ny = ((bx - ax) / l) * T;
    const c = SANDSTONE[2];
    const su = STYLE_TOWER * 1000 + (u % 900);
    for (const sgn of [1, -1]) {
      const w = D.walls;
      w.quad(w.vert(ax + nx * sgn, ay + ny * sgn, 0, c, su, 0), w.vert(bx + nx * sgn, by + ny * sgn, 0, c, su + l, 0), w.vert(bx + nx * sgn, by + ny * sgn, H, c, su + l, H), w.vert(ax + nx * sgn, ay + ny * sgn, H, c, su, H));
    }
    const s = D.solid;
    s.quad(s.vert(ax + nx, ay + ny, H, c), s.vert(bx + nx, by + ny, H, c), s.vert(bx - nx, by - ny, H, c), s.vert(ax - nx, ay - ny, H, c));
    // Wehrgang-Dach
    const rc = 0x8c3e2b;
    const R = D.roofs;
    const k = 1.35;
    R.quad(R.vert(ax + nx * k, ay + ny * k, H + 0.9, rc, 0, 0), R.vert(bx + nx * k, by + ny * k, H + 0.9, rc, l, 0), R.vert(bx, by, H + 2.2, rc, l, 1.6), R.vert(ax, ay, H + 2.2, rc, 0, 1.6));
    R.quad(R.vert(ax, ay, H + 2.2, rc, 0, 1.6), R.vert(bx, by, H + 2.2, rc, l, 1.6), R.vert(bx - nx * k, by - ny * k, H + 0.9, rc, l, 0), R.vert(ax - nx * k, ay - ny * k, H + 0.9, rc, 0, 0));
    // Stützen des Dachs
    for (let f = 0.5; f < l; f += 3) {
      const tx = ax + ((bx - ax) * f) / l;
      const ty = ay + ((by - ay) * f) / l;
      box(s, tx + nx * 0.9, ty + ny * 0.9, H, H + 1.0, 0.15, 0.15, 0, 0x4a3426);
    }
    u += l;
  }
}
