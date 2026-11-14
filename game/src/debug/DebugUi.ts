/**
 * Debug-Karte: Ebenen, Legende, Auswahl per Klick, Ortsliste, Verschieben und Zoomen.
 */
import { cycleLength, signalState, type Lane, type Place } from '@nrs/shared';
import type { Pick, WorldView } from '../world/WorldView.ts';
import type { LayerName } from '../world/TileView.ts';
import { CONTROL_COLORS, hex, LEGEND } from '../world/style.ts';

const LAYER_LABELS: Array<[LayerName, string]> = [
  ['areas', 'Flächen (Wasser, Grün …)'],
  ['roads', 'Fahrbahnen'],
  ['markings', 'Markierungen'],
  ['paths', 'Fuß- und Radwege'],
  ['rail', 'Gleise / Straßenbahn'],
  ['buildings', 'Gebäude'],
  ['lanes', 'Fahrspuren'],
  ['connectors', 'Spurverbinder'],
  ['controls', 'Vorfahrt / Stopp'],
  ['signals', 'Ampeln'],
  ['grid', 'Kachelraster'],
];

const CTRL_TEXT: Record<string, string> = {
  none: 'keine (Fortsetzung)',
  signal: 'Ampel',
  stop: 'Stoppschild',
  yield: 'Vorfahrt gewähren',
  priority: 'Vorfahrtstraße',
  rbl: 'rechts vor links',
  end: 'Sackgasse',
};

export class DebugUi {
  active = false;
  private panel = document.getElementById('panel')!;
  private statusEl = document.getElementById('status')!;
  private inspector = document.getElementById('inspector')!;
  private coordsEl = document.getElementById('coords')!;
  private placeSel = document.getElementById('place') as HTMLSelectElement;
  private selected: Pick | null = null;
  /** Aufruf, wenn das Auto auf eine Spur gesetzt werden soll */
  onPlaceCar?: (lane: Lane) => void;
  /** Aufruf bei Auswahl eines Orts (im Fahrmodus: Auto dorthin) */
  onJump?: (x: number, y: number) => void;

  constructor(
    private view: WorldView,
    private canvas: HTMLCanvasElement,
  ) {
    this.bindPointer();
  }

