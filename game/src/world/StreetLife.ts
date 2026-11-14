/**
 * Straßenleben in der 3D-Ansicht: parkende Autos, Verkehrsschilder, Poller, Mülleimer, Bänke,
 * Bushaltestellen (mit Werbung), Bäume und Büsche, Fußgänger und Straßenbahnen.
 * Kleine Objekte lassen sich umfahren (fliegen davon), parkende Autos und Bäume sind fest.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TILE_SIZE, tileKey, type Lane, type Tile } from '@nrs/shared';
import { carMaterialList, models } from '../assets/Models.ts';
import type { Car } from '../drive/Car.ts';
import { obbOverlap } from '../traffic/TrafficSim.ts';
import { adMaterial, AD } from './Ads.ts';
import { inAltstadt } from './Landmarks.ts';
import { RL_MAIN } from './TileView.ts';

type Kind = 'hedge' | 'bollard' | 'bin' | 'bench' | 'sign_stop' | 'sign_yield' | 'sign_prio' | 'sign_30' | 'sign_50' | 'shelter' | `car:${string}` | `tree:${number}`;

interface Prop {
  kind: Kind;
  x: number;
  y: number;
  h: number;
  s: number;
  /** Kollisionsmaße (halbe Länge/Breite) */
  hl: number;
  hw: number;
  heavy: boolean;
  knocked?: boolean;
  color?: number;
  /** Streckung (Hecken): Länge und Höhe relativ zu s */
  sx?: number;
  sz?: number;
}

interface Debris {
  mesh: THREE.Object3D;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  rest: boolean;
}

const PARK_CLS = new Set(['residential', 'unclassified', 'tertiary', 'living_street', 'secondary']);
const PARK_MODELS = ['sedan', 'hatchback_sports', 'suv', 'sedan', 'suv_luxury', 'sedan_sports', 'van', 'hatchback_sports', 'delivery_van', 'taxi'];
const CAR_COLORS = [0xd7263d, 0x1f4e8c, 0xf2f2f2, 0x222222, 0x8a8f96, 0x2e7d32, 0xf5b400, 0x6d2a8a, 0xb8b8b8, 0x0d5c75, 0x7a1f1f, 0xe8e2d6];

const hash = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

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

/** liegt der Punkt (m) näher als r an der Linie (dm)? */
function nearLine(p: number[], x: number, y: number, r: number): boolean {
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2] / 10;
    const ay = p[i - 1] / 10;
    const dx = p[i] / 10 - ax;
    const dy = p[i + 1] / 10 - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < r) return true;
  }
  return false;
}

/** Abstand Punkt (m) zur Spur-Mittellinie (dm) */
function laneDist(l: Lane, x: number, y: number): number {
  const p = l.pts;
  let best = Infinity;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2] / 10;
    const ay = p[i - 1] / 10;
    const bx = p[i] / 10;
    const by = p[i + 1] / 10;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

// ------------------------------------------------------------------ Geometrien

function zUp(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.rotateX(Math.PI / 2);
  return g;
}

function signTexture(): { tex: THREE.Texture; uv: Record<string, [number, number, number, number]> } {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 128;
  const g = c.getContext('2d')!;
  const uv: Record<string, [number, number, number, number]> = {};
  const cell = (i: number, name: string, draw: (cx: number, cy: number) => void) => {
    g.save();
    draw(i * 128 + 64, 64);
    g.restore();
    uv[name] = [(i * 128) / 640, 0, ((i + 1) * 128) / 640, 1];
  };
  // Stopp
  cell(0, 'sign_stop', (cx, cy) => {
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
      g.lineTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60);
    }
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
      g.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54);
    }
    g.closePath();
    g.fillStyle = '#c8102e';
    g.fill();
    g.fillStyle = '#fff';
    g.font = '900 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STOP', cx, cy + 2);
  });
  // Vorfahrt gewähren (Dreieck auf der Spitze)
  cell(1, 'sign_yield', (cx, cy) => {
    const tri = (r: number, col: string) => {
      g.beginPath();
      g.moveTo(cx - r, cy - r * 0.8);
      g.lineTo(cx + r, cy - r * 0.8);
      g.lineTo(cx, cy + r * 0.95);
      g.closePath();
      g.fillStyle = col;
      g.fill();
    };
    tri(62, '#c8102e');
    tri(46, '#ffffff');
  });
  // Vorfahrtstraße (Raute)
  cell(2, 'sign_prio', (cx, cy) => {
    const dia = (r: number, col: string) => {
      g.beginPath();
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r, cy);
      g.lineTo(cx, cy + r);
      g.lineTo(cx - r, cy);
      g.closePath();
      g.fillStyle = col;
      g.fill();
    };
    dia(62, '#ffffff');
    dia(54, '#222');
    dia(50, '#ffffff');
    dia(40, '#f5c400');
  });
  for (const [i, v] of [
    [3, '30'],
    [4, '50'],
  ] as const) {
    cell(i, `sign_${v}`, (cx, cy) => {
      g.beginPath();
      g.arc(cx, cy, 60, 0, Math.PI * 2);
      g.fillStyle = '#c8102e';
      g.fill();
      g.beginPath();
      g.arc(cx, cy, 47, 0, Math.PI * 2);
      g.fillStyle = '#ffffff';
      g.fill();
      g.fillStyle = '#111';
      g.font = '800 52px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(v, cx, cy + 3);
    });
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, uv };
}

interface PropModel {
  geo: THREE.BufferGeometry;
  mats: THREE.Material | THREE.Material[];
}

function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, transparent: true, ...extra });
}

function grouped(parts: Array<[THREE.BufferGeometry, number]>): THREE.BufferGeometry {
  const ps = parts.map(([g]) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
    return n;
  });
  const out = mergeGeometries(ps)!;
  out.clearGroups();
  let start = 0;
  ps.forEach((g, i) => {
    const n = g.getAttribute('position').count;
    out.addGroup(start, n, parts[i][1]);
    start += n;
  });
  return out;
}

