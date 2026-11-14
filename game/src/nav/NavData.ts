/**
 * Lädt Routinggraph, Straßennamen, Adressen und benannte Orte (einmalig, im Hintergrund).
 */
import { parseRouting, type AddressFile, type Poi, type PoiFile, type RoutingGraph } from '@nrs/shared';

export interface NavData {
  graph: RoutingGraph;
  names: string[];
  addr: AddressFile;
  pois: Poi[];
}

let pending: Promise<NavData> | null = null;

export function loadNavData(base: string): Promise<NavData> {
  pending ??= (async () => {
    const [bin, names, addr, pois] = await Promise.all([
      fetch(`${base}/routing.bin`).then((r) => r.arrayBuffer()),
      fetch(`${base}/names.json`).then((r) => r.json() as Promise<string[]>),
      fetch(`${base}/addresses.json`).then((r) => r.json() as Promise<AddressFile>),
      fetch(`${base}/pois.json`).then((r) => r.json() as Promise<PoiFile>),
    ]);
    return { graph: parseRouting(bin), names, addr, pois: pois.pois };
  })();
  return pending;
}

/** Ziel einer Fahrt: Punkt auf einer Spur plus Anzeige-Infos */
export interface Target {
  lane: number;
  s: number; // m
  x: number; // eigentlicher Ort (Haus) in m
  y: number;
  label: string;
}

export function addressTarget(d: NavData, i: number): Target {
  const a = d.addr.a;
  const o = i * 5;
  return {
    label: `${d.addr.streets[a[o]]} ${d.addr.nums[i]}`,
    x: a[o + 1] / 10,
    y: a[o + 2] / 10,
    lane: a[o + 3],
    s: a[o + 4] / 10,
  };
}

export function poiTarget(p: Poi): Target {
  return { label: p.n, x: p.x / 10, y: p.y / 10, lane: p.l, s: p.s / 10 };
}

export function addressCount(d: NavData): number {
  return d.addr.nums.length;
}
