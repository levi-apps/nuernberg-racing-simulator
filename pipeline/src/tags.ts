import type { AreaKind, LineKind, RoadClass } from '@nrs/shared';
import type { Tags } from './pbf/reader.ts';

/** highway=* Werte, die befahrbar sind, mit ihrer Straßenklasse. */
const DRIVABLE: Record<string, RoadClass> = {
  motorway: 'motorway',
  motorway_link: 'motorway',
  trunk: 'trunk',
  trunk_link: 'trunk',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary',
  unclassified: 'unclassified',
  residential: 'residential',
  living_street: 'living_street',
  service: 'service',
  road: 'unclassified',
};

/** Rang für Vorfahrt und Phasenbildung (höher = wichtiger). */
export const RANK: Record<RoadClass, number> = {
  motorway: 9,
  trunk: 8,
  primary: 7,
  secondary: 6,
  tertiary: 5,
  unclassified: 3,
  residential: 2,
  living_street: 1,
  service: 0,
  track: 0,
  pedestrian: 0,
};

export function roadClass(t: Tags): RoadClass | null {
  const hw = t.highway;
  if (!hw) return null;
  const cls = DRIVABLE[hw];
  if (!cls) return null;
  if (t.area === 'yes') return null;
  if (t.access === 'no' || t.access === 'private') {
    // private Zufahrten/Parkplätze weglassen, gesperrte Hauptstraßen (z. B. Baustellen) ebenfalls
    if (cls === 'service' || t.motor_vehicle !== 'yes') return null;
  }
  if (t.motor_vehicle === 'no' || t.motorcar === 'no' || t.vehicle === 'no') {
    // Busspuren, Fußgängerzonen-Zufahrten u. ä. sind für normale Autos tabu – fürs Spiel trotzdem nicht befahrbar
    return null;
  }
  if (hw === 'service' && (t.service === 'driveway' || t.service === 'emergency_access')) return null;
  return cls;
}

export function isLink(t: Tags): boolean {
  return /_link$/.test(t.highway ?? '');
}

export type Oneway = 0 | 1 | -1;

export function oneway(t: Tags): Oneway {
  const o = t.oneway;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no') return 0;
  if (t.junction === 'roundabout' || t.junction === 'circular') return 1;
  if (t.highway === 'motorway' || t.highway === 'motorway_link') return 1;
  return 0;
}

function int(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n < 12 ? n : null;
}

export interface LaneSpec {
  fwd: number;
  bwd: number;
  fwdTurns?: string[];
  bwdTurns?: string[];
}

/** Spuranzahl je Richtung (vorwärts = Digitalisierrichtung). */
export function laneSpec(t: Tags, cls: RoadClass, ow: Oneway): LaneSpec {
  const total = int(t.lanes);
  let fwd = int(t['lanes:forward']);
  let bwd = int(t['lanes:backward']);
  const psv = int(t['lanes:psv']) ?? 0; // Busspuren nicht als Fahrspur nutzen
  const link = isLink(t);

  if (ow !== 0) {
    let n = total ?? defaultOnewayLanes(cls, link);
    n = Math.max(1, n - psv);
    const turns = splitTurns(t['turn:lanes'], n);
    return ow === 1 ? { fwd: n, bwd: 0, fwdTurns: turns } : { fwd: 0, bwd: n, bwdTurns: turns };
  }

  if (fwd == null && bwd == null) {
    if (total != null) {
      const t2 = Math.max(2, total - psv);
      fwd = Math.ceil(t2 / 2);
      bwd = Math.max(1, t2 - fwd);
    } else {
      const d = defaultTwowayLanesPerDir(cls);
      fwd = d;
      bwd = d;
    }
  } else if (fwd == null) {
    fwd = Math.max(1, (total ?? (bwd as number) + 1) - (bwd as number));
  } else if (bwd == null) {
    bwd = Math.max(1, (total ?? fwd + 1) - fwd);
  }
  return {
    fwd: fwd as number,
    bwd: bwd as number,
    fwdTurns: splitTurns(t['turn:lanes:forward'], fwd as number),
    bwdTurns: splitTurns(t['turn:lanes:backward'], bwd as number),
  };
}

