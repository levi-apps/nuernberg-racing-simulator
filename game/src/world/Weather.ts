/**
 * Wetter für die 3D-Ansicht: Wolken, Regen (nasse, spiegelnde Straßen), Gewitter mit Blitzen
 * und Schnee (Flocken, weiße Dächer und Wiesen, rutschige Straßen).
 * Niederschlag läuft komplett im Vertex-Shader um die Kamera herum (keine CPU-Kosten je Tropfen).
 */
import * as THREE from 'three';
import { lit } from './litMaterials.ts';

export type WeatherKind = 'auto' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  auto: '🎲 Wechselnd',
  clear: '☀️ Klar',
  cloudy: '☁️ Bewölkt',
  rain: '🌧️ Regen',
  storm: '⛈️ Gewitter',
  snow: '❄️ Schnee',
};

interface Target {
  cloud: number;
  rain: number;
  snow: number;
  storm: number;
}

const TARGETS: Record<Exclude<WeatherKind, 'auto'>, Target> = {
  clear: { cloud: 0.1, rain: 0, snow: 0, storm: 0 },
  cloudy: { cloud: 0.75, rain: 0, snow: 0, storm: 0 },
  rain: { cloud: 0.9, rain: 0.75, snow: 0, storm: 0 },
  storm: { cloud: 1, rain: 1, snow: 0, storm: 1 },
  snow: { cloud: 0.85, rain: 0, snow: 1, storm: 0 },
};

const precipVert = /* glsl */ `
uniform vec3 uCam;
uniform float uTime;
uniform float uSpeed;
uniform float uSize;
uniform float uSnow;
attribute float aEnd;
varying float vA;
void main() {
  // Kasten 60 x 60 x 30 m um die Kamera, endlos wiederholt
  vec3 p = position;
  float fall = uTime * uSpeed;
  p.z = mod(p.z - fall, 30.0);
  // Schnee taumelt seitlich
  p.x += uSnow * sin(uTime * 0.9 + position.y * 0.37) * 0.8;
  p.y += uSnow * cos(uTime * 0.7 + position.x * 0.31) * 0.8;
  vec3 o = uCam - vec3(30.0, 30.0, 15.0);
  vec3 w;
  w.x = o.x + mod(p.x - o.x, 60.0);
  w.y = o.y + mod(p.y - o.y, 60.0);
  w.z = o.z + p.z;
  // Regenstrich: Endpunkt etwas tiefer (Bewegungsrichtung)
  w.z -= aEnd * uSize;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = length(mv.xyz);
  vA = smoothstep(32.0, 6.0, d) * smoothstep(0.5, 2.0, d);
  gl_PointSize = uSnow > 0.5 ? clamp(60.0 / d, 1.5, 7.0) : 1.0;
}`;

const precipFrag = /* glsl */ `
uniform float uAlpha;
uniform vec3 uColor;
uniform float uSnow;
varying float vA;
void main() {
  float a = vA * uAlpha;
  if (uSnow > 0.5) {
    vec2 c = gl_PointCoord - 0.5;
    a *= smoothstep(0.5, 0.2, length(c));
  }
  gl_FragColor = vec4(uColor, a);
}`;

