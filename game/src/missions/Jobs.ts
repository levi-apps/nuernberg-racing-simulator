/**
 * Jobs zum Geldverdienen – als Marker in der Stadt (hinfahren, anhalten, Job startet).
 *
 * Arten: Taxi, Essenslieferung, Paket-Express, Umzug (Transporter), VIP (Oberklasse),
 * Straßenrennen, Buslinie (Bus), Abschleppdienst (Abschleppwagen), Fahrzeug-Überführung.
 * Bezahlung richtet sich nach der geplanten Fahrzeit (€ je Minute je Job-Art), siehe RATE.
 */
import * as THREE from 'three';
import type { BusFile, Poi } from '@nrs/shared';
import { Car } from '../drive/Car.ts';
import { CarMesh } from '../drive/CarMesh.ts';
import type { Hud } from '../drive/Hud.ts';
import { CAP_TEXT, carById, CARS, type Cap } from '../garage/Cars.ts';
import type { Profile } from '../garage/Profile.ts';
import { addressCount, addressTarget, poiTarget, type NavData, type Target } from '../nav/NavData.ts';
import type { Navigator } from '../nav/Navigator.ts';
import type { MarkerLayer, MarkerSpec } from './Markers.ts';
import { formatDist, formatEuro, formatTime, type MissionUi } from './MissionUi.ts';
import { RacePath, RaceRivals } from './Race.ts';

export type JobKind = 'taxi' | 'food' | 'express' | 'moving' | 'vip' | 'race' | 'bus' | 'tow' | 'transfer';

interface KindDef {
  icon: string;
  title: string;
  color: number;
  /** Verdienst € je Minute geplanter Fahrzeit */
  rate: number;
  needs?: Cap;
}

export const KINDS: Record<JobKind, KindDef> = {
  taxi: { icon: '🚕', title: 'Taxi', color: 0xf5c400, rate: 8 },
  food: { icon: '🍕', title: 'Essen liefern', color: 0xe8701a, rate: 8 },
  express: { icon: '📦', title: 'Paket-Express', color: 0xa0703c, rate: 9 },
  transfer: { icon: '🔑', title: 'Überführung', color: 0x27a35a, rate: 10 },
  moving: {
    icon: '🛋️',
    title: 'Umzug',
    color: 0x8e44ad,
    rate: 13,
    needs: 'cargo',
  },
  bus: {
    icon: '🚌',
    title: 'Buslinie',
    color: 0x2b6fd6,
    rate: 11,
    needs: 'bus',
  },
  tow: {
    icon: '🪝',
    title: 'Abschleppen',
    color: 0xff8a00,
    rate: 14,
    needs: 'tow',
  },
  vip: {
    icon: '🎩',
    title: 'VIP-Fahrt',
    color: 0x222222,
    rate: 18,
    needs: 'premium',
  },
  race: { icon: '🏁', title: 'Straßenrennen', color: 0xe0262f, rate: 0 },
};

interface Offer {
  id: string;
  kind: JobKind;
  at: Target;
  dest: Target;
  /** geplante Fahrzeit (s) und Strecke (m) vom Start zum Ziel */
  time: number;
  len: number;
  pay: number;
  who: string;
  expires: number;
  /** Buslinie: Haltestellen ab Start */
  stops?: Target[];
  line?: string;
}

interface Active {
  offer: Offer;
  startedAt: number;
  deadline: number;
  crashes: number;
  reds: number;
  stopTimer: number;
  /** Bus: nächste Haltestelle, Plan-Ankunftszeiten */
  stopIdx: number;
  plan: number[];
  late: number;
  /** Rennen */
  race?: {
    rivals: RaceRivals;
    path: RacePath;
    checkpoints: number[];
    next: number;
    startAt: number;
    stake: number;
  };
  /** Abschleppen: angehängtes Auto */
  towed?: CarMesh;
  /** Überführung: Kundenauto */
  transferCar?: string;
}

const NAMES = [
  'Frau Huber',
  'Herr Meier',
  'Frau Schmidt',
  'Herr Bauer',
  'Frau Wagner',
  'Herr Fischer',
  'Frau Koch',
  'Herr Richter',
  'Frau Hoffmann',
  'Herr Schuster',
  'Frau Lang',
  'Herr Kraus',
  'Frau Lehmann',
  'Herr Brandl',
  'Frau Roth',
];
const VIPS = ['Dr. von Stetten', 'Frau Konsulin Ahrens', 'Herr Direktor Pröll', 'Frau Prof. Weidinger', 'Graf Egloffstein', 'Herr Bürgermeister a. D. Zink'];
const MAX_OFFERS = 12;
const OFFER_RANGE = 850;

