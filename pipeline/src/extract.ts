/**
 * Liest den OSM-Auszug, projiziert in lokale Meter und schneidet auf das Stadtgebiet zu.
 */
import type { AreaKind, LineKind, RoadClass } from '@nrs/shared';
import { assembleRings, bufferLine, project, RegionSet, ringArea, ringCentroid, simplify, type Pt } from './geo.ts';
import { readOsmPbf, type Member, type Tags } from './pbf/reader.ts';
import { areaKind, buildingHeight, layerOf, lineKind, roadClass } from './tags.ts';

export interface RawRoad {
  id: number; // OSM way id
  cls: RoadClass;
  tags: Tags;
  nodes: number[];
  pts: Pt[];
}

export interface RawPoint {
  id: number;
  p: Pt;
  tags: Tags;
}

export interface RawRestriction {
  type: string; // no_left_turn, only_straight_on, ...
  from: number; // way id
  via: number; // node id
  to: number; // way id
}

export interface RawBuilding {
  id: number;
  t: string;
  h: number;
  minH?: number;
  rs?: string;
  rc?: number;
  outer: Pt[];
  holes: Pt[][];
  name?: string;
}

export interface RawArea {
  id: number;
  k: AreaKind;
  outer: Pt[];
  holes: Pt[][];
}

export interface RawLine {
  id: number;
  k: LineKind;
  layer: number;
  pts: Pt[];
}

export interface Extract {
  boundary: Pt[][];
  regions: Region[];
  inside: RegionSet;
  roads: RawRoad[];
  /** Knoten mit Bedeutung für Verkehrsregelung (Ampeln, Stopp, Vorfahrt, Übergänge) */
  controlNodes: Map<number, RawPoint>;
  restrictions: RawRestriction[];
  buildings: RawBuilding[];
  areas: RawArea[];
  lines: RawLine[];
  places: Array<{ name: string; p: Pt; kind: string }>;
  /** Bäume: [x, y, Kronenradius] */
  trees: Array<[number, number, number]>;
  /** Buslinien mit Haltestellen in Fahrtreihenfolge */
  busLines: Array<{ ref: string; name: string; stops: Array<{ name: string; p: Pt }> }>;
  addresses: RawAddress[];
  pois: RawPoi[];
}

export interface RawAddress {
  street: string;
  num: string;
  p: Pt;
}

export type PoiCat = 'food' | 'shop' | 'hotel' | 'health' | 'station' | 'culture' | 'school' | 'emergency' | 'office' | 'car';

export interface RawPoi {
  name: string;
  cat: PoiCat;
  sub: string;
  p: Pt;
}

/** Kategorie eines benannten Orts (für Aufträge) */
/** Name eines Orts; Tankstellen und Waschanlagen haben oft nur eine Marke */
export function poiName(t: Tags): string | undefined {
  if (t.name) return t.name;
  if (t.amenity === 'fuel') return t.brand ? `${t.brand} Tankstelle` : 'Tankstelle';
  if (t.amenity === 'car_wash') return t.brand ? `${t.brand} Waschanlage` : 'Waschanlage';
  return undefined;
}

export function poiCat(t: Tags): { cat: PoiCat; sub: string } | null {
  const a = t.amenity;
  if (a === 'fuel' || a === 'car_wash') return { cat: 'car', sub: a };
  if (t.shop === 'tyres' || t.shop === 'car_parts') return { cat: 'car', sub: t.shop };
  if (a === 'restaurant' || a === 'fast_food' || a === 'cafe' || a === 'ice_cream' || a === 'biergarten' || a === 'pub' || a === 'bar') return { cat: 'food', sub: a };
  if (a === 'hospital' || a === 'clinic' || a === 'doctors' || a === 'pharmacy') return { cat: 'health', sub: a };
  if (a === 'police' || a === 'fire_station') return { cat: 'emergency', sub: a };
  if (a === 'cinema' || a === 'theatre' || a === 'arts_centre' || a === 'nightclub') return { cat: 'culture', sub: a };
  if (a === 'school' || a === 'university' || a === 'college') return { cat: 'school', sub: a };
  if (t.tourism === 'hotel' || t.tourism === 'hostel' || t.tourism === 'guest_house') return { cat: 'hotel', sub: t.tourism };
  if (t.tourism === 'museum' || t.tourism === 'attraction' || t.tourism === 'zoo') return { cat: 'culture', sub: t.tourism };
  if (t.railway === 'station' || (t.public_transport === 'station' && t.train === 'yes')) return { cat: 'station', sub: 'station' };
  if (t.shop) return { cat: 'shop', sub: t.shop };
  if (t.office === 'company' || t.office === 'government') return { cat: 'office', sub: t.office };
  return null;
}

