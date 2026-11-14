/**
 * Beleuchtete Materialien für die 3D-Ansicht: three.js-Standardmaterial (Sonne, Schatten, Nebel,
 * Spiegelungen, Laternen) mit den prozeduralen Mustern der Draufsicht. Fassaden bekommen Fenster
 * mit Rahmen, Glas und nachts beleuchteten Räumen, Dächer Ziegelreihen, Wasser spiegelt den Himmel.
 */
import * as THREE from 'three';
import { Pat, SHADOW_MAT, shared } from './materials.ts';

/** globale Werte für alle beleuchteten Materialien */
export const lit = {
  /** 0 = Tag, 1 = tiefe Nacht */
  uNight: { value: 0 },
  /** Nässe 0..1 (Regen) */
  uWet: { value: 0 },
  /** Schneedecke 0..1 */
  uSnow: { value: 0 },
};

/** zusätzliche Muster nur für 3D */
export const PAT_ROOF_FLAT = 10;
export const PAT_LAMP = 11;
export const PAT_SOLAR = 12;

const ROUGH: Record<number, number> = {
  [Pat.Plain]: 0.8,
  [Pat.Asphalt]: 0.78,
  [Pat.Paving]: 0.85,
  [Pat.Grass]: 0.95,
  [Pat.Forest]: 0.95,
  [Pat.Water]: 0.05,
  [Pat.Gravel]: 0.95,
  [Pat.Roof]: 0.75,
  [Pat.Canopy]: 0.9,
  [Pat.Facade]: 0.85,
  [PAT_ROOF_FLAT]: 0.92,
  [PAT_LAMP]: 0.5,
  [PAT_SOLAR]: 0.2,
};

