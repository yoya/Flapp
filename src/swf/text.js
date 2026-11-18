// フォントとテキストの解釈（仕様 10 章）。
import { shapeToPaths } from '../shape/paths.js';
import { Reader, SWFError } from './reader.js';
import { shapeRecords } from './shape.js';

/**
 * DefineFont (10) / DefineFont2 (48) / DefineFont3 (75)。
 * グリフは数が多いことがあるので、輪郭は使うときに初めて読む。
 */
export function parseDefineFont(tag) {
  const r = new Reader(tag.body);
  const font = {
    id: r.u16(),
    name: '', bold: false, italic: false,
    // グリフ座標の 1 em。DefineFont3 は 20 倍の精度で入っている。
    unitsPerEm: tag.code === 75 ? 1024 * 20 : 1024,
    codes: null, // グリフ番号 → 文字コード
    advances: null, // グリフ番号 → 送り幅（em 単位）
    ascent: 0, descent: 0, leading: 0,
  };
  let offsets;
  let tableStart;
  if (tag.code === 10) {
    tableStart = r.pos;
    const first = r.u16();
    offsets = [first];
    for (let i = 1; i < first / 2; i++) offsets.push(r.u16());
  } else if (tag.code === 48 || tag.code === 75) {
    const flags = r.u8();
    const hasLayout = (flags & 0x80) !== 0;
    const wideOffsets = (flags & 0x08) !== 0;
    const wideCodes = (flags & 0x04) !== 0;
    font.italic = (flags & 0x02) !== 0;
    font.bold = (flags & 0x01) !== 0;
    r.u8(); // LanguageCode
    font.name = new TextDecoder().decode(r.bytesView(r.u8())).replace(/\0+$/, '');
    const count = r.u16();
    tableStart = r.pos;
    offsets = [];
    if (count > 0) {
      const offset = () => (wideOffsets ? r.u32() : r.u16());
      for (let i = 0; i < count; i++) offsets.push(offset());
      const codeTable = new Reader(tag.body.subarray(tableStart + offset()));
      font.codes = Array.from({ length: count }, () => (wideCodes ? codeTable.u16() : codeTable.u8()));
      if (hasLayout) {
        font.ascent = codeTable.u16();
        font.descent = codeTable.u16();
        font.leading = codeTable.s16();
        font.advances = Array.from({ length: count }, () => codeTable.s16());
        // 以降の FontBoundsTable とカーニングは使わない。
      }
    }
  } else {
    throw new SWFError(`tag ${tag.code} is not a DefineFont`);
  }

  const paths = new Map(); // グリフ番号 → パス（無いグリフは null）
  font.glyphCount = offsets.length;
  /** グリフの輪郭（em 単位、原点はベースラインの左端）。読めないグリフは null。 */
  font.glyphPath = (index) => {
    if (paths.has(index)) return paths.get(index);
    let path = null;
    if (index >= 0 && index < offsets.length) {
      try {
        const records = shapeRecords(new Reader(tag.body.subarray(tableStart + offsets[index])), 1);
        // グリフは塗り 1 つだけの図形。どちら側に塗りが指定されていても同じ輪郭になる。
        path = shapeToPaths({ fillStyles: [{}], lineStyles: [], records, usesWindingRule: false })[0]?.path ?? null;
      } catch (e) {
        if (e.name !== 'SWFError') throw e;
      }
    }
    paths.set(index, path);
    return path;
  };
  return font;
}

/** DefineText (11) / DefineText2 (33)。 */
export function parseDefineText(tag) {
  const r = new Reader(tag.body);
  const text = { id: r.u16(), bounds: r.rect(), matrix: r.matrix(), records: [] };
  const glyphBits = r.u8();
  const advanceBits = r.u8();
  for (;;) {
    const flags = r.u8();
    if (flags === 0) break;
    const rec = {};
    if (flags & 0x08) rec.fontId = r.u16();
    if (flags & 0x04) rec.color = tag.code === 33 ? r.rgba() : r.rgb();
    if (flags & 0x01) rec.xOffset = r.s16();
    if (flags & 0x02) rec.yOffset = r.s16();
    if (flags & 0x08) rec.height = r.u16();
    const count = r.u8();
    rec.glyphs = [];
    for (let i = 0; i < count; i++) rec.glyphs.push({ index: r.ub(glyphBits), advance: r.sb(advanceBits) });
    r.align();
    text.records.push(rec);
  }
  return text;
}

