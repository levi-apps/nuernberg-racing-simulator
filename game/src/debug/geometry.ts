/**
 * Baut zusammengefasste Three.js-Geometrien aus Kachel-Daten (Koordinaten in dm).
 */
import * as THREE from 'three';
import earcut from 'earcut';

const tmp = new THREE.Color();

/** Sammelt gefüllte Polygone in einer Geometrie (Vertex-Farben). */
export class FillBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  add(outer: number[], holes: number[][] | undefined, color: number, z = 0): void {
    const coords: number[] = [];
    const holeIdx: number[] = [];
    const push = (ring: number[]) => {
      for (let i = 0; i < ring.length; i += 2) coords.push(ring[i] / 10, ring[i + 1] / 10);
    };
    push(outer);
    if (holes)
      for (const h of holes) {
        holeIdx.push(coords.length / 2);
        push(h);
      }
    const tris = earcut(coords, holeIdx.length ? holeIdx : undefined, 2);
    if (!tris.length) return;
    const base = this.pos.length / 3;
    tmp.setHex(color);
    for (let i = 0; i < coords.length; i += 2) {
      this.pos.push(coords[i], coords[i + 1], z);
      this.col.push(tmp.r, tmp.g, tmp.b);
    }
    for (const t of tris) this.idx.push(base + t);
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

/** Sammelt Linienzüge als LineSegments (Vertex-Farben), optional gestrichelt. */
export class LineBuilder {
  private pos: number[] = [];
  private col: number[] = [];

  add(pts: number[], color: number, z = 0, dash?: [number, number]): void {
    tmp.setHex(color);
    if (!dash) {
      for (let i = 2; i < pts.length; i += 2) this.seg(pts[i - 2] / 10, pts[i - 1] / 10, pts[i] / 10, pts[i + 1] / 10, z);
      return;
    }
    // gestrichelt: entlang der Linie Striche erzeugen
    const [on, off] = dash;
    let phase = 0;
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2] / 10;
      const ay = pts[i - 1] / 10;
      const bx = pts[i] / 10;
      const by = pts[i + 1] / 10;
      const l = Math.hypot(bx - ax, by - ay);
      let s = 0;
      while (s < l) {
        const inOn = phase < on;
        const step = Math.min(l - s, inOn ? on - phase : on + off - phase);
        if (inOn) {
          const t0 = s / l;
          const t1 = (s + step) / l;
          this.seg(ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1, z);
        }
        s += step;
        phase = (phase + step) % (on + off);
      }
    }
  }

  /** Pfeilspitzen entlang einer Linie (Abstand in m) */
  arrows(pts: number[], color: number, z: number, every: number, size: number): void {
    tmp.setHex(color);
    let acc = every / 2;
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2] / 10;
      const ay = pts[i - 1] / 10;
      const bx = pts[i] / 10;
      const by = pts[i + 1] / 10;
      const l = Math.hypot(bx - ax, by - ay);
      if (l === 0) continue;
      const dx = (bx - ax) / l;
      const dy = (by - ay) / l;
      while (acc <= l) {
        const px = ax + dx * acc;
        const py = ay + dy * acc;
        const nx = -dy;
        const ny = dx;
        this.seg(px, py, px - dx * size + nx * size * 0.6, py - dy * size + ny * size * 0.6, z);
        this.seg(px, py, px - dx * size - nx * size * 0.6, py - dy * size - ny * size * 0.6, z);
        acc += every;
      }
      acc -= l;
    }
  }

  private seg(ax: number, ay: number, bx: number, by: number, z: number) {
    this.pos.push(ax, ay, z, bx, by, z);
    this.col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

/** Kleine Marker (Quadrate/Dreiecke) mit änderbarer Farbe – als Dreiecksnetz. */
export class MarkerBuilder {
  pos: number[] = [];
  col: number[] = [];
  /** pro Marker: Startindex im Farbarray und Anzahl Vertices */
  slots: Array<{ start: number; count: number }> = [];

  /** Raute/Quadrat mit Kantenlänge size (m) */
  square(x: number, y: number, size: number, color: number, z = 0): number {
    const h = size / 2;
    return this.poly(
      [
        [x - h, y - h],
        [x + h, y - h],
        [x + h, y + h],
        [x - h, y - h],
        [x + h, y + h],
        [x - h, y + h],
      ],
      color,
      z,
    );
  }

  /** Kreis-Annäherung (8 Segmente) */
  disc(x: number, y: number, r: number, color: number, z = 0): number {
    const pts: Array<[number, number]> = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      pts.push([x, y], [x + Math.cos(a0) * r, y + Math.sin(a0) * r], [x + Math.cos(a1) * r, y + Math.sin(a1) * r]);
    }
    return this.poly(pts, color, z);
  }

  private poly(pts: Array<[number, number]>, color: number, z: number): number {
    tmp.setHex(color);
    const start = this.col.length;
    for (const [x, y] of pts) {
      this.pos.push(x, y, z);
      this.col.push(tmp.r, tmp.g, tmp.b);
    }
    this.slots.push({ start, count: pts.length });
    return this.slots.length - 1;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const c = new THREE.Float32BufferAttribute(this.col, 3);
    c.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('color', c);
    return g;
  }
}

export function setSlotColor(attr: THREE.BufferAttribute, slot: { start: number; count: number }, color: number): void {
  tmp.setHex(color);
  const a = attr.array as Float32Array;
  for (let i = 0; i < slot.count; i++) {
    a[slot.start + i * 3] = tmp.r;
    a[slot.start + i * 3 + 1] = tmp.g;
    a[slot.start + i * 3 + 2] = tmp.b;
  }
}