const COMMON = /* glsl */ `
uniform int uPat;
uniform float uTime;
uniform float uNight;
uniform float uWet;
uniform float uSnow;
varying vec3 vPWN;
varying vec2 vPW;
varying vec2 vPUv;
float gPatRough = -1.0;
vec3 gPatEmis = vec3(0.0);

float h21(vec2 p) {
  p = mod(p, 4096.0);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 7.1;
    a *= 0.5;
  }
  return s;
}
// Details ausblenden, wenn sie kleiner als ein paar Pixel werden
float pxSize;
float detail(float sizeM) {
  return clamp((sizeM / max(pxSize, 1e-4) - 2.0) / 4.0, 0.0, 1.0);
}

void applyPattern(inout vec3 c) {
  vec2 w = vPW;
  pxSize = length(fwidth(w)) + length(fwidth(vPUv)) * 0.5;
  if (uPat == 1) {
    float grain = vnoise(w * 9.0) * 0.5 + vnoise(w * 31.0) * 0.5;
    float big = fbm(w * 0.06);
    c *= 0.93 + 0.12 * (grain - 0.5) * detail(0.15) + 0.16 * (big - 0.5);
    float pch = smoothstep(0.6, 0.68, fbm(w * 0.045 + 17.0));
    c *= 1.0 - 0.08 * pch;
    // abgefahrene, glattere Spuren glänzen etwas
    gPatRough = 0.72 + 0.12 * grain - 0.1 * pch;
  } else if (uPat == 2) {
    vec2 g = w * 2.0;
    g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
    vec2 f = fract(g);
    float j = 1.0 - smoothstep(0.0, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    c *= 1.0 - 0.16 * j * detail(0.5);
    c *= 0.94 + 0.12 * vnoise(floor(g) * 0.73) * detail(0.5) + 0.06 * (fbm(w * 0.1) - 0.5);
  } else if (uPat == 3) {
    float n = fbm(w * 0.22);
    c *= 0.8 + 0.38 * n;
    c *= 0.92 + 0.16 * vnoise(w * 5.0) * detail(0.2);
  } else if (uPat == 4) {
    float crowns = fbm(w * 0.42 + 3.0);
    float n = fbm(w * 0.11);
    c = mix(c * 0.5, c * 1.1, smoothstep(0.38, 0.72, crowns) * 0.8 + n * 0.25);
  } else if (uPat == 5) {
    // Wasser: dunkel, glatt, leichte Wellen (Spiegelung kommt von der Umgebung)
    float n = fbm(w * 0.09 + vec2(uTime * 0.03, uTime * 0.012));
    float r = fbm(w * 0.5 - vec2(uTime * 0.05, 0.0));
    c *= 0.55 + 0.14 * n + 0.05 * r;
    gPatRough = 0.03 + 0.08 * r;
  } else if (uPat == 6) {
    c *= 0.78 + 0.4 * vnoise(w * 13.0) * detail(0.08) + 0.12 * (fbm(w * 0.3) - 0.5);
  } else if (uPat == 7) {
    // Ziegeldach: Reihen entlang der Traufe (u), Neigung (v)
    vec2 g = vec2(vPUv.x / 0.3, vPUv.y / 0.36);
    g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
    vec2 f = fract(g);
    float row = smoothstep(0.0, 0.18, f.y) * (1.0 - 0.35 * smoothstep(0.75, 1.0, f.y));
    float gap = smoothstep(0.0, 0.06, min(f.x, 1.0 - f.x));
    float tileVar = h21(floor(g) + 3.0);
    c *= mix(1.0, (0.72 + 0.28 * row) * (0.85 + 0.15 * gap), detail(0.3));
    c *= 0.9 + 0.2 * tileVar * detail(0.3) + 0.12 * (fbm(w * 0.4) - 0.5);
    // Verwitterung (Moos, Ruß)
    c = mix(c, c * vec3(0.75, 0.8, 0.7), 0.35 * smoothstep(0.55, 0.8, fbm(w * 0.25 + 9.0)));
  } else if (uPat == 10) {
    // Flachdach: Kies/Bitumen mit Flecken
    c *= 0.82 + 0.3 * vnoise(w * 6.0) * detail(0.1) + 0.2 * (fbm(w * 0.3) - 0.5);
  } else if (uPat == 8) {
    c *= 0.78 + 0.36 * fbm(w * 1.4 + vPUv * 3.0) + 0.1 * vnoise(w * 6.0) * detail(0.15);
  } else if (uPat == 9) {
    // Fassade: Stil aus u (je 1000 m ein Stil), Geschosse, Fensterachsen, Erdgeschoss
    float style = floor(vPUv.x / 1000.0);
    float u = mod(vPUv.x, 1000.0);
    float v = vPUv.y;
    float d = detail(0.4);
    vec3 base = c;
    if (style >= 30.0) {
      // Altstadt: Sandsteinquader (34-37), Fachwerk (30-33), Turm (38)
      bool fw = style < 34.0;
      bool tower = style >= 38.0;
      // Quader
      float row = floor(v / 0.45);
      vec2 qg = vec2(u / 1.05 + mod(row, 2.0) * 0.5, v / 0.45);
      vec2 qf = fract(qg);
      float joint = 1.0 - smoothstep(0.0, 0.035, min(qf.x, 1.0 - qf.x)) * smoothstep(0.0, 0.07, min(qf.y, 1.0 - qf.y));
      vec3 ashlar = base * (0.86 + 0.24 * h21(floor(qg) + 5.0)) * (1.0 - 0.28 * joint * detail(0.12));
      float flo = fw ? 2.8 : 3.3;
      float gf = fw ? 3.0 : 0.0;
      float bay = fw ? 1.25 : 2.7;
      vec2 g = vec2(u / bay, (v - gf) / flo);
      vec2 f = fract(g);
      float id = h21(floor(g) + style * 17.0 + floor(u / 50.0));
      float win = 0.0;
      float frame = 0.0;
      if (tower) {
        c = ashlar;
        vec2 tg = vec2(u / 4.6, v / 7.0);
        vec2 tf = fract(tg);
        win = step(0.45, tf.x) * step(tf.x, 0.55) * step(0.4, tf.y) * step(tf.y, 0.62) * step(3.0, v);
        id = h21(floor(tg) + 7.0);
      } else if (fw) {
        // Erdgeschoss massiv, darüber Fachwerk
        if (v < gf) {
          c = mix(ashlar, ashlar * vec3(1.05, 0.95, 0.9), 0.5);
          float fx = fract(u / 3.6);
          win = step(0.25, fx) * step(fx, 0.75) * step(0.6, v) * step(v, 2.4);
        } else {
          vec3 timber = vec3(0.075, 0.04, 0.022);
          float bayI = floor(g.x);
          float post = 1.0 - smoothstep(0.05, 0.075, min(f.x, 1.0 - f.x) * bay);
          float rail = 1.0 - smoothstep(0.07, 0.1, min(f.y, 1.0 - f.y) * flo);
          float sillL = 1.0 - smoothstep(0.05, 0.08, abs(f.y - 0.3) * flo);
          float diag = 0.0;
          float h = h21(vec2(bayI, floor(g.y)) + style);
          if (h < 0.45) diag = 1.0 - smoothstep(0.05, 0.09, abs(f.x - (h < 0.22 ? f.y * 0.3 : 1.0 - f.y * 0.3)) * bay);
          bool hasWin = mod(bayI, 2.0) < 1.0 && h > 0.2;
          if (hasWin) {
            win = step(0.16, f.x) * step(f.x, 0.84) * step(0.36, f.y) * step(f.y, 0.86);
            diag = 0.0;
          }
          float beam = clamp(post + rail + sillL * (hasWin ? 1.0 : 0.6) + diag, 0.0, 1.0);
          c = mix(base * (0.95 + 0.08 * vnoise(vPW * 1.3 + v)), timber * (0.8 + 0.4 * vnoise(vec2(u * 3.0, v * 3.0))), beam * detail(0.15));
        }
      } else {
        // Sandstein mit Fenstern und Rahmen aus hellerem Stein
        c = ashlar;
        win = step(0.3, f.x) * step(f.x, 0.7) * step(0.28, f.y) * step(f.y, 0.82) * step(1.0, v);
        frame = step(0.25, f.x) * step(f.x, 0.75) * step(0.22, f.y) * step(f.y, 0.88) * step(1.0, v) - win;
        c = mix(c, base * 1.15 + 0.04, frame * d);
      }
      vec3 glass = mix(vec3(0.05, 0.07, 0.09), vec3(0.2, 0.24, 0.28), id * id);
      // Laibung: oben im Fenster Schatten (wirkt eingelassen)
      glass *= 1.0 - 0.55 * smoothstep(0.62, 0.84, fw ? f.y : f.y);
      c = mix(c, glass, win * d);
      if (win * d > 0.5) gPatRough = 0.1;
      c *= 0.84 + 0.16 * smoothstep(0.0, 1.6, v);
      vec3 warm = vec3(1.0, 0.7, 0.4);
      gPatEmis = warm * step(id, 0.45) * win * uNight * 1.05 * d;
    } else {
    float bay = 2.4 + mod(style, 3.0) * 0.45;
    float flo = 3.0 + mod(style * 7.0, 3.0) * 0.25;
    float shop = step(2.0, mod(style, 5.0)) * step(mod(style, 5.0), 2.5); // jedes 5. Haus mit Ladenzone
    float gf = 3.8 * shop;
    // Geschossband (Gesims)
    float fl = (v - gf) / flo;
    float band = (1.0 - smoothstep(0.0, 0.05, fract(fl))) * step(gf, v);
    c *= 1.0 - 0.12 * band * detail(0.3);
    // Fenster
    vec2 g = vec2(u / bay, fl);
    vec2 f = fract(g);
    float ww = 0.26 + 0.08 * mod(style, 2.0);
    float win = step(ww, f.x) * step(f.x, 1.0 - ww) * step(0.28, f.y) * step(f.y, 0.82) * step(gf + 0.5, v);
    float frame = step(ww - 0.05, f.x) * step(f.x, 1.0 - ww + 0.05) * step(0.24, f.y) * step(f.y, 0.86) * step(gf + 0.5, v) - win;
    float sill = step(ww - 0.07, f.x) * step(f.x, 1.0 - ww + 0.07) * step(0.2, f.y) * step(f.y, 0.25) * step(gf + 0.5, v);
    // Ladenfenster im Erdgeschoss
    float sw = 0.0;
    if (shop > 0.5 && v < gf) {
      float fx = fract(u / 4.5);
      sw = step(0.08, fx) * step(fx, 0.92) * step(0.3, v) * step(v, gf - 0.6);
    }
    float id = h21(floor(g) + style * 17.0 + floor(u / 50.0));
    vec3 glass = mix(vec3(0.05, 0.07, 0.09), vec3(0.2, 0.24, 0.28), id * id);
    // Laibung: Schatten oben und seitlich im Fenster (wirkt eingelassen)
    glass *= (1.0 - 0.5 * smoothstep(0.6, 0.82, f.y)) * (1.0 - 0.25 * smoothstep(ww + 0.06, ww, f.x));
    c = mix(c, base * 1.18 + 0.05, clamp(frame + sill, 0.0, 1.0) * d);
    // Fensterbank wirft einen kleinen Schatten
    c *= 1.0 - 0.18 * step(ww - 0.07, f.x) * step(f.x, 1.0 - ww + 0.07) * step(0.15, f.y) * step(f.y, 0.2) * step(gf + 0.5, v) * d;
    c = mix(c, glass, max(win, sw) * d);
    if (max(win, sw) * d > 0.5) gPatRough = 0.12;
    c *= 0.93 + 0.08 * vnoise(vPW * 0.6 + v * 0.3);
    // unten dunkler (Spritzwasser, Umgebungsverdeckung)
    c *= 0.82 + 0.18 * smoothstep(0.0, 1.6, v);
    // nachts: einige Fenster und alle Läden beleuchtet
    float on = step(id, 0.42) * win + sw * 1.4;
    vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.8, h21(floor(g) + 91.0)));
    gPatEmis = warm * on * uNight * 1.05 * d;
    }
  } else if (uPat == 12) {
    // Solarmodule: dunkelblau mit Zellraster, glänzend
    vec2 g = vec2(vPUv.x / 1.05, vPUv.y / 1.7);
    vec2 f = fract(g);
    float gap = 1.0 - smoothstep(0.0, 0.03, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    vec2 cg = fract(vec2(vPUv.x / 0.17, vPUv.y / 0.17));
    float cell = 1.0 - smoothstep(0.0, 0.08, min(min(cg.x, 1.0 - cg.x), min(cg.y, 1.0 - cg.y)));
    c = mix(vec3(0.02, 0.04, 0.09), vec3(0.6, 0.62, 0.65), gap * detail(0.05));
    c += vec3(0.03, 0.05, 0.08) * cell * detail(0.02);
    gPatRough = 0.18;
  } else if (uPat == 11) {
    // Laternenkopf: nachts hell
    gPatEmis = vec3(1.0, 0.82, 0.55) * uNight * 6.0;
  }
}

void applyWeather(inout vec3 c) {
  if (uPat == 11 || uPat == 5) return;
  float flatness = abs(vPWN.z);
  // Schnee: auf allem, was nach oben zeigt; Fahrbahnen nur am Rand und zwischen den Spuren
  float snowAmt = 0.0;
  if (uSnow > 0.01) {
    float n = fbm(vPW * 0.35);
    snowAmt = uSnow * smoothstep(0.45, 0.85, flatness);
    if (uPat == 1) snowAmt *= 0.3 + 0.45 * smoothstep(0.45, 0.7, fbm(vPW * 0.8 + 3.0));
    else if (uPat == 2) snowAmt *= 0.8;
    snowAmt *= smoothstep(0.15, 0.5, n + uSnow * 0.45);
    snowAmt = clamp(snowAmt, 0.0, 1.0);
    c = mix(c, vec3(0.9, 0.93, 0.98), snowAmt);
    if (snowAmt > 0.3) gPatRough = 0.55;
  }
  // Nässe: dunkler und glänzend, Pfützen spiegeln
  if (uWet > 0.01) {
    float ground = smoothstep(0.6, 0.9, flatness);
    float puddle = smoothstep(0.52, 0.62, fbm(vPW * 0.18 + 11.0)) * ground;
    bool hard = uPat == 0 || uPat == 1 || uPat == 2 || uPat == 6 || uPat == 7 || uPat == 10;
    float w = uWet * (hard ? 1.0 : 0.45) * (1.0 - snowAmt * 0.8);
    c *= 1.0 - w * (0.32 + 0.25 * puddle);
    float rr = gPatRough >= 0.0 ? gPatRough : roughness;
    gPatRough = mix(rr, mix(0.16, 0.025, puddle), w * mix(0.4, 1.0, ground));
  }
}
`;

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** beleuchtetes Gegenstück zu surfaceMat */
export function litSurface(pat: number, alpha = 1, depth = false): THREE.MeshStandardMaterial {
  const key = `${pat}:${alpha}:${depth}`;
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    opacity: alpha,
    depthTest: depth,
    depthWrite: depth,
    side: THREE.DoubleSide,
    roughness: ROUGH[pat] ?? 0.85,
    metalness: 0,
    // Boden ohne Normalen: Normale aus der Fläche ableiten
    flatShading: !depth,
  });
  patternize(m, pat);
  cache.set(key, m);
  return m;
}

