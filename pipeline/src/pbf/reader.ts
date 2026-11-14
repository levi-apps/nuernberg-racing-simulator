/**
 * Minimaler, schneller Leser für OpenStreetMap-PBF-Dateien
 * (https://wiki.openstreetmap.org/wiki/PBF_Format).
 * Unterstützt zlib- und unkomprimierte Blobs, DenseNodes, Nodes, Ways, Relations.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PbfReader } from 'pbf';

export type Tags = Record<string, string>;

export interface Member {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
}

export interface OsmHandlers {
  node?: (id: number, lon: number, lat: number, tags: Tags | null) => void;
  way?: (id: number, refs: number[], tags: Tags) => void;
  relation?: (id: number, members: Member[], tags: Tags) => void;
  progress?: (bytesRead: number, total: number) => void;
}

const MEMBER_TYPES = ['node', 'way', 'relation'] as const;

export function readOsmPbf(path: string, h: OsmHandlers): void {
  const file = readFileSync(path);
  let pos = 0;
  const total = file.length;
  let lastProgress = 0;

  while (pos < total) {
    const headerLen = file.readUInt32BE(pos);
    pos += 4;
    const header = new PbfReader(file.subarray(pos, pos + headerLen)).readFields(
      (tag, r: { type: string; size: number }, p) => {
        if (tag === 1) r.type = p.readString();
        else if (tag === 3) r.size = p.readVarint();
      },
      { type: '', size: 0 },
    );
    pos += headerLen;
    const blobBuf = file.subarray(pos, pos + header.size);
    pos += header.size;

    if (header.type !== 'OSMData') continue;

    const blob = new PbfReader(blobBuf).readFields(
      (tag, r: { raw?: Uint8Array; zlib?: Uint8Array; other?: boolean }, p) => {
        if (tag === 1) r.raw = p.readBytes();
        else if (tag === 3) r.zlib = p.readBytes();
        else if (tag === 4 || tag === 6 || tag === 7) r.other = true;
      },
      {},
    );
    let data: Uint8Array;
    if (blob.raw) data = blob.raw;
    else if (blob.zlib) data = inflateSync(blob.zlib);
    else throw new Error('Nicht unterstützte Blob-Kompression (nur zlib/raw)');

    readPrimitiveBlock(data, h);

    if (h.progress && pos - lastProgress > 4_000_000) {
      lastProgress = pos;
      h.progress(pos, total);
    }
  }
  h.progress?.(total, total);
}

interface BlockMeta {
  strings: string[];
  granularity: number;
  latOffset: number;
  lonOffset: number;
  groups: Array<[number, number]>; // [start, end] byte ranges
}

function readPrimitiveBlock(data: Uint8Array, h: OsmHandlers): void {
  const p = new PbfReader(data);
  const meta: BlockMeta = { strings: [], granularity: 100, latOffset: 0, lonOffset: 0, groups: [] };
  p.readFields((tag, m: BlockMeta, pb) => {
    if (tag === 1) {
      const end = pb.readVarint() + pb.pos;
      const dec = new TextDecoder();
      while (pb.pos < end) {
        const t = pb.readVarint();
        if (t >>> 3 === 1) {
          const len = pb.readVarint();
          m.strings.push(dec.decode(pb.buf.subarray(pb.pos, pb.pos + len)));
          pb.pos += len;
        } else pb.skip(t);
      }
    } else if (tag === 2) {
      const len = pb.readVarint();
      m.groups.push([pb.pos, pb.pos + len]);
      pb.pos += len;
    } else if (tag === 17) m.granularity = pb.readVarint();
    else if (tag === 19) m.latOffset = pb.readVarint(true);
    else if (tag === 20) m.lonOffset = pb.readVarint(true);
  }, meta);

  for (const [start, end] of meta.groups) {
    p.pos = start;
    p.readFields(
      (tag, _r, pb) => {
        if (tag === 2 && h.node) readDense(pb, meta, h.node);
        else if (tag === 1 && h.node) readNode(pb, meta, h.node);
        else if (tag === 3 && h.way) readWay(pb, meta, h.way);
        else if (tag === 4 && h.relation) readRelation(pb, meta, h.relation);
      },
      null,
      end,
    );
  }
}

function readDense(p: PbfReader, m: BlockMeta, cb: NonNullable<OsmHandlers['node']>): void {
  const end = p.readVarint() + p.pos;
  let ids: number[] = [];
  let lats: number[] = [];
  let lons: number[] = [];
  let kv: number[] = [];
  p.readFields(
    (tag, _r, pb) => {
      if (tag === 1) ids = pb.readPackedSVarint();
      else if (tag === 8) lats = pb.readPackedSVarint();
      else if (tag === 9) lons = pb.readPackedSVarint();
      else if (tag === 10) kv = pb.readPackedVarint();
    },
    null,
    end,
  );
  const g = m.granularity * 1e-9;
  let id = 0;
  let lat = 0;
  let lon = 0;
  let k = 0;
  const s = m.strings;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i];
    lat += lats[i];
    lon += lons[i];
    let tags: Tags | null = null;
    if (kv.length) {
      while (k < kv.length && kv[k] !== 0) {
        (tags ??= {})[s[kv[k]]] = s[kv[k + 1]];
        k += 2;
      }
      k++;
    }
    cb(id, m.lonOffset * 1e-9 + lon * g, m.latOffset * 1e-9 + lat * g, tags);
  }
}

function readTags(keys: number[], vals: number[], s: string[]): Tags {
  const t: Tags = {};
  for (let i = 0; i < keys.length; i++) t[s[keys[i]]] = s[vals[i]];
  return t;
}

function readNode(p: PbfReader, m: BlockMeta, cb: NonNullable<OsmHandlers['node']>): void {
  const end = p.readVarint() + p.pos;
  const r = { id: 0, lat: 0, lon: 0, keys: [] as number[], vals: [] as number[] };
  p.readFields(
    (tag, o: typeof r, pb) => {
      if (tag === 1) o.id = pb.readSVarint();
      else if (tag === 2) o.keys = pb.readPackedVarint();
      else if (tag === 3) o.vals = pb.readPackedVarint();
      else if (tag === 8) o.lat = pb.readSVarint();
      else if (tag === 9) o.lon = pb.readSVarint();
    },
    r,
    end,
  );
  const g = m.granularity * 1e-9;
  const tags = r.keys.length ? readTags(r.keys, r.vals, m.strings) : null;
  cb(r.id, m.lonOffset * 1e-9 + r.lon * g, m.latOffset * 1e-9 + r.lat * g, tags);
}

function readWay(p: PbfReader, m: BlockMeta, cb: NonNullable<OsmHandlers['way']>): void {
  const end = p.readVarint() + p.pos;
  const r = { id: 0, keys: [] as number[], vals: [] as number[], refs: [] as number[] };
  p.readFields(
    (tag, o: typeof r, pb) => {
      if (tag === 1) o.id = pb.readVarint();
      else if (tag === 2) o.keys = pb.readPackedVarint();
      else if (tag === 3) o.vals = pb.readPackedVarint();
      else if (tag === 8) o.refs = pb.readPackedSVarint();
    },
    r,
    end,
  );
  let ref = 0;
  for (let i = 0; i < r.refs.length; i++) {
    ref += r.refs[i];
    r.refs[i] = ref;
  }
  cb(r.id, r.refs, readTags(r.keys, r.vals, m.strings));
}

function readRelation(p: PbfReader, m: BlockMeta, cb: NonNullable<OsmHandlers['relation']>): void {
  const end = p.readVarint() + p.pos;
  const r = { id: 0, keys: [] as number[], vals: [] as number[], roles: [] as number[], memids: [] as number[], types: [] as number[] };
  p.readFields(
    (tag, o: typeof r, pb) => {
      if (tag === 1) o.id = pb.readVarint();
      else if (tag === 2) o.keys = pb.readPackedVarint();
      else if (tag === 3) o.vals = pb.readPackedVarint();
      else if (tag === 8) o.roles = pb.readPackedVarint(undefined, true);
      else if (tag === 9) o.memids = pb.readPackedSVarint();
      else if (tag === 10) o.types = pb.readPackedVarint();
    },
    r,
    end,
  );
  const members: Member[] = [];
  let ref = 0;
  for (let i = 0; i < r.memids.length; i++) {
    ref += r.memids[i];
    members.push({ type: MEMBER_TYPES[r.types[i]] ?? 'node', ref, role: m.strings[r.roles[i]] ?? '' });
  }
  cb(r.id, members, readTags(r.keys, r.vals, m.strings));
}