export interface JobHooks {
  /** Auto wechseln (temporär = Überführung) */
  setCar(id: string, color: number): void;
  /** eigenes Auto wieder nehmen */
  restoreCar(): void;
  openGarage(dealer: string | null): void;
  money(): void;
}

export class JobSystem {
  offers: Offer[] = [];
  job: Active | null = null;
  dealers: Poi[];
  private nextId = 1;
  private genTimer = 0;
  private stopTimer = 0;
  private hint = '';
  private hintTimer = 0;
  private dealerCooldown = 0;
  private lastNear = '';

  constructor(
    private data: NavData,
    private bus: BusFile,
    private nav: Navigator,
    private car: Car,
    private ui: MissionUi,
    private hud: Hud,
    private profile: Profile,
    private markers: MarkerLayer,
    private scene: THREE.Scene,
    private now: () => number,
    private hooks: JobHooks,
    private use3d: () => boolean,
  ) {
    this.dealers = data.pois.filter((p) => p.c === 'shop' && p.t === 'car');
  }

  // ------------------------------------------------------------- Angebote erzeugen

  private randAddr(x: number, y: number, r0: number, r1: number): Target | null {
    const d = this.data;
    const n = addressCount(d);
    const a = d.addr.a;
    for (let i = 0; i < 3000; i++) {
      const k = (Math.random() * n) | 0;
      const dist = Math.hypot(a[k * 5 + 1] / 10 - x, a[k * 5 + 2] / 10 - y);
      if (dist >= r0 && dist <= r1) return addressTarget(d, k);
    }
    return null;
  }

  private randPoi(x: number, y: number, r0: number, r1: number, test: (p: Poi) => boolean): Target | null {
    const list = this.data.pois.filter((p) => test(p) && inRange(p.x / 10 - x, p.y / 10 - y, r0, r1));
    return list.length ? poiTarget(list[(Math.random() * list.length) | 0]) : null;
  }

