// DefineMorphShape / DefineMorphShape2 の解釈と、比率に応じた中間の図形の生成（仕様 9 章）。
import { shapeToPaths } from '../shape/paths.js';
import { Reader, SWFError } from './reader.js';
import { shapeRecords } from './shape.js';

const CACHE_SIZE = 64; // 比率ごとに作ったパスを覚えておく数

/**
 * DefineMorphShape / 2 の中身をそのまま読む（補間はしない）。fillStyles / lineStyles は開始と終了の組（{ start, end }）、
 * startRecords / endRecords は shapeRecords の形。
 */
export function readMorphShape(tag) {
  if (tag.code !== 46 && tag.code !== 84) throw new SWFError(`tag ${tag.code} is not a DefineMorphShape`);
  const version = tag.code === 84 ? 2 : 1;
  const r = new Reader(tag.body);
  const morph = { id: r.u16(), startBounds: r.rect(), endBounds: r.rect() };
  if (version === 2) {
    morph.startEdgeBounds = r.rect();
    morph.endEdgeBounds = r.rect();
    r.u8(); // UsesNonScalingStrokes, UsesScalingStrokes
  }
  const offset = r.u32();
  const endEdges = r.pos + offset;
  morph.fillStyles = styleArray(r, () => fillStylePair(r));
  morph.lineStyles = styleArray(r, () => lineStylePair(r, version));
  // 開始形状は塗り・線の指定つき、終了形状は辺だけ。スタイルの版は RGBA 固定なので 3 として読む。
  morph.startRecords = shapeRecords(r, 3);
  if (endEdges > tag.body.length) throw new SWFError('morph shape end edges are out of range');
  morph.endRecords = shapeRecords(new Reader(tag.body.subarray(endEdges)), 3);
  return morph;
}

/**
 * @returns {{ id: number, startBounds: object, endBounds: object,
 *   pathsAt: (ratio: number) => object[] }}  ratio は 0（開始形状）〜65535（終了形状）
 */
export function parseDefineMorphShape(tag) {
  const { id, startBounds, endBounds, fillStyles, lineStyles, startRecords, endRecords } = readMorphShape(tag);
  const morph = { id, startBounds, endBounds };

  const cache = new Map();
  morph.pathsAt = (ratio) => {
    const key = Math.max(0, Math.min(65535, Math.round(ratio)));
    let paths = cache.get(key);
    if (!paths) {
      const t = key / 65535;
      paths = shapeToPaths({
        fillStyles: fillStyles.map((pair) => lerpStyle(pair.start, pair.end, t)),
        lineStyles: lineStyles.map((pair) => lerpStyle(pair.start, pair.end, t)),
        records: lerpRecords(startRecords, endRecords, t),
        usesWindingRule: false,
      });
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
      cache.set(key, paths);
    }
    return paths;
  };
  return morph;
}

function styleArray(r, read) {
  let count = r.u8();
  if (count === 0xff) count = r.u16();
  const styles = [];
  for (let i = 0; i < count; i++) styles.push(read());
  return styles;
}

// MORPHFILLSTYLE を、通常の塗りスタイルと同じ形の開始・終了の組にする。
function fillStylePair(r) {
  const type = r.u8();
  if (type === 0x00) {
    return { start: { type: 'solid', color: r.rgba() }, end: { type: 'solid', color: r.rgba() } };
  }
  if (type === 0x10 || type === 0x12 || type === 0x13) {
    const startMatrix = r.matrix();
    const endMatrix = r.matrix();
    const spread = ['pad', 'reflect', 'repeat', 'pad'][r.ub(2)];
    const linearRGB = r.ub(2) === 1;
    const count = r.ub(4);
    const startStops = [];
    const endStops = [];
    for (let i = 0; i < count; i++) {
      startStops.push({ ratio: r.u8(), color: r.rgba() });
      endStops.push({ ratio: r.u8(), color: r.rgba() });
    }
    const kind = type === 0x10 ? 'linear' : 'radial';
    const start = { type: kind, matrix: startMatrix, spread, linearRGB, stops: startStops, focal: 0 };
    const end = { type: kind, matrix: endMatrix, spread, linearRGB, stops: endStops, focal: 0 };
    if (type === 0x13) {
      start.focal = r.fixed8();
      end.focal = r.fixed8();
    }
    return { start, end };
  }
  if (type >= 0x40 && type <= 0x43) {
    const base = { type: 'bitmap', bitmapId: r.u16(), repeat: (type & 1) === 0, smooth: type < 0x42 };
    return { start: { ...base, matrix: r.matrix() }, end: { ...base, matrix: r.matrix() } };
  }
  throw new SWFError(`unknown morph fill style type 0x${type.toString(16)}`);
}

