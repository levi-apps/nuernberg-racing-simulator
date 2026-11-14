/**
 * 2D-Kartenansicht (Vogelperspektive) mit Nachladen der Kacheln.
 */
import * as THREE from 'three';
import {
  signalState,
  TILE_SIZE,
  tileKey,
  type Area,
  type Connector,
  type Lane,
  type Manifest,
  type Overview,
  type SignalController,
  type SignalHead,
  type Tile,
} from '@nrs/shared';
import { FillBuilder, LineBuilder, setSlotColor } from './geometry.ts';
import { MATERIALS, ORDER, TileView, type LayerName } from './TileView.ts';
import { AREA_COLORS, BACKGROUND, ROAD_COLORS, SIGNAL_COLORS, TURN_COLORS } from './style.ts';

/** Ab dieser Auflösung (m pro Pixel) werden Kacheln geladen, darüber nur die Übersicht. */
const TILE_MPP = 2.6;
const DETAIL_MPP = 0.7; // Spuren, Verbinder, Regelung
const MAX_TILES = 450;

export type Pick =
  | { kind: 'lane'; lane: Lane }
  | { kind: 'connector'; con: Connector }
  | { kind: 'signal'; head: SignalHead; ctrl: SignalController };

export class MapView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  /** Kameramitte (m) und Maßstab (m pro CSS-Pixel) */
  cx = 0;
  cy = 0;
  mpp = 1.5;

  manifest!: Manifest;
  controllers = new Map<number, SignalController>();
  private tileSet = new Set<string>();
  private views = new Map<string, TileView>();
  private loading = new Set<string>();
  private lastUsed = new Map<string, number>();
  private overview = new THREE.Group();
  private highlight = new THREE.Group();
  private bigAreas = new THREE.Group();
  layerVisible: Record<LayerName, boolean> = {
    areas: true,
    roads: true,
    markings: true,
    paths: true,
    rail: true,
    buildings: true,
    lanes: true,
    connectors: true,
    controls: true,
    signals: true,
    grid: false,
  };
  private frame = 0;
  onChange?: () => void;
  startTime = performance.now();
  /** Index geladener Spuren für Hervorhebung */
  laneById = new Map<number, Lane>();
  conById = new Map<number, Connector>();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BACKGROUND);
    this.scene.add(this.bigAreas, this.overview, this.highlight);
    this.highlight.renderOrder = 50;
  }

  async init(base = 'world'): Promise<void> {
    const get = async <T>(f: string): Promise<T> => {
      const r = await fetch(`${base}/${f}`);
      if (!r.ok) throw new Error(`${base}/${f}: HTTP ${r.status}`);
      return r.json() as Promise<T>;
    };
    this.base = base;
    const [manifest, overview, areas, signals] = await Promise.all([
      get<Manifest>('manifest.json'),
      get<Overview>('overview.json'),
      get<{ areas: Area[] }>('areas.json'),
      get<{ controllers: SignalController[] }>('signals.json'),
    ]);
    this.manifest = manifest;
    this.tileSet = new Set(manifest.tiles);
    for (const c of signals.controllers) this.controllers.set(c.id, c);

    // große Flächen
    const fb = new FillBuilder();
    for (const a of areas.areas) fb.add(a.outer, a.holes, AREA_COLORS[a.k]);
    const am = new THREE.Mesh(fb.build(), MATERIALS.fill);
    am.renderOrder = ORDER.areas;
    am.frustumCulled = false;
    this.bigAreas.add(am);

    // Übersicht: Hauptstraßen + Stadtgrenze
    const lb = new LineBuilder();
    for (const r of overview.roads) lb.add(r.pts, ROAD_COLORS[r.cls] === 0xffffff ? 0x9a9a9a : darken(ROAD_COLORS[r.cls]));
    const ov = new THREE.LineSegments(lb.build(), MATERIALS.line);
    ov.renderOrder = ORDER.roads;
    ov.frustumCulled = false;
    this.overview.add(ov);
    const bl = new LineBuilder();
    for (const ring of manifest.boundary) bl.add(ring, 0x8a3aa8, 0, [40, 25]);
    const bnd = new THREE.LineSegments(bl.build(), MATERIALS.line);
    bnd.renderOrder = ORDER.grid;
    bnd.frustumCulled = false;
    this.scene.add(bnd);
  }
  private base = 'world';

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
  }

  /** Bildschirmpixel -> Weltkoordinaten (m) */
  toWorld(px: number, py: number): [number, number] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return [this.cx + (px - w / 2) * this.mpp, this.cy - (py - h / 2) * this.mpp];
  }

  zoomAt(px: number, py: number, factor: number): void {
    const [wx, wy] = this.toWorld(px, py);
    this.mpp = Math.min(25, Math.max(0.03, this.mpp * factor));
    const [nx, ny] = this.toWorld(px, py);
    this.cx += wx - nx;
    this.cy += wy - ny;
    this.onChange?.();
  }

  panBy(dxPx: number, dyPx: number): void {
    this.cx -= dxPx * this.mpp;
    this.cy += dyPx * this.mpp;
    this.onChange?.();
  }

  setLayer(layer: LayerName, visible: boolean): void {
    this.layerVisible[layer] = visible;
    for (const v of this.views.values()) this.applyLayers(v);
    if (layer === 'areas') this.bigAreas.visible = visible;
  }

  private applyLayers(v: TileView) {
    const detail = this.mpp < DETAIL_MPP;
    for (const [k, vis] of Object.entries(this.layerVisible) as Array<[LayerName, boolean]>) {
      const needsDetail = k === 'lanes' || k === 'connectors' || k === 'controls' || k === 'signals';
      v.setLayerVisible(k, vis && (!needsDetail || detail));
    }
  }

  get loadedTiles(): number {
    return this.views.size;
  }

  private visibleTileRange(margin = 1) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(w, h);
    return {
      tx0: Math.floor(x0 / TILE_SIZE) - margin,
      tx1: Math.floor(x1 / TILE_SIZE) + margin,
      ty0: Math.floor(y0 / TILE_SIZE) - margin,
      ty1: Math.floor(y1 / TILE_SIZE) + margin,
    };
  }

  private updateTiles(): void {
    const showTiles = this.mpp < TILE_MPP;
    this.overview.visible = !showTiles;
    for (const v of this.views.values()) v.group.visible = false;
    if (!showTiles) return;
    const r = this.visibleTileRange(1);
    const want: string[] = [];
    for (let tx = r.tx0; tx <= r.tx1; tx++)
      for (let ty = r.ty0; ty <= r.ty1; ty++) {
        const k = tileKey(tx, ty);
        if (!this.tileSet.has(k)) continue;
        want.push(k);
        this.lastUsed.set(k, this.frame);
        const v = this.views.get(k);
        if (v) {
          v.group.visible = true;
          this.applyLayers(v);
        } else if (!this.loading.has(k) && this.loading.size < 12) void this.load(k);
      }
    // Speicher begrenzen
    if (this.views.size > MAX_TILES) {
      const old = [...this.views.keys()].sort((a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0));
      for (const k of old.slice(0, this.views.size - MAX_TILES)) this.unload(k);
    }
  }

  private async load(k: string): Promise<void> {
    this.loading.add(k);
    try {
      const r = await fetch(`${this.base}/tiles/${k}.json`);
      const tile = (await r.json()) as Tile;
      const v = new TileView(tile);
      this.views.set(k, v);
      this.scene.add(v.group);
      for (const l of tile.lanes) this.laneById.set(l.id, l);
      for (const c of tile.connectors) this.conById.set(c.id, c);
      this.applyLayers(v);
      this.onChange?.();
    } catch (e) {
      console.error('Kachel', k, e);
    } finally {
      this.loading.delete(k);
    }
  }

  private unload(k: string): void {
    const v = this.views.get(k);
    if (!v) return;
    this.scene.remove(v.group);
    v.dispose();
    this.views.delete(k);
  }

  /** Simulationszeit in Sekunden */
  get time(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  render(): void {
    this.frame++;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const hw = (w / 2) * this.mpp;
    const hh = (h / 2) * this.mpp;
    this.camera.left = this.cx - hw;
    this.camera.right = this.cx + hw;
    this.camera.top = this.cy + hh;
    this.camera.bottom = this.cy - hh;
    this.camera.updateProjectionMatrix();
    this.updateTiles();
    if (this.frame % 6 === 0) this.updateSignals();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSignals(): void {
    if (this.mpp >= DETAIL_MPP) return;
    const t = this.time;
    for (const v of this.views.values()) {
      if (!v.group.visible || !v.signalAttr) continue;
      for (const s of v.signalSlots) {
        const c = this.controllers.get(s.ctrl);
        if (!c) continue;
        setSlotColor(v.signalAttr, s.slot, SIGNAL_COLORS[signalState(c, s.grp, t)]);
      }
      v.signalAttr.needsUpdate = true;
    }
  }

  /** Objekt unter dem Mauszeiger finden */
  pick(px: number, py: number): Pick | null {
    if (this.mpp >= DETAIL_MPP) return null;
    const [x, y] = this.toWorld(px, py);
    const tol = Math.max(1.2, 7 * this.mpp);
    const [tx, ty] = [Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)];
    const v = this.views.get(tileKey(tx, ty));
    if (!v) return null;
    let best: Pick | null = null;
    let bestD = tol;
    for (const h of v.tile.signals) {
      const d = Math.hypot(h.x / 10 - x, h.y / 10 - y);
      if (d < bestD * 1.2) {
        const ctrl = this.controllers.get(h.ctrl);
        if (ctrl) {
          best = { kind: 'signal', head: h, ctrl };
          bestD = d / 1.2;
        }
      }
    }
    for (const c of v.tile.connectors) {
      const d = distToPolyline(c.pts, x, y);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'connector', con: c };
      }
    }
    for (const l of v.tile.lanes) {
      const d = distToPolyline(l.pts, x, y);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'lane', lane: l };
      }
    }
    return best;
  }

  /** Ausgewähltes Objekt und seine Nachfolger hervorheben */
  setHighlight(p: Pick | null): void {
    for (const c of [...this.highlight.children]) {
      this.highlight.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    if (!p) return;
    const fb = new FillBuilder();
    const ribbon = (pts: number[], width: number, color: number) => fb.add(ribbonRing(pts, width), undefined, color);
    if (p.kind === 'lane') {
      ribbon(p.lane.pts, p.lane.w * 0.55, 0xff2d55);
      for (const cid of p.lane.out) {
        const c = this.conById.get(cid);
        if (!c) continue;
        ribbon(c.pts, 0.9, TURN_COLORS[c.turn]);
        const nxt = this.laneById.get(c.to);
        if (nxt) ribbon(nxt.pts, 0.5, 0xff9fb5);
      }
      // Vorgänger
      for (const c of this.conById.values()) {
        if (c.to !== p.lane.id) continue;
        const prev = this.laneById.get(c.from);
        if (prev) ribbon(prev.pts, 0.4, 0x9fb5ff);
        ribbon(c.pts, 0.5, 0x9fb5ff);
      }
    } else if (p.kind === 'connector') {
      ribbon(p.con.pts, 1.0, 0xff2d55);
      const a = this.laneById.get(p.con.from);
      const b = this.laneById.get(p.con.to);
      if (a) ribbon(a.pts, 0.5, 0x9fb5ff);
      if (b) ribbon(b.pts, 0.5, 0xff9fb5);
    } else {
      // alle Signalköpfe derselben Anlage
      for (const v of this.views.values())
        for (const h of v.tile.signals)
          if (h.ctrl === p.head.ctrl) {
            const r = 2.2;
            fb.add([dmv(h.x - r * 10), dmv(h.y - r * 10), dmv(h.x + r * 10), dmv(h.y - r * 10), dmv(h.x + r * 10), dmv(h.y + r * 10), dmv(h.x - r * 10), dmv(h.y + r * 10)], undefined, h.grp === 0 ? 0x2b6fd6 : 0xe08a20);
          }
    }
    if (fb.empty) return;
    const m = new THREE.Mesh(fb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    m.renderOrder = 40;
    m.frustumCulled = false;
    this.highlight.add(m);
  }

  focus(x: number, y: number, mpp?: number): void {
    this.cx = x;
    this.cy = y;
    if (mpp) this.mpp = mpp;
    this.onChange?.();
  }
}

const dmv = (v: number) => Math.round(v);

function darken(c: number): number {
  const col = new THREE.Color(c);
  col.multiplyScalar(0.75);
  return col.getHex();
}

function distToPolyline(pts: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2] / 10;
    const ay = pts[i - 1] / 10;
    const bx = pts[i] / 10;
    const by = pts[i + 1] / 10;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) best = d;
  }
  return best;
}

/** Band um eine Polylinie als Polygon (dm) */
function ribbonRing(pts: number[], width: number): number[] {
  const n = pts.length / 2;
  const left: number[] = [];
  const right: number[] = [];
  const hw = (width / 2) * 10;
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    let dx = pts[i1 * 2] - pts[i0 * 2];
    let dy = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    left.push(pts[i * 2] - dy * hw, pts[i * 2 + 1] + dx * hw);
    right.push(pts[i * 2] + dy * hw, pts[i * 2 + 1] - dx * hw);
  }
  const ring = [...left];
  for (let i = n - 1; i >= 0; i--) ring.push(right[i * 2], right[i * 2 + 1]);
  return ring;
}
