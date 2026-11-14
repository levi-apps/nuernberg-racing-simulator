/**
 * Darstellung der Welt in der Vogelperspektive mit Nachladen der Kacheln.
 * Wird vom Fahrmodus und von der Debug-Karte gemeinsam genutzt.
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
import { MATERIALS, ORDER, RL_MAIN, RL_MINI, TileView, type LayerName } from './TileView.ts';
import { AREA_COLORS, AREA_PATTERN, BACKGROUND, OVERVIEW_COLORS, TURN_COLORS } from './style.ts';
import { Pat, shared, surfaceMat } from './materials.ts';
import { Graphics } from './Graphics.ts';
import { litSurface, PAT_YARD, setLit } from './litMaterials.ts';

/** Ab dieser Auflösung (m pro Pixel) werden Kacheln geladen, darüber nur die Übersicht. */
const TILE_MPP = 2.6;
export const DETAIL_MPP = 0.7; // Spuren, Verbinder, Regelung, Ampeln
const MAX_TILES = 450;

export type Pick =
  | { kind: 'lane'; lane: Lane }
  | { kind: 'connector'; con: Connector }
  | { kind: 'signal'; head: SignalHead; ctrl: SignalController };

export type ViewMode = 'map' | 'drive';

export class WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  readonly miniCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  /** Verfolgerkamera für die 3D-Ansicht */
  readonly cam3d = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
  use3d = false;
  cam3dPos = new THREE.Vector3();
  cam3dTarget = new THREE.Vector3();
  /** Radius des Sichtbereichs in 3D (m) */
  radius3d = 200;
  private v3 = new THREE.Vector3();
  /** Kameramitte (m), Maßstab (m pro CSS-Pixel), Drehung: Weltrichtung von "oben" am Bildschirm (rad, PI/2 = Norden) */
  cx = 0;
  cy = 0;
  mpp = 1.5;
  rot = Math.PI / 2;
  mode: ViewMode = 'map';
  /** Punkt, um den immer Kacheln geladen werden (Auto), und Radius (m) für Verkehrssimulation */
  anchor: [number, number] | null = null;
  anchorRadius = 520;
  /** 3D-Körper einer Kachel wurden erzeugt / Kachel entladen */
  onTile3D?: (tile: Tile) => void;
  onTileUnload?: (key: string) => void;

  /** Schlüssel der gerade sichtbaren Kacheln */
  visibleKeys(): string[] {
    const out: string[] = [];
    for (const [k, v] of this.views) if (v.group.visible) out.push(k);
    return out;
  }

  /** alle Kacheln mit 3D-Körpern */
  tiles3D(): Tile[] {
    const out: Tile[] = [];
    for (const v of this.views.values()) if (v.has3D) out.push(v.tile);
    return out;
  }

  /** wird nach dem Laden jeder Kachel aufgerufen */
  onTileLoaded?: (tile: Tile) => void;

  manifest!: Manifest;
  controllers = new Map<number, SignalController>();
  /** große Flächen (für Untergrund-Abfragen, z. B. Wasser) */
  bigAreaData: Area[] = [];
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
    trees: true,
    lanes: true,
    connectors: true,
    controls: true,
    signals: true,
    signalStops: true,
    grid: false,
  };
  private frame = 0;
  onChange?: () => void;
  startTime = performance.now();
  /** Index geladener Spuren und Verbinder */
  laneById = new Map<number, Lane>();
  conById = new Map<number, Connector>();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BACKGROUND);
    this.scene.add(this.bigAreas, this.overview, this.highlight);
    this.highlight.renderOrder = 50;
    this.renderer.autoClear = false;
    this.camera.layers.enable(RL_MAIN);
    this.cam3d.layers.enable(RL_MAIN);
    this.cam3d.up.set(0, 0, 1);
    this.miniCamera.layers.set(0);
    this.miniCamera.layers.enable(RL_MINI);
    this.gfx = new Graphics(this.renderer, this.scene, this.cam3d);
    // Boden bis zum Horizont (nur 3D), damit hinter den geladenen Kacheln kein Loch ist
    const hg = new THREE.CircleGeometry(4000, 48);
    hg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(hg.getAttribute('position').count * 3).fill(0.56), 3));
    this.horizonGround = new THREE.Mesh(hg, litSurface(PAT_YARD, 1, false));
    this.horizonGround.renderOrder = -1;
    this.horizonGround.frustumCulled = false;
    this.horizonGround.layers.set(RL_MAIN);
    this.horizonGround.position.z = -0.2;
    this.horizonGround.receiveShadow = true;
    this.horizonGround.visible = false;
    this.scene.add(this.horizonGround);
  }
  readonly gfx: Graphics;
  private horizonGround: THREE.Mesh;
  /** Position des Spielerautos (für Scheinwerfer und Schatten) */
  carPose = { x: 0, y: 0, heading: 0 };
  private lastRender = performance.now();

  /** Welt -> Bildschirmpixel (CSS); hinter der Kamera: weit außerhalb */
  toScreen(x: number, y: number, z = 0): [number, number] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.use3d && this.mode === 'drive') {
      const v = this.v3.set(x, y, z);
      v.applyMatrix4(this.cam3d.matrixWorldInverse);
      if (v.z > -0.5) return [-1e5, -1e5];
      v.applyMatrix4(this.cam3d.projectionMatrix);
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    }
    const dx = x - this.cx;
    const dy = y - this.cy;
    const ux = Math.cos(this.rot);
    const uy = Math.sin(this.rot);
    const right = dx * uy - dy * ux;
    const up = dx * ux + dy * uy;
    return [w / 2 + right / this.mpp, h / 2 - up / this.mpp];
  }

  /**
   * Minikarte als zweiter Durchgang in ein Rechteck (CSS-Pixel, Ursprung unten links).
   * Zeigt alle geladenen Kacheln, die Übersichtsstraßen und Objekte der Ebene RL_MINI.
   */
  renderMinimap(rx: number, ry: number, rw: number, rh: number, cx: number, cy: number, rot: number, mpp: number): void {
    const cam = this.miniCamera;
    cam.left = (-rw / 2) * mpp;
    cam.right = (rw / 2) * mpp;
    cam.top = (rh / 2) * mpp;
    cam.bottom = (-rh / 2) * mpp;
    cam.position.set(cx, cy, 300);
    cam.near = -100;
    cam.far = 1000;
    cam.up.set(Math.cos(rot), Math.sin(rot), 0);
    cam.lookAt(cx, cy, 0);
    cam.updateProjectionMatrix();
    const vis: boolean[] = [];
    const dims: Array<'2d' | '3d'> = [];
    for (const v of this.views.values()) {
      vis.push(v.group.visible);
      dims.push(v.dim);
      v.group.visible = true;
      if (v.dim !== '2d') {
        v.setDim('2d', false);
        this.applyLayers(v);
      }
    }
    const ovVis = this.overview.visible;
    this.overview.visible = true;
    const r = this.renderer;
    this.gfx.reset2D();
    r.setRenderTarget(null);
    r.setScissorTest(true);
    r.setScissor(rx, ry, rw, rh);
    r.setViewport(rx, ry, rw, rh);
    r.clear();
    const mppMain = shared.uMpp.value;
    shared.uMpp.value = mpp;
    r.render(this.scene, cam);
    shared.uMpp.value = mppMain;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    let i = 0;
    for (const v of this.views.values()) {
      if (v.dim !== dims[i]) {
        v.setDim(dims[i], true);
        this.applyLayers(v);
      }
      v.group.visible = vis[i++];
    }
    this.overview.visible = ovVis;
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
    this.bigAreaData = areas.areas;

    const byPat = new Map<Pat, FillBuilder>();
    for (const a of areas.areas) {
      const p = AREA_PATTERN[a.k];
      let fb = byPat.get(p);
      if (!fb) byPat.set(p, (fb = new FillBuilder()));
      fb.add(a.outer, a.holes, AREA_COLORS[a.k]);
    }
    for (const [p, fb] of byPat) {
      const am = new THREE.Mesh(fb.build(), surfaceMat(p));
      am.renderOrder = p === Pat.Water ? ORDER.water - 0.05 : ORDER.areas - 0.05;
      am.frustumCulled = false;
      this.bigAreas.add(am);
    }

    const lb = new LineBuilder();
    for (const r of overview.roads) lb.add(r.pts, OVERVIEW_COLORS[r.cls]);
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
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.gfx?.resize();
  }

  /** Richtungen "rechts" und "oben" des Bildschirms in Weltkoordinaten */
  private axes(): { ux: number; uy: number; rx: number; ry: number } {
    const ux = Math.cos(this.rot);
    const uy = Math.sin(this.rot);
    return { ux, uy, rx: uy, ry: -ux };
  }

  /** Bildschirmpixel -> Weltkoordinaten (m) */
  toWorld(px: number, py: number): [number, number] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const dx = (px - w / 2) * this.mpp;
    const dy = -(py - h / 2) * this.mpp;
    const a = this.axes();
    return [this.cx + a.rx * dx + a.ux * dy, this.cy + a.ry * dx + a.uy * dy];
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
    const a = this.axes();
    this.cx -= (a.rx * dxPx - a.ux * dyPx) * this.mpp;
    this.cy -= (a.ry * dxPx - a.uy * dyPx) * this.mpp;
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
      const debugOnly = k === 'lanes' || k === 'connectors' || k === 'controls' || k === 'grid' || k === 'signalStops';
      const needsDetail = debugOnly || k === 'signals';
      let show = vis && (!needsDetail || detail);
      if (this.mode === 'drive' && debugOnly) show = false;
      v.setLayerVisible(k, show);
    }
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    for (const v of this.views.values()) this.applyLayers(v);
    if (mode === 'drive') this.setHighlight(null);
  }

  get loadedTiles(): number {
    return this.views.size;
  }

  /** Geladene Kacheln im Umkreis (für Kollision und Untergrund) */
  tilesAround(x: number, y: number, r: number): Tile[] {
    const out: Tile[] = [];
    const x0 = Math.floor((x - r) / TILE_SIZE);
    const x1 = Math.floor((x + r) / TILE_SIZE);
    const y0 = Math.floor((y - r) / TILE_SIZE);
    const y1 = Math.floor((y + r) / TILE_SIZE);
    for (let tx = x0; tx <= x1; tx++)
      for (let ty = y0; ty <= y1; ty++) {
        const v = this.views.get(tileKey(tx, ty));
        if (v) out.push(v.tile);
      }
    return out;
  }

  /** true, wenn die Kachel an dieser Stelle geladen ist (oder es dort keine gibt) */
  isReady(x: number, y: number): boolean {
    const k = tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
    return !this.tileSet.has(k) || this.views.has(k);
  }

  private updateTiles(): void {
    const showTiles = this.mpp < TILE_MPP;
    this.overview.visible = !showTiles;
    for (const v of this.views.values()) v.group.visible = false;
    const visible = new Set<string>();
    const want = new Set<string>();
    const in3d = this.use3d && this.mode === 'drive';
    if (showTiles) {
      // Kreis um die Bildmitte, der den gedrehten Bildschirm ganz abdeckt (3D: Sichtbereich vor dem Auto)
      const r = in3d ? this.radius3d : (Math.hypot(this.canvas.clientWidth, this.canvas.clientHeight) / 2) * this.mpp + TILE_SIZE * 0.5;
      this.collect(this.cx, this.cy, r, visible);
    }
    for (const k of visible) want.add(k);
    // Umgebung des Autos vorladen (Verkehr, Kollision), aber nicht zeichnen
    if (this.anchor) this.collect(this.anchor[0], this.anchor[1], this.anchorRadius, want);
    const order = [...want].sort((a, b) => this.tileDist(a) - this.tileDist(b));
    const dim = in3d ? '3d' : '2d';
    for (const k of order) {
      this.lastUsed.set(k, this.frame);
      const v = this.views.get(k);
      if (v) {
        if (visible.has(k)) {
          v.group.visible = true;
          if (in3d && v.ensure3D()) this.onTile3D?.(v.tile);
          v.setDim(dim, true);
          this.applyLayers(v);
        }
      } else if (!this.loading.has(k) && this.loading.size < 6) void this.load(k);
    }
    if (this.views.size > MAX_TILES) {
      const old = [...this.views.keys()].filter((k) => !want.has(k)).sort((a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0));
      for (const k of old.slice(0, this.views.size - MAX_TILES)) this.unload(k);
    }
  }

  private tileDist(k: string): number {
    const [tx, ty] = k.split('_').map(Number);
    const px = this.anchor?.[0] ?? this.cx;
    const py = this.anchor?.[1] ?? this.cy;
    return Math.hypot((tx + 0.5) * TILE_SIZE - px, (ty + 0.5) * TILE_SIZE - py);
  }

  private collect(x: number, y: number, r: number, into: Set<string>) {
    const x0 = Math.floor((x - r) / TILE_SIZE);
    const x1 = Math.floor((x + r) / TILE_SIZE);
    const y0 = Math.floor((y - r) / TILE_SIZE);
    const y1 = Math.floor((y + r) / TILE_SIZE);
    for (let tx = x0; tx <= x1; tx++)
      for (let ty = y0; ty <= y1; ty++) {
        const cx = (tx + 0.5) * TILE_SIZE;
        const cy = (ty + 0.5) * TILE_SIZE;
        if (Math.hypot(cx - x, cy - y) > r + TILE_SIZE * 0.71) continue;
        const k = tileKey(tx, ty);
        if (this.tileSet.has(k)) into.add(k);
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
      v.group.visible = false;
      this.applyLayers(v);
      this.onTileLoaded?.(tile);
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
    this.onTileUnload?.(k);
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
    this.camera.left = -hw;
    this.camera.right = hw;
    this.camera.top = hh;
    this.camera.bottom = -hh;
    this.camera.position.set(this.cx, this.cy, 300);
    this.camera.up.set(Math.cos(this.rot), Math.sin(this.rot), 0);
    this.camera.lookAt(this.cx, this.cy, 0);
    this.camera.near = -100;
    this.camera.far = 1000;
    this.camera.updateProjectionMatrix();
    const in3d = this.use3d && this.mode === 'drive';
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    if (in3d) {
      this.radius3d = this.gfx.spec.radius;
      this.gfx.update(dt);
      this.cam3d.aspect = w / Math.max(1, h);
      this.cam3d.position.copy(this.cam3dPos);
      this.cam3d.lookAt(this.cam3dTarget);
      this.cam3d.updateProjectionMatrix();
      this.cam3d.updateMatrixWorld();
    }
    this.updateTiles();
    if (this.frame % 6 === 0) this.updateSignals();
    shared.uMpp.value = this.mpp;
    shared.uTime.value = this.time;
    if (in3d) {
      // Laternen der sichtbaren Kacheln, Schatten und Scheinwerfer nachführen
      const lamps: Array<[number, number, number]> = [];
      for (const v of this.views.values()) if (v.group.visible) for (const l of v.streetLamps) lamps.push(l);
      this.gfx.place(this.cam3dTarget, lamps, this.carPose);
      this.horizonGround.position.x = this.cam3dPos.x;
      this.horizonGround.position.y = this.cam3dPos.y;
      this.horizonGround.visible = true;
      for (const o of this.bigAreas.children) setLit(o, true);
      this.gfx.render3D();
      for (const o of this.bigAreas.children) setLit(o, false);
      this.horizonGround.visible = false;
      return;
    }
    this.gfx.reset2D();
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSignals(): void {
    if (this.mpp >= DETAIL_MPP) return;
    const t = this.time;
    for (const v of this.views.values()) {
      if (!v.group.visible) continue;
      for (const g of v.signalGroups) {
        for (const s of g.slots) {
          const c = this.controllers.get(s.ctrl);
          if (!c) continue;
          setSlotColor(g.attr, s.slot, g.palette[signalState(c, s.grp, t)]);
        }
        g.attr.needsUpdate = true;
      }
    }
  }

  /** Nächstgelegene Spur (für Straßenname, Absetzen des Autos) */
  nearestLane(x: number, y: number, maxDist = 40, mainOnly = false): { lane: Lane; d: number; s: number } | null {
    let best: { lane: Lane; d: number; s: number } | null = null;
    for (const t of this.tilesAround(x, y, maxDist)) {
      for (const l of t.lanes) {
        if (mainOnly && l.iso) continue;
        const r = projectOnPolyline(l.pts, x, y);
        if (r.d < (best?.d ?? maxDist)) best = { lane: l, d: r.d, s: r.s };
      }
    }
    return best;
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
      const d = projectOnPolyline(c.pts, x, y).d;
      if (d < bestD) {
        bestD = d;
        best = { kind: 'connector', con: c };
      }
    }
    for (const l of v.tile.lanes) {
      const d = projectOnPolyline(l.pts, x, y).d;
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
      for (const v of this.views.values())
        for (const h of v.tile.signals)
          if (h.ctrl === p.head.ctrl) {
            const r = 22;
            fb.add([h.x - r, h.y - r, h.x + r, h.y - r, h.x + r, h.y + r, h.x - r, h.y + r], undefined, h.grp === 0 ? 0x2b6fd6 : 0xe08a20);
          }
    }
    if (fb.empty) return;
    const m = new THREE.Mesh(fb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    m.renderOrder = 40;
    m.frustumCulled = false;
    m.layers.set(RL_MAIN);
    this.highlight.add(m);
  }

  focus(x: number, y: number, mpp?: number): void {
    this.cx = x;
    this.cy = y;
    if (mpp) this.mpp = mpp;
    this.onChange?.();
  }
}


/** Abstand eines Punkts zu einer Polylinie (dm-Koordinaten) und Bogenlänge des Lotfußpunkts in m */
export function projectOnPolyline(pts: number[], x: number, y: number): { d: number; s: number; dir: [number, number] } {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  let dir: [number, number] = [1, 0];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2] / 10;
    const ay = pts[i - 1] / 10;
    const bx = pts[i] / 10;
    const by = pts[i + 1] / 10;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const l = Math.sqrt(l2);
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) {
      best = d;
      bestS = acc + t * l;
      if (l > 0) dir = [dx / l, dy / l];
    }
    acc += l;
  }
  return { d: best, s: bestS, dir };
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