  private makeOffer(kind: JobKind): Offer | null {
    const cx = this.car.x;
    const cy = this.car.y;
    let at: Target | null = null;
    let dest: Target | null = null;
    let who = '';
    let stops: Target[] | undefined;
    let line: string | undefined;
    const food = (p: Poi) => p.c === 'food';
    switch (kind) {
      case 'taxi':
        at = this.randAddr(cx, cy, 120, OFFER_RANGE);
        if (at)
          dest =
            Math.random() < 0.5
              ? this.randPoi(at.x, at.y, 900, 4500, (p) => ['station', 'hotel', 'culture', 'food', 'health', 'office'].includes(p.c))
              : this.randAddr(at.x, at.y, 900, 4500);
        who = pick(NAMES);
        break;
      case 'food':
        at = this.randPoi(cx, cy, 120, OFFER_RANGE, food);
        if (at) dest = this.randAddr(at.x, at.y, 700, 3200);
        who = at?.label ?? '';
        break;
      case 'express':
        at = this.randPoi(cx, cy, 120, OFFER_RANGE, (p) => (p.c === 'shop' && p.t !== 'car' && p.t !== 'car_repair') || p.c === 'office');
        if (at) dest = this.randAddr(at.x, at.y, 1000, 4000);
        who = at?.label ?? '';
        break;
      case 'moving':
        at = Math.random() < 0.5 ? this.randPoi(cx, cy, 120, OFFER_RANGE, (p) => p.t === 'furniture' || p.t === 'doityourself' || p.t === 'hardware') : null;
        at ??= this.randAddr(cx, cy, 120, OFFER_RANGE);
        if (at) dest = this.randAddr(at.x, at.y, 1500, 5000);
        who = pick(NAMES);
        break;
      case 'vip':
        at = this.randPoi(cx, cy, 120, OFFER_RANGE * 1.3, (p) => p.c === 'hotel') ?? this.randPoi(cx, cy, 120, OFFER_RANGE, (p) => p.c === 'station');
        if (at) dest = this.randPoi(at.x, at.y, 1500, 6000, (p) => ['culture', 'station', 'office', 'hotel'].includes(p.c) || (p.c === 'food' && p.t === 'restaurant'));
        who = pick(VIPS);
        break;
      case 'tow':
        at = this.randAddr(cx, cy, 150, OFFER_RANGE);
        if (at) dest = this.randPoi(at.x, at.y, 800, 4500, (p) => p.t === 'car_repair');
        who = 'Pannenfahrzeug';
        break;
      case 'transfer':
        at = this.randPoi(cx, cy, 120, OFFER_RANGE * 1.4, (p) => p.t === 'car');
        if (at) {
          // Abholung etwas neben dem Autohaus-Marker, damit beide getrennt anfahrbar sind
          const len = this.data.graph.len[at.lane];
          const s = at.s + 35 < len ? at.s + 35 : Math.max(0, at.s - 35);
          if (Math.abs(s - at.s) < 20) at = null;
          else {
            const p = this.nav.targetPoint({ ...at, s });
            at = { ...at, s, x: p[0], y: p[1], label: `${at.label} (Hof)` };
          }
        }
        if (at) dest = this.randAddr(at.x, at.y, 1500, 5000);
        who = at?.label ?? '';
        break;
      case 'race': {
        // Start auf einer größeren Straße in der Nähe, Ziel 2–4 km entfernt
        at = this.randAddr(cx, cy, 150, OFFER_RANGE);
        if (at) dest = this.randAddr(at.x, at.y, 1800, 3500);
        who = 'Straßenrennen';
        break;
      }
      case 'bus': {
        const cands: Array<{ li: number; si: number }> = [];
        this.bus.lines.forEach((l, li) =>
          l.stops.forEach((st, si) => {
            if (si <= l.stops.length - 6 && inRange(st.x / 10 - cx, st.y / 10 - cy, 100, OFFER_RANGE)) cands.push({ li, si });
          }),
        );
        if (!cands.length) return null;
        const c = cands[(Math.random() * cands.length) | 0];
        const l = this.bus.lines[c.li];
        const n = Math.min(l.stops.length - c.si, 5 + ((Math.random() * 4) | 0));
        stops = l.stops.slice(c.si, c.si + n).map((st) => ({
          label: st.n,
          x: st.x / 10,
          y: st.y / 10,
          lane: st.l,
          s: st.s / 10,
        }));
        at = stops[0];
        dest = stops[stops.length - 1];
        line = l.ref;
        who = `Linie ${l.ref}`;
        break;
      }
    }
    if (!at || !dest || at.lane === dest.lane) return null;
    // Gesamtfahrt planen (bei Bus über alle Haltestellen)
    let time = 0;
    let len = 0;
    const legs = stops ?? [at, dest];
    for (let i = 1; i < legs.length; i++) {
      const r = this.nav.router.route(legs[i - 1].lane, legs[i - 1].s, legs[i].lane, legs[i].s);
      if (!r) return null;
      time += r.time;
      len += r.length;
    }
    if (len < 500 || len > 9000) return null;
    const minutes = time / 60 + (kind === 'bus' ? legs.length * 0.33 : 0.6);
    const pay = kind === 'race' ? this.raceStake() * 2.2 : KINDS[kind].rate * minutes;
    return {
      id: `j${this.nextId++}`,
      kind,
      at,
      dest,
      time,
      len,
      pay,
      who,
      expires: this.now() + 300 + Math.random() * 240,
      stops,
      line,
    };
  }

  raceStake(): number {
    return Math.round(10 + this.profile.car.price * 0.02);
  }

  private refreshOffers(): void {
    const t = this.now();
    this.offers = this.offers.filter((o) => o.expires > t && Math.hypot(o.at.x - this.car.x, o.at.y - this.car.y) < OFFER_RANGE * 1.5);
    const kinds: JobKind[] = ['taxi', 'taxi', 'food', 'express', 'transfer', 'moving', 'vip', 'tow', 'bus', 'race', 'food', 'taxi'];
    let tries = 0;
    while (this.offers.length < MAX_OFFERS && tries++ < 8) {
      // jede Art möglichst einmal vertreten
      const missing = kinds.filter((k) => !this.offers.some((o) => o.kind === k));
      const kind = missing.length ? missing[(Math.random() * missing.length) | 0] : kinds[(Math.random() * kinds.length) | 0];
      const o = this.makeOffer(kind);
      if (o && !this.offers.some((x) => Math.hypot(x.at.x - o.at.x, x.at.y - o.at.y) < 40)) this.offers.push(o);
    }
  }

