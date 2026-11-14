/**
 * Geheimes Admin-Panel (dreimal schnell in die obere rechte Ecke klicken/tippen): Geld, Autos und Tuning, Teleport zu jeder Straße / jedem Ort,
 * Fahrzeug-Cheats, Welt (Verkehr, Zeit), Jobs und Anzeige.
 */
import type { Place } from '@nrs/shared';
import { CARS } from '../garage/Cars.ts';
import type { Profile } from '../garage/Profile.ts';
import { MAX_LEVEL } from '../garage/Tuning.ts';
import type { DriveController } from '../drive/DriveController.ts';
import type { TrafficSim } from '../traffic/TrafficSim.ts';
import type { NavData } from '../nav/NavData.ts';
import type { Navigator } from '../nav/Navigator.ts';
import { KINDS, type JobKind, type JobSystem } from '../missions/Jobs.ts';
import { formatEuro } from '../missions/MissionUi.ts';
import { BLIP_KINDS, type BlipKind, type BlipLayer } from '../world/Blips.ts';

export interface AdminContext {
  profile: Profile;
  drive: DriveController;
  traffic: TrafficSim;
  blips: BlipLayer;
  places: Place[];
  data(): NavData | null;
  jobs(): JobSystem | null;
  navi(): Navigator | null;
  applyOwnCar(): void;
  teleport(x: number, y: number, label: string): void;
  setMapMode(on: boolean): void;
  toast(html: string): void;
}

type Tab = 'money' | 'cars' | 'teleport' | 'drive' | 'world' | 'jobs';
const TABS: Array<[Tab, string]> = [
  ['money', '💰 Geld'],
  ['cars', '🚗 Autos'],
  ['teleport', '📍 Teleport'],
  ['drive', '🏎️ Fahren'],
  ['world', '🌍 Welt'],
  ['jobs', '💼 Jobs'],
];

interface Hit {
  icon: string;
  label: string;
  sub: string;
  x: number;
  y: number;
}

export class AdminPanel {
  private root = document.createElement('div');
  open = false;
  private tab: Tab = 'teleport';
  /** Zeitfaktor für Physik und Verkehr */
  timeScale = 1;
  /** in der Karte: Klick teleportiert */
  clickTeleport = false;
  showFps = false;
  private fpsEl = document.createElement('div');
  private frames = 0;
  private fpsT = 0;
  private resetArmed = 0;
  private streetLane: Map<number, number> | null = null;
  private query = '';

