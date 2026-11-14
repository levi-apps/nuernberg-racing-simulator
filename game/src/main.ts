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
import { JobSystem } from './missions/Jobs.ts';
import { MarkerLayer } from './missions/Markers.ts';
import { Profile } from './garage/Profile.ts';
import { carById } from './garage/Cars.ts';
import { GarageUi } from './garage/GarageUi.ts';
import { formatDist, formatTime, MissionUi } from './missions/MissionUi.ts';
import { StartMenu } from './ui/StartMenu.ts';
import { AdminPanel } from './ui/AdminPanel.ts';
import { GraphicsMenu } from './ui/GraphicsMenu.ts';
import { BlipLayer, type Blip, type BlipKind } from './world/Blips.ts';
import { TuningUi } from './garage/TuningUi.ts';
import { NITRO_SECONDS, PARTS, tunedSpec } from './garage/Tuning.ts';
import { poiTarget, type NavData } from './nav/NavData.ts';
import { formatEuro } from './missions/MissionUi.ts';
import { loadModels, models } from './assets/Models.ts';
import { StreetLife } from './world/StreetLife.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const view = new WorldView(canvas);
const debug = new DebugUi(view, canvas);
const drive = new DriveController(view);
const traffic = new TrafficSim(view, drive.car);
const trafficView = new TrafficRenderer();
const streetLife = new StreetLife(view.scene);
drive.streetLife = streetLife;
view.onTile3D = (t) => streetLife.addTile(t);
view.onTileUnload = (k) => streetLife.removeTile(k);
/** Straßenleben aller Kacheln neu erzeugen (nach dem Laden von Modellen oder Haltestellen) */
function refreshStreetLife() {
  for (const t of view.tiles3D()) {
    streetLife.removeTile(`${t.tx}_${t.ty}`);
    streetLife.addTile(t);
  }
}
const labels = new StreetLabels(view);
const missionUi = new MissionUi();
let navi: Navigator | null = null;
let jobs: JobSystem | null = null;
const profile = new Profile();
const garage = new GarageUi(profile);
const markers = new MarkerLayer(view);
const tuning = new TuningUi(profile);
const blips = new BlipLayer(view);
let navData: NavData | null = null;
let places: Place[] = [];

/** eigenes Auto mit Tuning und Lack übernehmen */
function applyOwnCar() {
  const m = profile.car;
  const t = profile.tuneOf(m.id);
  drive.setCar(tunedSpec(m.spec, t), profile.colorOf(m.id), m.body);
  drive.setNitro(NITRO_SECONDS[t.nitro]);
  missionUi.setMoney(profile.money);
}
const inTransfer = () => jobs?.job?.offer.kind === 'transfer';
applyOwnCar();

garage.onSelect = (id) => {
  if (jobs?.job?.offer.kind === 'transfer') return drive.hud.message('Erst die Überführung abschließen', 1.5);
  profile.select(id);
  applyOwnCar();
};
garage.onPaint = (id, c) => {
  profile.setPaint(id, c);
  if (profile.current === id && jobs?.job?.offer.kind !== 'transfer') applyOwnCar();
};
garage.onBuy = (id) => {
  if (profile.buy(id)) {
    applyOwnCar();
    missionUi.showToast(`<b>Gekauft: ${carById(id).name}</b><br>Viel Spaß damit!`, 3);
  }
};
garage.nearestText = () => {
  const d = jobs?.nearestDealer();
  return d ? `Nächstes: ${d.n} (${formatDist(Math.hypot(d.x / 10 - drive.car.x, d.y / 10 - drive.car.y))}).` : '';
};
garage.onNavigate = () => {
  const d = jobs?.nearestDealer();
  if (d && navi) navi.setTarget({ lane: d.l, s: d.s / 10, x: d.x / 10, y: d.y / 10, label: d.n });
};
garage.onClose = () => {
  drive.input.enabled = mode === 'drive' && !menu?.open;
  jobs?.garageClosed();
};
function openGarage(dealer: string | null) {
  drive.input.enabled = false;
  drive.car.vx = drive.car.vy = 0;
  garage.show(dealer);
}