/** Sortierte Knotentabelle (IDs aufsteigend wie in der PBF-Datei) */
class NodeStore {
  ids = new Float64Array(1 << 20);
  xs = new Float32Array(1 << 20);
  ys = new Float32Array(1 << 20);
  n = 0;
  sorted = true;
  push(id: number, x: number, y: number) {
    if (this.n === this.ids.length) {
      const grow = <T extends Float64Array | Float32Array>(a: T): T => {
        const b = new (a.constructor as { new (n: number): T })(a.length * 2);
        b.set(a);
        return b;
      };
      this.ids = grow(this.ids);
      this.xs = grow(this.xs);
      this.ys = grow(this.ys);
    }
    if (this.n > 0 && id < this.ids[this.n - 1]) this.sorted = false;
    this.ids[this.n] = id;
    this.xs[this.n] = x;
    this.ys[this.n] = y;
    this.n++;
  }
  find(id: number): number {
    let lo = 0;
    let hi = this.n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.ids[mid];
      if (v === id) return mid;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
}

/** Nürnberg: kreisfreie Stadt, OSM-Relation 62780 */
const CITY_RELATION = 62780;
/** Roth (Große Kreisstadt, Landkreis Roth), OSM-Relation 158556 */
const ROTH_RELATION = 158556;
/** Ortsmitte Roth (Marktplatz) – Ziel der Verbindungsstraße */
const ROTH_CENTER: [number, number] = [11.0909, 49.2459];
/** Breite (halb) des befahrbaren Korridors zwischen den Städten, m */
const CORRIDOR_W = 160;
/** Grobe Box mit Rand um die Stadtgebiete (WGS84), um Projektion zu sparen */
const BOX = { minLon: 10.93, maxLon: 11.26, minLat: 49.17, maxLat: 49.58 };

/** Gebiete der Spielwelt */
export interface Region {
  name: string;
  rings: Pt[][];
  /** Korridor: nicht als Stadtgrenze zeichnen */
  corridor?: boolean;
}

export function extract(pbfPath: string, log: (s: string) => void): Extract {
  const nodes = new NodeStore();
  const controlNodes = new Map<number, RawPoint>();
  const placeNodes: Array<{ name: string; p: Pt; kind: string }> = [];
  const addrPts: RawAddress[] = [];
  const treePts: Array<[number, number, number]> = [];
  const busStops = new Map<number, { name: string; p: Pt }>();
  const treeRows: number[][] = [];
  const poiPts: RawPoi[] = [];
  type PW = { refs: number[]; tags: Tags };
  /** Wege (meist Gebäude) mit Adresse oder Name -> Mittelpunkt */
  const tagWays: PW[] = [];

  // Wege: nach Typ getrennt sammeln
  type W = { id: number; refs: number[]; tags: Tags };
  const roadWays: W[] = [];
  const buildingWays: W[] = [];
  const areaWays: W[] = [];
  const lineWays: W[] = [];
  /** Wege, die als Mitglied einer Multipolygon-/Grenzrelation gebraucht werden könnten */
  const memberCandidates = new Map<number, number[]>();

  const relations: Array<{ id: number; members: Member[]; tags: Tags }> = [];
  const busRels: Array<{ id: number; members: Member[]; tags: Tags }> = [];

  const isControl = (t: Tags) =>
    t.highway === 'traffic_signals' ||
    t.highway === 'stop' ||
    t.highway === 'give_way' ||
    t.highway === 'crossing' ||
    t.highway === 'mini_roundabout' ||
    t.highway === 'turning_circle' ||
    t.crossing === 'traffic_signals';

  log('OSM lesen …');
  readOsmPbf(pbfPath, {
    node(id, lon, lat, tags) {
      if (lon < BOX.minLon || lon > BOX.maxLon || lat < BOX.minLat || lat > BOX.maxLat) return;
      const [x, y] = project(lon, lat);
      nodes.push(id, x, y);
      if (tags) {
        if (isControl(tags)) controlNodes.set(id, { id, p: [x, y], tags });
        const isBusStop =
          tags.highway === 'bus_stop' ||
          ((tags.public_transport === 'platform' || tags.public_transport === 'stop_position') && (tags.bus === 'yes' || tags.highway === 'bus_stop'));
        if (isBusStop && tags.name) busStops.set(id, { name: tags.name, p: [x, y] });
        if (tags.natural === 'tree') {
          const dc = parseFloat(tags.diameter_crown ?? '');
          treePts.push([x, y, Number.isFinite(dc) && dc > 1 && dc < 30 ? dc / 2 : 0]);
        }
        if (tags['addr:housenumber'] && tags['addr:street']) addrPts.push({ street: tags['addr:street'], num: tags['addr:housenumber'], p: [x, y] });
        const pname = poiName(tags);
        if (pname) {
          const pc = poiCat(tags);
          if (pc) poiPts.push({ name: pname, ...pc, p: [x, y] });
        }
        if (
          tags.name &&
          (tags.place === 'town' ||
            tags.place === 'suburb' ||
            tags.place === 'quarter' ||
            tags.place === 'neighbourhood' ||
            tags.place === 'village' ||
            tags.place === 'hamlet' ||
            tags.tourism === 'attraction' ||
            tags.railway === 'station' ||
            tags.amenity === 'townhall')
        )
          placeNodes.push({ name: tags.name, p: [x, y], kind: tags.place ?? tags.tourism ?? tags.railway ?? tags.amenity ?? '' });
      }
    },
    way(id, refs, tags) {
      if ((tags['addr:housenumber'] && tags['addr:street']) || (poiName(tags) && poiCat(tags))) tagWays.push({ refs, tags });
      if (tags.natural === 'tree_row') treeRows.push(refs);
      if (roadClass(tags)) roadWays.push({ id, refs, tags });
      else if (tags.building && tags.building !== 'no') buildingWays.push({ id, refs, tags });
      else if (lineKind(tags)) lineWays.push({ id, refs, tags });
      else if (areaKind(tags)) areaWays.push({ id, refs, tags });
      // jeder Weg kann Mitglied eines Multipolygons sein – nur die Knoten-IDs merken
      if (refs.length && nodes.find(refs[0]) >= 0) memberCandidates.set(id, refs);
    },
    relation(id, members, tags) {
      const t = tags.type;
      if (t === 'multipolygon' || t === 'restriction' || id === CITY_RELATION || id === ROTH_RELATION || t === 'building') relations.push({ id, members, tags });
      if (t === 'route' && (tags.route === 'bus' || tags.route === 'trolleybus')) busRels.push({ id, members, tags });
    },
  });
  if (!nodes.sorted) throw new Error('PBF-Knoten nicht nach ID sortiert');
  log(`  ${nodes.n.toLocaleString('de')} Knoten in der Box, ${roadWays.length.toLocaleString('de')} Straßenwege`);

  const resolve = (refs: number[]): { ids: number[]; pts: Pt[] } | null => {
    const pts: Pt[] = [];
    const ids: number[] = [];
    for (const r of refs) {
      const i = nodes.find(r);
      if (i < 0) return null; // Weg reicht aus der Box hinaus
      pts.push([nodes.xs[i], nodes.ys[i]]);
      ids.push(r);
    }
    return { ids, pts };
  };

  // Stadtgrenze
  const city = relations.find((r) => r.id === CITY_RELATION);
  if (!city) throw new Error('Stadtgrenze Nürnberg (Relation 62780) nicht gefunden');
  const outerWays = city.members
    .filter((m) => m.type === 'way' && m.role !== 'inner')
    .map((m) => resolve(memberCandidates.get(m.ref) ?? []))
    .filter((w): w is { ids: number[]; pts: Pt[] } => !!w);
  const boundary = assembleRings(outerWays);
  if (!boundary.length) throw new Error('Stadtgrenze konnte nicht zusammengesetzt werden');
  const regions: Region[] = [{ name: 'Nürnberg', rings: boundary }];
  // Roth
  const rothRel = relations.find((r) => r.id === ROTH_RELATION);
  if (rothRel) {
    const rw = rothRel.members
      .filter((m) => m.type === 'way' && m.role !== 'inner')
      .map((m) => resolve(memberCandidates.get(m.ref) ?? []))
      .filter((w): w is { ids: number[]; pts: Pt[] } => !!w);
    const rings = assembleRings(rw);
    if (rings.length) {
      regions.push({ name: 'Roth', rings });
      log(`  Roth: ${rings.length} Ring(e), ${(Math.abs(rings.reduce((a, r) => a + ringArea(r), 0)) / 1e6).toFixed(1)} km²`);
      const path = mainRoadPath(roadWays, resolve, [0, 0], project(ROTH_CENTER[0], ROTH_CENTER[1]));
      if (path.length > 1) {
        const ring = bufferLine(simplify(path, 40), CORRIDOR_W);
        regions.push({ name: 'Verbindungsstraße', rings: [ring], corridor: true });
        let len = 0;
        for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        log(`  Verbindung Nürnberg – Roth: ${(len / 1000).toFixed(1)} km`);
      } else log('  Keine Straßenverbindung nach Roth gefunden');
    }
  } else log('  Roth (Relation 158556) nicht gefunden');
  const inside = new RegionSet(
    regions.map((r) => r.rings),
    100,
  );
  log(
    `  Stadtgrenze: ${boundary.length} Ring(e), ${boundary.reduce((a, r) => a + r.length, 0)} Punkte, ${(Math.abs(boundary.reduce((a, r) => a + ringArea(r), 0)) / 1e6).toFixed(1)} km²`,
  );

  const anyInside = (pts: Pt[]) => pts.some((p) => inside.contains(p));
  // Puffer: Straßen knapp außerhalb der Grenze behalten, damit Kreuzungen an der Grenze vollständig sind
  const nearInside = (pts: Pt[]) => anyInside(pts);

  // Straßen
  const roads: RawRoad[] = [];
  for (const w of roadWays) {
    const r = resolve(w.refs);
    if (!r || r.pts.length < 2) continue;
    if (!nearInside(r.pts)) continue;
    roads.push({ id: w.id, cls: roadClass(w.tags)!, tags: w.tags, nodes: r.ids, pts: r.pts });
  }

  // Gebäude
  const buildings: RawBuilding[] = [];
  const pushBuilding = (id: number, tags: Tags, outer: Pt[], holes: Pt[][]) => {
    if (outer.length < 3) return;
    if (!inside.contains(ringCentroid(outer))) return;
    if (tags.building === 'roof' || tags.location === 'underground') return;
    const { h, minH } = buildingHeight(tags);
    buildings.push({
      id,
      t: tags.building ?? 'yes',
      h,
      minH,
      outer,
      holes,
      name: tags.name,
      rs: tags['roof:shape'],
      rc: parseColour(tags['roof:colour'] ?? tags['building:roof:colour']),
    });
  };
  for (const w of buildingWays) {
    const r = resolve(w.refs);
    if (!r || r.ids[0] !== r.ids[r.ids.length - 1]) continue;
    pushBuilding(w.id, w.tags, r.pts.slice(0, -1), []);
  }

  // Flächen
  const areas: RawArea[] = [];
  const pushArea = (id: number, k: AreaKind, outer: Pt[], holes: Pt[][]) => {
    if (outer.length < 3) return;
    if (!anyInside(outer)) return;
    areas.push({ id, k, outer, holes });
  };
  for (const w of areaWays) {
    const r = resolve(w.refs);
    if (!r || r.ids[0] !== r.ids[r.ids.length - 1]) continue;
    pushArea(w.id, areaKind(w.tags)!, r.pts.slice(0, -1), []);
  }

  // Multipolygone (Gebäude und Flächen) und Abbiegeverbote
  const restrictions: RawRestriction[] = [];
  let mpCount = 0;
  for (const rel of relations) {
    if (rel.tags.type === 'restriction') {
      const kind = rel.tags.restriction ?? rel.tags['restriction:motorcar'] ?? rel.tags['restriction:motor_vehicle'];
      if (!kind) continue;
      if (rel.tags.except && /motorcar/.test(rel.tags.except)) continue;
      const from = rel.members.find((m) => m.role === 'from' && m.type === 'way');
      const to = rel.members.find((m) => m.role === 'to' && m.type === 'way');
      const via = rel.members.find((m) => m.role === 'via' && m.type === 'node');
      if (from && to && via) restrictions.push({ type: kind, from: from.ref, via: via.ref, to: to.ref });
      continue;
    }
    if (rel.tags.type !== 'multipolygon') continue;
    const isBuilding = rel.tags.building && rel.tags.building !== 'no';
    const ak = isBuilding ? null : areaKind(rel.tags);
    if (!isBuilding && !ak) continue;
    const getWays = (inner: boolean) =>
      rel.members
        .filter((m) => m.type === 'way' && (inner ? m.role === 'inner' : m.role !== 'inner'))
        .map((m) => resolve(memberCandidates.get(m.ref) ?? []))
        .filter((w): w is { ids: number[]; pts: Pt[] } => !!w);
    const outers = assembleRings(getWays(false));
    const inners = assembleRings(getWays(true));
    for (const outer of outers) {
      const holes = inners.filter((h) => pointInRingSafe(h[0], outer));
      mpCount++;
      if (isBuilding) pushBuilding(rel.id + 1e12, rel.tags, outer, holes);
      else pushArea(rel.id + 1e12, ak!, outer, holes);
    }
  }
  log(`  ${mpCount} Multipolygone, ${restrictions.length} Abbiegeregeln`);

  // Linien (Fuß-/Radwege, Gleise, Gewässer)
  const lines: RawLine[] = [];
  for (const w of lineWays) {
    const r = resolve(w.refs);
    if (!r || r.pts.length < 2 || !anyInside(r.pts)) continue;
    lines.push({ id: w.id, k: lineKind(w.tags)!, layer: layerOf(w.tags), pts: r.pts });
  }

  const places = placeNodes.filter((p) => inside.contains(p.p));

  // Adressen und benannte Orte an Wegen (Gebäude, Flächen): Mittelpunkt
  for (const w of tagWays) {
    const r = resolve(w.refs);
    if (!r || r.pts.length < 3) continue;
    const c = ringCentroid(r.pts.slice(0, -1));
    if (w.tags['addr:housenumber'] && w.tags['addr:street']) addrPts.push({ street: w.tags['addr:street'], num: w.tags['addr:housenumber'], p: c });
    const pname = poiName(w.tags);
    if (pname) {
      const pc = poiCat(w.tags);
      if (pc) poiPts.push({ name: pname, ...pc, p: c });
    }
  }
  // doppelte Adressen (Knoten + Gebäude) zusammenfassen
  const seenAddr = new Set<string>();
  const addresses = addrPts.filter((a) => {
    if (!inside.contains(a.p)) return false;
    const k = `${a.street}|${a.num}`;
    if (seenAddr.has(k)) return false;
    seenAddr.add(k);
    return true;
  });
  const seenPoi = new Set<string>();
  const pois = poiPts.filter((a) => {
    if (!inside.contains(a.p)) return false;
    const k = `${a.name}|${Math.round(a.p[0] / 50)}|${Math.round(a.p[1] / 50)}`;
    if (seenPoi.has(k)) return false;
    seenPoi.add(k);
    return true;
  });
  log(`  ${addresses.length.toLocaleString('de')} Adressen, ${pois.length.toLocaleString('de')} benannte Orte`);

  // Bäume: Einzelbäume und Baumreihen (alle ~8 m ein Baum)
  const trees: Array<[number, number, number]> = treePts.filter((t) => inside.contains([t[0], t[1]]));
  for (const refs of treeRows) {
    const r = resolve(refs);
    if (!r || !anyInside(r.pts)) continue;
    let carry = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1];
      const b = r.pts[i];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let s = carry;
      while (s < l) {
        trees.push([a[0] + ((b[0] - a[0]) * s) / l, a[1] + ((b[1] - a[1]) * s) / l, 0]);
        s += 8;
      }
      carry = s - l;
    }
  }
  log(`  ${trees.length.toLocaleString('de')} Bäume`);

  // Buslinien: Haltestellen in Fahrtreihenfolge (Haltepositionen und Bahnsteige gleichen Namens zusammenfassen)
  const busLines: Extract['busLines'] = [];
  for (const r of busRels) {
    const stops: Array<{ name: string; p: Pt }> = [];
    for (const m of r.members) {
      if (m.type !== 'node' || !/^(stop|platform)/.test(m.role)) continue;
      const st = busStops.get(m.ref);
      if (!st) continue;
      if (stops.length && stops[stops.length - 1].name === st.name) continue;
      if (stops.some((x) => x.name === st.name && Math.hypot(x.p[0] - st.p[0], x.p[1] - st.p[1]) < 80)) continue;
      stops.push(st);
    }
    const inCity = stops.filter((st) => inside.contains(st.p));
    if (inCity.length < 4) continue;
    busLines.push({ ref: r.tags.ref ?? '?', name: r.tags.name ?? `Linie ${r.tags.ref ?? ''}`, stops: inCity });
  }
  log(`  ${busLines.length} Buslinien (Fahrtrichtungen), ${busStops.size.toLocaleString('de')} Haltestellen`);

  log(
    `  Im Stadtgebiet: ${roads.length.toLocaleString('de')} Straßen, ${buildings.length.toLocaleString('de')} Gebäude, ${areas.length.toLocaleString('de')} Flächen, ${lines.length.toLocaleString('de')} Linien`,
  );
  return {
    boundary: regions.filter((r) => !r.corridor).flatMap((r) => r.rings),
    regions,
    inside,
    roads,
    controlNodes,
    restrictions,
    buildings,
    areas,
    lines,
    places,
    trees,
    busLines,
    addresses,
    pois,
  };
}

