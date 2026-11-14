/**
 * Abschluss-Pass im GTA-Look: kräftige Farben, Kontrast, warme Lichter/kühle Schatten, Vignette,
 * Lichtstrahlen und Linsenreflexe der Sonne, Geschwindigkeits-Unschärfe und Blitz-Aufhellung.
 * Arbeitet auf dem fertigen (sRGB-)Bild nach dem OutputPass.
 */
import * as THREE from 'three';

export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
    uAspect: { value: 1 },
    uBlur: { value: 0 },
    uFlash: { value: 0 },
    uSat: { value: 1.16 },
    uContrast: { value: 1.12 },
    uVignette: { value: 0.32 },
    uRays: { value: 1 },
    uGloom: { value: 0 },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunUv;
    uniform float uSunVis;
    uniform float uAspect;
    uniform float uBlur;
    uniform float uFlash;
    uniform float uSat;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uRays;
    uniform float uGloom;
    uniform float uNight;
    varying vec2 vUv;
    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      vec2 uv = vUv;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      // Geschwindigkeit: radiale Unschärfe zum Rand hin
      vec2 dc = uv - 0.5;
      if (uBlur > 0.01) {
        float r = dot(dc, dc);
        vec3 acc = c;
        for (int i = 1; i <= 7; i++) {
          acc += texture2D(tDiffuse, uv - dc * float(i) * uBlur * 0.012 * r * 4.0).rgb;
        }
        c = acc / 8.0;
      }
      // Lichtstrahlen (God Rays) von der Sonne über helle Bildteile
      if (uSunVis > 0.01) {
        vec2 step = (uSunUv - uv) / 28.0;
        vec2 p = uv;
        float decay = 1.0;
        vec3 rays = vec3(0.0);
        if (uRays > 0.5) {
          for (int i = 0; i < 28; i++) {
            p += step;
            vec3 s = texture2D(tDiffuse, p).rgb;
            rays += s * max(0.0, lum(s) - 0.8) * decay;
            decay *= 0.93;
          }
        }
        c += rays * 0.16 * uSunVis * vec3(1.0, 0.85, 0.6);
        // Linsenreflexe nur, wenn die Sonne nicht verdeckt ist (Helligkeit an ihrer Stelle)
        float occ = 0.0;
        for (int i = 0; i < 5; i++) {
          vec2 o = vec2(float(i - 2) * 0.006, float((i * 3) % 5 - 2) * 0.006);
          occ += smoothstep(0.78, 0.97, lum(texture2D(tDiffuse, uSunUv + o).rgb));
        }
        occ /= 5.0;
        vec2 sv = uSunUv - 0.5;
        float ghosts = 0.0;
        vec3 gcol = vec3(0.0);
        for (int i = 0; i < 4; i++) {
          float k = -0.4 - float(i) * 0.38;
          vec2 g = 0.5 + sv * k;
          vec2 d = (uv - g) * vec2(uAspect, 1.0);
          float rad = 0.025 + float(i) * 0.018;
          float m = smoothstep(rad, rad * 0.3, length(d));
          gcol += m * mix(vec3(0.5, 0.7, 1.0), vec3(1.0, 0.6, 0.3), float(i) / 3.0);
        }
        vec2 hd = (uv - uSunUv) * vec2(uAspect, 1.0);
        float halo = smoothstep(0.32, 0.29, length(hd)) * smoothstep(0.26, 0.3, length(hd));
        c += (gcol * 0.08 + halo * vec3(0.9, 0.7, 1.0) * 0.04) * uSunVis * occ;
      }
      // Farbe: Sättigung, Kontrast (S-Kurve), warme Lichter / kühle Schatten
      float l = lum(c);
      c = mix(vec3(l), c, uSat * (1.0 - uGloom * 0.35));
      c = clamp(c, 0.0, 1.0);
      vec3 sc = c * c * (3.0 - 2.0 * c);
      c = mix(c, sc, (uContrast - 1.0) * 2.5);
      float lw = smoothstep(0.45, 1.0, l);
      float ls = 1.0 - smoothstep(0.0, 0.45, l);
      c += vec3(0.06, 0.025, -0.03) * lw * (1.0 - uNight * 0.6) + vec3(-0.012, 0.004, 0.022) * ls;
      // Vignette
      float v = dot(dc * vec2(uAspect, 1.0), dc * vec2(uAspect, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.1, 0.9, v * 1.6);
      // Blitz
      c += vec3(0.75, 0.8, 1.0) * uFlash;
      gl_FragColor = vec4(c, 1.0);
    }`,
};