function buildPropModels(): Map<string, PropModel> {
  const m = new Map<string, PropModel>();
  const grey = std(0x6f7378, { metalness: 0.5, roughness: 0.4 });
  // Poller mit Reflexstreifen
  m.set('bollard', {
    geo: grouped([
      [zUp(new THREE.CylinderGeometry(0.1, 0.11, 0.95, 10)).translate(0, 0, 0.475), 0],
      [zUp(new THREE.CylinderGeometry(0.112, 0.112, 0.08, 10)).translate(0, 0, 0.78), 1],
    ]),
    mats: [std(0x3a3d42), std(0xe8e8e8, { emissive: 0x444444 })],
  });
  // geschnittene Hecke: leicht unregelmäßiger Quader (1 m lang, 0.85 m breit, 1 m hoch)
  {
    const g = new THREE.BoxGeometry(1, 0.85, 1, 8, 4, 5).translate(0, 0, 0.5);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (z < 0.01) continue;
      const n = Math.sin(x * 23.1 + y * 17.7 + z * 11.3) * 0.5 + Math.sin(x * 7.3 - z * 13.1) * 0.5;
      pos.setXYZ(i, x * (Math.abs(x) > 0.49 ? 1 : 1), y + Math.sign(y) * n * 0.035, z + (z > 0.99 ? n * 0.05 : 0));
    }
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    m.set('hedge', { geo: ng, mats: std(0x2f5a22, { roughness: 0.95, flatShading: true }) });
  }
  m.set('bin', {
    geo: grouped([
      [zUp(new THREE.CylinderGeometry(0.24, 0.21, 0.8, 12)).translate(0, 0, 0.5), 0],
      [zUp(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6)).translate(0, -0.27, 0.5), 1],
    ]),
    mats: [std(0x2f6b3a), grey],
  });
  const bench: Array<[THREE.BufferGeometry, number]> = [
    [new THREE.BoxGeometry(0.45, 1.8, 0.06).translate(0, 0, 0.45), 0],
    [new THREE.BoxGeometry(0.06, 1.8, 0.4).rotateY(-0.2).translate(-0.24, 0, 0.72), 0],
  ];
  for (const y of [-0.75, 0.75]) bench.push([new THREE.BoxGeometry(0.4, 0.06, 0.45).translate(0, y, 0.22), 1]);
  m.set('bench', { geo: grouped(bench), mats: [std(0x8a5a3a, { roughness: 0.8 }), grey] });
  // Schilder: Mast + Tafel (Textur)
  const { tex, uv } = signTexture();
  const plateMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  for (const name of ['sign_stop', 'sign_yield', 'sign_prio', 'sign_30', 'sign_50']) {
    const [u0, v0, u1, v1] = uv[name];
    const plate = new THREE.PlaneGeometry(0.75, 0.75);
    plate.rotateY(-Math.PI / 2); // Fläche zeigt nach -x
    const a = plate.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * (u1 - u0) + u0, a.getY(i) * (v1 - v0) + v0);
    plate.translate(-0.06, 0, 2.3);
    m.set(name, {
      geo: grouped([
        [zUp(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6)).translate(0, 0, 1.3), 0],
        [plate, 1],
      ]),
      mats: [grey, plateMat],
    });
  }
  // Bushaltestelle: Rahmen, Glas, Dach, Werbevitrine, Bank (vorn = -x)
  const adMat = adMaterial(); // füllt auch AD
  const ad = AD.portrait[0];
  const adPlate = new THREE.PlaneGeometry(1.25, 1.9);
  adPlate.rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  const aa = adPlate.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < aa.count; i++) aa.setXY(i, aa.getX(i) * (ad.u1 - ad.u0) + ad.u0, aa.getY(i) * (ad.v1 - ad.v0) + ad.v0);
  adPlate.rotateZ(Math.PI / 2).translate(0, 1.8, 1.25);
  const shelter: Array<[THREE.BufferGeometry, number]> = [
    [new THREE.BoxGeometry(1.7, 4.2, 0.12).translate(0.05, 0, 2.55), 0],
    [new THREE.BoxGeometry(0.04, 3.9, 2.1).translate(0.7, 0, 1.3), 1],
    [new THREE.BoxGeometry(1.3, 0.04, 2.1).translate(0.1, -2.0, 1.3), 1],
    [adPlate, 2],
    [new THREE.BoxGeometry(0.42, 2.2, 0.06).translate(0.35, -0.2, 0.48), 3],
  ];
  for (const [x, y] of [
    [0.72, 2.05],
    [0.72, -2.05],
    [-0.55, 2.05],
    [-0.55, -2.05],
  ])
    shelter.push([new THREE.BoxGeometry(0.08, 0.08, 2.5).translate(x, y, 1.25), 0]);
  // Haltestellenschild (H)
  shelter.push([zUp(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6)).translate(-0.6, 2.6, 1.4), 0]);
  shelter.push([
    zUp(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16))
      .rotateY(Math.PI / 2)
      .translate(-0.6, 2.6, 2.6),
    4,
  ]);
  m.set('shelter', {
    geo: grouped(shelter),
    mats: [grey, std(0x9fb8c8, { opacity: 0.35, roughness: 0.05, metalness: 0.3 }), adMat, std(0x8a5a3a), std(0xf2c200, { emissive: 0x332200 })],
  });
  return m;
}

// ------------------------------------------------------------------ Straßenbahn

/** VAG-Straßenbahn (rot/weiß) aus 4 Wagenteilen */
function tramSection(): THREE.BufferGeometry {
  const parts: Array<[THREE.BufferGeometry, number]> = [
    [new THREE.BoxGeometry(7.6, 2.3, 1.0).translate(0, 0, 0.75), 0],
    [new THREE.BoxGeometry(7.5, 2.32, 1.2).translate(0, 0, 1.85), 1],
    [new THREE.BoxGeometry(7.6, 2.3, 0.55).translate(0, 0, 2.72), 2],
    [new THREE.BoxGeometry(3.0, 1.2, 0.35).translate(0, 0, 3.15), 3],
  ];
  return grouped(parts);
}

interface Tram {
  path: Array<[number, number]>;
  cum: number[];
  s: number;
  dir: 1 | -1;
  v: number;
  meshes: THREE.Mesh[];
}

// ------------------------------------------------------------------ Fußgänger

interface Ped {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  cur: string;
  path: Array<[number, number]>;
  side: number;
  cum: number[];
  s: number;
  dir: 1 | -1;
  speed: number;
  state: 'walk' | 'flee' | 'down' | 'angry';
  timer: number;
  x: number;
  y: number;
  h: number;
  fleeX: number;
  fleeY: number;
}

