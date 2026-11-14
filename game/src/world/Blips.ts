/**
 * Kartensymbole wie in GTA: Autohäuser, Tuning-Werkstätten, illegale Rennen, Tankstellen,
 * Notdienste und Job-Marker. Angezeigt auf der Minikarte (Fahrmodus) und in der großen Karte (K)
 * mit Legende zum Ein- und Ausblenden. Klick auf ein Symbol in der Karte setzt einen Wegpunkt.
 */
import type { Target } from '../nav/NavData.ts';
import type { WorldView } from './WorldView.ts';

export type BlipKind = 'dealer' | 'tuning' | 'race' | 'job' | 'fuel' | 'wash' | 'police' | 'fire' | 'hospital';

export const BLIP_KINDS: Record<BlipKind, { icon: string; color: string; label: string }> = {
  dealer: { icon: '🚗', color: '#1d6fe0', label: 'Autohaus' },
  tuning: { icon: '🔧', color: '#ff8a00', label: 'Tuning-Werkstatt' },
  race: { icon: '🏁', color: '#d81f2a', label: 'Illegales Rennen' },
  job: { icon: '💼', color: '#27a35a', label: 'Jobs' },
  fuel: { icon: '⛽', color: '#3d8b4f', label: 'Tankstelle' },
  wash: { icon: '🫧', color: '#1e9ec4', label: 'Waschanlage' },
  police: { icon: '🚓', color: '#24408e', label: 'Polizei' },
  fire: { icon: '🚒', color: '#c0392b', label: 'Feuerwehr' },
  hospital: { icon: '🏥', color: '#d94a6a', label: 'Krankenhaus' },
};

export interface Blip {
  id: string;
  kind: BlipKind;
  x: number;
  y: number;
  name: string;
  /** Ziel für die Navigation */
  target?: Target;
  /** eigenes Symbol/Farbe (z. B. Job-Art) */
  icon?: string;
  color?: string;
  locked?: boolean;
}

export interface MinimapRect {
  /** CSS-Pixel, Ursprung unten links (wie renderMinimap) */
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  rot: number;
  mpp: number;
}

const STORE = 'nrs.blips';

export class BlipLayer {
  private stat: Blip[] = [];
  private dyn: Blip[] = [];
  private mapRoot = div('blips-map');
  private miniRoot = div('blips-mini');
  private legend = div('blip-legend');
  private mapEls = new Map<string, HTMLDivElement>();
  private miniEls = new Map<string, HTMLDivElement>();
  filter: Record<BlipKind, boolean>;
  onClick?: (b: Blip) => void;

