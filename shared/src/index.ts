/**
 * Datenformat der generierten Welt.
 *
 * Koordinaten: Meter in einem lokalen, ebenen System (ETRS89 / UTM 32N, EPSG:25832),
 * verschoben auf einen Ursprung in der Nürnberger Altstadt. x = Osten, y = Norden.
 * In den Kachel-Dateien sind alle Koordinaten auf Dezimeter gerundet und als Ganzzahlen
 * gespeichert (flache Arrays [x0, y0, x1, y1, ...]); `dm()` / `fromDm()` rechnen um.
 */

export const FORMAT_VERSION = 1;
export const TILE_SIZE = 250; // Meter

export const dm = (m: number): number => Math.round(m * 10);
export const fromDm = (v: number): number => v / 10;

export function tileKey(tx: number, ty: number): string {
  return `${tx}_${ty}`;
}

export function tileOf(x: number, y: number): [number, number] {
  return [Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)];
}

/** Straßenklassen (aus OSM highway=*), sortiert nach Bedeutung. */
export type RoadClass =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'unclassified'
  | 'residential'
  | 'living_street'
  | 'service'
  | 'track'
  | 'pedestrian';

/** Regelung am Ende einer Fahrspur (Einfahrt in eine Kreuzung). */
export type LaneControl =
  | 'none' // keine Kreuzung (Fortsetzung derselben Straße)
  | 'signal' // Lichtsignalanlage
  | 'stop' // Stoppschild
  | 'yield' // Vorfahrt gewähren
  | 'priority' // Vorfahrtstraße
  | 'rbl' // rechts vor links
  | 'end'; // Sackgasse

export type Turn = 'through' | 'left' | 'right' | 'uturn' | 'merge';

/** Gemeinsame Felder aller Objekte mit globaler ID (Duplikate über Kachelgrenzen werden per ID erkannt). */
interface Identified {
  id: number;
}

export interface RoadSurface extends Identified {
  /** 'seg' = Straßenabschnitt, 'jct' = Kreuzungsfläche */
  k: 'seg' | 'jct';
  cls: RoadClass;
  /** OSM layer (Brücken > 0, Tunnel < 0) */
  layer: number;
  bridge?: 1;
  tunnel?: 1;
  /** Umriss als geschlossener Ring (dm) */
  ring: number[];
  /** Umriss inklusive Gehwegen (dm); fehlt, wenn es keinen Gehweg gibt */
  sw?: number[];
  /** Bordstein-/Fahrbahnränder als Polylinien (dm) */
  kerbs?: number[][];
}

/** Fahrbahnfarbe/Bodenmarkierung als Fläche (Zebrastreifen, Furten, Pfeile) */
export interface Paint {
  k: 'white' | 'yellow';
  layer: number;
  ring: number[];
}

export interface Marking {
  /** 'solid' | 'dashed' | 'stop' (Haltelinie) | 'edge' */
  k: 'solid' | 'dashed' | 'stop' | 'edge';
  layer: number;
  pts: number[];
}

export interface StopPoint {
  /** Abstand ab Spuranfang in Metern */
  s: number;
  ctrl: number;
  grp: number;
}

export interface Lane extends Identified {
  /** Straßenabschnitt (Segment-ID) */
  seg: number;
  /** 1 = in Digitalisierrichtung des Abschnitts, -1 = entgegen */
  dir: 1 | -1;
  /** Spurindex von links (0) nach rechts */
  idx: number;
  /** Anzahl Spuren in dieser Richtung */
  n: number;
  /** Breite in Metern */
  w: number;
  /** Tempolimit km/h */
  vmax: number;
  cls: RoadClass;
  layer: number;
  /** erlaubte Fahrtrichtungen laut turn:lanes (falls vorhanden) */
  turns?: string;
  /** Mittellinie (dm) */
  pts: number[];
  /** Länge in Metern */
  len: number;
  /** Regelung am Spurende */
  ctrl: LaneControl;
  /** Haltepunkte an Ampeln (an der Kreuzung oder mitten im Abschnitt, z. B. Fußgängerampel) */
  stops?: StopPoint[];
  /** ausgehende Verbinder-IDs */
  out: number[];
  name?: string;
  /** 1 = liegt außerhalb des zusammenhängenden Hauptnetzes (Parkplatz, Stummel an der Stadtgrenze …) */
  iso?: 1;
}

