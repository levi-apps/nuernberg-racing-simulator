/**
 * Freie 3D-Modelle (CC0, Kenney Car Kit und Mini Characters, Quaternius-Bäume) laden und
 * für das Spiel aufbereiten: lokales System x = vorn, y = links, z = oben, Boden bei z = 0.
 * Autos bekommen eine umfärbbare Lackfarbe (Farbfeld der Texturpalette) und leuchtende Lichter.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carLights } from '../drive/CarModel.ts';

export const CAR_MODELS = [
  'sedan',
  'sedan_sports',
  'hatchback_sports',
  'suv',
  'suv_luxury',
  'taxi',
  'police_car',
  'van',
  'delivery_van',
  'delivery_flat',
  'truck',
  'truck_flat',
  'garbage_truck',
  'ambulance',
  'firetruck',
  'race_car',
  'race_car_future',
] as const;
export type CarModelName = (typeof CAR_MODELS)[number];

/** Modelle, deren Farbe zum Fahrzeug gehört (nicht umfärben) */
const FIXED_COLOR = new Set<string>(['taxi', 'police_car', 'ambulance', 'firetruck', 'garbage_truck']);

export interface CarProto {
  name: string;
  /** Karosserie ohne Räder (+ Lichtkästen als eigene Gruppen) */
  body: THREE.BufferGeometry;
  /** Karosserie mit Rädern (für Instanzen) */
  merged: THREE.BufferGeometry;
  /** je Rad: Geometrie um den Radmittelpunkt und dessen Lage */
  wheels: Array<{ geo: THREE.BufferGeometry; x: number; y: number; z: number; front: boolean }>;
  length: number;
  width: number;
  height: number;
  material: THREE.MeshStandardMaterial;
  /** Index des Lack-Farbfelds in der Palette (-1 = nicht umfärben) */
  paintCell: number;
  cellLum: number;
}

export interface CharProto {
  gltf: GLTF;
  height: number;
  minY: number;
}

export const models = {
  cars: new Map<string, CarProto>(),
  chars: [] as CharProto[],
  trees: [] as THREE.BufferGeometry[],
  treeMats: [] as THREE.Material[][],
  ready: false,
};

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function floatAttr(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.count;
  const s = a.itemSize;
  const out = new Float32Array(n * s);
  for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) out[i * s + k] = k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i);
  return new THREE.BufferAttribute(out, s);
}

/** Geometrie eines Meshes in Float32, mit Weltmatrix (des normalisierten Halters) */
function bake(mesh: THREE.Mesh, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const src = mesh.geometry;
  g.setAttribute('position', floatAttr(src.getAttribute('position')));
  if (src.getAttribute('normal')) g.setAttribute('normal', floatAttr(src.getAttribute('normal')));
  if (src.getAttribute('uv')) g.setAttribute('uv', floatAttr(src.getAttribute('uv')));
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
  g.applyMatrix4(m);
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  return ng;
}

/** gemeinsamer Halter: glTF (y oben) -> Spiel (z oben), Länge entlang x, vorn = +x */
function normalize(scene: THREE.Object3D, frontHint?: () => THREE.Vector3 | null): THREE.Group {
  const holder = new THREE.Group();
  holder.add(scene);
  scene.rotation.x = Math.PI / 2;
  holder.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(holder);
  let size = box.getSize(new THREE.Vector3());
  if (size.y > size.x) {
    holder.rotation.z = Math.PI / 2;
    holder.updateMatrixWorld(true);
  }
  const f = frontHint?.();
  if (f && f.x < 0) {
    holder.rotation.z += Math.PI;
    holder.updateMatrixWorld(true);
  }
  box = new THREE.Box3().setFromObject(holder);
  size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -c.y, -box.min.z);
  holder.updateMatrixWorld(true);
  return holder;
}