  constructor(private ctx: AdminContext) {
    this.root.id = 'admin';
    this.root.style.display = 'none';
    this.fpsEl.id = 'fps';
    this.fpsEl.style.display = 'none';
    document.body.append(this.root, this.fpsEl);
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.open && e.code === 'Escape') this.toggle();
        // Eingaben im Panel nicht ans Spiel weitergeben
        if (this.open && e.target instanceof HTMLInputElement && this.root.contains(e.target)) e.stopPropagation();
      },
      true,
    );
    // geheimer Zugang: 3 Klicks/Tipps innerhalb von 2 s in die obere rechte Ecke (70 × 70 px)
    let taps: number[] = [];
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (this.open || e.clientX < window.innerWidth - 70 || e.clientY > 70) return;
        // Zeitpunkt der Eingabe (nicht der Verarbeitung), damit es auch bei ruckelndem Spiel klappt
        const now = e.timeStamp;
        taps = [...taps.filter((t) => now - t < 2000), now];
        if (taps.length >= 3) {
          taps = [];
          this.toggle();
        }
      },
      true,
    );
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
  }

  toggle(): void {
    this.open = !this.open;
    this.root.style.display = this.open ? '' : 'none';
    this.ctx.drive.input.enabled = !this.open;
    if (this.open) this.render();
  }

  /** jedes Frame: FPS-Anzeige */
  tick(dt: number): void {
    if (!this.showFps) return;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      const c = this.ctx.drive.car;
      this.fpsEl.textContent = `${Math.round(this.frames / this.fpsT)} FPS · x ${c.x.toFixed(0)} y ${c.y.toFixed(0)} · ${(c.speed * 3.6).toFixed(0)} km/h · KI ${this.ctx.traffic.count}`;
      this.frames = 0;
      this.fpsT = 0;
    }
  }

  // ------------------------------------------------------------- Darstellung

  render(): void {
    const tabs = TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === this.tab ? 'on' : ''}">${l}</button>`).join('');
    this.root.innerHTML = `<div class="a-head"><b>Admin-Panel</b><span>${formatEuro(this.ctx.profile.money)}</span><button data-act="close">✕</button></div>
      <div class="a-tabs">${tabs}</div><div class="a-body">${this.body()}</div>
      <div class="a-foot"><b>✕</b> oder <b>Esc</b> schließt · nur für deinen eigenen Spielstand</div>`;
    if (this.tab === 'teleport') {
      const inp = this.root.querySelector<HTMLInputElement>('#a-search');
      if (inp) {
        inp.value = this.query;
        inp.focus();
        this.renderHits();
      }
    }
  }

  private body(): string {
    const p = this.ctx.profile;
    const d = this.ctx.drive;
    const tr = this.ctx.traffic;
    switch (this.tab) {
      case 'money':
        return `<h4>Geld geben</h4><div class="a-grid">
          ${[100, 1000, 10000, 100000].map((v) => `<button data-act="money" data-v="${v}">+ ${formatEuro(v)}</button>`).join('')}
          <button data-act="money" data-v="-1000">− ${formatEuro(1000)}</button><button data-act="money0">auf 0 setzen</button></div>
          <h4>Betrag setzen</h4><div class="a-row"><input id="a-amount" type="number" min="0" step="100" value="${Math.round(p.money)}"><button data-act="setmoney">Setzen</button></div>
          <h4>Statistik</h4><p>Erledigte Jobs: ${p.completed} · verdient: ${formatEuro(p.earned)} · Autos: ${p.owned.length}/${CARS.length}</p>
          <h4>Spielstand</h4><button class="a-danger" data-act="reset">${this.resetArmed > performance.now() ? 'Wirklich alles löschen? Nochmal klicken' : 'Spielstand zurücksetzen'}</button>`;
      case 'cars': {
        const rows = CARS.map((c) => {
          const own = p.owns(c.id);
          const cur = p.current === c.id;
          return `<div class="a-car ${cur ? 'cur' : ''}"><span>${c.name}<small>${c.klass}</small></span>${own ? '' : `<button data-act="give" data-id="${c.id}">schenken</button>`}<button data-act="drive" data-id="${c.id}">${cur ? '● fährst du' : 'fahren'}</button></div>`;
        }).join('');
        return `<div class="a-grid"><button data-act="allcars">Alle Autos freischalten</button><button data-act="maxtune">Aktuelles Auto voll tunen</button><button data-act="alltune">Alle eigenen Autos voll tunen</button><button data-act="untune">Tuning entfernen</button></div><h4>Autos</h4>${rows}`;
      }
      case 'teleport': {
        const kinds: BlipKind[] = ['dealer', 'tuning', 'race', 'fuel', 'police', 'hospital'];
        return `<input id="a-search" placeholder="Straße, Adresse, Stadtteil oder Ort …" autocomplete="off"><div id="a-hits"></div>
          <h4>Schnell</h4><div class="a-grid">
          ${kinds.map((k) => `<button data-act="nearest" data-k="${k}">${BLIP_KINDS[k].icon} nächste/s ${BLIP_KINDS[k].label}</button>`).join('')}
          <button data-act="tp-target">🎯 zum Navigationsziel</button><button data-act="tp-random">🎲 zufälliger Ort</button>
          <button data-act="tp-home">🏛️ Hauptmarkt</button><button data-act="tp-job">💼 zum Job-Ziel</button></div>
          <h4>Karte</h4><label class="a-check"><input type="checkbox" data-opt="clickTeleport" ${this.clickTeleport ? 'checked' : ''}> Klick in der Karte (K) teleportiert dorthin</label>
          <button data-act="openmap">Karte öffnen</button>
          <h4>Koordinaten</h4><div class="a-row"><input id="a-x" type="number" placeholder="x (m)"><input id="a-y" type="number" placeholder="y (m)"><button data-act="tp-xy">los</button></div>
          <p class="a-muted">Aktuell: x ${d.car.x.toFixed(0)}, y ${d.car.y.toFixed(0)} (Meter ab Hauptmarkt)</p>`;
      }
      case 'drive':
        return `<h4>Leistung</h4><label class="a-range">Tempo & Beschleunigung ×<b>${d.car.power.toFixed(1)}</b><input type="range" data-opt="power" min="0.5" max="4" step="0.1" value="${d.car.power}"></label>
          <label class="a-check"><input type="checkbox" data-opt="ghost" ${d.ghost ? 'checked' : ''}> Geistermodus (durch Häuser und Autos fahren)</label>
          <label class="a-check"><input type="checkbox" data-opt="infNitro" ${d.infiniteNitro ? 'checked' : ''}> Unendlich Nitro</label>
          <div class="a-grid"><button data-act="nitro">Nitro einbauen + füllen</button><button data-act="stop">Auto anhalten</button><button data-act="flip">Umdrehen (180°)</button><button data-act="road">Zurück auf die Straße</button></div>
          <h4>Kamera</h4><div class="a-grid"><button data-act="cam3d">3D ein/aus</button><button data-act="camrot">Kamera dreht mit ein/aus</button></div>`;
      case 'world':
        return `<h4>Verkehr</h4><label class="a-check"><input type="checkbox" data-opt="traffic" ${tr.enabled ? 'checked' : ''}> KI-Verkehr</label>
          <label class="a-range">Dichte <b>${Math.round(tr.density * 100)} %</b><input type="range" data-opt="density" min="0.25" max="2.5" step="0.25" value="${tr.density}"></label>
          <button data-act="clear-traffic">Verkehr entfernen (neu verteilen)</button>
          <h4>Zeit</h4><label class="a-range">Spieltempo ×<b>${this.timeScale.toFixed(2)}</b><input type="range" data-opt="time" min="0.1" max="2" step="0.05" value="${this.timeScale}"></label>
          <div class="a-grid"><button data-act="time" data-v="0.25">Zeitlupe</button><button data-act="time" data-v="1">normal</button><button data-act="time" data-v="2">Zeitraffer</button></div>
          <h4>Anzeige</h4><label class="a-check"><input type="checkbox" data-opt="fps" ${this.showFps ? 'checked' : ''}> FPS, Position und Tempo anzeigen</label>
          <h4>Kartensymbole</h4>${(Object.keys(BLIP_KINDS) as BlipKind[])
            .map((k) => `<label class="a-check"><input type="checkbox" data-blip="${k}" ${this.ctx.blips.filter[k] ? 'checked' : ''}> ${BLIP_KINDS[k].icon} ${BLIP_KINDS[k].label}</label>`)
            .join('')}`;
      case 'jobs': {
        const j = this.ctx.jobs();
        const kinds = (Object.keys(KINDS) as JobKind[]).filter((k) => k !== 'race');
        return `<p>${j?.job ? `Aktiver Job: <b>${KINDS[j.job.offer.kind].title}</b>` : 'Kein Job aktiv.'}</p>
          <div class="a-grid"><button data-act="job-done" ${j?.job ? '' : 'disabled'}>Job sofort erledigen</button><button data-act="job-cancel" ${j?.job ? '' : 'disabled'}>Job abbrechen</button><button data-act="job-refresh">Neue Angebote</button></div>
          <h4>Job hier starten</h4><div class="a-grid">${kinds.map((k) => `<button data-act="job-start" data-k="${k}">${KINDS[k].icon} ${KINDS[k].title}</button>`).join('')}</div>
          <h4>Rennen</h4><div class="a-grid"><button data-act="race-near">🏁 zum nächsten Rennen</button><button data-act="race-win" ${j?.job?.offer.kind === 'race' ? '' : 'disabled'}>Rennen gewinnen</button></div>
          <p class="a-muted">Job-Start ignoriert das benötigte Fahrzeug.</p>`;
      }
    }
  }

  // ------------------------------------------------------------- Teleport-Suche

  private hits(q: string): Hit[] {
    const out: Hit[] = [];
    const data = this.ctx.data();
    const ql = q.trim().toLocaleLowerCase('de');
    if (ql.length < 2) return out;
    for (const p of this.ctx.places) if (p.name.toLocaleLowerCase('de').includes(ql)) out.push({ icon: '🏘️', label: p.name, sub: p.kind ?? 'Ort', x: p.x, y: p.y });
    if (!data) return out;
    // Adresse "Straße 12"
    const m = /^(.*\D)\s+(\d+\w*)$/.exec(q.trim());
    if (m) {
      const st = m[1].toLocaleLowerCase('de');
      const num = m[2].toLocaleLowerCase('de');
      const a = data.addr.a;
      for (let i = 0; i < data.addr.nums.length && out.length < 40; i++) {
        if (!data.addr.nums[i].toLocaleLowerCase('de').startsWith(num)) continue;
        const sn = data.addr.streets[a[i * 5]];
        if (!sn.toLocaleLowerCase('de').startsWith(st)) continue;
        out.push({ icon: '🏠', label: `${sn} ${data.addr.nums[i]}`, sub: 'Adresse', x: a[i * 5 + 1] / 10, y: a[i * 5 + 2] / 10 });
      }
    }
    // Straßen (aus dem Routinggraphen)
    if (!this.streetLane) {
      this.streetLane = new Map();
      const G = data.graph;
      for (let l = 0; l < G.n; l++) {
        const ni = G.name[l];
        if (ni >= 0 && !this.streetLane.has(ni) && !(G.flags[l] & 1)) this.streetLane.set(ni, l);
      }
    }
    const G = data.graph;
    const streets: Hit[] = [];
    for (const [ni, l] of this.streetLane) {
      const n = data.names[ni];
      const nl = n.toLocaleLowerCase('de');
      if (!nl.includes(ql)) continue;
      streets.push({ icon: '🛣️', label: n, sub: 'Straße', x: (G.x0[l] + G.x1[l]) / 20, y: (G.y0[l] + G.y1[l]) / 20 });
    }
    streets.sort((a, b) => Number(!a.label.toLocaleLowerCase('de').startsWith(ql)) - Number(!b.label.toLocaleLowerCase('de').startsWith(ql)) || a.label.localeCompare(b.label, 'de'));
    out.push(...streets.slice(0, 40));
    let np = 0;
    for (const p of data.pois) {
      if (np >= 25) break;
      if (!p.n.toLocaleLowerCase('de').includes(ql)) continue;
      np++;
      out.push({ icon: '📌', label: p.n, sub: p.t.replace(/_/g, ' '), x: p.x / 10, y: p.y / 10 });
    }
    return out.slice(0, 80);
  }

  private hitList: Hit[] = [];
  private renderHits(): void {
    const el = this.root.querySelector('#a-hits');
    if (!el) return;
    this.hitList = this.hits(this.query);
    el.innerHTML = this.query.trim().length < 2 ? '<p class="a-muted">Mindestens 2 Zeichen eingeben, z. B. „Königstr“, „Hauptmarkt“, „Gostenhof“ oder „Fürther Str 100“.</p>' : this.hitList.length ? this.hitList.map((h, i) => `<button class="a-hit" data-act="hit" data-i="${i}">${h.icon} ${esc(h.label)}<small>${esc(h.sub)}</small></button>`).join('') : '<p class="a-muted">Nichts gefunden.</p>';
  }

  // ------------------------------------------------------------- Aktionen

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    const d = this.ctx.drive;
    if (t.id === 'a-search') {
      // nur bei Eingabe neu suchen (ein "change" beim Verlassen würde die Trefferliste neu aufbauen)
      if (e.type === 'input' && t.value !== this.query) {
        this.query = t.value;
        this.renderHits();
      }
      return;
    }
    if (t.type === 'number') return;
    if (t.dataset.blip) {
      this.ctx.blips.filter[t.dataset.blip as BlipKind] = t.checked;
      return;
    }
    switch (t.dataset.opt) {
      case 'power':
        d.car.power = Number(t.value);
        break;
      case 'ghost':
        d.ghost = t.checked;
        break;
      case 'infNitro':
        d.infiniteNitro = t.checked;
        if (t.checked && d.nitroCap === 0) d.setNitro(8);
        break;
      case 'traffic':
        this.ctx.traffic.enabled = t.checked;
        if (!t.checked) this.ctx.traffic.clear();
        break;
      case 'density':
        this.ctx.traffic.density = Number(t.value);
        break;
      case 'time':
        this.timeScale = Number(t.value);
        break;
      case 'fps':
        this.showFps = t.checked;
        this.fpsEl.style.display = t.checked ? '' : 'none';
        break;
      case 'clickTeleport':
        this.clickTeleport = t.checked;
        break;
      default:
        return;
    }
    if (e.type === 'change') this.render();
    else {
      // Zahl neben dem Schieberegler aktualisieren
      const b = t.closest('label')?.querySelector('b');
      if (b && t.dataset.opt === 'power') b.textContent = d.car.power.toFixed(1);
      if (b && t.dataset.opt === 'density') b.textContent = `${Math.round(Number(t.value) * 100)} %`;
      if (b && t.dataset.opt === 'time') b.textContent = this.timeScale.toFixed(2);
    }
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!el) return;
    if (el.dataset.tab) {
      this.tab = el.dataset.tab as Tab;
      this.render();
      return;
    }
    const c = this.ctx;
    const p = c.profile;
    const d = c.drive;
    const j = c.jobs();
    const act = el.dataset.act;
    switch (act) {
      case 'close':
        this.toggle();
        return;
      case 'money':
        p.money = Math.max(0, p.money + Number(el.dataset.v));
        p.save();
        break;
      case 'money0':
        p.money = 0;
        p.save();
        break;
      case 'setmoney': {
        const v = Number(this.root.querySelector<HTMLInputElement>('#a-amount')?.value);
        if (Number.isFinite(v)) {
          p.money = Math.max(0, v);
          p.save();
        }
        break;
      }
      case 'reset':
        if (this.resetArmed > performance.now()) {
          try {
            localStorage.removeItem('nrs.save');
          } catch {
            /* egal */
          }
          location.reload();
          return;
        }
        this.resetArmed = performance.now() + 4000;
        break;
      case 'allcars':
        p.owned = CARS.map((x) => x.id);
        p.save();
        break;
      case 'give':
        if (!p.owns(el.dataset.id!)) p.owned.push(el.dataset.id!);
        p.save();
        break;
      case 'drive':
        if (!p.owns(el.dataset.id!)) p.owned.push(el.dataset.id!);
        p.select(el.dataset.id!);
        c.applyOwnCar();
        break;
      case 'maxtune':
      case 'alltune':
        for (const id of act === 'maxtune' ? [p.current] : p.owned) p.setTuning(id, { engine: MAX_LEVEL, brakes: MAX_LEVEL, tires: MAX_LEVEL, nitro: MAX_LEVEL });
        c.applyOwnCar();
        break;
      case 'untune':
        p.setTuning(p.current, { engine: 0, brakes: 0, tires: 0, nitro: 0 });
        c.applyOwnCar();
        break;
      case 'hit': {
        const h = this.hitList[Number(el.dataset.i)];
        if (h) this.go(h.x, h.y, h.label);
        return;
      }
      case 'nearest': {
        const k = el.dataset.k as BlipKind;
        const all = c.blips.all(k);
        let best = all[0];
        let bd = Infinity;
        for (const b of all) {
          const dist = Math.hypot(b.x - d.car.x, b.y - d.car.y);
          if (dist < bd && dist > 30) {
            bd = dist;
            best = b;
          }
        }
        if (best) this.go(best.x, best.y, best.name);
        else c.toast('Nichts gefunden');
        return;
      }
      case 'tp-target': {
        const t = c.navi()?.target;
        if (t) this.go(t.x, t.y, t.label);
        else c.toast('Kein Navigationsziel gesetzt');
        return;
      }
      case 'tp-job': {
        const t = j?.job?.offer.dest;
        if (t) this.go(t.x, t.y, t.label);
        else c.toast('Kein Job aktiv');
        return;
      }
      case 'tp-random': {
        const pl = c.places[(Math.random() * c.places.length) | 0];
        if (pl) this.go(pl.x, pl.y, pl.name);
        return;
      }
      case 'tp-home':
        this.go(0, 0, 'Hauptmarkt');
        return;
      case 'tp-xy': {
        const x = Number(this.root.querySelector<HTMLInputElement>('#a-x')?.value);
        const y = Number(this.root.querySelector<HTMLInputElement>('#a-y')?.value);
        if (Number.isFinite(x) && Number.isFinite(y)) this.go(x, y, `${x}, ${y}`);
        return;
      }
      case 'openmap':
        this.toggle();
        c.setMapMode(true);
        return;
      case 'nitro':
        if (d.nitroCap === 0) d.setNitro(5);
        d.nitro = d.nitroCap;
        break;
      case 'stop':
        d.car.vx = d.car.vy = 0;
        break;
      case 'flip':
        d.car.heading += Math.PI;
        d.car.vx = d.car.vy = 0;
        break;
      case 'road':
        d.requestSpawn(d.car.x, d.car.y);
        break;
      case 'cam3d':
        d.setView3D(!d.view3D);
        break;
      case 'camrot':
        d.rotateCamera = !d.rotateCamera;
        break;
      case 'clear-traffic':
        c.traffic.clear();
        break;
      case 'time':
        this.timeScale = Number(el.dataset.v);
        break;
      case 'job-done':
        j?.adminComplete();
        break;
      case 'job-cancel':
        j?.cancel();
        break;
      case 'job-refresh':
        j?.adminRefresh();
        break;
      case 'job-start':
        if (!j) break;
        if (!j.adminStart(el.dataset.k as JobKind)) c.toast('Hier ließ sich kein passender Job erzeugen – woanders probieren');
        else {
          this.toggle();
          return;
        }
        break;
      case 'race-near': {
        const r = j?.raceSpots.reduce((a, b) => (Math.hypot(b.at.x - d.car.x, b.at.y - d.car.y) < Math.hypot(a.at.x - d.car.x, a.at.y - d.car.y) ? b : a));
        if (r) this.go(r.at.x, r.at.y, r.at.label);
        return;
      }
      case 'race-win':
        j?.adminComplete();
        break;
      default:
        return;
    }
    this.render();
  }

  private go(x: number, y: number, label: string): void {
    this.ctx.teleport(x, y, label);
    this.toggle();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