export class StreetLife {
  private props = new Map<string, Prop[]>();
  private models = buildPropModels();
  private pools = new Map<string, THREE.InstancedMesh>();
  private group = new THREE.Group();
  private dirty = true;
  private lastKeys = '';
  private debris: Debris[] = [];
  private kerbs = new Map<string, Array<{ line: Array<[number, number]>; side: number }>>();
  private tramLines = new Map<number, Array<[number, number]>>();
  private trams: Tram[] = [];
  private tramGeo = tramSection();
  private tramMats = [std(0xc8102e, { roughness: 0.35, metalness: 0.2 }), std(0x1b222a, { roughness: 0.08, metalness: 0.4 }), std(0xf1f1f1), std(0x6f7378)];
  private peds: Ped[] = [];
  private pedTimer = 0;
  busStops: Array<{ x: number; y: number; lane: number; s: number }> = [];
  /** Fußgänger angefahren (Zähler für spätere Polizei) */
  pedHits = 0;
  onPedHit?: () => void;
  enabled = true;

  constructor(private scene: THREE.Scene) {
    this.group.layers.set(RL_MAIN);
    scene.add(this.group);
  }

  // ---------------------------------------------------------------- Kacheln

  addTile(t: Tile): void {
    const key = tileKey(t.tx, t.ty);
    if (this.props.has(key)) return;
    const out: Prop[] = [];
    const x0 = t.tx * TILE_SIZE;
    const y0 = t.ty * TILE_SIZE;
    const inTile = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + TILE_SIZE && y < y0 + TILE_SIZE;
    const lanes = t.lanes.filter((l) => l.layer === 0);
    const kerbLines: Array<{ line: Array<[number, number]>; side: number }> = [];

    // Schilder an Spurenden / -anfängen
    for (const l of lanes) {
      const p = l.pts;
      if (p.length < 4 || l.iso) continue;
      const put = (atEnd: boolean, kind: Kind) => {
        const i = atEnd ? p.length - 2 : 0;
        const j = atEnd ? p.length - 4 : 2;
        const x = p[i] / 10;
        const y = p[i + 1] / 10;
        let dx = (atEnd ? p[i] - p[j] : p[j] - p[i]) / 10;
        let dy = (atEnd ? p[i + 1] - p[j + 1] : p[j + 1] - p[i + 1]) / 10;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        // rechts neben der rechten Spur
        const off = l.w / 2 + (l.n - 1 - l.idx) * l.w + 1.6;
        const sx = x + dy * off - dx * 2;
        const sy = y - dx * off - dy * 2;
        if (!inTile(sx, sy)) return;
        out.push({ kind, x: sx, y: sy, h: Math.atan2(dy, dx), s: 1, hl: 0.12, hw: 0.12, heavy: false });
      };
      if (l.idx !== l.n - 1) continue;
      if (l.ctrl === 'stop') put(true, 'sign_stop');
      else if (l.ctrl === 'yield') put(true, 'sign_yield');
      else if (l.ctrl === 'priority' && hash(l.id) < 0.5) put(true, 'sign_prio');
      if (l.len > 70 && hash(l.id + 7) < 0.3 && (l.vmax === 30 || l.vmax === 50)) put(false, l.vmax === 30 ? 'sign_30' : 'sign_50');
    }

    // entlang der Bordsteine: parkende Autos, Poller, Mülleimer, Bänke
    for (const sfc of t.surfaces) {
      if (sfc.k !== 'seg' || sfc.layer !== 0 || !sfc.kerbs) continue;
      const parking = PARK_CLS.has(sfc.cls);
      const alt = inAltstadt((sfc.ring[0] ?? 0) / 10, (sfc.ring[1] ?? 0) / 10);
      sfc.kerbs.forEach((k, ki) => {
        const line: Array<[number, number]> = [];
        for (let i = 0; i < k.length; i += 2) line.push([k[i] / 10, k[i + 1] / 10]);
        if (line.length >= 2) {
          // Gehwegseite: links der Linie, wenn links nicht die Fahrbahn liegt
          const [ax0, ay0] = line[0];
          const [bx0, by0] = line[1];
          const l0 = Math.hypot(bx0 - ax0, by0 - ay0) || 1;
          const lx = -(by0 - ay0) / l0;
          const ly = (bx0 - ax0) / l0;
          const road = inRing(sfc.ring, ((ax0 + bx0) / 2 + lx * 1.2) * 10, ((ay0 + by0) / 2 + ly * 1.2) * 10);
          kerbLines.push({ line, side: road ? -1 : 1 });
        }
        let acc = 0;
        let total = 0;
        for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        const seed = sfc.id * 31 + ki;
        let nextCar = 8 + hash(seed) * 6;
        let nextFurn = 10 + hash(seed + 3) * 30;
        let runCars = hash(seed + 5) < 0.6;
        for (let i = 1; i < line.length; i++) {
          const [ax, ay] = line[i - 1];
          const [bx, by] = line[i];
          const seg = Math.hypot(bx - ax, by - ay);
          if (seg < 0.01) continue;
          const dx = (bx - ax) / seg;
          const dy = (by - ay) / seg;
          let nx = -dy;
          let ny = dx;
          // Normale zur Fahrbahn hin
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          if (!inRing(sfc.ring, (mx + nx * 1.2) * 10, (my + ny * 1.2) * 10)) {
            nx = -nx;
            ny = -ny;
          }
          while (nextCar <= acc + seg || nextFurn <= acc + seg) {
            if (nextCar <= nextFurn) {
              const f = (nextCar - acc) / seg;
              const px = ax + (bx - ax) * f;
              const py = ay + (by - ay) * f;
              const hv = hash(Math.round(px * 13) * 7919 + Math.round(py * 13));
              if (hv < 0.12) runCars = !runCars;
              if (parking && runCars && nextCar > 8 && nextCar < total - 8 && hv < 0.82) {
                const cx = px + nx * 1.15;
                const cy = py + ny * 1.15;
                // nicht in die Fahrspur ragen
                let clear = true;
                for (const l of lanes) {
                  if (laneDist(l, cx, cy) < l.w / 2 + 0.95) {
                    clear = false;
                    break;
                  }
                }
                if (clear && inTile(cx, cy)) {
                  const model = PARK_MODELS[Math.floor(hash(Math.round(cx * 7) + Math.round(cy * 11) * 3) * PARK_MODELS.length)];
                  out.push({
                    kind: `car:${model}`,
                    x: cx,
                    y: cy,
                    h: Math.atan2(dy, dx) + (hv < 0.5 ? 0 : Math.PI),
                    s: 1,
                    hl: 2.2,
                    hw: 0.9,
                    heavy: true,
                    color: CAR_COLORS[Math.floor(hv * 997) % CAR_COLORS.length],
                  });
                }
              }
              nextCar += 5.8;
            } else {
              const f = (nextFurn - acc) / seg;
              const px = ax + (bx - ax) * f - nx * 1.7;
              const py = ay + (by - ay) * f - ny * 1.7;
              const hv = hash(Math.round(px * 17) * 104729 + Math.round(py * 17));
              if (inTile(px, py)) {
                if (alt && hv < 0.35) {
                  // Pollerreihe am Bordstein
                  for (let k = 0; k < 5; k++) {
                    const bx2 = px + nx * 1.3 + dx * (k - 2) * 1.6;
                    const by2 = py + ny * 1.3 + dy * (k - 2) * 1.6;
                    out.push({ kind: 'bollard', x: bx2, y: by2, h: 0, s: 1, hl: 0.12, hw: 0.12, heavy: false });
                  }
                } else if (hv < 0.55) out.push({ kind: 'bin', x: px, y: py, h: Math.atan2(ny, nx), s: 1, hl: 0.25, hw: 0.25, heavy: false });
                else if (hv < 0.68) out.push({ kind: 'bench', x: px - nx * 0.3, y: py - ny * 0.3, h: Math.atan2(-ny, -nx), s: 1, hl: 0.3, hw: 0.9, heavy: false });
              }
              nextFurn += 26 + hv * 30;
            }
          }
          acc += seg;
        }
      });
    }
    this.kerbs.set(key, kerbLines);

    // Parkplätze füllen
    for (const a of t.areas) {
      if (a.k !== 'parking') continue;
      const o = a.outer;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < o.length; i += 2) {
        minX = Math.min(minX, o[i] / 10);
        maxX = Math.max(maxX, o[i] / 10);
        minY = Math.min(minY, o[i + 1] / 10);
        maxY = Math.max(maxY, o[i + 1] / 10);
      }
      let n = 0;
      for (let x = minX + 1.4; x < maxX - 1.2 && n < 60; x += 2.7)
        for (let y = minY + 2.6; y < maxY - 2.4 && n < 60; y += 6) {
          if (!inTile(x, y) || !inRing(o, x * 10, y * 10)) continue;
          const hv = hash(Math.round(x * 3) * 92821 + Math.round(y * 3));
          if (hv > 0.62) continue;
          const model = PARK_MODELS[Math.floor(hv * 1000) % PARK_MODELS.length];
          out.push({
            kind: `car:${model}`,
            x,
            y,
            h: Math.PI / 2 + (hv < 0.3 ? Math.PI : 0),
            s: 1,
            hl: 2.2,
            hw: 0.9,
            heavy: true,
            color: CAR_COLORS[Math.floor(hv * 7919) % CAR_COLORS.length],
          });
          n++;
        }
    }