  constructor(private view: WorldView) {
    const def = Object.fromEntries(Object.keys(BLIP_KINDS).map((k) => [k, true])) as Record<BlipKind, boolean>;
    try {
      this.filter = { ...def, ...(JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<BlipKind, boolean>>) };
    } catch {
      this.filter = def;
    }
    document.body.append(this.mapRoot, this.miniRoot, this.legend);
    this.mapRoot.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('.blip') as HTMLElement | null;
      if (!el) return;
      const b = this.byId(el.dataset.id ?? '');
      if (b) this.onClick?.(b);
    });
    this.legend.addEventListener('change', (e) => {
      const cb = e.target as HTMLInputElement;
      this.filter[cb.dataset.k as BlipKind] = cb.checked;
      try {
        localStorage.setItem(STORE, JSON.stringify(this.filter));
      } catch {
        /* egal */
      }
    });
    this.renderLegend();
  }

  private byId(id: string): Blip | undefined {
    return this.stat.find((b) => b.id === id) ?? this.dyn.find((b) => b.id === id);
  }

  setStatic(b: Blip[]): void {
    this.stat = b;
    this.renderLegend();
  }

  setDynamic(b: Blip[]): void {
    this.dyn = b;
  }

  /** alle Symbole einer Art (z. B. für "nächste Tankstelle") */
  all(kind?: BlipKind): Blip[] {
    const a = [...this.stat, ...this.dyn];
    return kind ? a.filter((b) => b.kind === kind) : a;
  }

  private renderLegend(): void {
    const count = (k: BlipKind) => this.all(k).length;
    this.legend.innerHTML =
      '<b>Kartensymbole</b>' +
      (Object.keys(BLIP_KINDS) as BlipKind[])
        .map((k) => {
          const d = BLIP_KINDS[k];
          const n = count(k);
          return `<label><input type="checkbox" data-k="${k}" ${this.filter[k] ? 'checked' : ''}><span class="blip-ic" style="background:${d.color}">${d.icon}</span>${d.label}${n && k !== 'job' ? ` <small>${n}</small>` : ''}</label>`;
        })
        .join('') +
      '<p>Klick auf ein Symbol setzt einen Wegpunkt.</p>';
  }

  private el(pool: Map<string, HTMLDivElement>, root: HTMLElement, b: Blip): HTMLDivElement {
    let e = pool.get(b.id);
    const k = BLIP_KINDS[b.kind];
    const icon = b.icon ?? k.icon;
    const color = b.locked ? '#7d8086' : (b.color ?? k.color);
    if (!e) {
      e = div('blip');
      e.dataset.id = b.id;
      root.append(e);
      pool.set(b.id, e);
    }
    if (e.dataset.v !== icon + color) {
      e.dataset.v = icon + color;
      e.textContent = icon;
      e.style.background = color;
      e.title = `${k.label}: ${b.name}`;
    }
    return e;
  }

  /** Elemente entfernen, deren Symbol es nicht mehr gibt */
  private prune(pool: Map<string, HTMLDivElement>, used: Set<string>): void {
    for (const [id, e] of pool) {
      if (used.has(id)) continue;
      if (!this.byId(id)) {
        e.remove();
        pool.delete(id);
      } else e.style.display = 'none';
    }
  }

  update(mapMode: boolean, mini: MinimapRect | null): void {
    const all = [...this.stat, ...this.dyn];
    this.legend.style.display = mapMode ? '' : 'none';
    this.mapRoot.style.display = mapMode ? '' : 'none';
    this.miniRoot.style.display = mini ? '' : 'none';
    // große Karte
    const usedMap = new Set<string>();
    if (mapMode) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const small = this.view.mpp > 6;
      for (const b of all) {
        if (!this.filter[b.kind]) continue;
        const [sx, sy] = this.view.toScreen(b.x, b.y);
        if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
        const e = this.el(this.mapEls, this.mapRoot, b);
        usedMap.add(b.id);
        e.style.display = '';
        e.classList.toggle('small', small);
        e.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
      }
    }
    this.prune(this.mapEls, usedMap);
    // Minikarte
    const usedMini = new Set<string>();
    if (mini) {
      const ux = Math.cos(mini.rot);
      const uy = Math.sin(mini.rot);
      const hw = mini.w / 2 - 7;
      const hh = mini.h / 2 - 7;
      const rmax = Math.hypot(hw, hh) * mini.mpp;
      this.miniRoot.style.left = `${mini.x}px`;
      this.miniRoot.style.bottom = `${mini.y}px`;
      this.miniRoot.style.width = `${mini.w}px`;
      this.miniRoot.style.height = `${mini.h}px`;
      for (const b of all) {
        if (!this.filter[b.kind]) continue;
        const dx = b.x - mini.cx;
        const dy = b.y - mini.cy;
        if (Math.abs(dx) > rmax || Math.abs(dy) > rmax) continue;
        const right = (dx * uy - dy * ux) / mini.mpp;
        const up = (dx * ux + dy * uy) / mini.mpp;
        if (Math.abs(right) > hw || Math.abs(up) > hh) continue;
        const e = this.el(this.miniEls, this.miniRoot, b);
        usedMini.add(b.id);
        e.style.display = '';
        e.style.transform = `translate(${(mini.w / 2 + right).toFixed(1)}px, ${(mini.h / 2 - up).toFixed(1)}px) translate(-50%, -50%)`;
      }
    }
    this.prune(this.miniEls, usedMini);
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
