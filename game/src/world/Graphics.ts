/**
 * Grafik der 3D-Ansicht: Tageszeit mit Sonne/Mond, echten Schatten, Himmel (auch als Spiegelung),
 * Dunst, Straßenlaternen und Scheinwerfer als Lichtquellen, Nachbearbeitung (Bloom,
 * Umgebungsverdeckung, Kantenglättung) und Qualitätsstufen.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { lit } from './litMaterials.ts';
import { SHADOW_MAT } from './materials.ts';
import { render3d } from './render3d.ts';
import { carLights } from '../drive/CarModel.ts';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySpec {
  label: string;
  shadows: number;
  ao: boolean;
  bloom: boolean;
  aa: 'none' | 'fxaa' | 'smaa';
  lamps: number;
  pixelRatio: number;
  radius: number;
  shadowRange: number;
}

const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
export const QUALITY: Record<Quality, QualitySpec> = {
  low: { label: 'Niedrig', shadows: 0, ao: false, bloom: false, aa: 'none', lamps: 0, pixelRatio: 1, radius: 170, shadowRange: 0 },
  medium: { label: 'Mittel', shadows: 1024, ao: false, bloom: true, aa: 'fxaa', lamps: 4, pixelRatio: 1, radius: 220, shadowRange: 90 },
  high: { label: 'Hoch', shadows: 2048, ao: true, bloom: true, aa: 'smaa', lamps: 8, pixelRatio: Math.min(dpr, 1.5), radius: 280, shadowRange: 130 },
  ultra: { label: 'Ultra', shadows: 4096, ao: true, bloom: true, aa: 'smaa', lamps: 12, pixelRatio: Math.min(dpr, 2), radius: 340, shadowRange: 170 },
};

export interface GraphicsSettings {
  quality: Quality;
  /** feste Uhrzeit oder Tageszyklus */
  cycle: boolean;
  hour: number;
  /** Echtzeit-Minuten pro Spieltag */
  dayMinutes: number;
}

const STORE = 'nrs.graphics';

