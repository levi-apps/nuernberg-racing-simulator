/**
 * Aufträge: Taxi und Kurier.
 *
 * Taxi:   Fahrgast an einer Adresse in der Nähe abholen (anhalten), zum Wunschziel bringen.
 *         Fahrpreis nach Strecke, Trinkgeld für Pünktlichkeit; Unfälle und Rotlicht kosten Trinkgeld.
 * Kurier: Bestellung bei einem Restaurant/Laden abholen, an eine Adresse liefern – mit Zeitlimit.
 * Wer im Dienst ist, bekommt nach jedem Auftrag automatisch den nächsten.
 */
import type { Car } from '../drive/Car.ts';
import type { Hud } from '../drive/Hud.ts';
import { addressCount, addressTarget, poiTarget, type NavData, type Target } from '../nav/NavData.ts';
import type { Navigator } from '../nav/Navigator.ts';
import { formatDist, formatEuro, formatTime, type MissionUi } from './MissionUi.ts';

export type JobKind = 'taxi' | 'courier';
type Phase = 'pickup' | 'deliver';

interface Job {
  kind: JobKind;
  phase: Phase;
  pickup: Target;
  dest: Target;
  who: string;
  /** geplante Strecke/Zeit der eigentlichen Fahrt (ab Abholung) */
  tripLen: number;
  tripTime: number;
  startedAt: number; // Zeitpunkt der Abholung
  deadline: number; // nur Kurier
  crashes: number;
  reds: number;
  stopTimer: number;
}

const SAVE_KEY = 'nrs.save';
const FIRST = ['Frau Huber', 'Herr Meier', 'Frau Schmidt', 'Herr Bauer', 'Frau Wagner', 'Herr Fischer', 'Frau Koch', 'Herr Richter', 'Frau Hoffmann', 'Herr Schuster', 'Frau Lang', 'Herr Kraus', 'Frau Lehmann', 'Herr Brandl', 'Frau Roth'];
const TAXI_DEST_CATS = new Set(['station', 'hotel', 'culture', 'food', 'health', 'school', 'office']);

export class Missions {
  job: Job | null = null;
  onDuty: JobKind | null = null;
  money = 0;
  completed = 0;
  private nextTimer = 0;
  private hintTimer = 0;

