// フォントとテキストの解釈（仕様 10 章）。
import { CHAR_KEYS } from '../player/richtext.js';
import { shapeToPaths } from '../shape/paths.js';
import { Reader, SWFError } from './reader.js';
import { shapeRecords } from './shape.js';

/**
 * DefineFont (10) / DefineFont2 (48) / DefineFont3 (75)。
 * グリフは数が多いことがあるので、輪郭は使うときに初めて読む。
 */
// フォントの名前。UTF-8 として読めなければ、1 バイトを 1 文字として読む（SWF 6 の実機の getTextFormat().font で確認。Shift-JIS の名前など）。
function fontName(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0+$/, '');
  } catch {
    return String.fromCharCode(...bytes).replace(/\0+$/, '');
  }
}

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
    offsets = [];
    if (r.pos < tag.body.length) { // 字形の無いフォント（id だけ）もある。名前は DefineFontInfo で付き、端末のフォントで描く
      const first = r.u16();
      offsets.push(first);
      for (let i = 1; i < first / 2; i++) offsets.push(r.u16());
    }
  } else if (tag.code === 48 || tag.code === 75) {
    const flags = r.u8();
    const hasLayout = (flags & 0x80) !== 0;
    const wideOffsets = (flags & 0x08) !== 0;
    const wideCodes = (flags & 0x04) !== 0;
    font.italic = (flags & 0x02) !== 0;
    font.bold = (flags & 0x01) !== 0;
    r.u8(); // LanguageCode
    font.name = fontName(r.bytesView(r.u8()));
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
  /** グリフの SHAPE のレコード（shapeRecords の形）。番号が範囲外なら null、壊れていれば SWFError。 */
  font.glyphRecords = (index) => (index >= 0 && index < offsets.length ? shapeRecords(new Reader(tag.body.subarray(tableStart + offsets[index])), 1) : null);
  /** グリフの輪郭（em 単位、原点はベースラインの左端）。読めないグリフは null。 */
  font.glyphPath = (index) => {
    if (paths.has(index)) return paths.get(index);
    let path = null;
    if (index >= 0 && index < offsets.length) {
      try {
        const records = font.glyphRecords(index);
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

/**
 * DefineFontInfo (13) / DefineFontInfo2 (62)。DefineFont（字形だけ）に付ける名前・太字・斜体と、グリフ番号 → 文字コード。
 * glyphCount は、そのフォントのグリフの数。
 */
export function parseDefineFontInfo(tag, glyphCount) {
  const r = new Reader(tag.body);
  const id = r.u16();
  const name = fontName(r.bytesView(r.u8()));
  const flags = r.u8();
  if (tag.code === 62) r.u8(); // LanguageCode
  const wide = (flags & 0x01) !== 0;
  const codes = [];
  while (codes.length < glyphCount && r.pos + (wide ? 2 : 1) <= tag.body.length) codes.push(wide ? r.u16() : r.u8());
  return { id, name, bold: (flags & 0x02) !== 0, italic: (flags & 0x04) !== 0, codes };
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

// 端末のフォントの行の寸法。実機（mac の日本語の環境）の getLineMetrics で測った（test/as3/textlineheight.as・textmetrics.as・
// textmetrics2.as）。多くは、大きさにフォントごとの比を掛けて 0.5 px の単位に丸めたもの。名前を知らないフォントは Helvetica と同じ。
// 汎用の名前（_sans など）は大きさごとに不規則なので、測った値の表を使い、表に無い大きさは前後の比を直線でつなぐ。
const DEVICE_RATIOS = [
  [/^(_ゴシック|_明朝)$/, 0.88, 0.12], // ヒラギノ
  [/^(osaka|_\x83S\x83V\x83b\x83N)$/i, 1, 0.25], // 後者は Shift-JIS の「_ゴシック」を 1 バイトずつ読んだ名前。実機は Osaka で描く
  [/^arial$/i, 0.905, 0.212],
];
const DEVICE_TABLES = Object.fromEntries(Object.entries({
  _sans: '8:9/2 9:8/2 10:8.5/2.5 11:11.5/2.5 12:12.5/3 13:13/3 14:13/3 16:15.5/3.5 18:17/4 20:19.5/4.5 24:21.5/5.5 28:25/6.5 30:27/7 36:32.5/8.5 48:43.5/11 72:65.5/16.5',
  _serif: '8:8/2 9:9/2.5 10:8.5/2.5 11:11.5/3 12:12/3 13:12/3.5 14:12.5/3.5 16:15/4 18:15.5/4.5 20:17.5/5 24:20.5/6 28:24/7 30:26/7.5 36:32.5/9 48:43/12 72:63.5/18',
  _typewriter: '8:6/2 9:8/2 10:7.5/2.5 11:11.5/2.5 12:12/3 13:12/3 14:12.5/3.5 16:14.5/4 18:14.5/4.5 20:17/5 24:20/6 28:23.5/7 30:25/7.5 36:27.5/9 48:37/12 72:57/17.5',
  _等幅: '8:7/1.5 9:7.5/1.5 10:8.5/2 11:9.5/2 12:10.5/2.5 13:11/2.5 14:12/2.5 16:13.5/3 18:15.5/3.5 20:17/4 24:20.5/4.5 28:24/5.5 36:31/7 48:41/9 72:61.5/14',
}).map(([name, table]) => [name, table.split(' ').map((item) => item.split(/[:/]/).map(Number))]));

/**
 * 端末のフォント family の、大きさ size（px）の行の寸法（px）: 上端から文字の基準線まで（ascent）、その下（descent）、行の高さ（その和。
 * leading が 0 のとき）。既定のフォント（Times Roman）と Times・Courier は、大きさの 3/4 と 1/4 を 0.5 px の単位に切り上げたもの。
 */
export function deviceMetrics(size, family = 'Times Roman') {
  const half = (v) => Math.round(v * 2) / 2;
  const name = family || 'Times Roman';
  let ascent, descent;
  const table = DEVICE_TABLES[name];
  if (table) {
    const exact = table.find(([at]) => at === size);
    if (exact) [, ascent, descent] = exact;
    else {
      const i = table.findIndex(([at]) => at > size);
      const [a, b] = i < 0 ? [table[table.length - 1], table[table.length - 1]] : i === 0 ? [table[0], table[0]] : [table[i - 1], table[i]];
      const t = b[0] === a[0] ? 0 : (size - a[0]) / (b[0] - a[0]);
      ascent = half(size * (a[1] / a[0] + t * (b[1] / b[0] - a[1] / a[0])));
      descent = half(size * (a[2] / a[0] + t * (b[2] / b[0] - a[2] / a[0])));
    }
  } else if (/^(times( roman)?|courier)$/i.test(name)) {
    const ceil2 = (v) => Math.ceil(v * 2 - 1e-9) / 2;
    ascent = ceil2(size * 0.75);
    descent = ceil2(size * 0.25);
  } else {
    const [, a, d] = DEVICE_RATIOS.find(([re]) => re.test(name)) ?? [null, 0.77, 0.23];
    ascent = half(size * a);
    descent = half(size * d);
  }
  return { ascent, descent, height: ascent + descent };
}
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

// HTML テキストを素の文字列にする。段落と改行タグは改行にし、書式タグは捨てる。
export function plainText(html) {
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, '\r')
    .replace(/<[^>]*>/g, '')
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\r$/, '');
}

// 文字ごとに書式が違うテキスト（edit.runs は { text, fmt } の並びで、text をつなげたものが edit.text）の配置。
// 段落（CR で終わる）ごとに、最初の文字の書式で位置揃え・余白・字下げ・行間・箇条書きを決める。wordWrap なら、空白の位置で折り返す
// （端末のフォントの幅は分からないので、折り返しの判断だけは 1 文字 = 大きさの半分（全角は 1 倍）の概算）。埋め込みのフォントで全部の字形が
// あれば字形の塗り、無ければ { kind: 'text', runs }（描画側が、端末のフォントで 1 行ぶんを順に並べる）。
function richText(edit, ops, content, font, glyphOf, outlines) {
  const { xmin, xmax, ymin } = edit.bounds;
  const base = edit.runs[0]?.fmt;
  const chars = [];
  let at = 0;
  for (const run of edit.runs) for (const unit of run.text) { chars.push({ ch: content[at] ?? unit, f: run.fmt, i: at }); at += unit.length; }
  const paragraphs = [[]];
  for (const c of chars) {
    if (c.ch === '\r' || c.ch === '\n') paragraphs.push([]);
    else paragraphs[paragraphs.length - 1].push(c);
  }
  const unitsPerEm = font?.unitsPerEm ?? 1024;
  const sizeOf = (c) => c.f.size * 20;
  const widthOf = (c) => {
    if (outlines) return (font.advances[glyphOf.get(c.ch.codePointAt(0))] * sizeOf(c)) / unitsPerEm + c.f.letterSpacing * 20;
    // edit.measure は、描く側が測った文字の幅（twips）。無ければ概算（半角は大きさの半分、全角は 1 倍）。
    const measured = edit.measure?.(c.ch, c.f, edit.deviceFont);
    return (measured ?? (c.ch.codePointAt(0) >= 0x2e80 ? sizeOf(c) : sizeOf(c) * 0.5)) + c.f.letterSpacing * 20;
  };
  // 行の [いちばん大きな文字の大きさ, 行の高さ, 上端から基準線まで]（twips）。端末のフォントは、文字ごとの ascent と descent の
  // それぞれの最大（フォントごとの寸法は deviceMetrics）。
  const heightOf = (line, pf) => {
    const size = line.length ? Math.max(...line.map(sizeOf)) : sizeOf({ f: pf });
    if (outlines) return [size, size * ((font.ascent + font.descent) / unitsPerEm) + pf.leading * 20, (font.ascent / unitsPerEm) * size];
    const list = (line.length ? line : [{ f: pf }]).map((c) => deviceMetrics(c.f.size, edit.deviceFont ?? c.f.font));
    const ascent = Math.max(...list.map((m) => m.ascent)) * 20, descent = Math.max(...list.map((m) => m.descent)) * 20;
    return [size, ascent + descent + pf.leading * 20, ascent];
  };
  // 画像（<img>）は、それがある行の下に置かれ、あとの行の文章は、画像の横へ回り込む。位置は実機で測った（左右の端から hspace、
  // 行の下から vspace。いずれも余白の 2 倍ぶん内側）。images は { index, bitmap, width, height, align, hspace, vspace }（twips でなく px）。
  const imageAt = new Map((edit.images ?? []).map((im) => [im.index, im]));
  const floats = []; // 画像の占める帯 { side, y0, y1, width }
  const bandAt = (top, height) => {
    let left = 0, right = 0;
    for (const fl of floats) if (top < fl.y1 && top + height > fl.y0) { if (fl.side === 'left') left = Math.max(left, fl.width); else right = Math.max(right, fl.width); }
    return [left, right];
  };
  const imageOps = []; // 画像は、文字より上に描く
  const place = (line, lineTop, height) => {
    for (const c of line) {
      const im = imageAt.get(c.i);
      if (!im?.bitmap) continue;
      const [w, h] = [im.width * 20, im.height * 20];
      const [hspace, vspace] = [im.hspace * 20, im.vspace * 20];
      const top = lineTop + height - 2 * GUTTER + vspace;
      const onRight = im.align === 'right';
      const x = onRight ? xmax - 2 * GUTTER - hspace - w : xmin + hspace;
      floats.push({ side: onRight ? 'right' : 'left', y0: top, y1: top + h, width: w + 2 * hspace });
      const matrix = { a: w / im.bitmap.width, b: 0, c: 0, d: h / im.bitmap.height, tx: x, ty: top };
      imageOps.push({ kind: 'fill', style: { type: 'bitmap', bitmap: im.bitmap, matrix, repeat: false, smooth: true }, evenOdd: true, path: [['M', x, top], ['L', x + w, top], ['L', x + w, top + h], ['L', x, top + h], ['Z']] });
    }
  };
  let y = ymin + GUTTER;
  paragraphs.forEach((par, n) => {
    if (!edit.multiline && n > 0) return;
    const pf = par[0]?.f ?? base;
    // 箇条書きの点は左端から大きさの約 1.7 倍、文字は約 3 倍のところから始まる（実機の画面から）。
    const left = xmin + GUTTER + (pf.leftMargin + pf.blockIndent) * 20 + (pf.bullet ? sizeOf({ f: pf }) * 3 : 0);
    const right = xmax - GUTTER - pf.rightMargin * 20;
    // 行に分ける（画像の帯に重なる行は、狭くする）。
    const lines = [];
    const tops = []; // 行ごとの { top, band }
    let line = [], width = 0, lastSpace = -1, top = y;
    const startLine = () => { tops.push({ top, band: bandAt(top, heightOf(line, pf)[1] || 1) }); };
    startLine();
    const limit = () => right - left - tops[tops.length - 1].band[0] - tops[tops.length - 1].band[1] - (lines.length === 0 ? pf.indent * 20 : 0);
    const endLine = () => { lines.push(line); const height = heightOf(line, pf)[1]; place(line, top, height); top += height; };
    for (const c of par) {
      const w = widthOf(c);
      if (edit.wordWrap && line.length && width + w > limit() && c.ch !== ' ') {
        let rest = [];
        if (lastSpace >= 0) rest = line.splice(lastSpace + 1);
        endLine();
        line = rest;
        startLine();
        width = line.reduce((sum, x) => sum + widthOf(x), 0);
        lastSpace = -1;
      }
      line.push(c);
      width += w;
      if (c.ch === ' ') lastSpace = line.length - 1;
    }
    place(line, top, heightOf(line, pf)[1]);
    lines.push(line);
    lines.forEach((chars2, row) => {
      const [size, height, baseline] = heightOf(chars2, pf);
      const [shiftLeft, shiftRight] = tops[row].band;
      const x0 = left + shiftLeft + (row === 0 ? pf.indent * 20 : 0);
      const right2 = right - shiftRight;
      if (pf.bullet && row === 0 && par.length) {
        ops.push({ kind: 'text', text: '•', x: left - sizeOf({ f: pf }) * 1.3, y, ascent: baseline, width: sizeOf({ f: pf }), align: 'left', size: sizeOf({ f: pf }), family: edit.deviceFont ?? pf.font, bold: pf.bold, italic: pf.italic, color: rgb(pf.color) });
      }
      if (outlines) {
        const total = chars2.reduce((sum, c) => sum + widthOf(c), 0);
        const extra = Math.max(0, right2 - x0 - total); // 枠より広い行は、揃え方によらず左端から並べる（実機で確認。test/as/textclip.as）
        let x = x0 + (pf.align === 'right' ? extra : pf.align === 'center' ? extra / 2 : 0);
        const ascent = (font.ascent / unitsPerEm) * size;
        for (const c of chars2) {
          const index = glyphOf.get(c.ch.codePointAt(0));
          const path = font.glyphPath(index);
          if (path) ops.push({ kind: 'fill', style: { type: 'solid', color: rgb(c.f.color) }, evenOdd: true, path: placeGlyph(path, sizeOf(c) / unitsPerEm, x, y + ascent, IDENTITY) });
          x += widthOf(c);
        }
      } else if (chars2.length) {
        // 書式が同じ文字の続きごとの 1 まとまり。
        const runs = [];
        for (const c of chars2) {
          const last = runs[runs.length - 1];
          if (last && CHAR_KEYS.every((k) => last.f[k] === c.f[k])) last.text += c.ch;
          else runs.push({ text: c.ch, f: c.f });
        }
        ops.push({
          kind: 'text', x: x0, y, ascent: baseline, width: right2 - x0, align: pf.align, size,
          runs: runs.map((r) => ({ text: r.text, size: r.f.size * 20, family: edit.deviceFont ?? r.f.font, bold: r.f.bold, italic: r.f.italic, underline: r.f.underline, color: rgb(r.f.color), letterSpacing: r.f.letterSpacing * 20 })),
        });
      }
      y += height;
    });
  });
  ops.push(...imageOps);
  return ops;
}

const rgb = (n) => ({ r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 });

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
  if (edit.runs) return richText(edit, ops, content, font, glyphOf, outlines);
  const scale = font ? edit.height / font.unitsPerEm : 0;
  const family = edit.deviceFont ?? font?.name ?? edit.fontName ?? '';
  const ascent = outlines ? font.ascent * scale : deviceMetrics(edit.height / 20, family).ascent * 20;
  const lineHeight = (outlines ? (font.ascent + font.descent) * scale : deviceMetrics(edit.height / 20, family).height * 20) + edit.leading;
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
        kind: 'text', text: line, x: start, y: top, ascent, width: right - start, align: edit.align, size: edit.height,
        family, bold: edit.bold ?? font?.bold ?? false, italic: edit.italic ?? font?.italic ?? false, color: edit.color,
      });
      return;
    }
    const extra = Math.max(0, right - start - widthOf(line)); // 枠より広い行は、揃え方によらず左端から並べる（実機で確認。test/as/textclip.as）
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