const C = (h: number) => new THREE.Color(h);
const SKY = {
  dayZen: C(0x2f6fc8),
  dayHor: C(0xb8d4ee),
  duskZen: C(0x34477e),
  duskHor: C(0xf0a060),
  nightZen: C(0x03060f),
  nightHor: C(0x111b33),
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const skyFrag = /* glsl */ `
uniform vec3 uZen;
uniform vec3 uHor;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uMoonDir;
uniform float uNight;
varying vec3 vDir;
float h31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.z, -1.0, 1.0);
  float t = pow(clamp(up, 0.0, 1.0), 0.45);
  vec3 col = mix(uHor, uZen, t);
  // unter dem Horizont: dunstiger Boden
  col = mix(col, uHor * 0.55, smoothstep(0.0, -0.08, up));
  // Sonne mit Hof
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunCol * (pow(sd, 900.0) * 5.0 + pow(sd, 12.0) * 0.3 + pow(sd, 3.0) * 0.1) * step(-0.05, uSunDir.z);
  // Sterne und Mond
  if (uNight > 0.01 && up > 0.0) {
    vec3 g = floor(d * 900.0);
    float s = step(0.9992, h31(g));
    col += vec3(s * (0.35 + 0.5 * h31(g + 7.0))) * uNight * smoothstep(0.0, 0.25, up);
    float md = max(dot(d, normalize(uMoonDir)), 0.0);
    col += vec3(0.85, 0.88, 1.0) * (step(0.99965, md) * 3.0 + pow(md, 60.0) * 0.12) * uNight;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Graphics {
  settings: GraphicsSettings;
  spec: QualitySpec;
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6f6450, 1);
  readonly headlight = new THREE.SpotLight(0xfff1d8, 0, 70, 0.5, 0.55, 1.4);
  readonly lampLights: THREE.PointLight[] = [];
  /** Nachtfaktor 0..1 (auch für Materialien) */
  night = 0;
  /** Sonne über dem Horizont 0..1 */
  day = 1;
  readonly sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  private fog = new THREE.Fog(0xb8d4ee, 100, 300);
  private skyScene = new THREE.Scene();
  private skyMat: THREE.ShaderMaterial;
  private skyDome: THREE.Mesh;
  private cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  private cubeCam = new THREE.CubeCamera(1, 3000, this.cubeRT);
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envHour = -99;
  private envTimer = 0;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private aoPass: GTAOPass | null = null;
  private horizon = new THREE.Color();
  private zenith = new THREE.Color();
  private sunCol = new THREE.Color();
  onChange?: () => void;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    let s: Partial<GraphicsSettings> = {};
    try {
      s = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<GraphicsSettings>;
    } catch {
      /* egal */
    }
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    this.settings = { quality: mobile ? 'medium' : 'high', cycle: true, hour: 14, dayMinutes: 24, ...s };
    this.spec = QUALITY[this.settings.quality];

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZen: { value: this.zenith },
        uHor: { value: this.horizon },
        uSunDir: { value: this.sunDir },
        uSunCol: { value: this.sunCol },
        uMoonDir: { value: this.moonDir },
        uNight: { value: 0 },
      },
    });
    this.skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.skyMat));
    // Himmel direkt in der Szene (scharfe Sterne), die Würfeltextur dient nur für Spiegelungen
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    this.skyDome.renderOrder = -2;
    this.skyDome.frustumCulled = false;
    this.skyDome.layers.set(1);
    this.skyDome.visible = false;
    scene.add(this.skyDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // Lichter: nur in der Hauptansicht (Ebene 0 reicht, Lichter wirken unabhängig von Ebenen)
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.09;
    scene.add(this.sun, this.sun.target, this.hemi, this.headlight, this.headlight.target);
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    this.applyQuality();
  }

  save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.settings));
    } catch {
      /* egal */
    }
  }

  setQuality(q: Quality): void {
    this.settings.quality = q;
    this.spec = QUALITY[q];
    this.save();
    this.applyQuality();
    this.onChange?.();
  }

  setHour(h: number, cycle = this.settings.cycle): void {
    this.settings.hour = ((h % 24) + 24) % 24;
    this.settings.cycle = cycle;
    this.save();
  }

  private applyQuality(): void {
    const q = this.spec;
    const r = this.renderer;
    r.setPixelRatio(q.pixelRatio);
    r.shadowMap.enabled = q.shadows > 0;
    render3d.shadows = q.shadows > 0;
    this.sun.castShadow = q.shadows > 0;
    if (q.shadows > 0) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      const cam = this.sun.shadow.camera;
      cam.left = -q.shadowRange;
      cam.right = q.shadowRange;
      cam.top = q.shadowRange;
      cam.bottom = -q.shadowRange;
      cam.near = 1;
      cam.far = 900;
      cam.updateProjectionMatrix();
    }
    // Laternenlichter: feste Anzahl (sonst würden alle Shader neu übersetzt)
    while (this.lampLights.length > q.lamps) this.scene.remove(this.lampLights.pop()!);
    while (this.lampLights.length < q.lamps) {
      const l = new THREE.PointLight(0xffc27a, 0, 26, 1.6);
      this.lampLights.push(l);
      this.scene.add(l);
    }
    // alle Materialien neu übersetzen (Schatten an/aus, Lichteranzahl)
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.buildComposer();
  }

  resize(): void {
    this.buildComposer();
  }

  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.aoPass = null;
    const q = this.spec;
    const r = this.renderer;
    const w = r.domElement.clientWidth || 1;
    const h = r.domElement.clientHeight || 1;
    if (!q.bloom && !q.ao && q.aa === 'none') return;
    const target = new THREE.WebGLRenderTarget(w * q.pixelRatio, h * q.pixelRatio, { type: THREE.HalfFloatType, samples: q.aa === 'smaa' ? 0 : 4 });
    const c = new EffectComposer(r, target);
    c.setPixelRatio(q.pixelRatio);
    c.setSize(w, h);
    this.renderPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.renderPass);
    if (q.ao) {
      this.aoPass = new GTAOPass(this.scene, this.camera, w, h);
      this.aoPass.blendIntensity = 0.85;
      this.aoPass.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: q.shadows >= 4096 ? 16 : 12 });
      c.addPass(this.aoPass);
    }
    if (q.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.5, 0.95));
    c.addPass(new OutputPass());
    if (q.aa === 'smaa') c.addPass(new SMAAPass());
    else if (q.aa === 'fxaa') {
      const fx = new ShaderPass(FXAAShader);
      fx.material.uniforms.resolution.value.set(1 / (w * q.pixelRatio), 1 / (h * q.pixelRatio));
      c.addPass(fx);
    }
    this.composer = c;
  }

  /** Tageszeit fortschreiben und Licht/Himmel einstellen */
  update(dt: number): void {
    const s = this.settings;
    if (s.cycle) s.hour = (s.hour + (dt * 24) / (s.dayMinutes * 60)) % 24;
    const h = s.hour;
    // Sonne: Aufgang 6 Uhr im Osten, Mittag im Süden (55°), Untergang 18 Uhr im Westen
    const maxEl = (55 * Math.PI) / 180;
    const el = maxEl * Math.sin((Math.PI * (h - 6)) / 12);
    const az = ((90 + (h - 6) * 15) * Math.PI) / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
    const mel = (38 * Math.PI) / 180;
    this.moonDir.set(-this.sunDir.x * Math.cos(mel), -this.sunDir.y * Math.cos(mel), Math.sin(mel));
    const elDeg = (el * 180) / Math.PI;
    this.day = THREE.MathUtils.smoothstep(elDeg, -4, 8);
    this.night = 1 - THREE.MathUtils.smoothstep(elDeg, -9, 2);
    const dusk = Math.max(0, 1 - Math.abs(elDeg - 2) / 14) * (1 - this.night * 0.6);
    lit.uNight.value = this.night;
    carLights.setNight(Math.max(this.night, dusk * 0.5));

    // Himmelsfarben
    this.zenith.copy(SKY.dayZen).lerp(SKY.duskZen, dusk * 0.7).lerp(SKY.nightZen, this.night);
    this.horizon.copy(SKY.dayHor).lerp(SKY.duskHor, dusk).lerp(SKY.nightHor, this.night);
    this.sunCol.setRGB(1, 0.95, 0.88).lerp(new THREE.Color(1, 0.55, 0.25), dusk);
    this.skyMat.uniforms.uNight.value = this.night;

    // Schlüssellicht: Sonne bei Tag, Mond bei Nacht
    const moon = this.night > 0.5;
    const key = moon ? this.moonDir : this.sunDir;
    this.sun.color.copy(moon ? new THREE.Color(0.55, 0.65, 0.95) : this.sunCol);
    this.sun.intensity = moon ? 0.35 * this.night : 2.7 * this.day;
    this.hemi.color.copy(this.zenith).lerp(new THREE.Color(1, 1, 1), 0.72);
    this.hemi.groundColor.setRGB(0.42, 0.38, 0.32).multiplyScalar(0.35 + 0.65 * this.day);
    this.hemi.intensity = 0.22 + 0.75 * this.day + 0.2 * dusk;
    this.fog.color.copy(this.horizon);
    this.scene.environmentIntensity = 0.1 + 0.5 * this.day;
    this.headlight.intensity = 260 * Math.max(this.night, 0.6 * dusk);
    for (const l of this.lampLights) l.intensity = 60 * this.night;
    this.keyDir = key;

    // Himmel als Würfeltextur neu zeichnen, wenn sich die Zeit merklich geändert hat
    this.envTimer -= dt;
    if (Math.abs(h - this.envHour) > 0.08 && this.envTimer <= 0) {
      this.envTimer = 0.5;
      this.envHour = h;
      this.renderSky();
    }
  }
  private keyDir = new THREE.Vector3(0, 0, 1);

  private renderSky(): void {
    const r = this.renderer;
    const tm = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    this.cubeCam.update(r, this.skyScene);
    r.toneMapping = tm;
    const env = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.envRT?.dispose();
    this.envRT = env;
  }

  /** Lichtquellen nachführen: Schatten-Kamera um den Blickpunkt, Laternen in der Nähe */
  place(target: THREE.Vector3, lamps: Array<[number, number, number]>, car: { x: number; y: number; heading: number }): void {
    const q = this.spec;
    const k = this.keyDir;
    // Schatten-Kamera auf Texel einrasten (gegen Flimmern beim Fahren)
    const range = Math.max(10, q.shadowRange);
    const texel = (2 * range) / Math.max(256, q.shadows || 256);
    const tx = Math.round(target.x / texel) * texel;
    const ty = Math.round(target.y / texel) * texel;
    this.sun.target.position.set(tx, ty, 0);
    this.sun.position.set(tx + k.x * 400, ty + k.y * 400, Math.max(20, k.z * 400));
    this.sun.target.updateMatrixWorld();
    // Scheinwerfer
    const fx = Math.cos(car.heading);
    const fy = Math.sin(car.heading);
    this.headlight.position.set(car.x + fx * 1.6, car.y + fy * 1.6, 0.9);
    this.headlight.target.position.set(car.x + fx * 30, car.y + fy * 30, 0);
    this.headlight.target.updateMatrixWorld();
    // nächste Laternen
    if (this.lampLights.length) {
      const near = lamps
        .map((p) => ({ p, d: (p[0] - target.x) ** 2 + (p[1] - target.y) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lampLights.length);
      this.lampLights.forEach((l, i) => {
        const n = near[i];
        if (n) l.position.set(n.p[0], n.p[1], n.p[2] - 0.4);
        else l.position.set(1e6, 1e6, -100);
      });
    }
  }

  /** 3D-Bild rendern */
  render3D(): void {
    const r = this.renderer;
    const scene = this.scene;
    const q = this.spec;
    this.camera.far = q.radius + 900;
    this.fog.near = q.radius * 0.45;
    this.fog.far = q.radius * 1.0;
    scene.fog = this.fog;
    scene.background = null;
    this.skyDome.visible = true;
    this.skyDome.position.copy(this.camera.position);
    this.skyDome.scale.setScalar(q.radius + 600);
    scene.environment = this.envRT?.texture ?? null;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    SHADOW_MAT.visible = q.shadows === 0;
    if (q.shadows > 0) r.shadowMap.needsUpdate = true;
    if (this.composer) {
      this.composer.render();
    } else {
      r.setRenderTarget(null);
      r.clear();
      r.render(scene, this.camera);
    }
    this.reset2D();
  }

  /** Zustand für die Draufsicht/Minikarte (unbeleuchtet) */
  reset2D(): void {
    const scene = this.scene;
    scene.fog = null;
    scene.background = null;
    scene.environment = null;
    this.skyDome.visible = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    SHADOW_MAT.visible = true;
  }
}