function imagePixels(tex: THREE.Texture | null): { data: Uint8ClampedArray; w: number; h: number } | null {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  return { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

/** Lackfarbfeld: das Farbfeld (16 x 4 Raster) mit der größten Fläche auf der Karosserie */
function findPaintCell(geo: THREE.BufferGeometry, tex: THREE.Texture): { cell: number; lum: number } {
  const uv = geo.getAttribute('uv');
  const pos = geo.getAttribute('position');
  if (!uv) return { cell: -1, lum: 1 };
  tex.updateMatrix();
  const mtx = tex.matrix;
  const area = new Map<number, number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const ar = b.sub(a).cross(c.sub(a)).length() / 2;
    v.set(uv.getX(i), uv.getY(i), 1).applyMatrix3(mtx);
    const cell = Math.floor(THREE.MathUtils.clamp(v.x, 0, 0.9999) * 16) + Math.floor(THREE.MathUtils.clamp(v.y, 0, 0.9999) * 4) * 16;
    area.set(cell, (area.get(cell) ?? 0) + ar);
  }
  const px = imagePixels(tex);
  let best = -1;
  let bestA = 0;
  let lum = 1;
  for (const [cell, ar] of area) {
    if (!px) {
      if (ar > bestA) {
        bestA = ar;
        best = cell;
      }
      continue;
    }
    // Farbfeld auswerten: dunkle/graue Felder (Reifen, Scheiben, Kunststoff) sind kein Lack
    const cx = Math.floor((((cell % 16) + 0.5) / 16) * px.w);
    const cy = Math.floor(((Math.floor(cell / 16) + 0.5) / 4) * px.h);
    const k = (cy * px.w + cx) * 4;
    const r = px.data[k] / 255;
    const g = px.data[k + 1] / 255;
    const bb = px.data[k + 2] / 255;
    const sat = Math.max(r, g, bb) - Math.min(r, g, bb);
    const l = 0.3 * r + 0.59 * g + 0.11 * bb;
    if (sat < 0.15 && l < 0.6) continue;
    if (ar > bestA) {
      bestA = ar;
      best = cell;
      const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      lum = Math.max(0.03, 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bb));
    }
  }
  return { cell: best, lum };
}

/** Material mit umfärbbarem Lack (Instanzfarbe oder uPaint) */
export function paintMaterial(tex: THREE.Texture, cell: number, lum: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.18, transparent: true });
  m.userData.uPaint = { value: new THREE.Color(1, 1, 1) };
  m.userData.cell = cell;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = m.userData.uPaint;
    sh.uniforms.uPaintCell = { value: cell };
    sh.uniforms.uCellLum = { value: lum };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uPaint;\nuniform float uPaintCell;\nuniform float uCellLum;').replace(
      '#include <color_fragment>',
      `
        #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
          vec3 paint = vColor.rgb;
        #else
          vec3 paint = uPaint;
        #endif
        #ifdef USE_MAP
        {
          vec2 pc = floor(clamp(vMapUv, 0.0, 0.9999) * vec2(16.0, 4.0));
          if (uPaintCell >= 0.0 && abs(pc.x + pc.y * 16.0 - uPaintCell) < 0.5) {
            float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            diffuseColor.rgb = paint * clamp(l / uCellLum, 0.4, 1.6);
          }
        }
        #endif
        `,
    );
  };
  m.customProgramCacheKey = () => 'kenney-paint';
  return m;
}

async function loadCar(base: string, name: string): Promise<CarProto | null> {
  try {
    const gltf = await loader.loadAsync(`${base}/${name}.glb`);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    let tex: THREE.Texture | null = null;
    const frontWheel = () => {
      const w = scene.getObjectByName('wheel-front-left') ?? scene.getObjectByName('wheel-front-right');
      return w ? w.getWorldPosition(new THREE.Vector3()) : null;
    };
    const holder = normalize(scene, frontWheel);
    const bodyParts: THREE.BufferGeometry[] = [];
    const allParts: THREE.BufferGeometry[] = [];
    const wheels: CarProto['wheels'] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      if (mat.map && !tex) tex = mat.map;
      const g = bake(mesh, mesh.matrixWorld);
      allParts.push(g);
      let isWheel = false;
      let wnode: THREE.Object3D | null = mesh;
      while (wnode && wnode !== scene) {
        if (wnode.name.startsWith('wheel')) {
          isWheel = true;
          break;
        }
        wnode = wnode.parent;
      }
      if (isWheel && wnode) {
        g.computeBoundingBox();
        const c = g.boundingBox!.getCenter(new THREE.Vector3());
        g.translate(-c.x, -c.y, -c.z);
        wheels.push({ geo: g, x: c.x, y: c.y, z: c.z, front: wnode.name.includes('front') });
      } else bodyParts.push(g);
    });
    if (!tex || !bodyParts.length) return null;
    const body = mergeGeometries(bodyParts)!;
    const merged = mergeGeometries(allParts)!;
    const box = new THREE.Box3().setFromBufferAttribute(merged.getAttribute('position') as THREE.BufferAttribute);
    const size = box.getSize(new THREE.Vector3());
    void holder;
    const { cell, lum } = FIXED_COLOR.has(name) ? { cell: -1, lum: 1 } : findPaintCell(body, tex);
    const material = paintMaterial(tex, cell, lum);
    // Lichtkästen vorn und hinten (leuchten nachts)
    const lights = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
      const L = size.x;
      const W = size.y;
      const H = size.z;
      const parts: THREE.BufferGeometry[] = [geo];
      const groups: number[] = [geo.getAttribute('position').count];
      for (const [x, slot] of [
        [L / 2 + 0.005, 1],
        [-L / 2 - 0.005, 2],
      ] as const) {
        for (const sy of [1, -1]) {
          const b = new THREE.BoxGeometry(0.03, W * 0.18, H * 0.07).toNonIndexed();
          b.translate(x, sy * W * 0.33, H * (slot === 1 ? 0.36 : 0.42));
          b.deleteAttribute('uv');
          b.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.getAttribute('position').count * 2), 2));
          parts.push(b);
          groups.push(b.getAttribute('position').count);
        }
      }
      const out = mergeGeometries(parts)!;
      out.clearGroups();
      let start = 0;
      groups.forEach((n, i) => {
        out.addGroup(start, n, i === 0 ? 0 : i <= 2 ? 1 : 2);
        start += n;
      });
      return out;
    };
    return { name, body: lights(body), merged: lights(merged), wheels, length: size.x, width: size.y, height: size.z, material, paintCell: cell, cellLum: lum };
  } catch (e) {
    console.warn('Modell', name, e);
    return null;
  }
}

