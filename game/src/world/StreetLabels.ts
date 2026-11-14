/**
 * Straßennamen entlang der Straßen (DOM-Text über der Karte).
 * Wichtige Straßen haben Vorrang, Beschriftungen überlappen sich nicht,
 * derselbe Name erscheint nicht mehrfach dicht nebeneinander.
 */
import type { RoadClass, RoadLabel } from '@nrs/shared';
import type { WorldView } from './WorldView.ts';

const PRIO: Partial<Record<RoadClass, number>> = {
  motorway: 9,
  trunk: 8,
  primary: 7,
  secondary: 6,
  tertiary: 5,
  unclassified: 3,
  residential: 3,
  living_street: 2,
  service: 1,
};

const MAX_LABELS = 45;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class StreetLabels {
  private root = document.createElement('div');
  private pool: HTMLDivElement[] = [];
  private timer = 0;
  enabled = true;
  /** Position des Spielers (bevorzugt Namen in seiner Nähe) */
  focus: [number, number] | null = null;

  constructor(private view: WorldView) {
    this.root.id = 'street-labels';
    document.body.insertBefore(this.root, document.body.firstChild?.nextSibling ?? null);
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 30;
    const v = this.view;
    const show = this.enabled && v.mpp < 1.3 && !!v.manifest;
    if (!show) {
      for (const el of this.pool) el.style.display = 'none';
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const r = (Math.hypot(w, h) / 2) * v.mpp;
    const fx = this.focus?.[0] ?? v.cx;
    const fy = this.focus?.[1] ?? v.cy;
    // Kandidaten sammeln
    const cands: Array<{ l: RoadLabel; sx: number; sy: number; score: number }> = [];
    const seen = new Set<RoadLabel>();
    for (const t of v.tilesAround(v.cx, v.cy, r)) {
      for (const l of t.labels ?? []) {
        if (seen.has(l)) continue;
        seen.add(l);
        const [sx, sy] = v.toScreen(l.x / 10, l.y / 10);
        if (sx < -50 || sy < -20 || sx > w + 50 || sy > h + 20) continue;
        // zu kurz für den Text bei diesem Maßstab?
        const textPx = l.n.length * 6.6 + 8;
        if (l.len / v.mpp < textPx * 0.7) continue;
        const d = Math.hypot(l.x / 10 - fx, l.y / 10 - fy);
        cands.push({ l, sx, sy, score: (PRIO[l.cls] ?? 1) * 40 - d * 0.15 + (l.layer > 0 ? 5 : 0) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const placed: Box[] = [];
    const lastByName = new Map<string, Array<[number, number]>>();
    let used = 0;
    for (const c of cands) {
      if (used >= MAX_LABELS) break;
      const major = (PRIO[c.l.cls] ?? 1) >= 5;
      const fontPx = major ? 13 : 11.5;
      const tw = c.l.n.length * fontPx * 0.56 + 8;
      // Bildschirmwinkel: Weltwinkel relativ zur Kameradrehung, lesbar halten
      let ang = -(c.l.a * Math.PI) / 180 + (v.rot - Math.PI / 2);
      while (ang > Math.PI / 2) ang -= Math.PI;
      while (ang <= -Math.PI / 2) ang += Math.PI;
      const cs = Math.abs(Math.cos(ang));
      const sn = Math.abs(Math.sin(ang));
      const bw = (tw * cs + 16 * sn) / 2;
      const bh = (tw * sn + 16 * cs) / 2;
      const box = { x0: c.sx - bw, y0: c.sy - bh, x1: c.sx + bw, y1: c.sy + bh };
      if (placed.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) continue;
      const prev = lastByName.get(c.l.n);
      if (prev?.some(([x, y]) => Math.hypot(x - c.sx, y - c.sy) < 260)) continue;
      placed.push(box);
      if (prev) prev.push([c.sx, c.sy]);
      else lastByName.set(c.l.n, [[c.sx, c.sy]]);
      const el = this.pool[used] ?? this.make();
      if (el.textContent !== c.l.n) el.textContent = c.l.n;
      el.className = major ? 'major' : '';
      el.style.display = '';
      el.style.transform = `translate(${c.sx.toFixed(1)}px, ${c.sy.toFixed(1)}px) translate(-50%, -50%) rotate(${ang.toFixed(3)}rad)`;
      used++;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }

  private make(): HTMLDivElement {
    const el = document.createElement('div');
    this.root.append(el);
    this.pool.push(el);
    return el;
  }
}
