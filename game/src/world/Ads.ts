/**
 * Werbung für PokeTrade (poketrade.patrick-thomas.de) überall in der Stadt:
 * Plakatwände an Straßen, Banner an Fassaden, Litfaßsäulen und Leuchtreklamen auf Dächern.
 * Alle Motive liegen in einer zur Laufzeit gezeichneten Texturkarte; nachts leuchten sie.
 */
import * as THREE from 'three';
import { lit } from './litMaterials.ts';

const URL_TEXT = 'poketrade.patrick-thomas.de';
const BRAND = 'POKETRADE';
const PURPLE = '#4231bb';

/** Bereiche in der Texturkarte (u0, v0, u1, v1) */
export interface AdRegion {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export const AD = {
  landscape: [] as AdRegion[],
  portrait: [] as AdRegion[],
  neon: [] as AdRegion[],
};

let material: THREE.MeshStandardMaterial | null = null;

const SIZE = 2048;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function sparkles(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n: number, seed: number): void {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const cx = x + rnd() * w;
    const cy = y + rnd() * h;
    const r = 3 + rnd() * 9;
    g.globalAlpha = 0.35 + rnd() * 0.5;
    star(g, cx, cy, r, '#ffffff');
  }
  g.globalAlpha = 1;
}

/** Booster-Packung mit Folienglanz */
function booster(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hue: number, tilt: number): void {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(tilt);
  g.translate(-w / 2, -h / 2);
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 24;
  g.shadowOffsetY = 10;
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, `hsl(${hue},85%,62%)`);
  grd.addColorStop(0.45, `hsl(${hue + 40},90%,72%)`);
  grd.addColorStop(0.55, '#ffffff');
  grd.addColorStop(0.62, `hsl(${hue + 60},90%,66%)`);
  grd.addColorStop(1, `hsl(${hue - 30},80%,45%)`);
  // Zackenränder oben und unten
  g.beginPath();
  const teeth = 12;
  g.moveTo(0, h * 0.04);
  for (let i = 0; i <= teeth; i++) g.lineTo((i / teeth) * w, i % 2 ? 0 : h * 0.04);
  g.lineTo(w, h * 0.96);
  for (let i = teeth; i >= 0; i--) g.lineTo((i / teeth) * w, i % 2 ? h : h * 0.96);
  g.closePath();
  g.fillStyle = grd;
  g.fill();
  g.shadowColor = 'transparent';
  // Emblem
  g.beginPath();
  g.arc(w / 2, h * 0.45, w * 0.28, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fill();
  star(g, w / 2, h * 0.45, w * 0.22, PURPLE);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.font = `900 ${Math.round(w * 0.13)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText('BOOSTER', w / 2, h * 0.82);
  g.restore();
}

/** Sammelkarte (eigenes Motiv, keine Figuren) */
function card(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hue: number, tilt: number): void {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(tilt);
  g.translate(-w / 2, -h / 2);
  g.shadowColor = 'rgba(0,0,0,0.4)';
  g.shadowBlur = 18;
  roundRect(g, 0, 0, w, h, w * 0.07);
  g.fillStyle = '#ffd84a';
  g.fill();
  g.shadowColor = 'transparent';
  roundRect(g, w * 0.06, h * 0.05, w * 0.88, h * 0.9, w * 0.05);
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, `hsl(${hue},80%,60%)`);
  grd.addColorStop(1, `hsl(${hue + 50},80%,40%)`);
  g.fillStyle = grd;
  g.fill();
  roundRect(g, w * 0.12, h * 0.14, w * 0.76, h * 0.42, w * 0.04);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fill();
  star(g, w / 2, h * 0.35, w * 0.22, `hsl(${hue + 180},85%,55%)`);
  for (let i = 0; i < 3; i++) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(w * 0.14, h * (0.64 + i * 0.08), w * (0.72 - i * 0.12), h * 0.035);
  }
  g.restore();
}

function background(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, variant: number): void {
  const grd = g.createLinearGradient(x, y, x + w, y + h);
  const pal = [
    ['#2a1d8f', PURPLE, '#8e4dff'],
    ['#1b1060', '#5b2fd6', '#d24dff'],
    ['#3a1a9e', '#6a3df0', '#ff5ec4'],
    ['#140c4a', PURPLE, '#3fd0ff'],
  ][variant % 4];
  grd.addColorStop(0, pal[0]);
  grd.addColorStop(0.55, pal[1]);
  grd.addColorStop(1, pal[2]);
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);
  // Lichtstrahlen
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.globalAlpha = 0.12;
  const cx = x + w * 0.7;
  const cy = y + h * 0.4;
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, Math.max(w, h), a0, a0 + 0.12);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
  }
  g.globalAlpha = 1;
  g.restore();
  sparkles(g, x, y, w, h, Math.round((w * h) / 9000), variant * 977 + 13);
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#ffffff', align: CanvasTextAlign = 'left', weight = 900): void {
  g.font = `${weight} ${size}px system-ui, "Segoe UI", sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillText(s, x + size * 0.04, y + size * 0.05);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

function urlPill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  roundRect(g, x, y, w, h, h / 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.font = `800 ${Math.round(h * 0.5)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = PURPLE;
  g.fillText(URL_TEXT, x + w / 2, y + h * 0.53);
  g.textBaseline = 'alphabetic';
}

function landscape(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number): void {
  background(g, x, y, w, h, v);
  const lines = [
    ['ÖFFNE JETZT', 'DEINEN BOOSTER!'],
    ['ALLE 30 MINUTEN', 'EIN NEUER BOOSTER'],
    ['SAMMELN.', 'TAUSCHEN. ÖFFNEN.'],
    ['KOSTENLOS', 'IM BROWSER SPIELEN'],
  ][v % 4];
  text(g, BRAND, x + w * 0.05, y + h * 0.23, h * 0.16, '#ffe14d');
  text(g, lines[0], x + w * 0.05, y + h * 0.46, h * 0.15);
  text(g, lines[1], x + w * 0.05, y + h * 0.64, h * 0.13);
  urlPill(g, x + w * 0.05, y + h * 0.74, w * 0.5, h * 0.15);
  if (v % 2 === 0) {
    booster(g, x + w * 0.62, y + h * 0.08, w * 0.17, h * 0.84, 270 + v * 20, -0.12);
    booster(g, x + w * 0.78, y + h * 0.12, w * 0.17, h * 0.8, 200 + v * 15, 0.1);
  } else {
    card(g, x + w * 0.6, y + h * 0.16, w * 0.15, h * 0.72, 300, -0.25);
    card(g, x + w * 0.7, y + h * 0.1, w * 0.15, h * 0.72, 200, 0);
    card(g, x + w * 0.8, y + h * 0.16, w * 0.15, h * 0.72, 30, 0.25);
  }
  // Rahmen
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.strokeRect(x + 5, y + 5, w - 10, h - 10);
}

function portrait(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number): void {
  background(g, x, y, w, h, v + 1);
  text(g, BRAND, x + w / 2, y + h * 0.1, w * 0.15, '#ffe14d', 'center');
  const head = [['BOOSTER', 'ÖFFNEN!'], ['ALLE', '30 MIN'], ['JETZT', 'SAMMELN'], ['NEUE', 'KARTEN']][v % 4];
  text(g, head[0], x + w / 2, y + h * 0.19, w * 0.13, '#ffffff', 'center');
  text(g, head[1], x + w / 2, y + h * 0.27, w * 0.15, '#ffffff', 'center');
  if (v % 2 === 0) booster(g, x + w * 0.22, y + h * 0.32, w * 0.56, h * 0.5, 260 + v * 30, 0.06);
  else {
    card(g, x + w * 0.12, y + h * 0.36, w * 0.42, h * 0.38, 280, -0.2);
    card(g, x + w * 0.46, y + h * 0.36, w * 0.42, h * 0.38, 190, 0.2);
  }
  g.font = `800 ${Math.round(w * 0.055)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  g.fillText('poketrade.', x + w / 2, y + h * 0.88);
  g.fillText('patrick-thomas.de', x + w / 2, y + h * 0.93);
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.strokeRect(x + 5, y + 5, w - 10, h - 10);
}

/** Leuchtreklame: Schriftzug auf dunklem Grund (nachts stark leuchtend) */
function neon(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number): void {
  g.fillStyle = '#0b0820';
  g.fillRect(x, y, w, h);
  g.save();
  g.shadowColor = v % 2 ? '#ff5ec4' : '#9b7bff';
  g.shadowBlur = h * 0.12;
  text(g, BRAND, x + w / 2, y + h * 0.6, h * 0.42, v % 2 ? '#ffd2f1' : '#e6dcff', 'center');
  g.shadowBlur = h * 0.06;
  g.font = `700 ${Math.round(h * 0.15)}px system-ui, sans-serif`;
  g.fillStyle = '#ffe14d';
  g.textAlign = 'center';
  g.fillText(v % 2 ? 'BOOSTER ALLE 30 MIN' : URL_TEXT, x + w / 2, y + h * 0.85);
  g.restore();
  star(g, x + w * 0.07, y + h * 0.45, h * 0.18, '#ffe14d');
  star(g, x + w * 0.93, y + h * 0.45, h * 0.18, '#ffe14d');
}

/** Material mit der Werbe-Texturkarte (einmalig gezeichnet) */
export function adMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  const reg = (x: number, y: number, w: number, h: number): AdRegion => ({ u0: x / SIZE, v0: 1 - (y + h) / SIZE, u1: (x + w) / SIZE, v1: 1 - y / SIZE });
  // 4 Querformate (1024 x 512), 4 Hochformate (512 x 1024), 2 Leuchtschriften (1024 x 256)
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 1024;
    const y = Math.floor(i / 2) * 512;
    landscape(g, x, y, 1024, 512, i);
    AD.landscape.push(reg(x, y, 1024, 512));
  }
  for (let i = 0; i < 4; i++) {
    const x = i * 512;
    portrait(g, x, 1024, 512, 768, i);
    AD.portrait.push(reg(x, 1024, 512, 768));
  }
  for (let i = 0; i < 2; i++) {
    neon(g, i * 1024, 1792, 1024, 256, i);
    AD.neon.push(reg(i * 1024, 1792, 1024, 256));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  material = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.45, transparent: true, side: THREE.DoubleSide });
  // nachts heller (Hinterleuchtung)
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = lit.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 + uNight * 2.0;');
  };
  return material;
}
