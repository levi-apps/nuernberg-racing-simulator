import './style.css';
import type { Place } from '@nrs/shared';
import { WorldView } from './world/WorldView.ts';
import { DebugUi } from './debug/DebugUi.ts';
import { DriveController } from './drive/DriveController.ts';
import { TrafficSim } from './traffic/TrafficSim.ts';
import { TrafficRenderer } from './traffic/TrafficRenderer.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const view = new WorldView(canvas);
const debug = new DebugUi(view, canvas);
const drive = new DriveController(view);
const traffic = new TrafficSim(view, drive.car);
const trafficView = new TrafficRenderer();
view.scene.add(trafficView.group);
view.onTileLoaded = (t) => traffic.graph.addTile(t);
drive.traffic = traffic;
drive.onTeleport = () => traffic.clear();
traffic.onEvent = (e) => {
  if (e.type === 'red_light') {
    drive.hud.message('Rote Ampel überfahren!', 2);
    drive.hud.setViolations(traffic.events.filter((x) => x.type === 'red_light').length);
  }
};

const REASON_HELP: Record<string, string> = {
  frei: 'freie Fahrt',
  folgt: 'folgt dem Vordermann',
  rot: 'wartet an roter/gelber Ampel',
  Vorfahrt: 'lässt Vorfahrt',
  'rechts vor links': 'rechts vor links',
  Stopp: 'hält am Stoppschild',
  'Kreuzung belegt': 'Kreuzung belegt',
  'Ausfahrt voll': 'Stau hinter der Kreuzung',
  Spieler: 'bremst wegen dir',
  Unfall: 'Unfall',
};
debug.extraPick = (x, y) => {
  const v = traffic.vehicleAt(x, y);
  if (!v) return null;
  return () =>
    [
      `<b>Fahrzeug ${v.id}</b> (${v.type === 'bus' ? 'Bus' : v.type === 'van' ? 'Transporter' : 'Pkw'}, ${v.len.toFixed(1)} m)`,
      `Tempo ${(v.v * 3.6).toFixed(0)} km/h, Beschl. ${v.a.toFixed(1)} m/s²`,
      `Zustand: ${REASON_HELP[v.reason] ?? v.reason}`,
      v.waitTime > 0.5 ? `wartet seit ${v.waitTime.toFixed(0)} s` : '',
      `Route: ${v.route
        .slice(0, 6)
        .map((k) => ((k & 1) === 1 ? `V${k >> 1}` : `S${k >> 1}`))
        .join(' → ')}`,
    ]
      .filter(Boolean)
      .join('\n');
};
debug.extraStatus = () => `KI-Fahrzeuge: ${traffic.count}${traffic.enabled ? '' : ' (aus)'}`;

// für Debugging in der Browser-Konsole
Object.assign(window as object, { map: view, drive, traffic });

type Mode = 'drive' | 'map';
let mode: Mode = 'drive';

function setMode(m: Mode) {
  mode = m;
  drive.setActive(m === 'drive');
  debug.setActive(m === 'map');
  if (m === 'map') {
    view.focus(drive.car.x, drive.car.y, Math.max(view.mpp, 0.35));
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyK' && !(e.target instanceof HTMLSelectElement)) setMode(mode === 'drive' ? 'map' : 'drive');
});

debug.onPlaceCar = (lane) => {
  drive.putOnLane(lane, lane.len / 2);
  setMode('drive');
};
debug.onJump = (x, y) => {
  if (mode === 'map') view.focus(x, y, 0.25);
  else drive.requestSpawn(x, y);
};

// Position in der URL merken: #x,y (Startpunkt) bzw. im Kartenmodus #x,y,mpp
let hashTimer = 0;
view.onChange = () => {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const x = mode === 'drive' ? drive.car.x : view.cx;
    const y = mode === 'drive' ? drive.car.y : view.cy;
    history.replaceState(null, '', `#${x.toFixed(0)},${y.toFixed(0)}${mode === 'map' ? ',' + view.mpp.toFixed(3) + ',map' : ''}`);
  }, 400);
};

function readHash(): { x: number; y: number; mpp?: number; map: boolean } | null {
  const parts = location.hash.slice(1).split(',');
  const [x, y, mpp] = parts.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, mpp: Number.isFinite(mpp) ? mpp : undefined, map: parts.includes('map') };
}

async function main() {
  view.resize();
  window.addEventListener('resize', () => view.resize());
  try {
    await view.init(`${import.meta.env.BASE_URL}world`);
  } catch (e) {
    debug.showError(`<b style="color:#c00">Weltdaten fehlen.</b><br>Erst <code>npm run data:build</code> ausführen.<br><span class="muted">${String(e)}</span>`);
    return;
  }
  const places = await fetch(`${import.meta.env.BASE_URL}world/places.json`).then((r) => r.json() as Promise<Place[]>);
  debug.setup(places);
  drive.init();

  // Start: Position aus der URL oder Hauptmarkt-Nähe (Burgstraße / Königstraße)
  const h = readHash();
  view.mpp = 0.07;
  drive.requestSpawn(h?.x ?? 120, h?.y ?? -40);
  setMode(h?.map ? 'map' : 'drive');
  if (h?.map) view.focus(h.x, h.y, h.mpp);

  let last = performance.now();
  let lastSlow = 0;
  const loop = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    drive.update(dt);
    if (drive.spawnedOk) traffic.update(dt);
    trafficView.update(traffic.vehicles);
    view.render();
    if (mode === 'drive' && t - lastSlow > 1000) view.onChange?.();
    if (t - lastSlow > 500) {
      lastSlow = t;
      debug.tick();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void main();