function defaultOnewayLanes(cls: RoadClass, link: boolean): number {
  if (link) return 1;
  if (cls === 'motorway' || cls === 'trunk') return 2;
  if (cls === 'primary') return 2;
  return 1;
}

function defaultTwowayLanesPerDir(cls: RoadClass): number {
  if (cls === 'motorway' || cls === 'trunk') return 2;
  return 1;
}

function splitTurns(v: string | undefined, n: number): string[] | undefined {
  if (!v) return undefined;
  const parts = v.split('|').map((s) => s.trim() || 'through');
  if (parts.length !== n) return undefined;
  return parts.map((p) => (p === 'none' ? 'through' : p));
}

/** Spurbreite in Metern */
export function laneWidth(t: Tags, cls: RoadClass, lanesTotal: number): number {
  const w = parseFloat(t.width ?? '');
  if (Number.isFinite(w) && w > 2 && lanesTotal > 0) {
    const per = w / lanesTotal;
    if (per >= 2.3 && per <= 4.5) return per;
  }
  switch (cls) {
    case 'motorway':
      return 3.6;
    case 'trunk':
    case 'primary':
      return 3.4;
    case 'secondary':
    case 'tertiary':
      return 3.25;
    case 'unclassified':
    case 'residential':
      return 3.0;
    case 'living_street':
      return 2.9;
    default:
      return 2.8;
  }
}

/** Tempolimit km/h */
export function maxSpeed(t: Tags, cls: RoadClass): number {
  const v = t.maxspeed ?? t['maxspeed:forward'];
  if (v) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return /mph/.test(v) ? Math.round(n * 1.609) : n;
    if (/walk/.test(v)) return 7;
    if (/zone:?30/.test(v)) return 30;
    if (/zone:?20/.test(v)) return 20;
    if (/zone:?10/.test(v)) return 10;
    if (/urban/.test(v)) return 50;
    if (/rural/.test(v)) return 100;
    if (/motorway|none/.test(v)) return 130;
    if (/living_street/.test(v)) return 7;
  }
  switch (cls) {
    case 'motorway':
      return 130;
    case 'trunk':
      return 100;
    case 'living_street':
      return 7;
    case 'service':
      return 20;
    case 'residential':
      return 30;
    default:
      return 50;
  }
}

export function layerOf(t: Tags): number {
  const l = parseInt(t.layer ?? '', 10);
  if (Number.isFinite(l)) return Math.max(-5, Math.min(5, l));
  if (t.bridge && t.bridge !== 'no') return 1;
  if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') return -1;
  return 0;
}

export function buildingHeight(t: Tags): { h: number; minH?: number } {
  const parseM = (v: string | undefined): number | null => {
    if (!v) return null;
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n < 400 ? n : null;
  };
  let h = parseM(t.height) ?? parseM(t['building:height']);
  const levels = parseM(t['building:levels']);
  const roofLevels = parseM(t['roof:levels']) ?? 0;
  if (h == null && levels != null) h = levels * 3.1 + roofLevels * 2.5 + 1;
  if (h == null) {
    switch (t.building) {
      case 'garage':
      case 'garages':
      case 'carport':
      case 'shed':
      case 'hut':
      case 'roof':
        h = 3;
        break;
      case 'house':
      case 'detached':
      case 'semidetached_house':
      case 'terrace':
      case 'bungalow':
        h = 8;
        break;
      case 'apartments':
      case 'residential':
        h = 15;
        break;
      case 'commercial':
      case 'office':
      case 'retail':
        h = 14;
        break;
      case 'industrial':
      case 'warehouse':
        h = 10;
        break;
      case 'church':
      case 'cathedral':
        h = 25;
        break;
      default:
        h = 10;
    }
  }
  let minH = parseM(t.min_height) ?? undefined;
  if (minH == null && t['building:min_level']) {
    const ml = parseM(t['building:min_level']);
    if (ml != null) minH = ml * 3.1;
  }
  return minH ? { h, minH } : { h };
}