tuning.blocked = () => (inTransfer() ? 'Mit dem Kundenauto geht hier nichts – erst die Überführung abschließen.' : null);
tuning.onBuy = (part) => {
  if (inTransfer()) return;
  if (profile.buyTuning(profile.current, part)) {
    applyOwnCar();
    const lvl = profile.tuneOf(profile.current)[part];
    drive.hud.message(`${PARTS[part].name}: ${PARTS[part].levels[lvl]} eingebaut`, 2);
  }
};
tuning.onPaint = (c) => {
  if (inTransfer()) return;
  profile.setPaint(profile.current, c);
  applyOwnCar();
};
tuning.damage = () => (inTransfer() ? 0 : drive.damage.level);
tuning.onRepair = (price) => {
  if (inTransfer() || profile.money < price) return;
  profile.spend(price);
  drive.repair();
  drive.hud.message('Auto repariert ✨', 2);
};
tuning.onClose = () => {
  drive.input.enabled = mode === 'drive' && !menu?.open;
  jobs?.garageClosed();
};
function openTuning(shop: string) {
  drive.input.enabled = false;
  drive.car.vx = drive.car.vy = 0;
  tuning.show(shop);
}

/** feste Kartensymbole aus den OSM-Orten und den Renn-Treffpunkten */
function buildBlips(data: NavData, js: JobSystem): Blip[] {
  const out: Blip[] = [];
  const kindOf = (c: string, t: string): BlipKind | null => {
    if (c === 'shop' && t === 'car') return 'dealer';
    if (t === 'car_repair' || t === 'tyres') return 'tuning';
    if (t === 'fuel') return 'fuel';
    if (t === 'car_wash') return 'wash';
    if (t === 'police') return 'police';
    if (t === 'fire_station') return 'fire';
    if (t === 'hospital') return 'hospital';
    return null;
  };
  data.pois.forEach((p, i) => {
    const k = kindOf(p.c, p.t);
    if (k) out.push({ id: `p${i}`, kind: k, x: p.x / 10, y: p.y / 10, name: p.n, target: poiTarget(p) });
  });
  for (const r of js.raceSpots)
    out.push({ id: r.id, kind: 'race', x: r.at.x, y: r.at.y, name: `${r.who} · Einsatz ${formatEuro(r.stake ?? 0)}`, target: r.at, color: r.tier === 2 ? '#111111' : r.tier === 1 ? '#8e1a9e' : undefined });
  return out;
}

blips.onClick = (b) => {
  if (!navi || !b.target) return;
  navi.setTarget({ ...b.target, label: b.name });
  missionUi.showToast(`<b>Wegpunkt gesetzt</b><br>${b.name}`, 2.5);
};

const gfxMenu = new GraphicsMenu(view.gfx);
gfxMenu.is3D = () => drive.view3D;
gfxMenu.onView3D = (on) => drive.setView3D(on);

const admin = new AdminPanel({
  profile,
  drive,
  traffic,
  blips,
  get places() {
    return places;
  },
  data: () => navData,
  jobs: () => jobs,
  navi: () => navi,
  applyOwnCar: () => (inTransfer() ? undefined : applyOwnCar()),
  teleport: (x, y, label) => {
    drive.requestSpawn(x, y);
    if (mode !== 'drive') setMode('drive');
    drive.hud.message(`Teleport: ${label}`, 2);
  },
  setMapMode: (on) => setMode(on ? 'map' : 'drive'),
  toast: (html) => missionUi.showToast(html, 2.5),
});

