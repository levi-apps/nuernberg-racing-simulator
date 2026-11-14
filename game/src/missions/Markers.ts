/**
 * Job-Marker in der Welt: Ring am Boden, Lichtsäule in 3D, Punkt in der Minikarte,
 * Beschriftung mit Symbol und Verdienst über dem Marker.
 */
import * as THREE from 'three';
import type { WorldView } from '../world/WorldView.ts';
import { RL_MAIN, RL_MINI } from '../world/TileView.ts';

export interface MarkerSpec {
  id: string;
  x: number;
  y: number;
  color: number;
  icon: string;
  text: string;
  locked: boolean;
}

interface Entry {
  spec: MarkerSpec;
  group: THREE.Group;
  label: HTMLDivElement;
  html: string;
}

const ringGeo = new THREE.RingGeometry(3.4, 4.4, 40);
const discGeo = new THREE.CircleGeometry(2.2, 32);
const miniGeo = new THREE.CircleGeometry(20, 20);
const beamGeo = new THREE.CylinderGeometry(2.2, 2.2, 1, 24, 1, true);
beamGeo.rotateX(Math.PI / 2);
beamGeo.translate(0, 0, 0.5);

export class MarkerLayer {
  private entries = new Map<string, Entry>();
  private root = document.createElement('div');
  private t = 0;

  constructor(private view: WorldView) {
    this.root.id = 'job-labels';
    document.body.append(this.root);
  }

  /** Marker auf genau diese Menge setzen */
  sync(specs: MarkerSpec[]): void {
    const keep = new Set(specs.map((s) => s.id));
    for (const [id, e] of this.entries) {
      if (keep.has(id)) continue;
      this.view.scene.remove(e.group);
      e.label.remove();
      this.entries.delete(id);
    }
    for (const s of specs) {
      const e = this.entries.get(s.id);
      if (e) {
        if (e.spec.locked !== s.locked || e.spec.text !== s.text) {
          this.view.scene.remove(e.group);
          e.label.remove();
          this.entries.delete(s.id);
        } else continue;
      }
      this.entries.set(s.id, this.make(s));
    }
  }

  private make(s: MarkerSpec): Entry {
    const color = s.locked ? 0x8a8d92 : s.color;
    const g = new THREE.Group();
    g.position.set(s.x, s.y, 0);
    const m = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number, layer: number) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      mesh.layers.set(layer);
      g.add(mesh);
      return mesh;
    };
    m(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }), 16.5, RL_MAIN).userData.ground = true;
    m(discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthTest: false }), 16.4, RL_MAIN).userData.ground = true;
    const beam = m(
      beamGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthTest: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      17,
      RL_MAIN,
    );
    beam.scale.set(1, 1, 30);
    beam.userData.beam = true;
    m(miniGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }), 57, RL_MINI);
    this.view.scene.add(g);
    const label = document.createElement('div');
    label.className = s.locked ? 'job-label locked' : 'job-label';
    const html = `<span class="ji">${s.icon}</span>${s.text}`;
    label.innerHTML = html;
    this.root.append(label);
    return { spec: s, group: g, label, html };
  }

  update(dt: number, carX: number, carY: number, show: boolean): void {
    this.t += dt;
    const v = this.view;
    const in3d = v.use3d && v.mode === 'drive';
    // in der 2D-Übersicht mit dem Zoom wachsen, damit Marker aus der Ferne erkennbar sind
    const k = (1 + 0.08 * Math.sin(this.t * 4)) * (in3d ? 1 : Math.max(1, v.mpp / 0.3));
    const far = in3d ? 450 : Math.max(450, v.mpp * 700);
    for (const e of this.entries.values()) {
      for (const c of e.group.children) {
        if (c.userData.beam) c.visible = in3d;
        if (c.userData.ground) c.scale.set(k, k, 1);
      }
      const d = Math.hypot(e.spec.x - carX, e.spec.y - carY);
      const [sx, sy] = v.toScreen(e.spec.x, e.spec.y, in3d ? 6 : 0);
      const W = window.innerWidth;
      const H = window.innerHeight;
      const inside = sx > -80 && sy > -40 && sx < W + 80 && sy < H + 40;
      const onScreen = show && inside && d < far;
      // Hinweis am Bildschirmrand für Marker außerhalb der Ansicht (nur 2D, bis ~1,2 km)
      const edge = show && !inside && !in3d && !e.spec.locked && d < (e.spec.id.startsWith('d') ? 600 : 1200);
      e.label.style.display = onScreen || edge ? '' : 'none';
      e.label.classList.toggle('edge', edge);
      if (onScreen) {
        if (e.label.dataset.mode !== 'full') {
          e.label.dataset.mode = 'full';
          e.label.innerHTML = e.html;
        }
        e.label.style.transform = `translate(${sx.toFixed(1)}px, ${(sy - (in3d ? 10 : 34)).toFixed(1)}px) translate(-50%, -100%)`;
      } else if (edge) {
        const txt = `<span class="ji">${e.spec.icon}</span>${d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1).replace('.', ',') + ' km'}`;
        if (e.label.dataset.mode !== txt) {
          e.label.dataset.mode = txt;
          e.label.innerHTML = txt;
        }
        // Richtung vom Bildmittelpunkt auf den Rand projizieren
        const dx = sx - W / 2;
        const dy = sy - H / 2;
        const f = Math.min((W / 2 - 46) / Math.max(1e-6, Math.abs(dx)), (H / 2 - 26) / Math.max(1e-6, Math.abs(dy)));
        const ex = W / 2 + dx * f;
        let ey = H / 2 + dy * f;
        if (ex < 260 && ey > H - 250) ey = H - 250; // Minikarte freihalten
        if (ex > W - 400 && ey > H - 110) ey = H - 110; // Tacho freihalten
        e.label.style.transform = `translate(${ex.toFixed(1)}px, ${ey.toFixed(1)}px) translate(-50%, -50%)`;
      }
    }
  }

  setVisible(v: boolean): void {
    for (const e of this.entries.values()) e.group.visible = v;
    this.root.style.display = v ? '' : 'none';
  }
}
