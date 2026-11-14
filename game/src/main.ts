import './style.css';
import type { Place } from '@nrs/shared';
import { WorldView } from './world/WorldView.ts';
import { DebugUi } from './debug/DebugUi.ts';
import { DriveController } from './drive/DriveController.ts';
import { TrafficSim } from './traffic/TrafficSim.ts';
import { TrafficRenderer } from './traffic/TrafficRenderer.ts';
import { StreetLabels } from './world/StreetLabels.ts';
import { loadNavData } from './nav/NavData.ts';
import { Navigator } from './nav/Navigator.ts';
import { Missions } from './missions/Missions.ts';
import { formatDist, formatTime, MissionUi } from './missions/MissionUi.ts';
import { StartMenu } from './ui/StartMenu.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const view = new WorldView(canvas);
const debug = new DebugUi(view, canvas);
const drive = new DriveController(view);
const traffic = new TrafficSim(view, drive.car);
const trafficView = new TrafficRenderer();
const labels = new StreetLabels(view);
const missionUi = new MissionUi();
let navi: Navigator | null = null;
let missions: Missions | null = null;
let menu: StartMenu | null = null;
view.scene.add(trafficView.group);
view.onTileLoaded = (t) => traffic.graph.addTile(t);
drive.traffic = traffic;
drive.onTeleport = () => traffic.clear();
drive.onImpact = (speed) => missions?.onCrash(speed);
traffic.onEvent = (e) => {
  if (e.type === 'red_light') {
    missions?.onRedLight();
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
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  if (menu?.open) return;
  if (e.code === 'KeyK') setMode(mode === 'drive' ? 'map' : 'drive');
  if (e.code === 'KeyO') openMenu(true);
  if (mode !== 'drive') return;
  if (e.code === 'Digit1' || e.code === 'Numpad1') missions ? missions.startDuty('taxi') : drive.hud.message('Navigation lädt noch …', 1.5);
  if (e.code === 'Digit2' || e.code === 'Numpad2') missions ? missions.startDuty('courier') : drive.hud.message('Navigation lädt noch …', 1.5);
  if (e.code === 'KeyX') {
    if (missions?.onDuty || missions?.job) missions.endDuty();
    else if (navi?.active) {
      navi.setTarget(null);
      drive.hud.message('Navigation beendet', 1.2);
    }
  }
});

function openMenu(canClose: boolean) {
  if (!menu) return;
  drive.input.enabled = false;
  menu.show(canClose);
}

debug.onPlaceCar = (lane) => {
  drive.putOnLane(lane, lane.len / 2);
  setMode('drive');
};
debug.onNavigate = (lane) => {
  if (!navi) return;
  navi.setTarget({ lane: lane.id, s: lane.len / 2, x: lane.pts[0] / 10, y: lane.pts[1] / 10, label: lane.name ?? 'Ziel' });
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

  // Startgebiet: aus der URL (#x,y) direkt, sonst Auswahlmenü
  const h = readHash();
  view.mpp = 0.07;
  const last0 = StartMenu.lastPos();
  drive.requestSpawn(h?.x ?? last0?.x ?? 120, h?.y ?? last0?.y ?? -40);
  setMode(h?.map ? 'map' : 'drive');
  if (h?.map) view.focus(h.x, h.y, h.mpp);
  menu = new StartMenu(places);
  menu.onChoose = (c) => {
    missions?.endDuty();
    navi?.setTarget(null);
    traffic.clear();
    drive.requestSpawn(c.x, c.y);
    drive.hud.message(`Start: ${c.name}`, 2);
  };
  menu.onClose = () => {
    drive.input.enabled = mode === 'drive';
  };
  if (!h) openMenu(false);

  // Navigation und Aufträge im Hintergrund laden
  loadNavData(`${import.meta.env.BASE_URL}world`)
    .then((data) => {
      navi = new Navigator(view, drive.car, data);
      missions = new Missions(data, navi, drive.car, missionUi, drive.hud, () => view.time);
      Object.assign(window as object, { navi, missions });
    })
    .catch((e) => console.error('Navigationsdaten', e));

  let last = performance.now();
  let lastSlow = 0;
  let lastSave = 0;
  const loop = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    drive.update(dt);
    if (drive.spawnedOk) traffic.update(dt);
    trafficView.update(traffic.vehicles);
    navi?.update(dt);
    missions?.update(dt);
    view.render();
    if (mode === 'drive') {
      // Minikarte unten links (CSS-Pixel, Ursprung unten links)
      view.renderMinimap(16, 16, 210, 210, drive.car.x, drive.car.y, drive.rotateCamera ? drive.car.heading : Math.PI / 2, 3.2);
      updateNavHud();
    }
    labels.focus = [drive.car.x, drive.car.y];
    labels.update(dt);
    if (t - lastSave > 5000 && drive.spawnedOk && mode === 'drive') {
      lastSave = t;
      StartMenu.saveLastPos(drive.car.x, drive.car.y);
    }
    if (mode === 'drive' && t - lastSlow > 1000) view.onChange?.();
    if (t - lastSlow > 500) {
      lastSlow = t;
      debug.tick();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const ARROWS: Record<string, string> = { left: '↰', right: '↱', uturn: '⮌' };
const TURN_TEXT: Record<string, string> = { left: 'links abbiegen', right: 'rechts abbiegen', uturn: 'wenden' };

function updateNavHud() {
  const nav = navi;
  if (!nav?.active || !nav.path.length) {
    missionUi.hideNav();
    missionUi.setPointer(0, 0, null);
    return;
  }
  const m = nav.nextManeuver();
  const rest = `${formatDist(nav.remaining)} · ca. ${formatTime(nav.remainingTime)} · ${nav.target!.label}`;
  if (nav.distanceToTarget() < 40) missionUi.setNav('◎', 'Ziel erreicht – anhalten', nav.target!.label);
  else if (m && m.dist < 600) missionUi.setNav(ARROWS[m.turn], `${m.dist < 15 ? 'Jetzt' : 'In ' + formatDist(m.dist)} ${TURN_TEXT[m.turn]}`, m.road ? `auf ${m.road} · ${rest}` : rest);
  else missionUi.setNav('↑', 'Der Straße folgen', rest);
  // Pfeil am Bildrand, wenn das Ziel nicht sichtbar ist
  const [tx, ty] = nav.targetPoint(nav.target!);
  const [sx, sy] = view.toScreen(tx, ty);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const margin = 40;
  if (sx > margin && sy > margin && sx < w - margin && sy < h - margin) {
    missionUi.setPointer(0, 0, null);
    return;
  }
  const cx = w / 2;
  const cy = h / 2;
  const ang = Math.atan2(sy - cy, sx - cx);
  const k = Math.min((w / 2 - margin) / Math.abs(Math.cos(ang) || 1e-6), (h / 2 - margin) / Math.abs(Math.sin(ang) || 1e-6));
  // nicht über Tacho/Minikarte am unteren Rand
  const py = Math.min(cy + Math.sin(ang) * k, h - 130);
  missionUi.setPointer(cx + Math.cos(ang) * k, py, ang);
}

void main();