function pointInRingSafe(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const NAMED_COLOURS: Record<string, number> = {
  red: 0xa8473a,
  darkred: 0x7f2f28,
  brown: 0x7a4b36,
  orange: 0xc06a3c,
  grey: 0x8a8c8f,
  gray: 0x8a8c8f,
  darkgrey: 0x55585c,
  darkgray: 0x55585c,
  lightgrey: 0xb6b7b8,
  lightgray: 0xb6b7b8,
  silver: 0xb9bcc0,
  black: 0x3a3c40,
  white: 0xdedede,
  green: 0x6f8f6a,
  darkgreen: 0x4b6347,
  blue: 0x5a6c86,
  beige: 0xc9b99a,
  yellow: 0xc9b25a,
};

/** roof:colour (Name oder #rrggbb) -> RGB */
function parseColour(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return parseInt(s.slice(1), 16);
  if (/^#[0-9a-f]{3}$/.test(s)) return parseInt(s[1] + s[1] + s[2] + s[2] + s[3] + s[3], 16);
  return NAMED_COLOURS[s.replace(/[\s_-]/g, '')];
}

/** kürzester Weg über Hauptstraßen (für die Verbindung zwischen den Städten) */
function mainRoadPath(ways: Array<{ refs: number[]; tags: Tags }>, resolve: (refs: number[]) => { ids: number[]; pts: Pt[] } | null, from: Pt, to: Pt): Pt[] {
  const COST: Record<string, number> = { trunk: 0.8, primary: 0.85, secondary: 1, trunk_link: 1, primary_link: 1, secondary_link: 1.1, tertiary: 1.4 };
  const adj = new Map<number, Array<[number, number]>>();
  const pos = new Map<number, Pt>();
  for (const w of ways) {
    const c = COST[w.tags.highway ?? ''];
    if (!c) continue;
    const r = resolve(w.refs);
    if (!r) continue;
    const ow = w.tags.oneway === 'yes' || w.tags.oneway === '1' || w.tags.junction === 'roundabout';
    for (let i = 0; i < r.ids.length; i++) {
      pos.set(r.ids[i], r.pts[i]);
      if (i === 0) continue;
      const a = r.ids[i - 1];
      const b = r.ids[i];
      const d = Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]) * c;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push([b, d]);
      if (!ow) adj.get(b)!.push([a, d]);
    }
  }
  const nearest = (p: Pt) => {
    let best = -1;
    let bd = Infinity;
    for (const [id, q] of pos) {
      if (!adj.get(id)?.length) continue;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  };
  const s = nearest(from);
  const t = nearest(to);
  if (s < 0 || t < 0) return [];
  // Dijkstra mit einfachem Binärheap
  const dist = new Map<number, number>([[s, 0]]);
  const prev = new Map<number, number>();
  const heap: Array<[number, number]> = [[0, s]];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === t) break;
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const [v, w] of adj.get(u) ?? []) {
      const nd = d + w;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        push([nd, v]);
      }
    }
  }
  if (!dist.has(t)) return [];
  const out: Pt[] = [];
  for (let u: number | undefined = t; u !== undefined; u = prev.get(u)) out.push(pos.get(u)!);
  return out.reverse();
}