  constructor(
    private data: NavData,
    private nav: Navigator,
    private car: Car,
    private ui: MissionUi,
    private hud: Hud,
    private now: () => number,
  ) {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as { money?: number; completed?: number };
      this.money = s.money ?? 0;
      this.completed = s.completed ?? 0;
    } catch {
      /* Speicher nicht verfügbar */
    }
    ui.setMoney(this.money);
  }

  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ money: this.money, completed: this.completed }));
    } catch {
      /* egal */
    }
  }

  startDuty(kind: JobKind): void {
    this.onDuty = kind;
    this.job = null;
    if (!this.newJob(kind)) this.hud.message('Gerade kein Auftrag in der Nähe – versuch es woanders', 2.5);
  }

  endDuty(): void {
    if (this.job) this.hud.message(this.job.kind === 'taxi' ? 'Fahrt abgebrochen' : 'Lieferung abgebrochen', 1.5);
    this.onDuty = null;
    this.job = null;
    this.nav.setTarget(null);
    this.ui.setJob(null);
  }

  onCrash(speed: number): void {
    if (this.job && this.job.phase === 'deliver' && speed > 3) this.job.crashes++;
  }

  onRedLight(): void {
    if (this.job && this.job.phase === 'deliver') this.job.reds++;
  }

  // ------------------------------------------------------------ Auswahl der Ziele

  private randomAddressNear(x: number, y: number, rMin: number, rMax: number): Target | null {
    const d = this.data;
    const n = addressCount(d);
    const a = d.addr.a;
    for (let tries = 0; tries < 4000; tries++) {
      const i = (Math.random() * n) | 0;
      const ax = a[i * 5 + 1] / 10;
      const ay = a[i * 5 + 2] / 10;
      const dist = Math.hypot(ax - x, ay - y);
      if (dist >= rMin && dist <= rMax) return addressTarget(d, i);
    }
    return null;
  }

  private randomPoiNear(x: number, y: number, rMin: number, rMax: number, cats: Set<string>): Target | null {
    const list = this.data.pois.filter((p) => cats.has(p.c) && inRange(p.x / 10 - x, p.y / 10 - y, rMin, rMax));
    if (!list.length) return null;
    return poiTarget(list[(Math.random() * list.length) | 0]);
  }

  private newJob(kind: JobKind): boolean {
    const [cx, cy] = [this.car.x, this.car.y];
    const r = this.nav.router;
    for (let attempt = 0; attempt < 12; attempt++) {
      let pickup: Target | null;
      let dest: Target | null;
      let who: string;
      if (kind === 'taxi') {
        pickup = this.randomAddressNear(cx, cy, 120, 600);
        if (!pickup) continue;
        dest = Math.random() < 0.55 ? this.randomPoiNear(pickup.x, pickup.y, 900, 4500, TAXI_DEST_CATS) : this.randomAddressNear(pickup.x, pickup.y, 900, 4500);
        who = FIRST[(Math.random() * FIRST.length) | 0];
      } else {
        pickup = this.randomPoiNear(cx, cy, 150, 1000, new Set(['food']));
        if (!pickup) continue;
        dest = this.randomAddressNear(pickup.x, pickup.y, 700, 3200);
        who = pickup.label;
      }
      if (!dest || dest.lane === pickup.lane) continue;
      const trip = r.route(pickup.lane, pickup.s, dest.lane, dest.s);
      // keine Riesenumwege (Fluss, Bahn) und keine Mini-Fahrten
      if (!trip || trip.length < 400 || trip.length > (kind === 'taxi' ? 7000 : 5000)) continue;
      const job: Job = {
        kind,
        phase: 'pickup',
        pickup,
        dest,
        who,
        tripLen: trip.length,
        tripTime: trip.time,
        startedAt: 0,
        deadline: 0,
        crashes: 0,
        reds: 0,
        stopTimer: 0,
      };
      if (!this.nav.setTarget(pickup)) continue;
      this.job = job;
      this.hud.message(kind === 'taxi' ? `Fahrgast wartet: ${pickup.label}` : `Abholen bei ${pickup.label}`, 2.5);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ Ablauf

  update(dt: number): void {
    const job = this.job;
    if (!job) {
      this.ui.setJob(this.onDuty ? '<b>Suche Auftrag …</b>' : null);
      if (this.onDuty) {
        this.nextTimer -= dt;
        if (this.nextTimer <= 0) {
          this.nextTimer = 3;
          this.newJob(this.onDuty);
        }
      }
      return;
    }
    const t = this.now();
    const target = job.phase === 'pickup' ? job.pickup : job.dest;
    const tp = this.nav.targetPoint(target);
    const dist = Math.hypot(tp[0] - this.car.x, tp[1] - this.car.y);
    const speedKmh = Math.abs(this.car.speed) * 3.6;
    const needStop = job.kind === 'taxi' ? 4 : 10;
    if (dist < 11 && speedKmh < needStop) job.stopTimer += dt;
    else job.stopTimer = 0;
    const arrived = job.stopTimer > (job.kind === 'taxi' ? 0.8 : 0.2);
    if (dist < 30 && speedKmh >= needStop && (this.hintTimer -= dt) <= 0) {
      this.hintTimer = 2.5;
      this.hud.message(job.kind === 'taxi' ? 'Anhalten!' : 'Langsamer – hier abgeben', 1.2);
    }

    if (job.phase === 'pickup' && arrived) {
      job.phase = 'deliver';
      job.startedAt = t;
      job.deadline = t + job.tripTime * 1.35 + 30;
      job.stopTimer = 0;
      this.nav.setTarget(job.dest);
      this.hud.message(job.kind === 'taxi' ? `${job.who} steigt ein – nach ${job.dest.label}` : `Bestellung abgeholt – nach ${job.dest.label}`, 2.5);
    } else if (job.phase === 'deliver' && arrived) {
      this.finish(job, t);
      return;
    } else if (job.kind === 'courier' && job.phase === 'deliver' && t > job.deadline) {
      this.ui.showToast(`<b>Zu spät!</b><br>Die Bestellung von ${esc(job.who)} ist kalt. Kein Geld.`, 4);
      this.job = null;
      this.nav.setTarget(null);
      this.nextTimer = 4;
      return;
    }
    this.renderJob(job, t);
  }

  private finish(job: Job, t: number): void {
    const km = job.tripLen / 1000;
    const used = t - job.startedAt;
    let pay: number;
    let lines: string[];
    if (job.kind === 'taxi') {
      const fare = 4.9 + 2.5 * km;
      // Trinkgeld: bis 20 %, weniger bei Verspätung, Unfällen und Rotlicht
      const ratio = used / Math.max(30, job.tripTime);
      let tipPct = ratio <= 1 ? 0.2 : Math.max(0, 0.2 * (1 - (ratio - 1) / 0.6));
      tipPct -= job.crashes * 0.1 + job.reds * 0.1;
      const tip = Math.max(0, fare * tipPct);
      pay = fare + tip;
      lines = [`Fahrpreis ${formatEuro(fare)} (${km.toFixed(1).replace('.', ',')} km)`, `Trinkgeld ${formatEuro(tip)}`];
      if (job.crashes) lines.push(`${job.crashes}× Blechschaden – ${job.who} war nicht begeistert`);
      if (job.reds) lines.push(`${job.reds}× über Rot`);
    } else {
      const base = 5 + 1.6 * km;
      const left = job.deadline - t;
      const bonus = Math.max(0, Math.min(4, left / 15));
      const damage = Math.min(base, job.crashes * 1.5);
      pay = Math.max(0, base + bonus - damage);
      lines = [`Lieferung ${formatEuro(base)}`, `Zeitbonus ${formatEuro(bonus)}`];
      if (damage) lines.push(`Ware beschädigt −${formatEuro(damage)}`);
    }
    this.money += pay;
    this.completed++;
    this.save();
    this.ui.setMoney(this.money);
    this.ui.showToast(`<b>${job.kind === 'taxi' ? 'Fahrt beendet' : 'Geliefert'}: +${formatEuro(pay)}</b><br>${lines.map(esc).join('<br>')}`, 4.5);
    this.job = null;
    this.nav.setTarget(null);
    this.nextTimer = 3;
  }

  private renderJob(job: Job, t: number): void {
    const title = job.kind === 'taxi' ? '🚕 Taxi' : '📦 Kurier';
    const rows: string[] = [`<div class="job-title">${title}</div>`];
    if (job.phase === 'pickup') {
      rows.push(job.kind === 'taxi' ? `Fahrgast abholen: <b>${esc(job.who)}</b>` : `Abholen bei <b>${esc(job.pickup.label)}</b>`);
      rows.push(`<span class="muted">${esc(job.kind === 'taxi' ? job.pickup.label : '')}</span>`);
      rows.push(`danach ${formatDist(job.tripLen)} nach ${esc(job.dest.label)}`);
    } else {
      rows.push(`Ziel: <b>${esc(job.dest.label)}</b>`);
      const used = t - job.startedAt;
      if (job.kind === 'taxi') {
        const fare = 4.9 + 2.5 * (Math.max(0, job.tripLen - this.nav.remaining) / 1000);
        rows.push(`Taxameter <b>${formatEuro(fare)}</b> · Fahrzeit ${formatTime(used)}`);
      } else {
        const left = job.deadline - t;
        rows.push(`Zeit <b class="${left < 30 ? 'warn' : ''}">${formatTime(left)}</b>`);
      }
      if (job.crashes || job.reds) rows.push(`<span class="warn">${job.crashes ? job.crashes + '× Unfall ' : ''}${job.reds ? job.reds + '× Rot' : ''}</span>`);
    }
    rows.push(`<span class="muted">X beendet den Dienst</span>`);
    this.ui.setJob(rows.join('<br>'));
  }
}

function inRange(dx: number, dy: number, a: number, b: number): boolean {
  const d = Math.hypot(dx, dy);
  return d >= a && d <= b;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