    // Bushaltestellen
    for (const st of this.busStops) {
      if (!inTile(st.x, st.y)) continue;
      const l = t.lanes.find((x) => x.id === st.lane);
      if (!l) continue;
      const [dx, dy] = laneDir(l, st.s);
      const off = l.w / 2 + 2.7;
      out.push({ kind: 'shelter', x: st.x + dy * off, y: st.y - dx * off, h: Math.atan2(-dx, dy), s: 1, hl: 0.9, hw: 2.1, heavy: true });
    }

    // Bäume und Büsche aus Modellen (wenn geladen)
    if (models.ready && models.trees.length) {
      const tr = t.trees ?? [];
      const nTree = Math.max(1, models.trees.length - 2);
      for (let i = 0; i < tr.length; i += 3) {
        const x = tr[i] / 10;
        const y = tr[i + 1] / 10;
        if (!inTile(x, y)) continue;
        const seed = (tr[i] * 73856093) ^ (tr[i + 1] * 19349663);
        const r = tr[i + 2] > 0 ? tr[i + 2] / 10 : 2.6 + hash(seed) * 2.2;
        out.push({ kind: `tree:${Math.floor(hash(seed + 3) * nTree)}`, x, y, h: hash(seed) * 6.28, s: 4 + r * 1.6, hl: 0.3, hw: 0.3, heavy: true });
      }
      for (const a of t.areas) {
        if (a.k !== 'park' && a.k !== 'grass' && a.k !== 'cemetery') continue;
        const o = a.outer;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < o.length; i += 2) {
          minX = Math.min(minX, o[i] / 10);
          maxX = Math.max(maxX, o[i] / 10);
          minY = Math.min(minY, o[i + 1] / 10);
          maxY = Math.max(maxY, o[i + 1] / 10);
        }
        const count = Math.min(30, Math.floor(((maxX - minX) * (maxY - minY)) / 260));
        for (let k = 0; k < count * 3 && k < 90; k++) {
          const x = minX + hash(a.id * 977 + k * 2) * (maxX - minX);
          const y = minY + hash(a.id * 977 + k * 2 + 1) * (maxY - minY);
          if (!inTile(x, y) || !inRing(o, x * 10, y * 10)) continue;
          if (t.surfaces.some((sf) => inRing(sf.sw ?? sf.ring, x * 10, y * 10))) continue;
          if (t.lines.some((l) => (l.k === 'footway' || l.k === 'path' || l.k === 'cycleway') && nearLine(l.pts, x, y, 1.6))) continue;
          const bush = models.trees.length - 1 - (k % 2);
          out.push({ kind: `tree:${bush}`, x, y, h: hash(k) * 6.28, s: 0.9 + hash(k + 9) * 1.2, hl: 0.4, hw: 0.4, heavy: false });
        }
      }
    }

    // Vorgärten: Hecken, Büsche und Bäume hinter dem Gehweg von Wohnstraßen
    if (models.ready && models.trees.length >= 6) this.gardens(t, out, inTile);

    // Straßenbahnlinien sammeln
    for (const l of t.lines) {
      if (l.k !== 'tram' || l.layer !== 0 || this.tramLines.has(l.id)) continue;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < l.pts.length; i += 2) pts.push([l.pts[i] / 10, l.pts[i + 1] / 10]);
      if (pts.length >= 2) this.tramLines.set(l.id, pts);
    }
    this.props.set(key, out);
    this.dirty = true;
  }

  private gardens(t: Tile, out: Prop[], inTile: (x: number, y: number) => boolean): void {
    const GARDEN_CLS = new Set(['residential', 'living_street', 'unclassified', 'tertiary']);
    // Gebäude als Rechteck + Ring (dm) für den Punkttest
    const bl = t.buildings.map((b) => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < b.outer.length; i += 2) {
        x0 = Math.min(x0, b.outer[i]);
        x1 = Math.max(x1, b.outer[i]);
        y0 = Math.min(y0, b.outer[i + 1]);
        y1 = Math.max(y1, b.outer[i + 1]);
      }
      return { x0: x0 - 15, y0: y0 - 15, x1: x1 + 15, y1: y1 + 15, ring: b.outer };
    });
    const inBuilding = (x: number, y: number) => {
      const X = x * 10;
      const Y = y * 10;
      for (const b of bl) if (X > b.x0 && X < b.x1 && Y > b.y0 && Y < b.y1 && inRing(b.ring, X, Y)) return true;
      // Abstand zu Wänden grob: Rechteck mit Rand
      return false;
    };
    const nearBuilding = (x: number, y: number, r: number) => {
      const X = x * 10;
      const Y = y * 10;
      const R = r * 10;
      for (const b of bl)
        if (
          X > b.x0 - R &&
          X < b.x1 + R &&
          Y > b.y0 - R &&
          Y < b.y1 + R &&
          (inRing(b.ring, X, Y) || inRing(b.ring, X + R, Y) || inRing(b.ring, X - R, Y) || inRing(b.ring, X, Y + R) || inRing(b.ring, X, Y - R))
        )
          return true;
      return false;
    };
    const roads = t.surfaces;
    const onRoad = (x: number, y: number) => {
      const X = x * 10;
      const Y = y * 10;
      for (const s of roads) if (inRing(s.sw ?? s.ring, X, Y)) return true;
      return false;
    };
    const areaOk = (x: number, y: number) => {
      for (const a of t.areas) if ((a.k === 'parking' || a.k === 'water' || a.k === 'railway' || a.k === 'pedestrian') && inRing(a.outer, x * 10, y * 10)) return false;
      return true;
    };
    const nTree = models.trees.length - 2;
    for (const sfc of t.surfaces) {
      if (sfc.k !== 'seg' || sfc.layer !== 0 || !GARDEN_CLS.has(sfc.cls)) continue;
      const ring = sfc.sw ?? sfc.ring;
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) {
        const ax = ring[i * 2] / 10;
        const ay = ring[i * 2 + 1] / 10;
        const bx = ring[((i + 1) % n) * 2] / 10;
        const by = ring[((i + 1) % n) * 2 + 1] / 10;
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 4) continue;
        const dx = (bx - ax) / len;
        const dy = (by - ay) / len;
        // Normale nach außen
        let nx = -dy;
        let ny = dx;
        if (inRing(ring, ((ax + bx) / 2 + nx * 0.6) * 10, ((ay + by) / 2 + ny * 0.6) * 10)) {
          nx = -nx;
          ny = -ny;
        }
        const seed = sfc.id * 131 + i * 7;
        // Art des Abschnitts: Hecke, Büsche oder Bäume
        const style = hash(seed);
        const step = style < 0.35 ? 2.6 : style < 0.7 ? 4.5 : 11;
        for (let d = 1.5 + hash(seed + 1) * 2; d < len - 1.5; d += step) {
          const px = ax + dx * d;
          const py = ay + dy * d;
          const r = hash(seed + Math.floor(d * 10));
          if (style < 0.35) {
            // Hecke: gestrecktes Buschmodell parallel zum Gehweg
            const x = px + nx * 0.9;
            const y = py + ny * 0.9;
            if (!inTile(x, y) || onRoad(x, y) || nearBuilding(x, y, 0.8) || !areaOk(x, y)) continue;
            out.push({ kind: 'hedge', x, y, h: Math.atan2(dy, dx), s: 1, sx: 2.75, sz: 1.0 + r * 0.6, hl: 1.35, hw: 0.45, heavy: false });
          } else if (style < 0.7) {
            if (r > 0.65) continue;
            const off = 1.2 + r * 3;
            const x = px + nx * off;
            const y = py + ny * off;
            if (!inTile(x, y) || onRoad(x, y) || nearBuilding(x, y, 0.8) || !areaOk(x, y)) continue;
            out.push({ kind: `tree:${models.trees.length - 1 - (r < 0.3 ? 1 : 0)}`, x, y, h: r * 6.28, s: 0.9 + r * 0.9, hl: 0.4, hw: 0.4, heavy: false });
          } else {
            if (r > 0.6) continue;
            const off = 2.5 + r * 3;
            const x = px + nx * off;
            const y = py + ny * off;
            if (!inTile(x, y) || onRoad(x, y) || nearBuilding(x, y, 2.5) || inBuilding(x, y) || !areaOk(x, y)) continue;
            out.push({ kind: `tree:${Math.floor(hash(seed + 99 + d) * nTree)}`, x, y, h: r * 6.28, s: 6 + r * 6, hl: 0.3, hw: 0.3, heavy: true });
          }
        }
      }
    }
  }

  removeTile(key: string): void {
    if (this.props.delete(key)) this.dirty = true;
    this.kerbs.delete(key);
  }

  // ---------------------------------------------------------------- Darstellung

  private pool(kind: string): THREE.InstancedMesh | null {
    let im = this.pools.get(kind);
    if (im) return im;
    let geo: THREE.BufferGeometry;
    let mats: THREE.Material | THREE.Material[];
    let max = 600;
    if (kind.startsWith('car:')) {
      const p = models.cars.get(kind.slice(4));
      if (!p) return null;
      geo = p.merged;
      mats = carMaterialList(p);
      max = 700;
    } else if (kind.startsWith('tree:')) {
      const i = Number(kind.slice(5));
      if (!models.trees[i]) return null;
      geo = models.trees[i];
      mats = models.treeMats[i];
      max = 6000;
    } else {
      const m = this.models.get(kind);
      if (!m) return null;
      geo = m.geo;
      mats = m.mats;
    }
    im = new THREE.InstancedMesh(geo, mats, max);
    im.count = 0;
    im.renderOrder = 13;
    im.frustumCulled = false;
    im.castShadow = true;
    im.receiveShadow = true;
    im.layers.set(RL_MAIN);
    if (kind.startsWith('car:') || kind.startsWith('tree:')) im.setColorAt(0, new THREE.Color(1, 1, 1));
    this.pools.set(kind, im);
    this.group.add(im);
    return im;
  }

  private rebuild(keys: string[], cx: number, cy: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const z = new THREE.Vector3(0, 0, 1);
    const col = new THREE.Color();
    const counts = new Map<string, number>();
    for (const key of keys) {
      for (const pr of this.props.get(key) ?? []) {
        if (pr.knocked) continue;
        // kleine Dinge nur in der Nähe
        const far = Math.hypot(pr.x - cx, pr.y - cy);
        if (!pr.kind.startsWith('tree') && far > (pr.kind.startsWith('car') ? 230 : 160)) continue;
        const im = this.pool(pr.kind);
        if (!im) continue;
        const i = counts.get(pr.kind) ?? 0;
        if (i >= im.instanceMatrix.count) continue;
        let s = pr.s;
        if (pr.kind.startsWith('car:')) {
          const proto = models.cars.get(pr.kind.slice(4))!;
          s = 4.4 / proto.length;
          im.setColorAt(i, col.setHex(pr.color ?? 0xffffff));
        } else if (pr.kind.startsWith('tree:')) {
          // leichte Farbvariation je Baum
          const v = 0.82 + ((pr.h * 1000) % 1) * 0.3;
          im.setColorAt(i, col.setRGB(v, v * (0.96 + ((pr.h * 337) % 1) * 0.08), v));
        }
        p.set(pr.x, pr.y, 0);
        q.setFromAxisAngle(z, pr.h);
        sc.set(s * (pr.sx ?? 1), s, s * (pr.sz ?? 1));
        m.compose(p, q, sc);
        im.setMatrixAt(i, m);
        counts.set(pr.kind, i + 1);
      }
    }
    for (const [kind, im] of this.pools) {
      im.count = counts.get(kind) ?? 0;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** jedes Bild (3D): Instanzen, Trümmer, Fußgänger, Straßenbahnen */
  update(dt: number, in3d: boolean, keys: string[], cam: THREE.Vector3, car: Car, pedCount: number): void {
    this.group.visible = in3d && this.enabled;
    if (!in3d || !this.enabled) return;
    const k = keys.join('|');
    const moved = Math.hypot(cam.x - this.lastCam[0], cam.y - this.lastCam[1]) > 25;
    if (this.dirty || k !== this.lastKeys || moved) {
      this.rebuild(keys, cam.x, cam.y);
      this.dirty = false;
      this.lastKeys = k;
      this.lastCam = [cam.x, cam.y];
    }
    this.updateDebris(dt);
    this.updateTrams(dt, car);
    this.updatePeds(dt, keys, car, pedCount);
  }
  private lastCam: [number, number] = [0, 0];

  // ---------------------------------------------------------------- Kollision

  /** Spielerauto gegen Objekte; liefert Aufprallgeschwindigkeit (m/s) */
  collide(car: Car): number {
    if (!this.enabled) return 0;
    const tx = Math.floor(car.x / TILE_SIZE);
    const ty = Math.floor(car.y / TILE_SIZE);
    let impact = 0;
    const hl = car.spec.length / 2;
    const hw = car.spec.width / 2;
    const speed = Math.hypot(car.vx, car.vy);
    for (let ix = tx - 1; ix <= tx + 1; ix++)
      for (let iy = ty - 1; iy <= ty + 1; iy++) {
        const list = this.props.get(tileKey(ix, iy));
        if (!list) continue;
        for (const pr of list) {
          if (pr.knocked || Math.abs(pr.x - car.x) > 6 || Math.abs(pr.y - car.y) > 6) continue;
          const res = obbOverlap(car.x, car.y, car.heading, hl, hw, pr.x, pr.y, pr.h, pr.hl, pr.hw);
          if (!res) continue;
          const [nx, ny, depth] = res;
          // tief ineinander (z. B. nach Start oder Teleport): Objekt verschwindet einfach
          if (depth > 0.8) {
            pr.knocked = true;
            this.dirty = true;
            continue;
          }
          if (!pr.heavy && speed > 2.5) {
            // umfahren: fliegt davon, Auto wird kaum gebremst
            pr.knocked = true;
            this.dirty = true;
            this.spawnDebris(pr, car);
            car.vx *= 0.93;
            car.vy *= 0.93;
            continue;
          }
          car.x += nx * (depth + 0.01);
          car.y += ny * (depth + 0.01);
          const rel = car.vx * nx + car.vy * ny;
          if (rel < 0) {
            car.vx -= 1.4 * rel * nx;
            car.vy -= 1.4 * rel * ny;
            car.vx *= 0.85;
            car.vy *= 0.85;
            impact = Math.max(impact, -rel);
            // parkendes Auto wird etwas verschoben
            if (pr.kind.startsWith('car:') && -rel > 3) {
              const push = Math.min(1.2, -rel * 0.07);
              pr.x -= nx * push;
              pr.y -= ny * push;
              pr.h += (Math.random() - 0.5) * 0.25 * push;
              this.dirty = true;
            }
          }
        }
      }
    // Straßenbahnen sind schwer
    for (const tr of this.trams) {
      for (let i = 0; i < tr.meshes.length; i++) {
        const m = tr.meshes[i];
        if (Math.abs(m.position.x - car.x) > 8 || Math.abs(m.position.y - car.y) > 8) continue;
        const res = obbOverlap(car.x, car.y, car.heading, hl, hw, m.position.x, m.position.y, m.rotation.z, 3.8, 1.2);
        if (!res) continue;
        const [nx, ny, depth] = res;
        car.x += nx * (depth + 0.02);
        car.y += ny * (depth + 0.02);
        const rel = car.vx * nx + car.vy * ny;
        if (rel < 0) {
          car.vx -= 1.5 * rel * nx;
          car.vy -= 1.5 * rel * ny;
          impact = Math.max(impact, -rel);
        }
        tr.v = Math.min(tr.v, 2);
      }
    }
    return impact;
  }

  private spawnDebris(pr: Prop, car: Car): void {
    const im = this.pools.get(pr.kind);
    if (!im) return;
    const mesh = new THREE.Mesh(im.geometry, im.material);
    mesh.position.set(pr.x, pr.y, 0.05);
    mesh.rotation.set(0, 0, pr.h, 'ZYX');
    mesh.scale.setScalar(pr.s);
    mesh.renderOrder = 13;
    mesh.castShadow = true;
    mesh.layers.set(RL_MAIN);
    this.group.add(mesh);
    const sp = Math.hypot(car.vx, car.vy);
    this.debris.push({
      mesh,
      vx: car.vx * 0.9 + (Math.random() - 0.5) * 3,
      vy: car.vy * 0.9 + (Math.random() - 0.5) * 3,
      vz: 2 + sp * 0.25 + Math.random() * 2,
      wx: (Math.random() - 0.5) * 12,
      wy: (Math.random() - 0.5) * 12,
      rest: false,
    });
    if (this.debris.length > 50) {
      const d = this.debris.shift()!;
      this.group.remove(d.mesh);
    }
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      if (d.rest) continue;
      const m = d.mesh;
      d.vz -= 9.81 * dt;
      m.position.x += d.vx * dt;
      m.position.y += d.vy * dt;
      m.position.z += d.vz * dt;
      m.rotation.x += d.wx * dt;
      m.rotation.y += d.wy * dt;
      if (m.position.z < 0.1) {
        m.position.z = 0.1;
        if (Math.abs(d.vz) < 1.2) {
          // liegen bleiben (umgekippt)
          d.rest = true;
          m.rotation.x = Math.PI / 2;
          m.rotation.y = 0;
          continue;
        }
        d.vz = -d.vz * 0.35;
        d.vx *= 0.6;
        d.vy *= 0.6;
        d.wx *= 0.5;
        d.wy *= 0.5;
      }
    }
  }

  // ---------------------------------------------------------------- Straßenbahn

  private updateTrams(dt: number, car: Car): void {
    // alte entfernen
    this.trams = this.trams.filter((t) => {
      const head = t.meshes[0].position;
      if (Math.hypot(head.x - car.x, head.y - car.y) > 520) {
        for (const m of t.meshes) this.group.remove(m);
        return false;
      }
      return true;
    });
    // neue in der Nähe (auf langen Abschnitten)
    if (this.trams.length < 3 && this.tramLines.size && Math.random() < dt * 0.5) {
      const cands = [...this.tramLines.values()].filter((p) => {
        const m = p[Math.floor(p.length / 2)];
        const d = Math.hypot(m[0] - car.x, m[1] - car.y);
        return d > 80 && d < 380;
      });
      if (cands.length) {
        const path = this.chain(cands[Math.floor(Math.random() * cands.length)]);
        const cum = [0];
        for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
        if (cum[cum.length - 1] > 60) {
          const meshes: THREE.Mesh[] = [];
          for (let k = 0; k < 4; k++) {
            const m = new THREE.Mesh(this.tramGeo, this.tramMats);
            m.renderOrder = 19;
            m.castShadow = true;
            m.receiveShadow = true;
            m.layers.set(RL_MAIN);
            this.group.add(m);
            meshes.push(m);
          }
          this.trams.push({ path, cum, s: 35 + Math.random() * (cum[cum.length - 1] - 70), dir: Math.random() < 0.5 ? 1 : -1, v: 0, meshes });
        }
      }
    }
    for (const t of this.trams) {
      const L = t.cum[t.cum.length - 1];
      // vor dem Spieler bremsen
      const head = t.meshes[0].position;
      const dCar = Math.hypot(head.x - car.x, head.y - car.y);
      const target = dCar < 14 ? 0 : 11;
      t.v += Math.max(-4 * dt, Math.min(1.2 * dt, target - t.v));
      t.s += t.v * t.dir * dt;
      if (t.s > L - 2 || t.s < 32) {
        t.dir = t.dir === 1 ? -1 : 1;
        t.s = Math.max(32, Math.min(L - 2, t.s));
      }
      for (let k = 0; k < t.meshes.length; k++) {
        const s = t.s - t.dir * (k * 7.75 + 3.8);
        const [x, y, h] = pathAt(t.path, t.cum, s);
        const m = t.meshes[k];
        m.position.set(x, y, 0);
        m.rotation.z = h;
      }
    }
  }

  /** Gleisstück nach beiden Seiten mit passenden Anschlussstücken verlängern */
  private chain(start: Array<[number, number]>): Array<[number, number]> {
    const path = [...start];
    const used = new Set<Array<[number, number]>>([start]);
    const extend = (atEnd: boolean) => {
      for (let guard = 0; guard < 40; guard++) {
        const e = atEnd ? path[path.length - 1] : path[0];
        let found: Array<[number, number]> | null = null;
        let rev = false;
        for (const p of this.tramLines.values()) {
          if (used.has(p)) continue;
          if (Math.hypot(p[0][0] - e[0], p[0][1] - e[1]) < 1.5) {
            found = p;
            rev = false;
            break;
          }
          if (Math.hypot(p[p.length - 1][0] - e[0], p[p.length - 1][1] - e[1]) < 1.5) {
            found = p;
            rev = true;
            break;
          }
        }
        if (!found) return;
        used.add(found);
        const seg = rev ? [...found].reverse() : [...found];
        if (atEnd) path.push(...seg.slice(1));
        else path.unshift(...seg.reverse().slice(0, -1));
      }
    };
    extend(true);
    extend(false);
    return path;
  }

  // ---------------------------------------------------------------- Fußgänger

  private updatePeds(dt: number, keys: string[], car: Car, want: number): void {
    if (!models.chars.length) return;
    // Fußgänger weit weg entfernen
    this.peds = this.peds.filter((p) => {
      if (Math.hypot(p.x - car.x, p.y - car.y) > 170) {
        this.group.remove(p.root);
        return false;
      }
      return true;
    });
    this.pedTimer -= dt;
    if (this.peds.length < want && this.pedTimer <= 0) {
      this.pedTimer = 0.15;
      const lines: Array<{ line: Array<[number, number]>; side: number }> = [];
      for (const k of keys) for (const l of this.kerbs.get(k) ?? []) lines.push(l);
      const pick = lines[Math.floor(Math.random() * lines.length)];
      if (pick && pick.line.length >= 2) this.spawnPed(pick.line, pick.side, car);
    }
    const speed = Math.hypot(car.vx, car.vy);
    for (const p of this.peds) {
      p.mixer.update(dt);
      const dx = p.x - car.x;
      const dy = p.y - car.y;
      const d = Math.hypot(dx, dy);
      if (p.state === 'walk' || p.state === 'angry') {
        // Auto kommt schnell näher: wegrennen
        if (d < 7 && speed > 4) {
          p.state = 'flee';
          p.timer = 1.6;
          const fx = Math.cos(car.heading);
          const fy = Math.sin(car.heading);
          const side = -fy * dx + fx * dy >= 0 ? 1 : -1;
          p.fleeX = -fy * side;
          p.fleeY = fx * side;
          this.play(p, 'sprint');
        }
      }
      if (d < 1.4 && speed > 2 && p.state !== 'down') {
        p.state = 'down';
        p.timer = 4;
        this.play(p, 'fall');
        this.pedHits++;
        this.onPedHit?.();
      }
      switch (p.state) {
        case 'walk': {
          p.s += p.speed * p.dir * dt;
          const L = p.cum[p.cum.length - 1];
          if (p.s > L || p.s < 0) {
            p.dir = p.dir === 1 ? -1 : 1;
            p.s = Math.max(0, Math.min(L, p.s));
          }
          const [x, y, h] = pathAt(p.path, p.cum, p.s, 2.2 * p.side);
          p.x = x;
          p.y = y;
          p.h = p.dir === 1 ? h : h + Math.PI;
          break;
        }
        case 'flee':
          p.x += p.fleeX * 5.5 * dt;
          p.y += p.fleeY * 5.5 * dt;
          p.h = Math.atan2(p.fleeY, p.fleeX);
          if ((p.timer -= dt) <= 0) {
            p.state = 'angry';
            p.timer = 2;
            this.play(p, 'emote-no');
          }
          break;
        case 'down':
          if ((p.timer -= dt) <= 0) {
            p.state = 'angry';
            p.timer = 2.2;
            this.play(p, 'emote-no');
          }
          break;
        case 'angry':
          if ((p.timer -= dt) <= 0) {
            // zurück auf den Gehweg
            const pr = projectPath(p.path, p.cum, p.x, p.y);
            p.s = pr;
            p.state = 'walk';
            this.play(p, 'walk');
          }
          break;
      }
      p.root.position.set(p.x, p.y, 0);
      p.root.rotation.z = p.h;
    }
  }

  private spawnPed(line: Array<[number, number]>, side: number, car: Car): void {
    const proto = models.chars[Math.floor(Math.random() * models.chars.length)];
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const L = cum[cum.length - 1];
    if (L < 12) return;
    const s = Math.random() * L;
    const [x, y] = pathAt(line, cum, s, 2.2 * side);
    const d = Math.hypot(x - car.x, y - car.y);
    if (d < 25 || d > 150) return;
    const holder = new THREE.Group();
    const inner = cloneSkinned(proto.gltf.scene);
    const upright = new THREE.Group();
    upright.rotation.x = Math.PI / 2; // y oben -> z oben
    inner.rotation.y = Math.PI / 2; // Blickrichtung +z -> +x
    const sc = (1.6 + Math.random() * 0.25) / Math.max(0.5, proto.height);
    upright.scale.setScalar(sc);
    upright.position.z = -proto.minY * sc;
    upright.add(inner);
    holder.add(upright);
    inner.traverse((o) => {
      o.layers.set(RL_MAIN);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
        m.renderOrder = 18;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of mats) mt.transparent = true;
      }
    });
    holder.layers.set(RL_MAIN);
    const mixer = new THREE.AnimationMixer(inner);
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of proto.gltf.animations) actions[clip.name] = mixer.clipAction(clip);
    const fall = actions['fall'] ?? actions['die'];
    if (fall) {
      fall.setLoop(THREE.LoopOnce, 1);
      fall.clampWhenFinished = true;
    }
    const p: Ped = {
      root: holder,
      mixer,
      actions,
      cur: '',
      path: line,
      side,
      cum,
      s,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: 1.1 + Math.random() * 0.5,
      state: 'walk',
      timer: 0,
      x,
      y,
      h: 0,
      fleeX: 0,
      fleeY: 0,
    };
    this.play(p, 'walk');
    this.group.add(holder);
    this.peds.push(p);
  }

  private play(p: Ped, name: string): void {
    const a = p.actions[name] ?? p.actions['idle'];
    if (!a || p.cur === name) return;
    const old = p.actions[p.cur];
    a.reset().play();
    if (old) a.crossFadeFrom(old, 0.2, false);
    p.cur = name;
  }
}