function lineStylePair(r, version) {
  const startWidth = r.u16();
  const endWidth = r.u16();
  const base = { startCap: 'round', endCap: 'round', join: 'round', noClose: false };
  if (version === 2) {
    const caps = ['round', 'butt', 'square', 'round'];
    base.startCap = caps[r.ub(2)];
    base.join = ['round', 'bevel', 'miter', 'round'][r.ub(2)];
    const hasFill = r.ub(1);
    base.noHScale = r.ub(1) === 1;
    base.noVScale = r.ub(1) === 1;
    base.pixelHinting = r.ub(1) === 1;
    r.ub(5);
    base.noClose = r.ub(1) === 1;
    base.endCap = caps[r.ub(2)];
    if (base.join === 'miter') base.miterLimit = r.u16() / 256;
    if (hasFill) {
      const fill = fillStylePair(r);
      return { start: { ...base, width: startWidth, fill: fill.start }, end: { ...base, width: endWidth, fill: fill.end } };
    }
  }
  return { start: { ...base, width: startWidth, color: r.rgba() }, end: { ...base, width: endWidth, color: r.rgba() } };
}

const lerp = (a, b, t) => a + (b - a) * t;

// 同じ形の 2 つのスタイルを補間する。数値は線形補間、それ以外（種別など）は開始側の値を使う。
function lerpStyle(start, end, t) {
  if (typeof start === 'number') return typeof end === 'number' ? lerp(start, end, t) : start;
  if (Array.isArray(start)) return start.map((v, i) => lerpStyle(v, end?.[i] ?? v, t));
  if (start && typeof start === 'object') {
    const out = {};
    for (const key of Object.keys(start)) out[key] = lerpStyle(start[key], end?.[key] ?? start[key], t);
    return out;
  }
  return start;
}

// 開始形状と終了形状の辺を順に対応させて補間する。
// 終了形状の辺の間に入る移動 (moveTo) は、その位置から次の辺が始まることを表す。
// 直線と曲線が対応する場合は、直線を「制御点が中点の曲線」とみなす。
function lerpRecords(startRecords, endRecords, t) {
  const out = [];
  let sx = 0, sy = 0; // 開始形状での現在位置
  let ex = 0, ey = 0; // 終了形状での現在位置
  let j = 0;
  for (const s of startRecords) {
    if (s.type === 'style') {
      const rec = { ...s };
      if (s.moveTo) {
        ({ x: sx, y: sy } = s.moveTo);
        const e = endRecords[j];
        if (e?.type === 'style' && e.moveTo) {
          ({ x: ex, y: ey } = e.moveTo);
          j++;
        }
        rec.moveTo = { x: lerp(sx, ex, t), y: lerp(sy, ey, t) };
      }
      out.push(rec);
      continue;
    }
    while (endRecords[j]?.type === 'style') {
      const e = endRecords[j++];
      if (e.moveTo) {
        ({ x: ex, y: ey } = e.moveTo);
        out.push({ type: 'style', moveTo: { x: lerp(sx, ex, t), y: lerp(sy, ey, t) } });
      }
    }
    const e = endRecords[j++] ?? { type: 'line', x: ex, y: ey }; // 終了側の辺が足りなければ長さ 0 の辺
    const x = lerp(s.x, e.x, t);
    const y = lerp(s.y, e.y, t);
    if (s.type === 'line' && e.type === 'line') {
      out.push({ type: 'line', x, y });
    } else {
      const scx = s.type === 'curve' ? s.cx : (sx + s.x) / 2;
      const scy = s.type === 'curve' ? s.cy : (sy + s.y) / 2;
      const ecx = e.type === 'curve' ? e.cx : (ex + e.x) / 2;
      const ecy = e.type === 'curve' ? e.cy : (ey + e.y) / 2;
      out.push({ type: 'curve', cx: lerp(scx, ecx, t), cy: lerp(scy, ecy, t), x, y });
    }
    sx = s.x;
    sy = s.y;
    ex = e.x;
    ey = e.y;
  }
  return out;
}
