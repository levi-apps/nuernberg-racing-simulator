/**
 * Fahreffekte: Reifenspuren auf dem Asphalt und Rauch beim Driften oder Vollbremsen.
 */
import * as THREE from 'three';
import type { Car } from './Car.ts';
import { RL_MAIN } from '../world/TileView.ts';
import { lit } from '../world/litMaterials.ts';

const MAX_QUADS = 2400;
const MAX_SMOKE = 260;

function smokeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class DriveFx {
  private pos = new Float32Array(MAX_QUADS * 4 * 3);
  private alpha = new Float32Array(MAX_QUADS * 4);
  private geo = new THREE.BufferGeometry();
  private next = 0;
  private last: Array<[number, number] | null> = [null, null];
  private smokeGeo = new THREE.BufferGeometry();
  private sp = new Float32Array(MAX_SMOKE * 3);
  private sc = new Float32Array(MAX_SMOKE * 4);
  private vel = new Float32Array(MAX_SMOKE * 3);
  private life = new Float32Array(MAX_SMOKE);
  private sNext = 0;
  private smokeMat: THREE.PointsMaterial;
  /** zuletzt erkannter Rutsch-/Bremszustand (0..1) */
  slip = 0;

  constructor(scene: THREE.Scene) {
    const idx: number[] = [];
    for (let q = 0; q < MAX_QUADS; q++) {
      const b = q * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.04, 0.04, 0.045, vA); }',
    });
    const marks = new THREE.Mesh(this.geo, mat);
    marks.renderOrder = 4.6;
    marks.frustumCulled = false;
    marks.layers.set(RL_MAIN);
    scene.add(marks);

    this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(this.sp, 3).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeo.setAttribute('color', new THREE.BufferAttribute(this.sc, 4).setUsage(THREE.DynamicDrawUsage));
    this.smokeMat = new THREE.PointsMaterial({ size: 3.2, map: smokeTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    const smoke = new THREE.Points(this.smokeGeo, this.smokeMat);
    smoke.renderOrder = 26;
    smoke.frustumCulled = false;
    smoke.layers.set(RL_MAIN);
    scene.add(smoke);
    for (let i = 0; i < MAX_SMOKE; i++) this.sp[i * 3 + 2] = -1000;
  }

  /** nach jedem Physikschritt-Block aufrufen */
  update(dt: number, car: Car, handbrake: boolean, braking: number, in3d: boolean, mpp: number): void {
    const fx = Math.cos(car.heading);
    const fy = Math.sin(car.heading);
    const vF = car.vx * fx + car.vy * fy;
    const vL = -car.vx * fy + car.vy * fx;
    const speed = Math.hypot(car.vx, car.vy);
    const drift = Math.abs(vL) > 2.3 && speed > 4;
    const lock = handbrake && speed > 5;
    const hardBrake = braking > 0.5 && vF > 14 && car.ground === 'road';
    const burnout = car.boost > 0 && speed < 12;
    const skid = car.ground === 'road' && (drift || lock || hardBrake || burnout);
    this.slip = skid ? 1 : 0;
    const L = car.spec.length;
    const W = car.spec.width;
    // Hinterräder (bei Vollbremsung alle Spuren hinten reichen)
    for (let w = 0; w < 2; w++) {
      const side = w === 0 ? 1 : -1;
      const x = car.x - fx * L * 0.32 - fy * side * (W / 2 - 0.25);
      const y = car.y - fy * L * 0.32 + fx * side * (W / 2 - 0.25);
      const last = this.last[w];
      if (skid && last) {
        const d = Math.hypot(x - last[0], y - last[1]);
        if (d > 0.35 && d < 6) {
          this.quad(last[0], last[1], x, y, Math.min(1, 0.25 + Math.abs(vL) * 0.06 + (lock || hardBrake ? 0.2 : 0)));
          this.last[w] = [x, y];
        } else if (d >= 6) this.last[w] = [x, y];
      } else this.last[w] = skid ? [x, y] : null;
      if (skid && Math.random() < dt * (12 + Math.abs(vL) * 3)) this.puff(x, y, vF);
    }
    // Rauch bewegen
    const pos = this.smokeGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.smokeGeo.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < MAX_SMOKE; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      this.sp[k] += this.vel[k] * dt;
      this.sp[k + 1] += this.vel[k + 1] * dt;
      this.sp[k + 2] += this.vel[k + 2] * dt;
      this.vel[k] *= 1 - dt * 1.5;
      this.vel[k + 1] *= 1 - dt * 1.5;
      const a = Math.max(0, this.life[i] / 2.2);
      this.sc[i * 4 + 3] = a * 0.55;
      if (this.life[i] <= 0) this.sp[k + 2] = -1000;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    // Draufsicht: Punktgröße in Pixeln aus dem Maßstab
    this.smokeMat.color.setScalar(0.3 + 0.7 * (1 - lit.uNight.value));
    this.smokeMat.sizeAttenuation = in3d;
    this.smokeMat.size = in3d ? 3.2 : 3.2 / Math.max(0.02, mpp);
  }

  private quad(ax: number, ay: number, bx: number, by: number, a: number): void {
    const l = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / l) * 0.12;
    const ny = ((bx - ax) / l) * 0.12;
    const q = this.next;
    this.next = (this.next + 1) % MAX_QUADS;
    const p = this.pos;
    const o = q * 12;
    p[o] = ax + nx;
    p[o + 1] = ay + ny;
    p[o + 2] = 0.02;
    p[o + 3] = ax - nx;
    p[o + 4] = ay - ny;
    p[o + 5] = 0.02;
    p[o + 6] = bx - nx;
    p[o + 7] = by - ny;
    p[o + 8] = 0.02;
    p[o + 9] = bx + nx;
    p[o + 10] = by + ny;
    p[o + 11] = 0.02;
    for (let i = 0; i < 4; i++) this.alpha[q * 4 + i] = a * 0.55;
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const aa = this.geo.getAttribute('alpha') as THREE.BufferAttribute;
    pa.needsUpdate = true;
    aa.needsUpdate = true;
  }

  /** Rauch aus dem Motorraum: dark 0 = weißer Dampf, 1 = schwarzer Qualm */
  engineSmoke(x: number, y: number, z: number, dark: number, vx: number, vy: number): void {
    const i = this.sNext;
    this.sNext = (this.sNext + 1) % MAX_SMOKE;
    const k = i * 3;
    this.sp[k] = x + (Math.random() - 0.5) * 0.3;
    this.sp[k + 1] = y + (Math.random() - 0.5) * 0.3;
    this.sp[k + 2] = z;
    this.vel[k] = vx * 0.4 + (Math.random() - 0.5) * 0.6;
    this.vel[k + 1] = vy * 0.4 + (Math.random() - 0.5) * 0.6;
    this.vel[k + 2] = 1.2 + Math.random() * 0.9;
    this.life[i] = 1.6 + Math.random() * 1.0;
    const g = 0.85 - dark * 0.72 + Math.random() * 0.08;
    this.sc[i * 4] = g;
    this.sc[i * 4 + 1] = g;
    this.sc[i * 4 + 2] = g * (1 - dark * 0.1);
    this.sc[i * 4 + 3] = 0.55;
  }

  private puff(x: number, y: number, vF: number): void {
    const i = this.sNext;
    this.sNext = (this.sNext + 1) % MAX_SMOKE;
    const k = i * 3;
    this.sp[k] = x + (Math.random() - 0.5) * 0.4;
    this.sp[k + 1] = y + (Math.random() - 0.5) * 0.4;
    this.sp[k + 2] = 0.3;
    this.vel[k] = (Math.random() - 0.5) * 1.5;
    this.vel[k + 1] = (Math.random() - 0.5) * 1.5;
    this.vel[k + 2] = 0.6 + Math.random() * 0.8;
    void vF;
    this.life[i] = 1.4 + Math.random() * 0.8;
    const g = 0.82 + Math.random() * 0.12;
    this.sc[i * 4] = g;
    this.sc[i * 4 + 1] = g;
    this.sc[i * 4 + 2] = g;
    this.sc[i * 4 + 3] = 0.55;
  }
}