/** DefineEditText (37)。 */
export function parseDefineEditText(tag, byteStrings = false) {
  const r = new Reader(tag.body, byteStrings);
  const edit = { id: r.u16(), bounds: r.rect() };
  const f1 = r.u8();
  const f2 = r.u8();
  Object.assign(edit, {
    wordWrap: (f1 & 0x40) !== 0, multiline: (f1 & 0x20) !== 0, password: (f1 & 0x10) !== 0, readOnly: (f1 & 0x08) !== 0,
    autoSize: (f2 & 0x40) !== 0, noSelect: (f2 & 0x10) !== 0, border: (f2 & 0x08) !== 0, wasStatic: (f2 & 0x04) !== 0,
    html: (f2 & 0x02) !== 0, useOutlines: (f2 & 0x01) !== 0,
    color: { r: 0, g: 0, b: 0, a: 255 }, height: 240,
    align: 'left', leftMargin: 0, rightMargin: 0, indent: 0, leading: 0, text: '',
  });
  if (f1 & 0x01) edit.fontId = r.u16();
  if (f2 & 0x80) edit.fontClass = r.string();
  if (f1 & 0x01 || f2 & 0x80) edit.height = r.u16();
  if (f1 & 0x04) edit.color = r.rgba();
  if (f1 & 0x02) edit.maxLength = r.u16();
  if (f2 & 0x20) {
    edit.align = ['left', 'right', 'center', 'justify'][r.u8()] ?? 'left';
    edit.leftMargin = r.u16();
    edit.rightMargin = r.u16();
    edit.indent = r.u16();
    edit.leading = r.s16();
  }
  edit.variableName = r.string();
  if (f1 & 0x80) edit.text = r.string();
  return edit;
}

const transform = (m, x, y) => [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty];
// グリフのパスを、倍率 scale と原点 (x, y) で配置し、行列 m で変換する。
function placeGlyph(path, scale, x, y, m) {
  return path.map((cmd) => {
    if (cmd[0] === 'Z') return cmd;
    const out = [cmd[0]];
    for (let i = 1; i < cmd.length; i += 2) out.push(...transform(m, x + cmd[i] * scale, y + cmd[i + 1] * scale));
    return out;
  });
}

/**
 * 静的テキストを、図形と同じ形式の描画命令（グリフごとの塗り）にする。
 * @param {ReturnType<typeof parseDefineText>} text
 * @param {(id: number) => object | undefined} getFont  フォント ID → parseDefineFont の結果
 */
export function textToPaths(text, getFont) {
  const ops = [];
  let font;
  let color = { r: 0, g: 0, b: 0, a: 255 };
  let height = 0;
  let x = 0;
  let y = 0;
  for (const rec of text.records) {
    if (rec.fontId !== undefined) {
      font = getFont(rec.fontId);
      height = rec.height;
    }
    if (rec.color) color = rec.color;
    if (rec.xOffset !== undefined) x = rec.xOffset;
    if (rec.yOffset !== undefined) y = rec.yOffset;
    for (const glyph of rec.glyphs) {
      const path = font?.glyphPath(glyph.index);
      if (path) {
        ops.push({ kind: 'fill', style: { type: 'solid', color }, evenOdd: true, path: placeGlyph(path, height / font.unitsPerEm, x, y, text.matrix) });
      }
      x += glyph.advance;
    }
  }
  return ops;
}

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const GUTTER = 40; // テキストフィールドの内側の余白（2px）
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

// HTML テキストを素の文字列にする。段落と改行タグは改行にし、書式タグは捨てる。
export function plainText(html) {
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, '\r')
    .replace(/<[^>]*>/g, '')
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\r$/, '');
}