async function loadChar(base: string, name: string): Promise<CharProto | null> {
  try {
    const gltf = await loader.loadAsync(`${base}/${name}.glb`);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    return { gltf, height: box.getSize(new THREE.Vector3()).y, minY: box.min.y };
  } catch (e) {
    console.warn('Figur', name, e);
    return null;
  }
}

/** natürlichere Farben statt der türkisen Kenney-Palette */
const NATURE_COLORS: Record<string, number> = {
  leafsGreen: 0x4d8a2c,
  leafsDark: 0x2e6328,
  leafsFall: 0xd27a26,
  grass: 0x4b8f33,
  woodBark: 0x6b4a32,
  woodBarkDark: 0x4a3426,
  woodBirch: 0xe6e0d2,
};

async function loadTree(base: string, name: string): Promise<{ geo: THREE.BufferGeometry; mats: THREE.Material[] } | null> {
  try {
    const gltf = await loader.loadAsync(`${base}/${name}.glb`);
    const holder = normalize(gltf.scene);
    void holder;
    const parts: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = bake(mesh, mesh.matrixWorld);
      g.deleteAttribute('uv');
      parts.push(g);
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const named = NATURE_COLORS[m.name];
      const sm = new THREE.MeshStandardMaterial({ color: named !== undefined ? new THREE.Color(named) : m.color, roughness: 0.9, transparent: true });
      mats.push(sm);
    });
    const merged = mergeGeometries(parts, true);
    if (!merged) return null;
    // Höhe auf 1 normieren (Skalierung je Baum)
    const box = new THREE.Box3().setFromBufferAttribute(merged.getAttribute('position') as THREE.BufferAttribute);
    const h = box.max.z - box.min.z;
    merged.scale(1 / h, 1 / h, 1 / h);
    return { geo: merged, mats };
  } catch (e) {
    console.warn('Baum', name, e);
    return null;
  }
}

export async function loadModels(base: string): Promise<void> {
  const cars = await Promise.all(CAR_MODELS.map((n) => loadCar(base, n)));
  for (const c of cars) if (c) models.cars.set(c.name, c);
  const names = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((x) => [`mini_male_${x}`, `mini_female_${x}`]);
  const chars = await Promise.all(names.map((n) => loadChar(base, n)));
  models.chars = chars.filter((c): c is CharProto => !!c);
  // Reihenfolge fest: Bäume zuerst, die letzten beiden sind Büsche
  const trees = await Promise.all(['tree_oak', 'tree_fat', 'tree_dark', 'tree_autumn', 'bush', 'bush_large'].map((n) => loadTree(base, n)));
  for (const t of trees) {
    if (!t) continue;
    models.trees.push(t.geo);
    models.treeMats.push(t.mats);
  }
  models.ready = true;
}

/** Materialliste für ein Auto-Mesh: Lack (Palette), Scheinwerfer, Rückleuchten */
export function carMaterialList(p: CarProto, tail?: THREE.Material): THREE.Material[] {
  return [p.material, carLights.head, tail ?? carLights.tail];
}
