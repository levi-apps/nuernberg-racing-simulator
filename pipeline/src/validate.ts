/**
 * Plausibilitätsprüfung des Spurgraphen: Spuren ohne Ausfahrt und Zusammenhang
 * (größte stark zusammenhängende Komponente = Teil des Netzes, in dem man von überall überall hinkommt).
 */
import type { RoadNet } from './roadnet.ts';

export interface Validation {
  deadEnds: number;
  dangling: number;
  sccLargestShare: number;
  sccLanes: Uint8Array;
}

export function validate(net: RoadNet, log: (s: string) => void): Validation {
  const { lanes, connectors } = net;
  let dangling = 0;
  let deadEnds = 0;
  for (const l of lanes) {
    if (l.out.length) continue;
    if (l.ctrl === 'end') deadEnds++;
    else dangling++;
  }

  // Tarjan iterativ auf Spurebene
  const n = lanes.length;
  const succ = (i: number) => lanes[i].out.map((c) => connectors[c].to);
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const comp = new Int32Array(n).fill(-1);
  let idx = 0;
  let compCount = 0;
  const compSize: number[] = [];
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work: Array<[number, number]> = [[s, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] === 0) {
        index[v] = low[v] = idx++;
        stack.push(v);
        onStack[v] = 1;
      }
      const ss = succ(v);
      if (top[1] < ss.length) {
        const w = ss[top[1]++];
        if (index[w] === -1) work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) {
        const p = work[work.length - 1][0];
        low[p] = Math.min(low[p], low[v]);
      }
      if (low[v] === index[v]) {
        let size = 0;
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          comp[w] = compCount;
          size++;
        } while (w !== v);
        compSize.push(size);
        compCount++;
      }
    }
  }
  let big = 0;
  for (let i = 1; i < compSize.length; i++) if (compSize[i] > compSize[big]) big = i;
  const sccLanes = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (comp[i] === big) sccLanes[i] = 1;
  const share = compSize[big] / n;
  log(`  Sackgassen-Spuren: ${deadEnds.toLocaleString('de')}, Spuren ohne Ausfahrt (Datenfehler): ${dangling.toLocaleString('de')}`);
  log(`  Zusammenhängendes Hauptnetz: ${(share * 100).toFixed(1)} % der Spuren (${compSize[big].toLocaleString('de')})`);
  return { deadEnds, dangling, sccLargestShare: share, sccLanes };
}
