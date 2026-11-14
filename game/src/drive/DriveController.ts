/**
 * Fahrmodus: verbindet Auto, Eingabe, Welt-Abfragen, Kamera und HUD.
 */
import { Car } from './Car.ts';
import { CarMesh } from './CarMesh.ts';
import { Hud } from './Hud.ts';
import { Input } from './Input.ts';
import { WorldQuery } from './WorldQuery.ts';
import { projectOnPolyline, type WorldView } from '../world/WorldView.ts';
import type { Lane } from '@nrs/shared';
import type { TrafficSim } from '../traffic/TrafficSim.ts';

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
  private acc = 0;
  private infoTimer = 0;
  private camVX = 0;
  private camVY = 0;
  private zoomUser = 1;
  private spawned = false;
  private outsideWarned = false;
  private lastImpact = 0;
  currentLane: Lane | null = null;
  traffic?: TrafficSim;
  /** wird aufgerufen, wenn das Auto weit versetzt wird */
  onTeleport?: () => void;
  /** Aufprall (Gebäude oder Fahrzeug) mit Geschwindigkeit in m/s */
  onImpact?: (speed: number) => void;
  get spawnedOk(): boolean {
    return this.spawned;
  }

  constructor(private view: WorldView) {
    this.mesh = new CarMesh(this.car);
    this.query = new WorldQuery(view);
    view.scene.add(this.mesh.group);
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
      while (this.acc >= PHYS_DT) {
        this.acc -= PHYS_DT;
        const surf = this.query.surfaceAt(car.x, car.y, car.layer);
        car.ground = surf.ground;
        if (surf.ground === 'road') car.layer = surf.layer;
        else car.layer = 0;
        car.step(PHYS_DT, inp);
        // Auf Brücken und in Tunneln keine Gebäudekollision
        if (car.layer === 0) {
          const near = this.query.buildingsNear(car.x, car.y, car.spec.length);
          if (near.length) {
            const hit = car.collide(near, (x, y) => this.query.onAnyRoad(x, y));
            if (hit && hit.speed > 4 && v.time - this.lastImpact > 0.6) {
              this.lastImpact = v.time;
              this.hud.message(hit.speed > 12 ? 'Krach!' : 'Rumms', 0.9);
              this.onImpact?.(hit.speed);
            }
          }
        }
        // andere Fahrzeuge
        const imp = this.traffic?.collidePlayer() ?? 0;
        if (imp > 3 && v.time - this.lastImpact > 0.6) {
          this.lastImpact = v.time;
          this.hud.message(imp > 10 ? 'Unfall!' : 'Blechschaden', 1.2);
          this.onImpact?.(imp);
        }
      }
      // Stadtgrenze
      if (this.infoTimer <= 0) {
        const inside = this.query.insideCity(car.x, car.y);
        if (!inside) {
          car.vx *= 0.9;
          car.vy *= 0.9;
          if (!this.outsideWarned) this.hud.message('Stadtgrenze – hier endet Nürnberg', 2.5);
        }
        this.outsideWarned = !inside;
      }
    }

    this.mesh.update(car);
    this.updateInfo(dt);
    if (this.active) this.updateCamera(dt);
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