// Admin: Klick in der Karte teleportiert (nur ohne Ziehen)
let downAt: [number, number] | null = null;
canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
canvas.addEventListener('pointerup', (e) => {
  if (!admin.clickTeleport || mode !== 'map' || !downAt) return;
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = canvas.getBoundingClientRect();
  const [x, y] = view.toWorld(e.clientX - r.left, e.clientY - r.top);
  drive.requestSpawn(x, y);
  setMode('drive');
  drive.hud.message('Teleport', 1.2);
});
let menu: StartMenu | null = null;
let onModelsReady: (() => void) | null = null;
view.scene.add(trafficView.group, trafficView.group3d);
drive.onView3D = (on) => {
  trafficView.set3D(on);
  try {
    localStorage.setItem('nrs.view3d', on ? '1' : '0');
  } catch {
    /* egal */
  }
};
view.onTileLoaded = (t) => traffic.graph.addTile(t);
drive.traffic = traffic;
drive.onTeleport = () => traffic.clear();
drive.onImpact = (speed) => jobs?.onCrash(speed);
traffic.onEvent = (e) => {
  if (e.type === 'red_light') {
    jobs?.onRedLight();
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
Object.assign(window as object, { map: view, drive, traffic, streetLife, models });

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
  if (menu?.open || admin.open) return;
  if (e.code === 'KeyK') setMode(mode === 'drive' ? 'map' : 'drive');
  if (e.code === 'KeyO') openMenu(true);
  if (mode !== 'drive') return;
  if (garage.open || tuning.open) return;
  if (e.code === 'KeyG') openGarage(null);
  if (e.code === 'KeyX') {
    if (jobs?.job) jobs.cancel();
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
  places = await fetch(`${import.meta.env.BASE_URL}world/places.json`).then((r) => r.json() as Promise<Place[]>);
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
    jobs?.cancel();
    navi?.setTarget(null);
    traffic.clear();
    drive.requestSpawn(c.x, c.y);
    drive.hud.message(`Start: ${c.name}`, 2);
  };
  menu.onClose = () => {
    drive.input.enabled = mode === 'drive';
  };
  if (!h) openMenu(false);
  try {
    // 3D-Ansicht ist Standard, außer man hat zuletzt die Draufsicht gewählt
    if (localStorage.getItem('nrs.view3d') !== '0') drive.setView3D(true);
  } catch {
    /* egal */
  }

  // 3D-Modelle (Autos, Figuren, Bäume) im Hintergrund laden
  loadModels(`${import.meta.env.BASE_URL}models`)
    .then(() => {
      if (!inTransfer()) applyOwnCar();
      trafficView.useModels();
      refreshStreetLife();
      onModelsReady?.();
    })
    .catch((e) => console.error('Modelle', e));

  // Navigation und Aufträge im Hintergrund laden
  loadNavData(`${import.meta.env.BASE_URL}world`)
    .then((data) => {
      navData = data;
      // Bushaltestellen für die Wartehäuschen
      const seen = new Set<string>();
      for (const line of data.bus.lines)
        for (const st of line.stops) {
          const key = `${st.n}|${Math.round(st.x / 100)}|${Math.round(st.y / 100)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          streetLife.busStops.push({ x: st.x / 10, y: st.y / 10, lane: st.l, s: st.s / 10 });
        }
      refreshStreetLife();
      navi = new Navigator(view, drive.car, data);
      jobs = new JobSystem(data, data.bus, navi, drive.car, missionUi, drive.hud, profile, markers, view.scene, () => view.time, {
        setCar: (id, color) => {
          const m = carById(id);
          drive.setCar(m.spec, color, m.body);
          drive.setNitro(0);
        },
        restoreCar: () => applyOwnCar(),
        openGarage: (dealer) => openGarage(dealer),
        openTuning: (shop) => openTuning(shop),
        money: () => missionUi.setMoney(profile.money),
      }, () => drive.view3D);
      blips.setStatic(buildBlips(data, jobs));
      Object.assign(window as object, { navi, jobs, profile, garage, tuning, blips, admin });
    })
    .catch((e) => console.error('Navigationsdaten', e));

  let last = performance.now();
  let lastSlow = 0;
  let lastSave = 0;
  let lastBlips = 0;
  let lastClock = 0;
  const loop = (t: number) => {
    const dtReal = Math.min(0.1, (t - last) / 1000);
    const dt = dtReal * admin.timeScale;
    last = t;
    admin.tick(dtReal);
    drive.update(dt);
    if (drive.spawnedOk) traffic.update(dt);
    trafficView.update(traffic.vehicles);
    const peds = { low: 0, medium: 12, high: 24, ultra: 40 }[view.gfx.effective];
    streetLife.update(dt, mode === 'drive' && drive.view3D, view.visibleKeys(), view.cam3dTarget, drive.car, peds);
    navi?.update(dt);
    jobs?.update(dt, mode === 'drive' && !garage.open && !tuning.open && !admin.open && !menu?.open);
    markers.setVisible(mode === 'drive');
    view.render();
    if (mode === 'drive') {
      // Minikarte unten links (CSS-Pixel, Ursprung unten links)
      const miniRot = drive.rotateCamera || drive.view3D ? view.rot : Math.PI / 2;
      view.renderMinimap(16, 16, 210, 210, drive.car.x, drive.car.y, miniRot, 3.2);
      updateNavHud();
      blips.update(false, { x: 16, y: 16, w: 210, h: 210, cx: drive.car.x, cy: drive.car.y, rot: miniRot, mpp: 3.2 });
    } else blips.update(true, null);
    if (t - lastBlips > 1000 && jobs) {
      lastBlips = t;
      blips.setDynamic(jobs.jobBlips());
    }
    if (t - lastClock > 500) {
      lastClock = t;
      gfxMenu.tick(mode === 'drive');
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
