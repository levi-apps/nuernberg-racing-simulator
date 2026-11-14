/**
 * Oberflächen mit prozeduralen Texturen in Weltkoordinaten (kein Bildmaterial nötig):
 * Asphalt, Pflaster, Rasen, Wald, Wasser, Schotter, Dächer.
 * Grundfarbe kommt aus den Vertexfarben, der Shader legt das Muster darüber.
 */
import * as THREE from 'three';

export enum Pat {
  Plain = 0,
  Asphalt = 1,
  Paving = 2,
  Grass = 3,
  Forest = 4,
  Water = 5,
  Gravel = 6,
  Roof = 7,
  Canopy = 8,
  Facade = 9,
}

/** gemeinsame Uniforms: Maßstab (m/px) und Zeit */
export const shared = {
  uMpp: { value: 0.1 },
  uTime: { value: 0 },
};

const vert = /* glsl */ `
varying vec2 vW;
varying vec3 vC;
varying vec2 vUv;
void main() {
  vC = color;
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
precision highp float;
uniform int uPat;
uniform float uAlpha;
uniform float uMpp;
uniform float uTime;
varying vec2 vW;
varying vec3 vC;
varying vec2 vUv;

// Hash ohne Sinus, Gitter periodisch (4096 Zellen) gegen Genauigkeitsprobleme bei großen Koordinaten
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
  float a = h21(i);
  float b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0));
  float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
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
// Detail ausblenden, wenn es kleiner als ein paar Pixel wird (gegen Flimmern)
float detail(float sizeM) {
  return clamp((sizeM / uMpp - 2.0) / 4.0, 0.0, 1.0);
}

void main() {
  vec3 c = vC;
  vec2 w = vW;
  if (uPat == 1) {
    // Asphalt: feines Korn, großflächige Unterschiede, ausgebesserte Stellen
    float grain = vnoise(w * 9.0) * 0.5 + vnoise(w * 31.0) * 0.5;
    float big = fbm(w * 0.06);
    c *= 0.93 + 0.1 * (grain - 0.5) * detail(0.15) + 0.16 * (big - 0.5);
    c *= 1.0 - 0.07 * smoothstep(0.6, 0.68, fbm(w * 0.045 + 17.0));
  } else if (uPat == 2) {
    // Pflaster: versetzte Platten 0,5 m mit Fugen
    vec2 g = w * 2.0;
    g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
    vec2 f = fract(g);
    float j = 1.0 - smoothstep(0.0, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    c *= 1.0 - 0.1 * j * detail(0.5);
    c *= 0.94 + 0.12 * vnoise(floor(g) * 0.73) * detail(0.5) + 0.06 * (fbm(w * 0.1) - 0.5);
  } else if (uPat == 3) {
    // Rasen: fleckig, mit feinem Halmkorn
    float n = fbm(w * 0.22);
    c *= 0.8 + 0.38 * n;
    c *= 0.94 + 0.12 * vnoise(w * 5.0) * detail(0.2);
  } else if (uPat == 4) {
    // Wald: Baumkronen als dunkle und helle Flecken
    float crowns = fbm(w * 0.42 + 3.0);
    float n = fbm(w * 0.11);
    float lit = smoothstep(0.38, 0.72, crowns);
    c = mix(c * 0.52, c * 1.12, lit * 0.8 + n * 0.25);
    c *= 0.95 + 0.1 * vnoise(w * 3.0) * detail(0.3);
  } else if (uPat == 5) {
    // Wasser: weiche, langsam wandernde Muster
    float n = fbm(w * 0.09 + vec2(uTime * 0.03, uTime * 0.012));
    float r = fbm(w * 0.5 - vec2(uTime * 0.05, 0.0));
    c *= 0.88 + 0.16 * n + 0.06 * r * detail(0.4);
  } else if (uPat == 6) {
    // Schotter / Kies
    c *= 0.78 + 0.4 * vnoise(w * 13.0) * detail(0.08) + 0.12 * (fbm(w * 0.3) - 0.5);
  } else if (uPat == 7) {
    // Dach: leichte Unregelmäßigkeit
    c *= 0.95 + 0.08 * vnoise(w * 2.2) + 0.04 * vnoise(w * 9.0) * detail(0.12);
  } else if (uPat == 9) {
    // Fassade: Fensterreihen je Geschoss (3,1 m), Fensterachsen alle 2,8 m
    vec2 g = vec2(vUv.x / 2.8, vUv.y / 3.1);
    vec2 f = fract(g);
    float win = step(0.27, f.x) * step(f.x, 0.73) * step(0.3, f.y) * step(f.y, 0.8);
    float lit = h21(floor(g) + 13.0);
    vec3 wc = mix(vec3(0.13, 0.16, 0.2), vec3(0.34, 0.39, 0.45), lit * lit);
    c = mix(c, wc, win * detail(0.5));
    c *= 0.93 + 0.08 * vnoise(vW * 0.6 + vUv.y * 0.3);
  } else if (uPat == 8) {
    // Baumkrone: blättrige Struktur
    c *= 0.82 + 0.32 * fbm(w * 1.4) + 0.1 * vnoise(w * 6.0) * detail(0.15);
  }
  gl_FragColor = vec4(c, uAlpha);
  #include <colorspace_fragment>
}`;

const cache = new Map<string, THREE.ShaderMaterial>();

/** depth = true: mit Tiefentest (für 3D-Körper wie Gebäude und Bäume) */
export function surfaceMat(pat: Pat, alpha = 1, depth = false): THREE.ShaderMaterial {
  const key = `${pat}:${alpha}:${depth}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      vertexColors: true,
      // alles im transparenten Durchgang, damit renderOrder gilt (Boden zuerst, dann Körper mit Tiefentest)
      transparent: true,
      depthTest: depth,
      depthWrite: depth,
      side: THREE.DoubleSide,
      uniforms: { uPat: { value: pat }, uAlpha: { value: alpha }, uMpp: shared.uMpp, uTime: shared.uTime },
    });
    cache.set(key, m);
  }
  return m;
}

/**
 * Schatten: jedes Pixel nur einmal abdunkeln, auch wenn sich Schatten überlappen.
 * Über den Stencil-Puffer: der erste Schatten markiert das Pixel, weitere werden verworfen
 * (funktioniert in Draufsicht und Perspektive gleich).
 */
export const SHADOW_MAT = new THREE.MeshBasicMaterial({
  color: 0x1a2030,
  transparent: true,
  opacity: 0.26,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
});

/** Lichtrichtung (zur Sonne hin): Sonne im Südwesten, Schatten fallen nach Nordosten */
export const TO_SUN: [number, number] = [-Math.SQRT1_2, -Math.SQRT1_2];
export const SHADOW_DIR: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];