  private markerSpecs(): MarkerSpec[] {
    const specs: MarkerSpec[] = [];
    if (!this.job) {
      for (const o of this.offers) {
        const k = KINDS[o.kind];
        const locked = !!k.needs && !this.profile.has(k.needs);
        const p = this.nav.targetPoint(o.at);
        const payTxt = o.kind === 'race' ? `Einsatz ${formatEuro(this.raceStake())}` : `~${formatEuro(o.pay)}`;
        specs.push({
          id: o.id,
          x: p[0],
          y: p[1],
          color: k.color,
          icon: k.icon,
          text: `${k.title} · ${payTxt}`,
          locked,
        });
      }
    }
    // Autohäuser in der Nähe
    const near = this.dealers
      .map((d) => ({
        d,
        dist: Math.hypot(d.x / 10 - this.car.x, d.y / 10 - this.car.y),
      }))
      .filter((e) => e.dist < 1600)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 6);
    for (const { d } of near) {
      const p = this.nav.targetPoint(poiTarget(d));
      if (specs.some((m) => Math.hypot(m.x - p[0], m.y - p[1]) < 25)) continue;
      specs.push({
        id: `d${d.l}_${d.s}`,
        x: p[0],
        y: p[1],
        color: 0x1d6fe0,
        icon: '🚗',
        text: `Autohaus ${d.n}`,
        locked: false,
      });
    }
    return specs;
  }

  // ------------------------------------------------------------- Ablauf

  update(dt: number, active: boolean): void {
    const t = this.now();
    this.genTimer -= dt;
    this.hintTimer -= dt;
    this.dealerCooldown -= dt;
    if (this.genTimer <= 0) {
      this.genTimer = 4;
      if (!this.job) this.refreshOffers();
      this.markers.sync(this.markerSpecs());
    }
    this.markers.update(dt, this.car.x, this.car.y, active);
    if (!active) return;
    if (this.job) this.runJob(dt, t);
    else this.checkMarkers(dt);
    this.ui.setMoney(this.profile.money);
  }

  private say(msg: string, sec = 2): void {
    if (msg === this.hint && this.hintTimer > 0) return;
    this.hint = msg;
    this.hintTimer = sec + 1.5;
    this.hud.message(msg, sec);
  }

  /** Anhalten an einem Marker startet den Job bzw. öffnet das Autohaus */
  private checkMarkers(dt: number): void {
    const slow = Math.abs(this.car.speed) * 3.6 < 8;
    let near: Offer | null = null;
    for (const o of this.offers) {
      const p = this.nav.targetPoint(o.at);
      if (Math.hypot(p[0] - this.car.x, p[1] - this.car.y) < 10) near = o;
    }
    // Autohaus
    let dealer: Poi | null = null;
    for (const d of this.dealers) {
      const p = this.nav.targetPoint(poiTarget(d));
      if (Math.hypot(p[0] - this.car.x, p[1] - this.car.y) < 14) dealer = d;
    }
    if (dealer && near) dealer = null; // Job-Marker hat Vorrang (Überführung startet am Autohaus)
    if (dealer && slow) {
      if (this.dealerCooldown <= 0 && this.lastNear !== dealer.n) {
        this.lastNear = dealer.n;
        this.hooks.openGarage(dealer.n);
      }
    } else if (!dealer) this.lastNear = '';
    if (!near) {
      this.stopTimer = 0;
      this.ui.setJob(null);
      return;
    }
    const k = KINDS[near.kind];
    if (k.needs && !this.profile.has(k.needs)) {
      const car = CARS.find((c) => c.caps.includes(k.needs!));
      this.ui.setJob(
        `<div class="job-title">${k.icon} ${k.title}</div>🔒 Braucht ein Fahrzeug für <b>${CAP_TEXT[k.needs]}</b>${car ? `<br>z. B. ${car.name} (${formatEuro(car.price)}) im Autohaus` : ''}`,
      );
      return;
    }
    this.ui.setJob(`<div class="job-title">${k.icon} ${k.title}</div>${this.describe(near)}<br><span class="muted">Anhalten zum Starten</span>`);
    if (!slow) {
      this.stopTimer = 0;
      return;
    }
    this.stopTimer += dt;
    if (this.stopTimer > 0.6) this.start(near);
  }

  private describe(o: Offer): string {
    const km = formatDist(o.len);
    switch (o.kind) {
      case 'taxi':
        return `${esc(o.who)} möchte nach <b>${esc(o.dest.label)}</b> (${km}) · ~${formatEuro(o.pay)}`;
      case 'food':
        return `Bestellung von <b>${esc(o.who)}</b> nach ${esc(o.dest.label)} (${km}) · ~${formatEuro(o.pay)}`;
      case 'express':
        return `Paket von ${esc(o.who)} nach <b>${esc(o.dest.label)}</b> (${km}), knappe Zeit · ~${formatEuro(o.pay)}`;
      case 'moving':
        return `Umzug für ${esc(o.who)} nach <b>${esc(o.dest.label)}</b> (${km}) · ~${formatEuro(o.pay)}`;
      case 'vip':
        return `${esc(o.who)} nach <b>${esc(o.dest.label)}</b> (${km}) · ~${formatEuro(o.pay)} + Trinkgeld`;
      case 'tow':
        return `Panne! Zur Werkstatt <b>${esc(o.dest.label)}</b> (${km}) · ~${formatEuro(o.pay)}`;
      case 'transfer':
        return `Kundenauto von ${esc(o.who)} unbeschädigt nach <b>${esc(o.dest.label)}</b> (${km}) · ~${formatEuro(o.pay)}`;
      case 'bus':
        return `<b>Linie ${esc(o.line ?? '')}</b>: ${o.stops?.length} Haltestellen bis ${esc(o.dest.label)} (${km}) · ~${formatEuro(o.pay)}`;
      case 'race':
        return `Gegen 3 Gegner nach <b>${esc(o.dest.label)}</b> (${km}) · Einsatz ${formatEuro(this.raceStake())}, Sieg ${formatEuro(this.raceStake() * 2.2)}`;
    }
  }

  private start(o: Offer): void {
    const t = this.now();
    const job: Active = {
      offer: o,
      startedAt: t,
      deadline: Infinity,
      crashes: 0,
      reds: 0,
      stopTimer: 0,
      stopIdx: 1,
      plan: [],
      late: 0,
    };
    this.offers = this.offers.filter((x) => x !== o);
    switch (o.kind) {
      case 'food':
        job.deadline = t + o.time * 1.35 + 30;
        break;
      case 'express':
        job.deadline = t + o.time * 1.15 + 20;
        break;
      case 'moving':
        job.deadline = t + o.time * 2 + 60;
        break;
      case 'tow': {
        job.towed = new CarMesh(new Car(), 0x9aa0a6, 'compact');
        job.towed.set3D(this.use3d());
        this.scene.add(job.towed.group, job.towed.group3d);
        break;
      }
      case 'transfer': {
        const premium = CARS.filter((c) => c.price >= 600 && !c.caps.includes('bus') && !c.caps.includes('tow'));
        const m = premium[(Math.random() * premium.length) | 0];
        job.transferCar = m.id;
        this.hooks.setCar(m.id, pick([0x1c1c1c, 0xf2f2f2, 0x9aa0a6, 0x1f4e8c, 0x8c1c1c]));
        break;
      }
      case 'bus': {
        // Fahrplan: Ankunft je Haltestelle nach geplanter Fahrzeit + Haltezeit
        let acc = t;
        job.plan = [t];
        const st = o.stops!;
        for (let i = 1; i < st.length; i++) {
          const r = this.nav.router.route(st[i - 1].lane, st[i - 1].s, st[i].lane, st[i].s);
          acc += (r?.time ?? 60) * 1.25 + 20;
          job.plan.push(acc);
        }
        break;
      }
      case 'race': {
        const stake = this.raceStake();
        if (this.profile.money < stake) {
          this.say(`Für den Einsatz fehlen dir ${formatEuro(stake - this.profile.money)}`, 2.5);
          return;
        }
        this.profile.money -= stake;
        this.profile.save();
        break;
      }
    }
    this.job = job;
    this.markers.sync(this.markerSpecs());
    const target = o.kind === 'bus' ? o.stops![1] : o.dest;
    this.nav.setTarget(target);
    if (o.kind === 'race') {
      // Rennstrecke = berechnete Route
      const path = new RacePath(this.nav.path.map((p) => [p[0], p[1]] as [number, number]));
      const rivals = new RaceRivals(this.scene, path);
      rivals.spawn(3, this.profile.car.spec.maxSpeed, this.profile.car.spec.accel, this.use3d());
      const checkpoints: number[] = [];
      for (let s = 350; s < path.length - 100; s += 350) checkpoints.push(s);
      checkpoints.push(path.length);
      job.race = {
        rivals,
        path,
        checkpoints,
        next: 0,
        startAt: t + 3.5,
        stake: this.raceStake(),
      };
      this.say('3 … 2 … 1 …', 3);
      return;
    }
    const msg = (): string => {
      switch (o.kind) {
        case 'taxi':
          return `${o.who} steigt ein – nach ${o.dest.label}`;
        case 'food':
          return `Bestellung abgeholt – nach ${o.dest.label}`;
        case 'express':
          return `Paket geladen – schnell nach ${o.dest.label}!`;
        case 'moving':
          return `Möbel geladen – vorsichtig nach ${o.dest.label}`;
        case 'vip':
          return `${o.who} steigt ein. Bitte sanft fahren.`;
        case 'tow':
          return `Pannenauto angehängt – zur Werkstatt ${o.dest.label}`;
        case 'transfer':
          return `Kundenauto übernommen (${carById(job.transferCar!).name}) – bitte ohne Kratzer!`;
        case 'bus':
          return `Linie ${o.line}: nächste Haltestelle ${o.stops![1].label}`;
        default:
          return '';
      }
    };
    this.say(msg(), 2.5);
  }

  cancel(): void {
    const j = this.job;
    if (!j) return;
    this.cleanup(j);
    this.job = null;
    this.nav.setTarget(null);
    this.say('Job abgebrochen', 1.5);
    this.markers.sync(this.markerSpecs());
  }

  private cleanup(j: Active): void {
    if (j.towed) {
      this.scene.remove(j.towed.group, j.towed.group3d);
      j.towed.dispose();
    }
    j.race?.rivals.dispose();
    if (j.transferCar) this.hooks.restoreCar();
  }

  onCrash(speed: number): void {
    if (this.job && speed > 3) this.job.crashes++;
  }

  onRedLight(): void {
    if (this.job) this.job.reds++;
  }

  private arrived(target: Target, dt: number, maxKmh: number, hold: number): boolean {
    const p = this.nav.targetPoint(target);
    const d = Math.hypot(p[0] - this.car.x, p[1] - this.car.y);
    const kmh = Math.abs(this.car.speed) * 3.6;
    if (d < 12 && kmh < maxKmh) this.job!.stopTimer += dt;
    else this.job!.stopTimer = 0;
    if (d < 35 && kmh >= maxKmh) this.say(this.job!.offer.kind === 'bus' ? 'Haltestelle – anhalten' : 'Ziel – anhalten', 1.2);
    return this.job!.stopTimer > hold;
  }

  private runJob(dt: number, t: number): void {
    const j = this.job!;
    const o = j.offer;
    if (j.towed) this.updateTow(j.towed);
    if (o.kind === 'race') return this.runRace(dt, t);
    if (o.kind === 'bus') return this.runBus(dt, t);
    if (t > j.deadline) {
      if (o.kind === 'moving') {
        // Umzug: verspätet gibt es die Hälfte
        j.deadline = Infinity;
        j.late = 1;
        this.say('Zu spät – der Kunde zahlt nur noch die Hälfte', 2.5);
      } else {
        this.finish(0, [`Zu spät! ${o.kind === 'food' ? 'Das Essen ist kalt.' : 'Die Sendung wurde storniert.'}`], 'Zu spät');
        return;
      }
    }
    if (o.kind === 'transfer' && j.crashes >= 4) {
      this.finish(0, ['Das Kundenauto ist hinüber – kein Geld.'], 'Auftrag verloren');
      return;
    }
    const hold = o.kind === 'moving' ? 2.5 : o.kind === 'taxi' || o.kind === 'vip' ? 0.8 : 0.3;
    if (this.arrived(o.dest, dt, o.kind === 'taxi' || o.kind === 'vip' ? 4 : 10, hold)) {
      this.complete(t);
      return;
    }
    this.renderJob(t);
  }

  private complete(t: number): void {
    const j = this.job!;
    const o = j.offer;
    const used = t - j.startedAt;
    const ratio = used / Math.max(30, o.time);
    let pay = o.pay;
    const lines: string[] = [];
    switch (o.kind) {
      case 'taxi': {
        let tip = ratio <= 1.1 ? 0.2 : Math.max(0, 0.2 * (1 - (ratio - 1.1) / 0.6));
        if (this.profile.has('premium')) tip *= 1.5;
        tip -= j.crashes * 0.1 + j.reds * 0.1;
        lines.push(`Fahrpreis ${formatEuro(pay)}`, `Trinkgeld ${formatEuro(Math.max(0, pay * tip))}`);
        pay += Math.max(0, pay * tip);
        break;
      }
      case 'food':
      case 'express': {
        if (o.kind === 'express') {
          const bonus = this.profile.has('fast') ? 0.5 : this.profile.has('space') ? 0.3 : 0;
          if (bonus) lines.push(`Fahrzeugbonus +${bonus * 100} %`);
          pay *= 1 + bonus;
        }
        const left = j.deadline - t;
        const tb = Math.max(0, Math.min(pay * 0.25, left / 10));
        lines.unshift(`Lieferung ${formatEuro(pay)}`);
        lines.push(`Zeitbonus ${formatEuro(tb)}`);
        pay += tb - j.crashes * 1.5;
        if (j.crashes) lines.push(`Ware beschädigt −${formatEuro(j.crashes * 1.5)}`);
        break;
      }
      case 'moving': {
        const dmg = Math.min(0.9, j.crashes * 0.15);
        lines.push(`Umzug ${formatEuro(pay)}`);
        if (dmg) lines.push(`Möbelschaden −${Math.round(dmg * 100)} %`);
        if (j.late) lines.push('Verspätet: halber Lohn');
        pay *= (1 - dmg) * (j.late ? 0.5 : 1);
        break;
      }
      case 'vip': {
        const smooth = j.crashes === 0 && j.reds === 0;
        const tip = smooth ? 0.4 : 0;
        const dmg = Math.min(1, j.crashes * 0.35 + j.reds * 0.2);
        lines.push(`Honorar ${formatEuro(pay)}`);
        if (smooth) lines.push(`Diskretions-Trinkgeld ${formatEuro(pay * tip)}`);
        if (dmg) lines.push(`${o.who} ist verärgert −${Math.round(dmg * 100)} %`);
        pay *= (1 + tip) * (1 - dmg);
        break;
      }
      case 'tow':
        lines.push(`Abschleppen ${formatEuro(pay)}`);
        break;
      case 'transfer': {
        const dmg = Math.min(1, j.crashes * 0.25);
        lines.push(`Überführung ${formatEuro(pay)}`);
        if (dmg) lines.push(`Kratzer am Kundenauto −${Math.round(dmg * 100)} %`);
        pay *= 1 - dmg;
        break;
      }
    }
    this.finish(Math.max(0, pay), lines, o.kind === 'taxi' || o.kind === 'vip' ? 'Fahrt beendet' : 'Erledigt');
  }

  private finish(pay: number, lines: string[], title: string): void {
    const j = this.job!;
    this.cleanup(j);
    if (pay > 0) this.profile.earn(pay);
    this.ui.showToast(
      `<b>${title}${pay > 0 ? ': +' + formatEuro(pay) : ''}</b><br>${lines.map(esc).join('<br>')}<br><span style="opacity:.75">Kontostand ${formatEuro(this.profile.money)}</span>`,
      4.5,
    );
    this.job = null;
    this.nav.setTarget(null);
    this.ui.setJob(null);
    this.genTimer = 0.5;
    this.hooks.money();
  }

  // ------------------------------------------------------------- Bus

  private runBus(dt: number, t: number): void {
    const j = this.job!;
    const o = j.offer;
    const st = o.stops!;
    const target = st[j.stopIdx];
    if (this.arrived(target, dt, 3, 1.6)) {
      const late = t - j.plan[j.stopIdx];
      if (late > 20) j.late++;
      j.stopTimer = 0;
      j.stopIdx++;
      if (j.stopIdx >= st.length) {
        const punct = 1 - j.late / (st.length - 1);
        const bonus = o.pay * 0.25 * punct;
        const dmg = Math.min(0.8, j.crashes * 0.12);
        this.finish(
          (o.pay + bonus) * (1 - dmg),
          [
            `Linie ${o.line}: ${st.length - 1} Haltestellen`,
            `Pünktlichkeit ${Math.round(punct * 100)} % → +${formatEuro(bonus)}`,
            ...(dmg ? [`Beschwerden −${Math.round(dmg * 100)} %`] : []),
          ],
          'Endhaltestelle',
        );
        return;
      }
      this.nav.setTarget(st[j.stopIdx]);
      this.say(`${late > 20 ? 'Verspätet! ' : ''}Nächster Halt: ${st[j.stopIdx].label}`, 2);
    }
    const next = st[j.stopIdx];
    const due = j.plan[j.stopIdx] - t;
    this.ui.setJob(
      [
        `<div class="job-title">🚌 Linie ${esc(o.line ?? '')}</div>`,
        `Nächster Halt: <b>${esc(next.label)}</b> (${j.stopIdx}/${st.length - 1})`,
        `Plan: ${due >= 0 ? 'in ' + formatTime(due) : '<span class="warn">' + formatTime(-due) + ' zu spät</span>'}`,
        `<span class="muted">An jeder Haltestelle kurz anhalten · X bricht ab</span>`,
      ].join('<br>'),
    );
  }

  // ------------------------------------------------------------- Rennen

  private runRace(dt: number, t: number): void {
    const j = this.job!;
    const r = j.race!;
    const started = t >= r.startAt;
    r.rivals.update(dt, t, started);
    if (!started) {
      this.ui.setJob(`<div class="job-title">🏁 Straßenrennen</div>Start in <b>${Math.ceil(r.startAt - t)}</b> …`);
      return;
    }
    // Fortschritt des Spielers: Projektion auf die Strecke, Kontrollpunkte der Reihe nach
    const cp = r.checkpoints[r.next];
    const p = r.path.at(cp);
    if (Math.hypot(p.x - this.car.x, p.y - this.car.y) < 30) {
      r.next++;
      if (r.next >= r.checkpoints.length) {
        const place = 1 + r.rivals.rivals.filter((x) => x.finished >= 0).length;
        const prize = place === 1 ? r.stake * 2.2 : place === 2 ? r.stake * 1.2 : 0;
        this.finish(
          prize,
          [`Platz ${place} von ${r.rivals.rivals.length + 1}`, `Zeit ${formatTime(t - r.startAt)}`, place > 2 ? `Einsatz ${formatEuro(r.stake)} verloren` : ''].filter(Boolean),
          place === 1 ? 'Sieg!' : `Platz ${place}`,
        );
        return;
      }
      this.say(`Kontrollpunkt ${r.next}/${r.checkpoints.length - 1}`, 1);
    }
    const playerS = r.next > 0 ? r.checkpoints[r.next - 1] : 0;
    const sp = this.progressOnPath(r.path, playerS);
    const ahead = r.rivals.rivals.filter((x) => x.finished >= 0 || x.s > sp).length;
    this.ui.setJob(
      [
        `<div class="job-title">🏁 Straßenrennen</div>`,
        `Position <b>${ahead + 1}</b> von ${r.rivals.rivals.length + 1}`,
        `Kontrollpunkt ${r.next + 1}/${r.checkpoints.length} · ${formatDist(Math.max(0, r.path.length - sp))} bis Ziel`,
        `<span class="muted">Zeit ${formatTime(t - r.startAt)} · Regeln gelten hier nicht (noch)</span>`,
      ].join('<br>'),
    );
  }

  /** Fortschritt des Spielers auf der Strecke (Suche ab letztem Kontrollpunkt) */
  private progressOnPath(path: RacePath, from: number): number {
    let best = from;
    let bd = Infinity;
    for (let s = Math.max(0, from - 50); s <= Math.min(path.length, from + 500); s += 5) {
      const p = path.at(s);
      const d = Math.hypot(p.x - this.car.x, p.y - this.car.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // ------------------------------------------------------------- Abschleppen

  private updateTow(m: CarMesh): void {
    // angehängtes Auto: Vorderachse am Heck des Abschleppwagens, Heck schleift hinterher
    const c = this.car;
    const hx = c.x - Math.cos(c.heading) * (c.spec.length / 2 + 0.6);
    const hy = c.y - Math.sin(c.heading) * (c.spec.length / 2 + 0.6);
    const prev = (m.group.userData.h as number | undefined) ?? c.heading;
    let d = c.heading - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const h = prev + d * 0.08;
    m.group.userData.h = h;
    const L = 4.3;
    const fake = {
      x: hx - Math.cos(h) * (L / 2),
      y: hy - Math.sin(h) * (L / 2),
      heading: h,
      steer: 0,
      braking: false,
      reversing: false,
    } as unknown as Car;
    m.update(fake);
  }

  private renderJob(t: number): void {
    const j = this.job!;
    const o = j.offer;
    const k = KINDS[o.kind];
    const rows = [`<div class="job-title">${k.icon} ${k.title}</div>`, `Ziel: <b>${esc(o.dest.label)}</b>`];
    if (j.deadline < Infinity) {
      const left = j.deadline - t;
      rows.push(`Zeit <b class="${left < 30 ? 'warn' : ''}">${formatTime(left)}</b>`);
    } else rows.push(`Fahrzeit ${formatTime(t - j.startedAt)}`);
    if (o.kind === 'taxi') rows.push(`Taxameter ~${formatEuro(o.pay * Math.min(1, Math.max(0, 1 - this.nav.remaining / Math.max(1, o.len))))}`);
    if (j.crashes || j.reds) rows.push(`<span class="warn">${j.crashes ? j.crashes + '× Unfall ' : ''}${j.reds ? j.reds + '× Rot' : ''}</span>`);
    rows.push('<span class="muted">X bricht ab</span>');
    this.ui.setJob(rows.join('<br>'));
  }

  /** nächstes Autohaus (für die Navigation aus der Garage) */
  nearestDealer(): Poi | null {
    let best: Poi | null = null;
    let bd = Infinity;
    for (const d of this.dealers) {
      const dist = Math.hypot(d.x / 10 - this.car.x, d.y / 10 - this.car.y);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  /** Garage geschlossen: nicht sofort erneut öffnen */
  garageClosed(): void {
    this.dealerCooldown = 6;
  }
}

function pick<T>(a: T[]): T {
  return a[(Math.random() * a.length) | 0];
}

function inRange(dx: number, dy: number, a: number, b: number): boolean {
  const d = Math.hypot(dx, dy);
  return d >= a && d <= b;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