  setup(places: Place[]): void {
    const layers = document.getElementById('layers')!;
    for (const [k, label] of LAYER_LABELS) {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.view.layerVisible[k];
      cb.onchange = () => this.view.setLayer(k, cb.checked);
      l.append(cb, label);
      layers.append(l);
    }
    const legend = document.getElementById('legend')!;
    for (const [label, color, dot] of LEGEND) {
      const i = document.createElement('i');
      i.style.background = hex(color);
      if (dot) i.className = 'dot';
      const s = document.createElement('span');
      s.textContent = label;
      legend.append(i, s);
    }
    const presets: Place[] = [{ name: 'Hauptmarkt', x: 0, y: 0 }, ...places.sort((a, b) => a.name.localeCompare(b.name, 'de'))];
    for (const p of presets) {
      const o = document.createElement('option');
      o.value = `${p.x},${p.y}`;
      o.textContent = p.name;
      this.placeSel.append(o);
    }
    this.placeSel.onchange = () => {
      const [x, y] = this.placeSel.value.split(',').map(Number);
      this.onJump?.(x, y);
      this.placeSel.blur();
    };
    this.inspector.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.action === 'place-car' && this.selected?.kind === 'lane') this.onPlaceCar?.(this.selected.lane);
    });
  }

  setActive(a: boolean): void {
    this.active = a;
    this.panel.style.display = a ? '' : 'none';
    this.canvas.style.cursor = a ? '' : 'none';
    if (!a) this.select(null);
  }

  private bindPointer(): void {
    const canvas = this.canvas;
    const view = this.view;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = { x: e.clientX, y: e.clientY, moved: false };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const [wx, wy] = view.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      this.coordsEl.textContent = `x ${wx.toFixed(1)}  y ${wy.toFixed(1)}  ·  ${view.mpp < 1 ? (view.mpp * 100).toFixed(0) + ' cm' : view.mpp.toFixed(1) + ' m'}/px`;
      if (!this.active || !pointers.has(e.pointerId) || !drag) return;
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) view.zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, pinchDist / d);
        pinchDist = d;
        drag.moved = true;
        return;
      }
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) {
        drag.moved = true;
        canvas.classList.add('dragging');
      }
      if (drag.moved) view.panBy(e.clientX - prev.x, e.clientY - prev.y);
    });
    const end = (e: PointerEvent) => {
      if (!this.active) return;
      pointers.delete(e.pointerId);
      canvas.classList.remove('dragging');
      if (drag && !drag.moved && pointers.size === 0) {
        const rect = canvas.getBoundingClientRect();
        this.select(view.pick(e.clientX - rect.left, e.clientY - rect.top));
      }
      if (pointers.size === 0) drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        view.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  select(p: Pick | null): void {
    this.selected = p;
    this.view.setHighlight(p);
    this.renderInspector();
  }

  renderInspector(): void {
    const p = this.selected;
    const inspector = this.inspector;
    if (!p) {
      inspector.innerHTML = '<span class="muted">Auf eine Spur, einen Verbinder oder eine Ampel klicken.</span>';
      return;
    }
    if (p.kind === 'lane') {
      const l = p.lane;
      const lines = [
        `<b>Spur ${l.id}</b>${l.name ? ` · ${escapeHtml(l.name)}` : ''}`,
        `Abschnitt ${l.seg}, ${l.dir === 1 ? 'vorwärts' : 'rückwärts'}`,
        `Spur ${l.idx + 1} von ${l.n} (von links)`,
        `Klasse ${l.cls}, ${l.vmax} km/h, ${l.w} m breit`,
        `Länge ${l.len} m${l.layer ? `, Ebene ${l.layer}` : ''}`,
        `Regelung am Ende: <span style="color:${hex(CONTROL_COLORS[l.ctrl])}">■</span> ${CTRL_TEXT[l.ctrl]}`,
      ];
      if (l.turns) lines.push(`turn:lanes: ${l.turns}`);
      if (l.iso) lines.push('<span style="color:#c00">außerhalb des Hauptnetzes</span>');
      if (l.stops?.length) lines.push(`Haltelinien: ${l.stops.map((s) => `${s.s} m (Anlage ${s.ctrl}, Gruppe ${s.grp})`).join(', ')}`);
      lines.push(`Ausfahrten: ${l.out.length ? l.out.map((c) => `${c} (${this.view.conById.get(c)?.turn ?? '?'})`).join(', ') : '–'}`);
      lines.push('', '<a data-action="place-car">▶ Auto hier absetzen</a>');
      inspector.innerHTML = lines.join('\n');
    } else if (p.kind === 'connector') {
      const c = p.con;
      inspector.innerHTML = [`<b>Verbinder ${c.id}</b>`, `Richtung: ${c.turn}`, `von Spur ${c.from} → Spur ${c.to}`, `Länge ${c.len} m, Knoten ${c.node}`].join('\n');
    } else {
      const c = p.ctrl;
      const state = signalState(c, p.head.grp, this.view.time);
      const phases = c.phases
        .map((ph, i) => `  Phase ${i + 1}: Gruppen [${ph.green.join(', ') || 'Fußgänger'}] grün ${ph.g}s, gelb ${ph.y}s, rot ${ph.r}s`)
        .join('\n');
      inspector.innerHTML = [
        `<b>Ampelanlage ${c.id}</b> (${c.k === 'junction' ? 'Kreuzung' : 'Fußgängerampel'})`,
        `Signalgruppe ${p.head.grp}: ${state === 'green' ? 'grün' : state === 'yellow' ? 'gelb' : 'rot'}`,
        `Umlauf ${cycleLength(c)} s, Versatz ${c.offset} s`,
        phases,
        `<span class="muted">Phasen sind erzeugt, nicht echt.</span>`,
      ].join('\n');
    }
  }

  tick(): void {
    if (!this.active) return;
    const s = this.view.manifest?.stats;
    if (s)
      this.statusEl.innerHTML = [
        `Kacheln geladen: ${this.view.loadedTiles} / ${this.view.manifest.tiles.length}`,
        `Spuren: ${s.lanes.toLocaleString('de')} · Verbinder: ${s.connectors.toLocaleString('de')}`,
        `Ampelanlagen: ${s.signalControllers.toLocaleString('de')} · Gebäude: ${s.buildings.toLocaleString('de')}`,
        `Datenstand: ${new Date(this.view.manifest.generatedAt).toLocaleDateString('de')}`,
        this.view.mpp >= 0.7 ? '<i>Für Spuren und Ampeln weiter hineinzoomen.</i>' : '',
        '<b>K</b> zurück zum Fahren',
      ].join('<br>');
    if (this.selected?.kind === 'signal') this.renderInspector();
  }

  showError(msg: string): void {
    this.panel.style.display = '';
    this.statusEl.innerHTML = msg;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