function laneDir(l: Lane, s: number): [number, number] {
  const p = l.pts;
  let acc = 0;
  for (let i = 2; i < p.length; i += 2) {
    const dx = (p[i] - p[i - 2]) / 10;
    const dy = (p[i + 1] - p[i - 1]) / 10;
    const seg = Math.hypot(dx, dy) || 1;
    if (acc + seg >= s || i === p.length - 2) return [dx / seg, dy / seg];
    acc += seg;
  }
  return [1, 0];
}

/** Punkt und Richtung auf einem Pfad; off = seitlicher Versatz nach links */
function pathAt(path: Array<[number, number]>, cum: number[], s: number, off = 0): [number, number, number] {
  const L = cum[cum.length - 1];
  const t = Math.max(0, Math.min(L, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const [ax, ay] = path[i - 1];
  const [bx, by] = path[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (t - cum[i - 1]) / seg;
  const dx = (bx - ax) / seg;
  const dy = (by - ay) / seg;
  return [ax + (bx - ax) * f - dy * off, ay + (by - ay) * f + dx * off, Math.atan2(dy, dx)];
}

function projectPath(path: Array<[number, number]>, cum: number[], x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < bd) {
      bd = d;
      best = cum[i - 1] + t * Math.sqrt(l2);
    }
  }
  return best;
}
