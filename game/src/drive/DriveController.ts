/**
 * Fahrmodus: verbindet Auto, Eingabe, Welt-Abfragen, Kamera und HUD.
 */
import { Car } from './Car.ts';
import { CarMesh } from './CarMesh.ts';
import { Hud } from './Hud.ts';
import { Input } from './Input.ts';
import { WorldQuery } from './WorldQuery.ts';
import { DriveFx } from './DriveFx.ts';
import { CarDamage } from './CarDamage.ts';
import type { StreetLife } from '../world/StreetLife.ts';
import { projectOnPolyline, type WorldView } from '../world/WorldView.ts';
import type { Lane } from '@nrs/shared';
import type { TrafficSim } from '../traffic/TrafficSim.ts';
import type { CarSpec } from './Car.ts';
import type { Body } from '../garage/Cars.ts';

const PHYS_DT = 1 / 120;

export class DriveController {
  car = new Car();
  mesh: CarMesh;
  input = new Input();
  hud = new Hud();
  query: WorldQuery;
  active = true;
  /** Kamera dreht mit dem Auto (sonst Norden oben) */
  rotateCamera = false;
  /** 3D-Verfolgerkamera */
  view3D = false;
  private camHeading = 0;
  /** Blickwinkel relativ zur Fahrtrichtung (Zurückschauen mit B) */
  lookAngle = 0;
  /** freie Kamera (für Fotos) */
  camOverride: { pos: [number, number, number]; target: [number, number, number] } | null = null;
  /** Kamerawackeln 0..1 (nach Aufprall) */
  shake = 0;
  private lastHandbrake = false;
  private lastBrake = 0;
  private camSpeed = 0;
  onView3D?: (on: boolean) => void;
  private acc = 0;
  private infoTimer = 0;
  private camVX = 0;
  private camVY = 0;
  private zoomUser = 1;
  private spawned = false;
  private outsideWarned = false;
  private lastImpact = 0;
  currentLane: Lane | null = null;
  /** Nitro: Vorrat und aktueller Stand in Sekunden */
  nitroCap = 0;
  nitro = 0;
  infiniteNitro = false;
  /** Admin: keine Kollisionen mit Gebäuden und Verkehr */
  ghost = false;
  traffic?: TrafficSim;
  streetLife?: StreetLife;
  /** wird aufgerufen, wenn das Auto weit versetzt wird */
  onTeleport?: () => void;
  /** Aufprall (Gebäude oder Fahrzeug) mit Geschwindigkeit in m/s */
  onImpact?: (speed: number) => void;
  get spawnedOk(): boolean {
    return this.spawned;
  }

