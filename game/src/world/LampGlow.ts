/**
 * Nachts: Lichthöfe um Laternenköpfe und schwache Lichtkegel bis zum Boden (GTA-Stimmung).
 */
import * as THREE from 'three';
import { lit } from './litMaterials.ts';

const haloMat = new THREE.ShaderMaterial({
  uniforms: { uNight: lit.uNight, uScale: { value: 240 } },
  vertexShader: /* glsl */ `
    uniform float uScale;
    varying float vFade;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float d = -mv.z;
      gl_PointSize = clamp(uScale * 2.2 / max(d, 1.0), 2.0, 160.0);
      vFade = smoothstep(450.0, 120.0, d);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uNight;
    varying float vFade;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float r = length(p);
      float core = exp(-r * r * 18.0);
      float glow = exp(-r * r * 4.0) * 0.18;
      float a = (core + glow) * uNight * mix(0.45, 1.0, vFade);
      if (a < 0.004) discard;
      gl_FragColor = vec4(vec3(1.0, 0.78, 0.48) * a * 0.9, a);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

const coneMat = new THREE.ShaderMaterial({
  uniforms: { uNight: lit.uNight },
  vertexShader: /* glsl */ `
    attribute float aH;
    varying float vH;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vH = aH;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uNight;
    varying float vH;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      // Rand des Kegels weich, oben heller
      float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
      float a = uNight * 0.028 * edge * (0.15 + 0.85 * vH * vH);
      if (a < 0.002) discard;
      gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * a, a);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
});

/** Objekte für die Laternen einer Kachel ([x, y, z] des Leuchtkopfs) */
export function lampGlow(lamps: Array<[number, number, number]>): THREE.Object3D[] {
  if (!lamps.length) return [];
  const pts = new Float32Array(lamps.length * 3);
  lamps.forEach(([x, y, z], i) => {
    pts[i * 3] = x;
    pts[i * 3 + 1] = y;
    pts[i * 3 + 2] = z - 0.35;
  });
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const halos = new THREE.Points(pg, haloMat);
  halos.renderOrder = 30;
  halos.frustumCulled = false;

  // Lichtkegel: offener Kegel je Laterne
  const SEG = 14;
  const pos: number[] = [];
  const nor: number[] = [];
  const hh: number[] = [];
  const idx: number[] = [];
  for (const [x, y, z] of lamps) {
    const top = z - 0.4;
    const R = 3.6;
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Normale der Mantelfläche
      const k = top / Math.hypot(top, R);
      const nz = R / Math.hypot(top, R);
      pos.push(x + c * 0.25, y + s * 0.25, top, x + c * R, y + s * R, 0.05);
      nor.push(c * k, s * k, nz, c * k, s * k, nz);
      hh.push(1, 0);
    }
    for (let i = 0; i < SEG; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  cg.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1));
  cg.setIndex(idx);
  const cones = new THREE.Mesh(cg, coneMat);
  cones.renderOrder = 29;
  cones.frustumCulled = false;
  for (const o of [halos, cones]) {
    o.userData.layer = 'signals';
    o.userData.unlit = true;
    o.userData.is3d = true;
  }
  return [cones, halos];
}

/** Halos/Kegel nur nachts zeichnen */
export function glowVisible(): boolean {
  return lit.uNight.value > 0.02;
}
