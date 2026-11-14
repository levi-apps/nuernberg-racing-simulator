import './style.css';
import { cycleLength, signalState, type Place } from '@nrs/shared';
import { MapView, type Pick } from './debug/MapView.ts';
import type { LayerName } from './debug/TileView.ts';
import { CONTROL_COLORS, hex, LEGEND } from './debug/style.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const statusEl = document.getElementById('status')!;
const inspector = document.getElementById('inspector')!;
const coordsEl = document.getElementById('coords')!;
const placeSel = document.getElementById('place') as HTMLSelectElement;

const view = new MapView(canvas);
// für Debugging in der Browser-Konsole
(window as unknown as { map: MapView }).map = view;

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

function setupUi(places: Place[]) {
  const layers = document.getElementById('layers')!;
  for (const [k, label] of LAYER_LABELS) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = view.layerVisible[k];
    cb.onchange = () => view.setLayer(k, cb.checked);
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

  const presets: Place[] = [
    { name: 'Hauptmarkt', x: 0, y: 0 },
    ...places.sort((a, b) => a.name.localeCompare(b.name, 'de')),
  ];
  for (const p of presets) {
    const o = document.createElement('option');
    o.value = `${p.x},${p.y}`;
    o.textContent = p.name;
    placeSel.append(o);
  }
  placeSel.onchange = () => {
    const [x, y] = placeSel.value.split(',').map(Number);
    view.focus(x, y, 0.25);
  };
}

// Interaktion: Ziehen = verschieben, Rad = zoomen, Klick = auswählen
let drag: { x: number; y: number; moved: boolean } | null = null;
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
canvas.addEventListener('pointerdown', (e) => {
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
  coordsEl.textContent = `x ${wx.toFixed(1)}  y ${wy.toFixed(1)}  ·  ${view.mpp < 1 ? (view.mpp * 100).toFixed(0) + ' cm' : view.mpp.toFixed(1) + ' m'}/px`;
  if (!pointers.has(e.pointerId) || !drag) return;
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
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) {
    drag.moved = true;
    canvas.classList.add('dragging');
  }
  if (drag.moved) view.panBy(dx, dy);
});
const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (drag && !drag.moved && pointers.size === 0) {
    const rect = canvas.getBoundingClientRect();
    select(view.pick(e.clientX - rect.left, e.clientY - rect.top));
  }
  if (pointers.size === 0) drag = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    view.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(e.deltaY * 0.0015));
  },
  { passive: false },
);

let selected: Pick | null = null;
function select(p: Pick | null) {
  selected = p;
  view.setHighlight(p);
  renderInspector();
}

const CTRL_TEXT: Record<string, string> = {
  none: 'keine (Fortsetzung)',
  signal: 'Ampel',
  stop: 'Stoppschild',
  yield: 'Vorfahrt gewähren',
  priority: 'Vorfahrtstraße',
  rbl: 'rechts vor links',
  end: 'Sackgasse',
};

function renderInspector() {
  const p = selected;
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
    lines.push(`Ausfahrten: ${l.out.length ? l.out.map((c) => `${c} (${view.conById.get(c)?.turn ?? '?'})`).join(', ') : '–'}`);
    inspector.innerHTML = lines.join('\n');
  } else if (p.kind === 'connector') {
    const c = p.con;
    inspector.innerHTML = [`<b>Verbinder ${c.id}</b>`, `Richtung: ${c.turn}`, `von Spur ${c.from} → Spur ${c.to}`, `Länge ${c.len} m, Knoten ${c.node}`].join('\n');
  } else {
    const c = p.ctrl;
    const t = view.time;
    const state = signalState(c, p.head.grp, t);
    const phases = c.phases.map((ph, i) => `  Phase ${i + 1}: Gruppen [${ph.green.join(', ') || 'Fußgänger'}] grün ${ph.g}s, gelb ${ph.y}s, rot ${ph.r}s`).join('\n');
    inspector.innerHTML = [
      `<b>Ampelanlage ${c.id}</b> (${c.k === 'junction' ? 'Kreuzung' : 'Fußgängerampel'})`,
      `Signalgruppe ${p.head.grp}: ${state === 'green' ? 'grün' : state === 'yellow' ? 'gelb' : 'rot'}`,
      `Umlauf ${cycleLength(c)} s, Versatz ${c.offset} s`,
      phases,
      `<span class="muted">Phasen sind erzeugt, nicht echt.</span>`,
    ].join('\n');
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// Position in der URL merken (#x,y,mpp)
function readHash() {
  const m = location.hash.slice(1).split(',').map(Number);
  if (m.length === 3 && m.every(Number.isFinite)) view.focus(m[0], m[1], m[2]);
}
let hashTimer = 0;
view.onChange = () => {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => history.replaceState(null, '', `#${view.cx.toFixed(0)},${view.cy.toFixed(0)},${view.mpp.toFixed(3)}`), 250);
};

function updateStatus() {
  const s = view.manifest?.stats;
  if (!s) return;
  statusEl.innerHTML = [
    `Kacheln geladen: ${view.loadedTiles} / ${view.manifest.tiles.length}`,
    `Spuren: ${s.lanes.toLocaleString('de')} · Verbinder: ${s.connectors.toLocaleString('de')}`,
    `Ampelanlagen: ${s.signalControllers.toLocaleString('de')} · Gebäude: ${s.buildings.toLocaleString('de')}`,
    `Datenstand: ${new Date(view.manifest.generatedAt).toLocaleDateString('de')}`,
    view.mpp >= 0.7 ? '<i>Für Spuren und Ampeln weiter hineinzoomen.</i>' : '',
  ].join('<br>');
}

async function main() {
  view.resize();
  window.addEventListener('resize', () => view.resize());
  try {
    await view.init(`${import.meta.env.BASE_URL}world`);
  } catch (e) {
    statusEl.innerHTML = `<b style="color:#c00">Weltdaten fehlen.</b><br>Erst <code>npm run data:build</code> ausführen.<br><span class="muted">${String(e)}</span>`;
    return;
  }
  const places = await fetch(`${import.meta.env.BASE_URL}world/places.json`).then((r) => r.json() as Promise<Place[]>);
  setupUi(places);
  view.focus(0, 0, 0.6);
  readHash();
  let lastStatus = 0;
  const loop = (t: number) => {
    view.render();
    if (t - lastStatus > 500) {
      lastStatus = t;
      updateStatus();
      if (selected?.kind === 'signal') renderInspector();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void main();
