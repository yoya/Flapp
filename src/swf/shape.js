// DefineShape / DefineShape2 / 3 / 4 の解釈（仕様 6〜7 章）。
import { Reader, SWFError } from './reader.js';

const SHAPE_VERSION = { 2: 1, 22: 2, 32: 3, 83: 4 };

/**
 * @param {{ code: number, body: Uint8Array }} tag
 * @returns {{
 *   id: number, bounds: object, edgeBounds?: object, usesWindingRule: boolean,
 *   fillStyles: object[], lineStyles: object[], records: object[],
 * }}
 * records は次のいずれか（座標は twips、図形の原点からの絶対値）:
 *   { type: 'style', moveTo?: {x, y}, fill0?: n, fill1?: n, line?: n, fillStyles?, lineStyles? }
 *   { type: 'line', x, y }           現在位置から (x, y) への直線
 *   { type: 'curve', cx, cy, x, y }  制御点 (cx, cy) の 2 次ベジェ
 * fill0 / fill1 / line は 1 始まりの番号で、0 は「なし」。
 */
export function parseDefineShape(tag) {
  const version = SHAPE_VERSION[tag.code];
  if (!version) throw new SWFError(`tag ${tag.code} is not a DefineShape`);
  const r = new Reader(tag.body);
  const shape = { id: r.u16(), bounds: r.rect(), usesWindingRule: false };
  if (version === 4) {
    shape.edgeBounds = r.rect();
    r.ub(5);
    shape.usesWindingRule = r.ub(1) === 1;
    r.ub(2); // UsesNonScalingStrokes, UsesScalingStrokes
  }
  shape.fillStyles = fillStyleArray(r, version);
  shape.lineStyles = lineStyleArray(r, version);
  shape.records = shapeRecords(r, version);
  return shape;
}

function fillStyleArray(r, version) {
  let count = r.u8();
  if (count === 0xff) count = r.u16();
  const styles = [];
  for (let i = 0; i < count; i++) styles.push(fillStyle(r, version));
  return styles;
}

function fillStyle(r, version) {
  const type = r.u8();
  const color = () => (version >= 3 ? r.rgba() : r.rgb());
  if (type === 0x00) return { type: 'solid', color: color() };
  if (type === 0x10 || type === 0x12 || type === 0x13) {
    const matrix = r.matrix();
    const spread = ['pad', 'reflect', 'repeat', 'pad'][r.ub(2)];
    const linearRGB = r.ub(2) === 1;
    const count = r.ub(4);
    const stops = [];
    for (let i = 0; i < count; i++) stops.push({ ratio: r.u8(), color: color() });
    const style = { type: type === 0x10 ? 'linear' : 'radial', matrix, spread, linearRGB, stops, focal: 0 };
    if (type === 0x13) style.focal = r.fixed8();
    return style;
  }
  if (type >= 0x40 && type <= 0x43) {
    return { type: 'bitmap', bitmapId: r.u16(), matrix: r.matrix(), repeat: (type & 1) === 0, smooth: type < 0x42 };
  }
  throw new SWFError(`unknown fill style type 0x${type.toString(16)}`);
}

function lineStyleArray(r, version) {
  let count = r.u8();
  if (count === 0xff) count = r.u16();
  const styles = [];
  for (let i = 0; i < count; i++) {
    const width = r.u16();
    if (version < 4) {
      styles.push({ width, color: version >= 3 ? r.rgba() : r.rgb(), startCap: 'round', endCap: 'round', join: 'round', noClose: false });
      continue;
    }
    const caps = ['round', 'butt', 'square', 'round'];
    const startCap = caps[r.ub(2)];
    const join = ['round', 'bevel', 'miter', 'round'][r.ub(2)];
    const hasFill = r.ub(1);
    const noHScale = r.ub(1) === 1;
    const noVScale = r.ub(1) === 1;
    const pixelHinting = r.ub(1) === 1;
    r.ub(5);
    const noClose = r.ub(1) === 1;
    const endCap = caps[r.ub(2)];
    const style = { width, startCap, endCap, join, noClose, noHScale, noVScale, pixelHinting };
    if (join === 'miter') style.miterLimit = r.u16() / 256;
    if (hasFill) style.fill = fillStyle(r, version);
    else style.color = r.rgba();
    styles.push(style);
  }
  return styles;
}

/**
 * SHAPE / SHAPEWITHSTYLE のレコード列（NumFillBits / NumLineBits から EndShapeRecord まで）。
 * フォントのグリフ (SHAPE) もこの形式。version は DefineShape の版（スタイル差し替え時の色の形式に使う）。
 */
export function shapeRecords(r, version) {
  r.align();
  let fillBits = r.ub(4);
  let lineBits = r.ub(4);
  const records = [];
  let x = 0;
  let y = 0;
  for (;;) {
    if (r.ub(1) === 0) {
      const flags = r.ub(5);
      if (flags === 0) break; // EndShapeRecord
      const rec = { type: 'style' };
      if (flags & 0x01) {
        const n = r.ub(5);
        x = r.sb(n);
        y = r.sb(n);
        rec.moveTo = { x, y };
      }
      if (flags & 0x02) rec.fill0 = r.ub(fillBits);
      if (flags & 0x04) rec.fill1 = r.ub(fillBits);
      if (flags & 0x08) rec.line = r.ub(lineBits);
      if (flags & 0x10) {
        rec.fillStyles = fillStyleArray(r, version);
        rec.lineStyles = lineStyleArray(r, version);
        r.align();
        fillBits = r.ub(4);
        lineBits = r.ub(4);
      }
      records.push(rec);
    } else if (r.ub(1) === 1) {
      const n = r.ub(4) + 2;
      if (r.ub(1)) {
        x += r.sb(n);
        y += r.sb(n);
      } else if (r.ub(1)) {
        y += r.sb(n);
      } else {
        x += r.sb(n);
      }
      records.push({ type: 'line', x, y });
    } else {
      const n = r.ub(4) + 2;
      const cx = x + r.sb(n);
      const cy = y + r.sb(n);
      x = cx + r.sb(n);
      y = cy + r.sb(n);
      records.push({ type: 'curve', cx, cy, x, y });
    }
  }
  return records;
}