export function areaKind(t: Tags): AreaKind | null {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'basin' || t.landuse === 'reservoir') return 'water';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground') return 'park';
  if (t.leisure === 'pitch' || t.leisure === 'sports_centre' || t.leisure === 'stadium' || t.leisure === 'track') return 'sports';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (
    t.landuse === 'grass' ||
    t.landuse === 'meadow' ||
    t.landuse === 'village_green' ||
    t.landuse === 'recreation_ground' ||
    t.natural === 'grassland' ||
    t.natural === 'scrub' ||
    t.landuse === 'allotments' ||
    t.landuse === 'orchard'
  )
    return 'grass';
  if (t.landuse === 'farmland' || t.landuse === 'farmyard') return 'farmland';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey') return 'parking';
  if ((t.highway === 'pedestrian' && t.area === 'yes') || t['area:highway'] === 'pedestrian' || t.place === 'square') return 'pedestrian';
  if (t.landuse === 'railway') return 'railway';
  if (t.landuse === 'industrial') return 'industrial';
  if (t.landuse === 'commercial' || t.landuse === 'retail') return 'commercial';
  if (t.landuse === 'residential') return 'residential';
  return null;
}

export function lineKind(t: Tags): LineKind | null {
  const hw = t.highway;
  if (hw === 'footway' || hw === 'pedestrian' || hw === 'bridleway' || hw === 'corridor') return t.area === 'yes' ? null : 'footway';
  if (hw === 'cycleway') return 'cycleway';
  if (hw === 'path' || hw === 'track') return 'path';
  if (hw === 'steps') return 'steps';
  const rw = t.railway;
  if (rw === 'rail' || rw === 'light_rail' || rw === 'narrow_gauge') return t.tunnel === 'yes' ? null : 'rail';
  if (rw === 'tram') return 'tram';
  if (rw === 'subway') return null; // U-Bahn liegt im Tunnel – oben nicht sichtbar
  if (t.barrier === 'hedge') return 'hedge';
  if (t.barrier === 'city_wall' || t.historic === 'city_wall' || t.wall === 'city_wall') return 'citywall';
  if (t.barrier === 'wall' || t.barrier === 'retaining_wall') return 'wall';
  if (t.barrier === 'fence') return 'fence';
  if (t.waterway === 'river' || t.waterway === 'canal') return t.tunnel ? null : 'river';
  if (t.waterway === 'stream' || t.waterway === 'ditch' || t.waterway === 'drain') return t.tunnel ? null : 'stream';
  return null;
}

/** Gehwegbreiten links/rechts (bezogen auf die Digitalisierrichtung) in Metern */
export function sidewalks(t: Tags, cls: RoadClass): [number, number] {
  const def =
    cls === 'primary' || cls === 'secondary' ? 3.0 : cls === 'tertiary' || cls === 'unclassified' || cls === 'residential' ? 2.4 : cls === 'living_street' ? 1.6 : 0;
  if (/_link$/.test(t.highway ?? '') || cls === 'motorway' || cls === 'trunk' || cls === 'service' || cls === 'track') {
    return [0, 0];
  }
  const val = (v: string | undefined): boolean | null => (v === undefined ? null : v !== 'no' && v !== 'none');
  let l = val(t['sidewalk:left']);
  let r = val(t['sidewalk:right']);
  const both = t['sidewalk:both'];
  if (both !== undefined) {
    l ??= val(both);
    r ??= val(both);
  }
  const sw = t.sidewalk;
  if (sw !== undefined) {
    if (sw === 'both' || sw === 'yes' || sw === 'separate') {
      l ??= true;
      r ??= true;
    } else if (sw === 'left') {
      l ??= true;
      r ??= false;
    } else if (sw === 'right') {
      l ??= false;
      r ??= true;
    } else if (sw === 'no' || sw === 'none') {
      l ??= false;
      r ??= false;
    }
  }
  // ohne Angabe: innerorts Gehwege auf beiden Seiten
  l ??= def > 0;
  r ??= def > 0;
  const w = parseFloat(t['sidewalk:width'] ?? '') || def || 2.2;
  return [l ? w : 0, r ? w : 0];
}