export interface Connector extends Identified {
  /** Kreuzungsknoten */
  node: number;
  from: number; // Lane-ID
  to: number; // Lane-ID
  turn: Turn;
  pts: number[];
  len: number;
}

export interface SignalHead extends Identified {
  ctrl: number;
  grp: number;
  /** Position (dm) */
  x: number;
  y: number;
  /** Fahrtrichtung der geregelten Spuren in Grad (0 = Osten, gegen den Uhrzeigersinn) */
  hdg: number;
  /** Stellung über die Fahrbahn: Breite der Haltelinie in m */
  w: number;
}

export interface Building extends Identified {
  /** Höhe in Metern (aus height, building:levels oder Schätzung) */
  h: number;
  /** OSM building=* Wert */
  t: string;
  /** min_height (z. B. für Durchfahrten / Brückenbauten) */
  minH?: number;
  /** Dachform (OSM roof:shape) */
  rs?: string;
  /** Dachfarbe (RGB) aus roof:colour */
  rc?: number;
  outer: number[];
  holes?: number[][];
  name?: string;
}

export type AreaKind =
  | 'water'
  | 'park'
  | 'grass'
  | 'forest'
  | 'farmland'
  | 'parking'
  | 'pedestrian'
  | 'railway'
  | 'industrial'
  | 'residential'
  | 'commercial'
  | 'cemetery'
  | 'sports';

export interface Area extends Identified {
  k: AreaKind;
  outer: number[];
  holes?: number[][];
}

export type LineKind = 'footway' | 'cycleway' | 'path' | 'steps' | 'rail' | 'tram' | 'subway' | 'river' | 'stream' | 'hedge' | 'wall' | 'citywall' | 'fence';

export interface Line extends Identified {
  k: LineKind;
  layer: number;
  pts: number[];
}

/** Beschriftung eines Straßenabschnitts: Mittelpunkt (dm), Richtung in Grad, Länge (m) */
export interface RoadLabel {
  n: string;
  x: number;
  y: number;
  a: number;
  len: number;
  cls: RoadClass;
  layer: number;
}

export interface Tile {
  v: number;
  tx: number;
  ty: number;
  surfaces: RoadSurface[];
  markings: Marking[];
  lanes: Lane[];
  connectors: Connector[];
  signals: SignalHead[];
  buildings: Building[];
  areas: Area[];
  lines: Line[];
  labels?: RoadLabel[];
  paint?: Paint[];
  /** Bäume: flach [x, y, Kronenradius] in dm */
  trees?: number[];
}

export interface SignalPhase {
  /** Gruppen, die in dieser Phase grün haben */
  green: number[];
  /** Dauer grün / gelb / alles-rot in Sekunden */
  g: number;
  y: number;
  r: number;
}

export interface SignalController {
  id: number;
  /** Mittelpunkt (dm) */
  x: number;
  y: number;
  phases: SignalPhase[];
  /** Versatz in Sekunden (Grüne Welle kommt später) */
  offset: number;
  /** 'junction' = Kreuzung, 'crossing' = Fußgängerampel */
  k: 'junction' | 'crossing';
}

export type SignalState = 'green' | 'yellow' | 'red';

export function cycleLength(c: SignalController): number {
  return c.phases.reduce((t, p) => t + p.g + p.y + p.r, 0);
}

/** Zustand einer Signalgruppe zur Zeit t (Sekunden). */
export function signalState(c: SignalController, grp: number, t: number): SignalState {
  const cycle = cycleLength(c);
  let tc = (((t + c.offset) % cycle) + cycle) % cycle;
  for (const p of c.phases) {
    const isGreen = p.green.includes(grp);
    if (tc < p.g) return isGreen ? 'green' : 'red';
    tc -= p.g;
    if (tc < p.y) return isGreen ? 'yellow' : 'red';
    tc -= p.y;
    if (tc < p.r) return 'red';
    tc -= p.r;
  }
  return 'red';
}