/**
 * テキストフィールドの初期表示を描画命令にする。書式は全体で 1 つだけ（HTML の書式タグは反映しない）。
 * 埋め込みフォントに字形があればグリフの塗り、無ければ { kind: 'text' }（描画側が端末のフォントで描く）。
 */
export function editTextToPaths(edit, getFont) {
  const ops = [];
  const { xmin, xmax, ymin, ymax } = edit.bounds;
  // 定義では「枠あり」が背景と枠線の両方を意味する。スクリプトからは別々に切り替えられ、色も変えられる。
  const box = [['M', xmin, ymin], ['L', xmax, ymin], ['L', xmax, ymax], ['L', xmin, ymax], ['Z']];
  if (edit.background ?? edit.border) {
    ops.push({ kind: 'fill', style: { type: 'solid', color: edit.backgroundColor ?? { r: 255, g: 255, b: 255, a: 255 } }, evenOdd: true, path: box });
  }
  if (edit.border) {
    ops.push({
      kind: 'stroke', path: box,
      // 枠は極細線（どの倍率でも 1 デバイスピクセル）。
      style: { width: 1, color: edit.borderColor ?? { r: 0, g: 0, b: 0, a: 255 }, startCap: 'round', endCap: 'round', join: 'round', noClose: false },
    });
  }
  let content = edit.html ? plainText(edit.text) : edit.text;
  if (edit.password) content = content.replace(/[^\r\n]/g, '*');
  if (!content) return ops;

  const font = edit.fontId === undefined ? undefined : getFont(edit.fontId);
  const glyphOf = new Map(font?.codes?.map((code, index) => [code, index]));
  const outlines = edit.useOutlines && font?.advances && [...content].every((ch) => /[\r\n]/.test(ch) || glyphOf.has(ch.codePointAt(0)));
  const scale = font ? edit.height / font.unitsPerEm : 0;
  const ascent = outlines ? font.ascent * scale : edit.height * 0.9; // 端末フォントの寸法は概算
  const lineHeight = (outlines ? (font.ascent + font.descent) * scale : edit.height * 1.15) + edit.leading;
  const widthOf = (s) => [...s].reduce((w, ch) => w + font.advances[glyphOf.get(ch.codePointAt(0))] * scale, 0);

  const left = xmin + GUTTER + edit.leftMargin;
  const right = xmax - GUTTER - edit.rightMargin;
  let lines = content.split(/\r\n|\r|\n/);
  if (!edit.multiline) lines = [lines.join('')];
  if (outlines && edit.wordWrap) {
    // 幅を超える行を空白の位置で折り返す。
    lines = lines.flatMap((line, n) => {
      const out = [];
      let current = '';
      for (const word of line.split(/(?<= )/)) {
        const limit = right - left - (n === 0 && out.length === 0 ? edit.indent : 0);
        if (current && widthOf(current + word.trimEnd()) > limit) {
          out.push(current.trimEnd());
          current = '';
        }
        current += word;
      }
      out.push(current);
      return out;
    });
  }

  lines.forEach((line, n) => {
    const top = ymin + GUTTER + n * lineHeight;
    const start = left + (n === 0 ? edit.indent : 0);
    if (!outlines) {
      ops.push({
        kind: 'text', text: line, x: start, y: top, width: right - start, align: edit.align, size: edit.height,
        family: font?.name ?? edit.fontName ?? '', bold: edit.bold ?? font?.bold ?? false, italic: edit.italic ?? font?.italic ?? false, color: edit.color,
      });
      return;
    }
    const extra = right - start - widthOf(line);
    let x = start + (edit.align === 'right' ? extra : edit.align === 'center' ? extra / 2 : 0);
    for (const ch of line) {
      const index = glyphOf.get(ch.codePointAt(0));
      const path = font.glyphPath(index);
      if (path) {
        ops.push({ kind: 'fill', style: { type: 'solid', color: edit.color }, evenOdd: true, path: placeGlyph(path, scale, x, top + ascent, IDENTITY) });
      }
      x += font.advances[index] * scale;
    }
  });
  return ops;
}