export class Weather {
  kind: WeatherKind = 'auto';
  /** aktueller (weich überblendeter) Zustand */
  cloud = 0.1;
  rain = 0;
  snow = 0;
  storm = 0;
  /** Blitz-Helligkeit 0..1 */
  flash = 0;
  /** Bodenzustand (trocknet/taut langsamer als der Niederschlag) */
  wet = 0;
  cover = 0;
  private autoKind: Exclude<WeatherKind, 'auto'> = 'clear';
  private autoTimer = 0;
  private nextFlash = 6;
  private rainLines: THREE.LineSegments;
  private snowPts: THREE.Points;
  private rainMat: THREE.ShaderMaterial;
  private snowMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const mk = (n: number, line: boolean) => {
      const pos = new Float32Array(n * (line ? 2 : 1) * 3);
      const end = new Float32Array(n * (line ? 2 : 1));
      for (let i = 0; i < n; i++) {
        const x = Math.random() * 60;
        const y = Math.random() * 60;
        const z = Math.random() * 30;
        const k = line ? 2 : 1;
        for (let j = 0; j < k; j++) {
          pos.set([x, y, z], (i * k + j) * 3);
          end[i * k + j] = j;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      return g;
    };
    const uniforms = () => ({
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uSpeed: { value: 14 },
      uSize: { value: 0.6 },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(0.75, 0.8, 0.9) },
      uSnow: { value: 0 },
    });
    this.rainMat = new THREE.ShaderMaterial({ vertexShader: precipVert, fragmentShader: precipFrag, transparent: true, depthWrite: false, uniforms: uniforms() });
    this.snowMat = new THREE.ShaderMaterial({ vertexShader: precipVert, fragmentShader: precipFrag, transparent: true, depthWrite: false, uniforms: uniforms() });
    this.snowMat.uniforms.uSnow.value = 1;
    this.snowMat.uniforms.uSpeed.value = 1.4;
    this.snowMat.uniforms.uSize.value = 0;
    this.snowMat.uniforms.uColor.value = new THREE.Color(1, 1, 1);
    this.rainLines = new THREE.LineSegments(mk(9000, true), this.rainMat);
    this.snowPts = new THREE.Points(mk(7000, false), this.snowMat);
    for (const o of [this.rainLines, this.snowPts]) {
      o.frustumCulled = false;
      o.renderOrder = 30;
      o.layers.set(1);
      o.visible = false;
      scene.add(o);
    }
    try {
      const k = localStorage.getItem('nrs.weather') as WeatherKind | null;
      if (k && k in WEATHER_LABEL) this.kind = k;
    } catch {
      /* egal */
    }
  }

  setKind(k: WeatherKind): void {
    this.kind = k;
    try {
      localStorage.setItem('nrs.weather', k);
    } catch {
      /* egal */
    }
  }

  /** aktuelles Wetter in Worten (für die Anzeige) */
  get current(): Exclude<WeatherKind, 'auto'> {
    return this.kind === 'auto' ? this.autoKind : this.kind;
  }

  update(dt: number, time: number, cam: THREE.Vector3, in3d: boolean, hour: number): void {
    // wechselndes Wetter: alle paar Minuten neu würfeln (Schnee nur selten)
    if (this.kind === 'auto') {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.autoTimer = 150 + Math.random() * 200;
        const r = Math.random();
        this.autoKind = r < 0.38 ? 'clear' : r < 0.62 ? 'cloudy' : r < 0.82 ? 'rain' : r < 0.92 ? 'storm' : 'snow';
      }
    }
    const t = TARGETS[this.current];
    const k = 1 - Math.exp(-dt * 0.25);
    this.cloud += (t.cloud - this.cloud) * k;
    this.rain += (t.rain - this.rain) * k;
    this.snow += (t.snow - this.snow) * k;
    this.storm += (t.storm - this.storm) * k;
    // Boden: wird schnell nass, trocknet langsam; Schneedecke wächst/taut langsam
    this.wet += (Math.max(this.rain, this.snow * 0.4) - this.wet) * (1 - Math.exp(-dt * (this.rain > this.wet ? 0.35 : 0.05)));
    this.cover += (this.snow - this.cover) * (1 - Math.exp(-dt * (this.snow > this.cover ? 0.08 : 0.03)));
    lit.uWet.value = this.wet;
    lit.uSnow.value = this.cover;

    // Blitze
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.storm > 0.5) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flash = 1;
        this.nextFlash = 3 + Math.random() * 9;
        if (Math.random() < 0.4) setTimeout(() => (this.flash = 0.8), 120);
      }
    }
    void hour;

    // Niederschlag um die Kamera
    for (const [o, m, a] of [
      [this.rainLines, this.rainMat, this.rain * 0.55],
      [this.snowPts, this.snowMat, this.snow * 0.9],
    ] as const) {
      o.visible = in3d && a > 0.02;
      m.uniforms.uCam.value.copy(cam);
      m.uniforms.uTime.value = time;
      m.uniforms.uAlpha.value = a;
    }
    // Regen bei Gewitter schräger/schneller wirkt dichter
    this.rainMat.uniforms.uSpeed.value = 14 + this.storm * 6;
    this.rainMat.uniforms.uSize.value = 0.55 + this.storm * 0.3;
  }

  /** Grip-Faktor für die Fahrphysik */
  get grip(): number {
    return 1 - 0.14 * this.wet - 0.3 * this.cover;
  }
}