export interface OverviewRoad {
  cls: RoadClass;
  pts: number[];
}

export interface Manifest {
  v: number;
  generatedAt: string;
  source: string;
  attribution: string;
  crs: string;
  /** Ursprung des lokalen Systems in EPSG:25832 und WGS84 */
  origin: { e: number; n: number; lon: number; lat: number };
  tileSize: number;
  /** vorhandene Kacheln */
  tiles: string[];
  /** Ausdehnung in Metern (lokal) */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Stadtgrenze (dm, vereinfacht) */
  boundary: number[][];
  stats: Record<string, number>;
}

export interface Overview {
  roads: OverviewRoad[];
}

export interface Place {
  name: string;
  x: number;
  y: number;
  /** suburb, quarter, neighbourhood, village, hamlet, attraction, station, townhall */
  kind?: string;
}

// ------------------------------------------------------------------ Navigation und Aufträge

export const ROUTING_MAGIC = 0x3153524e; // "NRS1"
export const TURN_CODES: Turn[] = ['through', 'left', 'right', 'uturn', 'merge'];

/** Flags je Spur im Routinggraphen */
export const LANE_ISO = 1;
export const LANE_SIGNAL = 2;
export const LANE_MINOR_CTRL = 4;
export const LANE_SERVICE = 8;

/** Routinggraph über alle Spuren (Kanten = Spurverbinder) */
export interface RoutingGraph {
  n: number;
  e: number;
  x0: Int32Array;
  y0: Int32Array;
  x1: Int32Array;
  y1: Int32Array;
  name: Int32Array;
  outStart: Uint32Array;
  len: Float32Array;
  target: Int32Array;
  conLen: Float32Array;
  vmax: Uint8Array;
  flags: Uint8Array;
  layer: Int8Array;
  turn: Uint8Array;
}

export function parseRouting(buf: ArrayBuffer): RoutingGraph {
  const head = new Int32Array(buf, 0, 4);
  if (head[0] !== ROUTING_MAGIC) throw new Error('routing.bin: falsches Format');
  const n = head[1];
  const e = head[2];
  let o = 16;
  const i32 = (k: number) => {
    const a = new Int32Array(buf, o, k);
    o += k * 4;
    return a;
  };
  const x0 = i32(n);
  const y0 = i32(n);
  const x1 = i32(n);
  const y1 = i32(n);
  const name = i32(n);
  const outStart = new Uint32Array(buf, o, n + 1);
  o += (n + 1) * 4;
  const len = new Float32Array(buf, o, n);
  o += n * 4;
  const target = i32(e);
  const conLen = new Float32Array(buf, o, e);
  o += e * 4;
  const vmax = new Uint8Array(buf, o, n);
  o += n;
  const flags = new Uint8Array(buf, o, n);
  o += n;
  const layer = new Int8Array(buf, o, n);
  o += n;
  const turn = new Uint8Array(buf, o, e);
  return { n, e, x0, y0, x1, y1, name, outStart, len, target, conLen, vmax, flags, layer, turn };
}

/** Adressen: a = flach [Straßenindex, x(dm), y(dm), Spur, s(dm)] je Adresse; nums parallel dazu */
export interface AddressFile {
  streets: string[];
  nums: string[];
  a: number[];
}

export interface Poi {
  n: string; // Name
  c: string; // Kategorie (food, shop, hotel, health, station, culture, school, emergency, office)
  t: string; // OSM-Unterart
  x: number; // dm
  y: number;
  l: number; // Spur
  s: number; // dm auf der Spur
}

export interface PoiFile {
  pois: Poi[];
}

/** Buslinien (je Fahrtrichtung) mit Haltestellen in Fahrtreihenfolge */
export interface BusFile {
  lines: Array<{
    ref: string;
    name: string;
    stops: Array<{ n: string; x: number; y: number; l: number; s: number }>;
  }>;
}