  fx: DriveFx;
  damage: CarDamage;
  private wreckWarned = false;
  private body: Body | null = null;
  private lastRegion = '';
  constructor(private view: WorldView) {
    this.fx = new DriveFx(view.scene);
    this.damage = new CarDamage(view.scene);
    this.mesh = new CarMesh(this.car);
    this.query = new WorldQuery(view);
    view.scene.add(this.mesh.group, this.mesh.group3d);
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        this.zoomUser = Math.min(3, Math.max(0.4, this.zoomUser * Math.exp(e.deltaY * 0.0012)));
      },
      { passive: true },
    );
  }

  init(): void {
    this.query.init();
  }

  /** Auto auf die nächstgelegene Spur des Hauptnetzes setzen */
  spawnNear(x: number, y: number): boolean {
    const hit = this.view.nearestLane(x, y, 400, true);
    if (!hit) return false;
    this.putOnLane(hit.lane, hit.s);
    return true;
  }

  putOnLane(lane: Lane, s: number): void {
    const p = pointAtLane(lane, Math.min(Math.max(s, 2), Math.max(2, lane.len - 2)));
    if (Math.hypot(p.x - this.car.x, p.y - this.car.y) > 250) this.onTeleport?.();
    this.car.place(p.x, p.y, Math.atan2(p.dy, p.dx));
    this.car.layer = lane.layer;
    this.spawned = true;
    this.view.anchor = [p.x, p.y];
  }

  setActive(a: boolean): void {
    this.active = a;
    this.input.enabled = a;
    this.hud.visible = a;
    this.view.setMode(a ? 'drive' : 'map');
    if (!a) this.view.rot = Math.PI / 2;
    this.mesh.set3D(a && this.view3D);
  }

  /** Startposition: gewünschter Ort, sobald die Kacheln dort geladen sind */
  private pendingSpawn: [number, number] | null = null;
  requestSpawn(x: number, y: number): void {
    this.pendingSpawn = [x, y];
    this.spawned = false;
    this.view.anchor = [x, y];
    this.view.focus(x, y);
  }

  update(dt: number): void {
    const v = this.view;
    if (this.pendingSpawn) {
      const [x, y] = this.pendingSpawn;
      this.hud.setLoading(true);
      if (v.isReady(x, y) && v.tilesAround(x, y, 300).length >= 4) {
        if (this.spawnNear(x, y)) this.pendingSpawn = null;
      }
      if (this.pendingSpawn) return;
    }
    const car = this.car;
    v.anchor = [car.x, car.y];
    const ready = v.isReady(car.x, car.y);
    this.hud.setLoading(!ready);

    if (this.active) {
      if (this.input.wasPressed('KeyR')) this.resetToRoad();
      if (this.input.wasPressed('KeyC')) {
        this.rotateCamera = !this.rotateCamera;
        this.hud.message(this.rotateCamera ? 'Kamera dreht mit' : 'Norden oben', 1.2);
      }
      if (this.input.wasPressed('KeyH')) this.hud.toggleHelp();
      if (this.input.wasPressed('KeyV')) this.setView3D(!this.view3D);
      if (this.input.wasPressed('KeyT') && this.traffic) {
        this.traffic.enabled = !this.traffic.enabled;
        if (!this.traffic.enabled) this.traffic.clear();
        this.hud.message(this.traffic.enabled ? 'Verkehr an' : 'Verkehr aus', 1.2);
      }
      if (this.traffic && (this.input.wasPressed('Equal') || this.input.wasPressed('BracketRight') || this.input.wasPressed('NumpadAdd'))) {
        this.traffic.density = Math.min(2.5, this.traffic.density + 0.25);
        this.hud.message(`Verkehrsdichte ${Math.round(this.traffic.density * 100)} %`, 1.2);
      }
      if (this.traffic && (this.input.wasPressed('Minus') || this.input.wasPressed('Slash') || this.input.wasPressed('NumpadSubtract'))) {
        this.traffic.density = Math.max(0.25, this.traffic.density - 0.25);
        this.hud.message(`Verkehrsdichte ${Math.round(this.traffic.density * 100)} %`, 1.2);
      }
    }

    // Physik in festen Schritten, nur wenn die Umgebung geladen ist
    if (ready && this.spawned) {
      this.acc += Math.min(dt, 0.1);
      const inp = this.input.read();
      this.lastHandbrake = inp.handbrake;
      this.lastBrake = inp.brake;
      while (this.acc >= PHYS_DT) {
        this.acc -= PHYS_DT;
        const surf = this.query.surfaceAt(car.x, car.y, car.layer);
        car.ground = surf.ground;
        if (surf.ground === 'road') car.layer = surf.layer;
        else car.layer = 0;
        const boosting = this.nitroCap > 0 && this.nitro > 0 && this.input.nitro && inp.throttle > 0;
        car.boost = boosting ? 1 : 0;
        if (boosting) {
          if (!this.infiniteNitro) this.nitro = Math.max(0, this.nitro - PHYS_DT);
        } else this.nitro = Math.min(this.nitroCap, this.nitro + (PHYS_DT * this.nitroCap) / 25);
        car.gripScale = this.view.gfx.weather.grip;
        car.step(PHYS_DT, inp);
        const pvx = car.vx;
        const pvy = car.vy;
        let hitSpeed = 0;
        // Auf Brücken und in Tunneln keine Gebäudekollision
        if (car.layer === 0 && !this.ghost) {
          const near = this.query.buildingsNear(car.x, car.y, car.spec.length);
          if (near.length) {
            const hit = car.collide(near, (x, y) => this.query.onAnyRoad(x, y));
            if (hit && hit.speed > 4 && v.time - this.lastImpact > 0.6) {
              this.lastImpact = v.time;
              hitSpeed = hit.speed;
              this.hud.message(hit.speed > 12 ? 'Krach!' : 'Rumms', 0.9);
              this.shake = Math.min(1, this.shake + hit.speed / 15);
              this.onImpact?.(hit.speed);
            }
          }
        }
        // andere Fahrzeuge
        const imp = this.ghost ? 0 : Math.max(this.traffic?.collidePlayer() ?? 0, this.view3D ? (this.streetLife?.collide(car) ?? 0) : 0);
        if (imp > 3 && v.time - this.lastImpact > 0.6) {
          this.lastImpact = v.time;
          this.hud.message(imp > 10 ? 'Unfall!' : 'Blechschaden', 1.2);
          this.shake = Math.min(1, this.shake + imp / 15);
          this.onImpact?.(imp);
          hitSpeed = Math.max(hitSpeed, imp);
        }
        if (hitSpeed > 0) {
          // Stoßrichtung aus der Geschwindigkeitsänderung
          let nx = car.vx - pvx;
          let ny = car.vy - pvy;
          let nl = Math.hypot(nx, ny);
          if (nl < 0.3) {
            nx = -pvx;
            ny = -pvy;
            nl = Math.hypot(nx, ny) || 1;
          }
          this.damage.hit(car, this.mesh, hitSpeed, nx / nl, ny / nl, this.view3D);
          if (this.damage.level >= 1 && !this.wreckWarned) {
            this.wreckWarned = true;
            this.hud.message('Motorschaden! Ab in die Werkstatt 🔧', 3);
          }
        }
      }
      // Stadtgrenze
      if (this.infoTimer <= 0) {
        const region = this.query.regionAt(car.x, car.y);
        const inside = region !== null;
        if (region && !region.corridor && region.name !== this.lastRegion) {
          if (this.lastRegion) this.hud.message(`Willkommen in ${region.name}`, 2.5);
          this.lastRegion = region.name;
        }
        if (!inside) {
          car.vx *= 0.9;
          car.vy *= 0.9;
          if (!this.outsideWarned) this.hud.message('Ende der Spielwelt – hier geht es nicht weiter', 2.5);
        }
        this.outsideWarned = !inside;
      }
    }

    this.mesh.update(car);
    if (this.spawned) this.fx.update(dt, car, this.lastHandbrake, this.lastBrake, this.view3D && this.active, v.mpp);
    this.damage.update(dt, car, this.fx, this.view3D && this.active);
    this.hud.setDamage(this.damage.level);
    v.carPose.x = car.x;
    v.carPose.y = car.y;
    v.carPose.heading = car.heading;
    this.hud.setNitro(this.nitroCap > 0 ? this.nitro / this.nitroCap : null, car.boost > 0);
    this.updateInfo(dt);
    if (this.active) this.updateCamera(dt);
  }

  /** Schaden beheben (Werkstatt, Admin) */
  repair(): void {
    this.damage.repair(this.mesh);
    this.wreckWarned = false;
  }

  /** anderes Auto: Fahrwerte und Aussehen tauschen, Position bleibt */
  setCar(spec: CarSpec, color: number, body: Body): void {
    // gleiches Auto (Tuning, Lack): Schaden bleibt, sonst frisch
    const same = this.body === body && this.car.spec.length === spec.length && this.car.spec.width === spec.width;
    const dents = same ? this.mesh.dents : [];
    if (!same) {
      this.damage.repair(this.mesh);
      this.wreckWarned = false;
    }
    this.body = body;
    this.car.spec = { ...spec };
    this.view.scene.remove(this.mesh.group, this.mesh.group3d);
    this.mesh.dispose();
    this.mesh = new CarMesh(this.car, color, body);
    for (const d of dents) this.mesh.dent(...d);
    this.mesh.setWear(this.damage.level);
    this.view.scene.add(this.mesh.group, this.mesh.group3d);
    this.mesh.set3D(this.active && this.view3D);
    this.mesh.update(this.car);
  }

  setNitro(seconds: number): void {
    if (seconds !== this.nitroCap) this.nitro = seconds;
    this.nitroCap = seconds;
  }

  setView3D(on: boolean): void {
    this.view3D = on;
    this.view.use3d = on;
    this.mesh.set3D(on);
    this.camHeading = this.car.heading;
    this.hud.message(on ? '3D-Ansicht' : 'Draufsicht', 1.2);
    this.onView3D?.(on);
  }

  private resetToRoad(): void {
    const hit = this.view.nearestLane(this.car.x, this.car.y, 300, true);
    if (hit) {
      this.putOnLane(hit.lane, hit.s);
      this.hud.message('Zurück auf der Straße', 1.2);
    }
  }

  private updateInfo(dt: number): void {
    const car = this.car;
    const kmh = car.speed * 3.6;
    this.hud.setSpeed(kmh);
    this.infoTimer -= dt;
    if (this.infoTimer > 0) return;
    this.infoTimer = 0.25;
    // Spur passend zur Fahrtrichtung suchen
    let best: { lane: Lane; score: number } | null = null;
    const [fx, fy] = car.forward;
    for (const t of this.view.tilesAround(car.x, car.y, 10)) {
      for (const l of t.lanes) {
        if (Math.abs(l.layer - car.layer) > 0) continue;
        const r = projectOnPolyline(l.pts, car.x, car.y);
        if (r.d > l.w * 1.2 + 1) continue;
        const align = r.dir[0] * fx + r.dir[1] * fy;
        const score = r.d - align * 2;
        if (!best || score < best.score) best = { lane: l, score };
      }
    }
    this.currentLane = best?.lane ?? null;
    const lane = best?.lane;
    this.hud.setStreet(lane?.name ?? (lane ? 'ohne Namen' : null), lane?.vmax ?? null, !!lane && kmh > lane.vmax + 5);
  }

  private updateCamera(dt: number): void {
    const v = this.view;
    const car = this.car;
    const speed = Math.hypot(car.vx, car.vy);
    if (this.view3D && this.camOverride) {
      // freie Kamera (Fotos, Debug): Position und Blickpunkt vorgegeben
      const o = this.camOverride;
      v.cam3dPos.set(o.pos[0], o.pos[1], o.pos[2]);
      v.cam3dTarget.set(o.target[0], o.target[1], o.target[2]);
      v.cx = (o.pos[0] + o.target[0]) / 2;
      v.cy = (o.pos[1] + o.target[1]) / 2;
      v.mpp = 0.12;
      v.rot = Math.atan2(o.target[1] - o.pos[1], o.target[0] - o.pos[0]);
      return;
    }
    if (this.view3D) {
      // Verfolgerkamera: folgt der Fahrtrichtung gedämpft, weiter weg bei hohem Tempo
      let d = car.heading - this.camHeading;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      // rückwärts nicht herumschwenken
      const follow = car.speed < -1 ? 0.6 : 3.2;
      this.camHeading += d * (1 - Math.exp(-dt * follow));
      this.camSpeed += (Math.min(speed, 45) - this.camSpeed) * (1 - Math.exp(-dt * 1.2));
      const z = this.zoomUser;
      // tiefe Verfolgerkamera: Horizont und Himmel im Bild
      const back = (8.5 + this.camSpeed * 0.16) * z;
      const up = (3.4 + this.camSpeed * 0.045) * z;
      const ahead = 7 + this.camSpeed * 0.35;
      const look = this.lookAngle + (this.input.isDown('KeyB') ? Math.PI : 0);
      const hx = Math.cos(this.camHeading + look);
      const hy = Math.sin(this.camHeading + look);
      // Kamerawackeln nach Aufprall und leicht bei hohem Tempo
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const sh = this.shake * this.shake * 0.6 + Math.max(0, speed - 25) * 0.0015;
      const t = v.time;
      v.cam3dPos.set(car.x - hx * back + Math.sin(t * 37) * sh, car.y - hy * back + Math.cos(t * 41) * sh, up + Math.sin(t * 53) * sh * 0.7);
      // Sichtfeld weitet sich mit Tempo und Nitro
      const fovT = 52 + Math.min(14, Math.max(0, speed - 8) * 0.22) + car.boost * 9;
      v.cam3d.fov += (fovT - v.cam3d.fov) * (1 - Math.exp(-dt * 3));
      v.gfx.speedFx = Math.min(1, Math.max(0, (speed - 22) / 40) * 0.8 + car.boost * 0.35);
      v.cam3dTarget.set(car.x + hx * ahead, car.y + hy * ahead, 1.2);
      // Kachelauswahl um einen Punkt vor dem Auto; Maßstab für Detailstufen
      v.cx = car.x + hx * v.radius3d * 0.45;
      v.cy = car.y + hy * v.radius3d * 0.45;
      v.mpp = 0.12;
      v.rot = this.camHeading;
      return;
    }
    // Vorausschau in Fahrtrichtung, geglättet
    const k = 1 - Math.exp(-dt * 3);
    this.camVX += (car.vx - this.camVX) * k;
    this.camVY += (car.vy - this.camVY) * k;
    const look = 0.9;
    const tx = car.x + this.camVX * look;
    const ty = car.y + this.camVY * look;
    const kp = 1 - Math.exp(-dt * 8);
    v.cx += (tx - v.cx) * kp;
    v.cy += (ty - v.cy) * kp;
    // Zoom abhängig vom Tempo
    const targetMpp = (0.065 + Math.min(speed, 50) * 0.0023) * this.zoomUser;
    v.mpp += (targetMpp - v.mpp) * (1 - Math.exp(-dt * 1.5));
    // Drehung
    const targetRot = this.rotateCamera ? car.heading : Math.PI / 2;
    let d = targetRot - v.rot;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    v.rot += d * (1 - Math.exp(-dt * 4));
  }
}

function pointAtLane(l: Lane, s: number): { x: number; y: number; dx: number; dy: number } {
  let acc = 0;
  const p = l.pts;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2] / 10;
    const ay = p[i - 1] / 10;
    const bx = p[i] / 10;
    const by = p[i + 1] / 10;
    const seg = Math.hypot(bx - ax, by - ay);
    if (acc + seg >= s || i === p.length - 2) {
      const t = seg > 0 ? Math.min(1, (s - acc) / seg) : 0;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / (seg || 1), dy: (by - ay) / (seg || 1) };
    }
    acc += seg;
  }
  return { x: p[0] / 10, y: p[1] / 10, dx: 1, dy: 0 };
}