export function patternize(m: THREE.Material, pat: number): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPat = { value: pat };
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uNight = lit.uNight;
    sh.uniforms.uWet = lit.uWet;
    sh.uniforms.uSnow = lit.uSnow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPW;\nvarying vec2 vPUv;\nvarying vec3 vPWN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 pw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            pw = instanceMatrix * pw;
          #endif
          pw = modelMatrix * pw;
          vPW = pw.xy;
          vPUv = uv;
          vPWN = normalize(mat3(modelMatrix) * objectNormal);
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\napplyPattern(diffuseColor.rgb);\napplyWeather(diffuseColor.rgb);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (gPatRough >= 0.0) roughnessFactor = gPatRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gPatEmis;');
  };
  m.customProgramCacheKey = () => 'nrs-pattern';
}

const basicCache = new WeakMap<THREE.Material, THREE.Material>();

/**
 * Beleuchtete Variante eines Draufsicht-Materials (Farbflächen wie Markierungen, Bordsteine).
 * Unbeleuchtete Leuchten (Ampellampen) bleiben unverändert.
 */
export function litVariant(src: THREE.Material): THREE.Material {
  const hit = basicCache.get(src);
  if (hit) return hit;
  let out: THREE.Material = src;
  if (src === SHADOW_MAT) return src;
  if (src instanceof THREE.ShaderMaterial && src.uniforms.uPat) {
    out = litSurface(src.uniforms.uPat.value as number, src.uniforms.uAlpha?.value ?? 1, src.depthTest);
  } else if (src instanceof THREE.MeshBasicMaterial) {
    const s = new THREE.MeshStandardMaterial({
      color: src.color,
      vertexColors: src.vertexColors,
      transparent: src.transparent,
      opacity: src.opacity,
      depthTest: src.depthTest,
      depthWrite: src.depthWrite,
      side: src.side,
      roughness: 0.7,
      metalness: 0,
      flatShading: true,
    });
    out = s;
  }
  basicCache.set(src, out);
  return out;
}

/** Material eines Draufsicht-Objekts gegen die beleuchtete Variante tauschen (und zurück) */
export function setLit(o: THREE.Object3D, on: boolean): void {
  const m = o as THREE.Mesh;
  if (!m.isMesh || m.userData.unlit || m.userData.is3d) return;
  if (on) {
    if (!m.userData.mat2d) m.userData.mat2d = m.material;
    const src = m.userData.mat2d as THREE.Material;
    if (src === SHADOW_MAT) return;
    const g = m.geometry;
    if (!g.getAttribute('normal')) {
      const n = new Float32Array(g.getAttribute('position').count * 3);
      for (let i = 2; i < n.length; i += 3) n[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    }
    m.material = litVariant(src);
    m.receiveShadow = true;
  } else if (m.userData.mat2d) m.material = m.userData.mat2d as THREE.Material;
}
