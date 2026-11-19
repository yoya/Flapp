// テスト用 SWF を生成して test/fixtures/ に書き出す。
// 仕様: docs/swf-file-format-spec-v19.pdf 1〜3 章（基本型・ヘッダ・表示リスト）、5 章（アクション）、6〜7 章（図形）。
//
// 多フレームのものは、10 フレーム目までに絵が止まり、その後は長く同じ絵が続くように作る
// （実機の画面は再生開始から数秒後に取るので、どのフレームで取っても同じ絵になる必要がある）。
//
// zws-hello.swf だけはここで生成しない（Node に LZMA 圧縮が無いため）。lzma-src.swf を
// 次のコマンドで圧縮したものをコミットしている:
//   python3 -c 'import lzma,struct;d=open("test/fixtures/lzma-src.swf","rb").read();c=lzma.compress(d[8:],format=lzma.FORMAT_ALONE);open("test/fixtures/zws-hello.swf","wb").write(b"ZWS"+d[3:8]+struct.pack("<I",len(c)-13)+c[:5]+c[13:])'
//
// 音のテスト用の素材（tools/assets/）は、0.3 秒・440 Hz・小さな音量の音 (22050 Hz モノラル) から次のように作った:
//   tone.mp3        lame --quiet -r -s 22.05 -m m --bitwidth 16 --signed --little-endian -b 32 tone.raw tone.mp3
//   tone-adpcm.flv  ffmpeg -f s16le -ar 22050 -ac 1 -i tone.raw -c:a adpcm_swf -f flv tone-adpcm.flv
//                   （ADPCM の復号を ffmpeg の復号結果と突き合わせるため。test/sound.test.js）
//
// ビデオのテスト用の素材は、ffmpeg のテスト用の絵（64×48 px、8 フレーム、4 フレームごとにキーフレーム）から作った:
//   video-h263.flv  ffmpeg -f lavfi -i testsrc2=size=64x48:rate=12 -frames:v 8 -c:v flv -g 4 -q:v 4 -an -fflags +bitexact -flags +bitexact video-h263.flv
//   video-h263.yuv  ffmpeg -i video-h263.flv -f rawvideo -pix_fmt yuv420p video-h263.yuv
//                   （H.263 の復号を ffmpeg の復号結果と突き合わせるため。test/video.test.js）
// Screen Video v2 は ffmpeg でしか作れないので、FLV の素材だけがある（灰色の地に、現れては消える四角。128×64 px、7 フレーム）:
//   video-screen2.flv     ffmpeg -f lavfi -i "color=c=0x406080:size=128x64:rate=12,drawbox=x=8:y=8:w=30:h=20:color=red:t=fill:enable='eq(n,1)+eq(n,2)',
//                         drawbox=x=80:y=30:w=20:h=20:color=yellow:t=fill:enable='eq(n,2)+eq(n,4)',drawbox=x=64:y=0:w=64:h=64:color=0x1830c8:t=fill:enable='eq(n,6)'"
//                         -frames:v 7 -c:v flashsv2 -g 10 -an -fflags +bitexact -flags +bitexact video-screen2.flv
//   video-screen2.rgb.gz  ffmpeg -i video-screen2.flv -f rawvideo -pix_fmt rgb24 video-screen2.rgb; gzip -9n video-screen2.rgb
// VP6 の素材（video-vp6.flv、video-vp6a.flv と、ffmpeg で復号した結果）は、tools/mkvp6.js で作る（作り方はそちらの冒頭）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFLV } from '../src/video/flv.js';
import { crc32, deflateSync } from 'node:zlib';

export const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
export const u32 = (v) => [...u16(v & 0xffff), ...u16(v >>> 16)];
const cstr = (s) => [...new TextEncoder().encode(s), 0];

// ビット値の組み立て。
class Bits {
  s = '';
  ub(n, v) {
    if (n > 0) this.s += Number(v).toString(2).padStart(n, '0');
    return this;
  }
  sb(n, v) { return this.ub(n, v < 0 ? v + 2 ** n : v); }
  align() {
    this.s = this.s.padEnd(Math.ceil(this.s.length / 8) * 8, '0');
    return this;
  }
  bytes() {
    const s = this.s.padEnd(Math.ceil(this.s.length / 8) * 8, '0');
    return (s.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2));
  }
}
// 符号付きで表すのに必要なビット数。
const sbits = (...vals) => Math.max(...vals.map((v) => 32 - Math.clz32(v < 0 ? ~v : v) + 1));
const fixed = (v) => Math.round(v * 65536);

// RECT。単位は twips。
function rect(xmin, xmax, ymin, ymax) {
  const n = sbits(xmin, xmax, ymin, ymax);
  return new Bits().ub(5, n).sb(n, xmin).sb(n, xmax).sb(n, ymin).sb(n, ymax).bytes();
}

export function matrix({ a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0 } = {}) {
  const bits = new Bits();
  for (const [p, q, unit] of [[a, d, 1], [b, c, 0]]) {
    if (p === unit && q === unit) {
      bits.ub(1, 0);
    } else {
      const n = sbits(fixed(p), fixed(q));
      bits.ub(1, 1).ub(5, n).sb(n, fixed(p)).sb(n, fixed(q));
    }
  }
  const n = sbits(tx, ty);
  return bits.ub(5, n).sb(n, tx).sb(n, ty).bytes();
}

// CXFORMWITHALPHA。mult は 256 が 1.0。
function cxform({ mult, add }) {
  const n = sbits(...(mult ?? []), ...(add ?? []));
  const bits = new Bits().ub(1, add ? 1 : 0).ub(1, mult ? 1 : 0).ub(4, n);
  for (const v of [...(mult ?? []), ...(add ?? [])]) bits.sb(n, v);
  return bits.bytes();
}

// long: 中身が短くても長いタグヘッダにする。ビットマップ定義タグは長いヘッダでないと実機が読まない。
export function tag(code, body = [], long = false) {
  return body.length < 0x3f && !long
    ? [...u16((code << 6) | body.length), ...body]
    : [...u16((code << 6) | 0x3f), ...u32(body.length), ...body];
}

export function swf({ version, width = 240, height = 160, fps = 12, frames = 1, zlib = false, tags }) {
  const body = Uint8Array.from([...rect(0, width * 20, 0, height * 20), 0, fps, ...u16(frames), ...tags.flat()]);
  const head = [zlib ? 0x43 : 0x46, 0x57, 0x53, version, ...u32(8 + body.length)];
  return Uint8Array.from([...head, ...(zlib ? deflateSync(body) : body)]);
}

const SetBackgroundColor = (r, g, b) => tag(9, [r, g, b]);
export const ShowFrame = () => tag(1);
export const End = () => tag(0);
const DoAction = (actions) => tag(12, [...actions.flat(), 0]);
const PushString = (s) => [0x96, ...u16(s.length + 2), 0, ...cstr(s)]; // ASCII のみ
const Trace = () => [0x26];
const traceTag = (s) => DoAction([PushString(s), Trace()]);

export const DefineSprite = (id, frames, tags) => tag(39, [...u16(id), ...u16(frames), ...tags.flat()]);
export const RemoveObject2 = (depth) => tag(28, u16(depth));

// PlaceObject2。id があれば配置、move があれば既存の変更（両方なら置き換え）。
// clipActions: [{ events, code }]。events は 0x01 load / 0x02 enterFrame / 0x04 unload などの和（SWF 6 以降の 32 ビット形式で書く）。
export function PlaceObject2({ depth, id, move = false, matrix: m, cxform: cx, ratio, name, clipDepth, clipActions }) {
  const flags = (move ? 0x01 : 0) | (id !== undefined ? 0x02 : 0) | (m ? 0x04 : 0) | (cx ? 0x08 : 0) |
    (ratio !== undefined ? 0x10 : 0) | (name !== undefined ? 0x20 : 0) | (clipDepth !== undefined ? 0x40 : 0) |
    (clipActions ? 0x80 : 0);
  return tag(26, [
    flags, ...u16(depth),
    ...(id !== undefined ? u16(id) : []),
    ...(m ? matrix(m) : []),
    ...(cx ? cxform(cx) : []),
    ...(ratio !== undefined ? u16(ratio) : []),
    ...(name !== undefined ? (Array.isArray(name) ? [...name, 0] : cstr(name)) : []), // 配列ならそのままのバイト列
    ...(clipDepth !== undefined ? u16(clipDepth) : []),
    ...(clipActions ? [
      ...u16(0), ...u32(clipActions.reduce((all, a) => all | a.events, 0)),
      ...clipActions.flatMap((a) => [...u32(a.events), ...u32(a.code.length), ...a.code]),
      ...u32(0),
    ] : []),
  ]);
}

// PlaceObject3。PlaceObject2 の項目に加えて blendMode（番号）、filters（FILTER のバイト列の配列）、visible、
// background（不透明な背景色 [r, g, b, a]）。
export function PlaceObject3({ depth, id, move = false, matrix: m, cxform: cx, name, clipDepth, blendMode, filters, visible, background }) {
  const flags = (move ? 0x01 : 0) | (id !== undefined ? 0x02 : 0) | (m ? 0x04 : 0) | (cx ? 0x08 : 0) |
    (name !== undefined ? 0x20 : 0) | (clipDepth !== undefined ? 0x40 : 0);
  const flags2 = (filters ? 0x01 : 0) | (blendMode !== undefined ? 0x02 : 0) | (visible !== undefined ? 0x20 : 0) | (background ? 0x40 : 0);
  return tag(70, [
    flags, flags2, ...u16(depth),
    ...(id !== undefined ? u16(id) : []),
    ...(m ? matrix(m) : []),
    ...(cx ? cxform(cx) : []),
    ...(name !== undefined ? cstr(name) : []),
    ...(clipDepth !== undefined ? u16(clipDepth) : []),
    ...(filters ? [filters.length, ...filters.flat()] : []),
    ...(blendMode !== undefined ? [blendMode] : []),
    ...(visible !== undefined ? [visible ? 1 : 0] : []),
    ...(background ?? []),
  ]);
}

// --- 図形 ---
// 色は [r, g, b]（DefineShape / 2）か [r, g, b, a]（DefineShape3 / 4）。
export const solid = (...color) => [0x00, ...color];
// type: 0x10 線形、0x12 放射、0x13 焦点つき放射。stops は [ratio, ...color] の列。
// spread: 0 端の色で埋める / 1 折り返す / 2 繰り返す。linearRGB: 線形の色空間で補間する。
const gradient = ({ type, matrix: m, stops, focal, spread = 0, linearRGB = false }) => [
  type, ...matrix(m), (spread << 6) | (linearRGB ? 0x10 : 0) | stops.length, ...stops.flat(),
  ...(type === 0x13 ? u16(Math.round(focal * 256)) : []),
];
export const lineStyle = (width, ...color) => [...u16(width), ...color];
// LINESTYLE2 (DefineShape4)。join: 0 丸 / 1 ベベル / 2 マイター。startCap / endCap: 0 丸 / 1 なし / 2 四角。
// fill（塗りスタイルのバイト列）を渡すと、色の代わりに塗りで線を描く。
const lineStyle2 = ({ width, join = 0, miterLimit = 3, color, fill, startCap = 0, endCap = 0 }) => [
  ...u16(width),
  ...new Bits().ub(2, startCap).ub(2, join).ub(1, fill !== undefined).ub(3, 0).ub(6, 0).ub(2, endCap).bytes(),
  ...(join === 2 ? u16(Math.round(miterLimit * 256)) : []),
  ...(fill ?? color),
];

/**
 * DefineShape〜DefineShape4。records は次の列（座標は twips）:
 *   ['style', { moveTo: [x, y], fill0, fill1, line, newStyles: { fills, lines } }]
 *                                                       番号は 1 始まり、0 は「なし」。newStyles はスタイル表の差し替え
 *   ['line', dx, dy]
 *   ['curve', 制御点 dx, dy, 終点 dx, dy]               終点は制御点からの差分
 */
// SHAPE のレコード列（NumFillBits / NumLineBits から EndShapeRecord まで）をビット列にする。
function shapeBits(records, fillCount, lineCount) {
  let fillBits = 32 - Math.clz32(fillCount);
  let lineBits = 32 - Math.clz32(lineCount);
  const bits = new Bits().ub(4, fillBits).ub(4, lineBits);
  for (const [type, ...args] of records) {
    if (type === 'style') {
      const { moveTo, fill0, fill1, line, newStyles } = args[0];
      bits.ub(1, 0).ub(1, newStyles !== undefined).ub(1, line !== undefined).ub(1, fill1 !== undefined)
        .ub(1, fill0 !== undefined).ub(1, moveTo !== undefined);
      if (moveTo) {
        const n = sbits(...moveTo);
        bits.ub(5, n).sb(n, moveTo[0]).sb(n, moveTo[1]);
      }
      // 番号は差し替え前のビット幅で書くが、指すのは差し替え後のスタイル表。
      if (fill0 !== undefined) bits.ub(fillBits, fill0);
      if (fill1 !== undefined) bits.ub(fillBits, fill1);
      if (line !== undefined) bits.ub(lineBits, line);
      if (newStyles) {
        const { fills: f = [], lines: l = [] } = newStyles;
        bits.align();
        for (const byte of [f.length, ...f.flat(), l.length, ...l.flat()]) bits.ub(8, byte);
        fillBits = 32 - Math.clz32(f.length);
        lineBits = 32 - Math.clz32(l.length);
        bits.ub(4, fillBits).ub(4, lineBits);
      }
    } else {
      const n = Math.max(2, sbits(...args));
      bits.ub(1, 1).ub(1, type === 'line').ub(4, n - 2);
      if (type === 'curve' || (args[0] !== 0 && args[1] !== 0)) {
        if (type === 'line') bits.ub(1, 1);
        for (const v of args) bits.sb(n, v);
      } else if (args[0] === 0) {
        bits.ub(2, 0b01).sb(n, args[1]); // 垂直線
      } else {
        bits.ub(2, 0b00).sb(n, args[0]); // 水平線
      }
    }
  }
  return bits.ub(6, 0); // EndShapeRecord
}

export function DefineShape({ id, version = 1, bounds, fills = [], lines = [], records }) {
  const bits = shapeBits(records, fills.length, lines.length);
  return tag({ 1: 2, 2: 22, 3: 32, 4: 83 }[version], [
    ...u16(id), ...rect(...bounds),
    ...(version === 4 ? [...rect(...bounds), 0x01] : []), // EdgeBounds（ここでは同じ値）、UsesScalingStrokes
    fills.length, ...fills.flat(),
    lines.length, ...lines.flat(),
    ...bits.bytes(),
  ]);
}

// --- フィルタ ---
const fixed32 = (v) => u32(Math.round(v * 65536) >>> 0);
const float32 = (v) => [...new Uint8Array(new Float32Array([v]).buffer)];
export const blurFilter = (x, y, passes) => [1, ...fixed32(x), ...fixed32(y), passes << 3];
// flags: 0x80 内側 / 0x40 ノックアウト / 0x20 元の絵も描く。下位 5 ビットはぼかしの回数。
const dropShadowFilter = ({ color, blur, angle, distance, strength = 1, flags = 0x20, passes = 1 }) => [
  0, ...color, ...fixed32(blur), ...fixed32(blur), ...fixed32(angle), ...fixed32(distance), ...u16(Math.round(strength * 256)), flags | passes,
];
const glowFilter = ({ color, blur, strength = 1, flags = 0x20, passes = 1 }) => [
  2, ...color, ...fixed32(blur), ...fixed32(blur), ...u16(Math.round(strength * 256)), flags | passes,
];
const colorMatrixFilter = (m) => [6, ...m.flatMap(float32)];
// flags: 0x80 内側 / 0x40 ノックアウト / 0x20 元の絵も描く / 0x10 上に重ねる。下位 4 ビットはぼかしの回数。
const bevelFilter = ({ shadow, highlight, blur, angle, distance, strength = 1, flags = 0xa0, passes = 1 }) => [
  3, ...shadow, ...highlight, ...fixed32(blur), ...fixed32(blur), ...fixed32(angle), ...fixed32(distance), ...u16(Math.round(strength * 256)), flags | passes,
];
// type: 4 グラデーション光彩 / 7 グラデーションベベル。stops は [ratio, ...color] の列。
const gradientFilter = ({ type, stops, blur, angle = 0, distance = 0, strength = 1, flags = 0xa0, passes = 1 }) => [
  type, stops.length, ...stops.flatMap(([, ...color]) => color), ...stops.map(([ratio]) => ratio),
  ...fixed32(blur), ...fixed32(blur), ...fixed32(angle), ...fixed32(distance), ...u16(Math.round(strength * 256)), flags | passes,
];
// flags: 0x02 範囲外は端の画素 / 0x01 アルファを変えない。
const convolutionFilter = ({ x, y, matrix: m, divisor = 1, bias = 0, color = [0, 0, 0, 0], flags = 0 }) => [
  5, x, y, ...float32(divisor), ...float32(bias), ...m.flatMap(float32), ...color, flags,
];

// --- ボタン ---
// records: [{ states, id, depth, matrix, cxform }]。states は 1 通常 / 2 マウスが乗った状態 / 4 押下 / 8 当たり判定 の和。
// DefineButton2 のレコードは色変換を必ず持つ（指定が無ければ「変換なし」の 1 バイト）。
const buttonRecords = (records, version) => records.flatMap((rec) => [
  rec.states, ...u16(rec.id), ...u16(rec.depth), ...matrix(rec.matrix),
  ...(version === 2 ? (rec.cxform ? cxform(rec.cxform) : [0]) : []),
]);
// DefineButton の actions はアクションのバイト列（ボタンの上でマウスを離すと実行される）。
const DefineButton = (id, records, actions = []) => tag(7, [...u16(id), ...buttonRecords(records, 1), 0, ...actions.flat(2), 0]);
// DefineButton2 の actions は [{ cond, key, code }]。cond は 0x01 rollOver / 0x02 rollOut / 0x04 press / 0x08 release /
// 0x10 dragOut / 0x20 dragOver / 0x40 releaseOutside の和、key は keyPress のキーコード。
function DefineButton2(id, records, actions = []) {
  const recs = [...buttonRecords(records, 2), 0];
  const conds = actions.flatMap(({ cond = 0, key = 0, code }, i) => {
    const body = [...code.flat(), 0];
    return [...u16(i === actions.length - 1 ? 0 : 4 + body.length), ...u16(cond | (key << 9)), ...body];
  });
  return tag(34, [...u16(id), 0, ...u16(actions.length ? 2 + recs.length : 0), ...recs, ...conds]);
}

// --- モーフ図形 ---
// DefineMorphShape。fills / lines は MORPHFILLSTYLE / MORPHLINESTYLE のバイト列（開始と終了の値を並べたもの）。
// startRecords は塗り・線の指定つき、endRecords は移動と辺だけ。
export function DefineMorphShape({ id, startBounds, endBounds, fills = [], lines = [], startRecords, endRecords }) {
  const styles = [fills.length, ...fills.flat(), lines.length, ...lines.flat()];
  const start = shapeBits(startRecords, fills.length, lines.length).bytes();
  const end = shapeBits(endRecords, 0, 0).bytes();
  return tag(46, [
    ...u16(id), ...rect(...startBounds), ...rect(...endBounds),
    ...u32(styles.length + start.length), // EndEdges までのバイト数
    ...styles, ...start, ...end,
  ]);
}

// --- フォントとテキスト ---
// テスト用のグリフ。em は 1024、原点はベースラインの左端、y は下向き。O の穴は逆回りで描く。
const GLYPHS = {
  I: [['style', { moveTo: [250, -700], fill1: 1 }], ['line', 150, 0], ['line', 0, 700], ['line', -150, 0], ['line', 0, -700]],
  L: [
    ['style', { moveTo: [100, -700], fill1: 1 }],
    ['line', 150, 0], ['line', 0, 550], ['line', 350, 0], ['line', 0, 150], ['line', -500, 0], ['line', 0, -700],
  ],
  O: [
    ['style', { moveTo: [100, -700], fill1: 1 }], ['line', 500, 0], ['line', 0, 700], ['line', -500, 0], ['line', 0, -700],
    ['style', { moveTo: [250, -550] }], ['line', 0, 400], ['line', 200, 0], ['line', 0, -400], ['line', -200, 0],
  ],
};
const CHARS = Object.keys(GLYPHS).sort(); // 文字コード順 = グリフ番号順
const ADVANCE = 700;
const scaled = (records, k) => records.map(([type, ...args]) => (type === 'style'
  ? [type, { ...args[0], moveTo: args[0].moveTo?.map((v) => v * k) }]
  : [type, ...args.map((v) => v * k)]));
const glyphShapes = (k) => CHARS.map((ch) => shapeBits(scaled(GLYPHS[ch], k), 1, 0).bytes());
// 各グリフの位置（オフセット表の先頭から）と、その後ろの位置。
function glyphOffsets(shapes, tableSize) {
  let pos = tableSize;
  const offsets = shapes.map((shape) => {
    const at = pos;
    pos += shape.length;
    return at;
  });
  return { offsets, end: pos };
}

// DefineFont（グリフだけ。文字コードや送り幅は持たない）。
const DefineFont = (id) => {
  const shapes = glyphShapes(1);
  const { offsets } = glyphOffsets(shapes, shapes.length * 2);
  return tag(10, [...u16(id), ...offsets.flatMap(u16), ...shapes.flat()]);
};

// DefineFont2 / DefineFont3（文字コード表とレイアウト情報つき）。DefineFont3 は座標が 20 倍。
function DefineFont2({ id, version = 2, name }) {
  const k = version === 3 ? 20 : 1;
  const shapes = glyphShapes(k);
  const { offsets, end } = glyphOffsets(shapes, (shapes.length + 1) * 2);
  const nameBytes = [...new TextEncoder().encode(name)];
  return tag(version === 3 ? 75 : 48, [
    ...u16(id), 0x80 | 0x04, 1, nameBytes.length, ...nameBytes, // HasLayout, WideCodes / 言語コード / 名前
    ...u16(shapes.length), ...offsets.flatMap(u16), ...u16(end), ...shapes.flat(),
    ...CHARS.flatMap((ch) => u16(ch.charCodeAt(0))),
    ...u16(800 * k), ...u16(200 * k), ...u16(0), // ascent, descent, leading
    ...CHARS.flatMap(() => u16(ADVANCE * k)),
    ...CHARS.flatMap(() => rect(0, 0, 0, 0)),
    ...u16(0), // カーニングなし
  ]);
}

// 文字列を、高さ height のときのグリフ番号と送り幅の列にする。
const glyphRun = (str, height) => [...str].map((ch) => [CHARS.indexOf(ch), Math.round((ADVANCE * height) / 1024)]);

// DefineText / DefineText2。records: [{ fontId, height, color, x, y, glyphs: [[番号, 送り幅], ...] }]
function DefineText({ id, version = 1, bounds, matrix: m, records }) {
  const all = records.flatMap((rec) => rec.glyphs);
  const glyphBits = Math.max(1, 32 - Math.clz32(Math.max(...all.map((g) => g[0]))));
  const advanceBits = sbits(...all.map((g) => g[1]));
  return tag(version === 2 ? 33 : 11, [
    ...u16(id), ...rect(...bounds), ...matrix(m), glyphBits, advanceBits,
    ...records.flatMap((rec) => {
      const bits = new Bits();
      for (const [index, advance] of rec.glyphs) bits.ub(glyphBits, index).sb(advanceBits, advance);
      return [
        0x80 | (rec.fontId !== undefined ? 0x08 : 0) | (rec.color ? 0x04 : 0) | (rec.y !== undefined ? 0x02 : 0) | (rec.x !== undefined ? 0x01 : 0),
        ...(rec.fontId !== undefined ? u16(rec.fontId) : []),
        ...(rec.color ?? []),
        ...(rec.x !== undefined ? u16(rec.x & 0xffff) : []),
        ...(rec.y !== undefined ? u16(rec.y & 0xffff) : []),
        ...(rec.fontId !== undefined ? u16(rec.height) : []),
        rec.glyphs.length, ...bits.bytes(),
      ];
    }),
    0,
  ]);
}

// DefineEditText（読み取り専用・選択不可）。align: 0 左 / 1 右 / 2 中央。
function DefineEditText({ id, bounds, fontId, height, color, text, multiline, wordWrap, border, useOutlines, html, align = 0, leading = 0, variable = '' }) {
  return tag(37, [
    ...u16(id), ...rect(...bounds),
    0x80 | (wordWrap ? 0x40 : 0) | (multiline ? 0x20 : 0) | 0x08 | 0x04 | (fontId !== undefined ? 0x01 : 0),
    0x20 | 0x10 | (border ? 0x08 : 0) | (html ? 0x02 : 0) | (useOutlines ? 0x01 : 0),
    ...(fontId !== undefined ? [...u16(fontId), ...u16(height)] : []),
    ...color,
    align, ...u16(0), ...u16(0), ...u16(0), ...u16(leading & 0xffff), // 左右の余白、字下げ、行間
    ...cstr(variable), // 連動する変数の名前（無ければ空）
    ...cstr(text),
  ]);
}

// --- ビットマップ ---
// type: 0x40 繰り返し / 0x41 繰り返さない（どちらも補間あり）、0x42 / 0x43 は同じく補間なし。
export const bitmapFill = (type, id, m) => [type, ...u16(id), ...matrix(m)];

/**
 * DefineBitsLossless / 2。pixel(x, y) の返すもの:
 *   format 3: カラーテーブルの番号（table は [r, g, b] か、alpha なら [r, g, b, a] の列）
 *   format 4: [r, g, b]（各 5 ビット）
 *   format 5: [r, g, b]、alpha なら [r, g, b, a]
 * アルファつきの色は乗算前の値で渡す（ファイルには乗算済みで書く）。
 */
export function DefineBitsLossless({ id, format, width, height, alpha = false, table = [], pixel }) {
  const premultiplied = ([r, g, b, a]) => [Math.round((r * a) / 255), Math.round((g * a) / 255), Math.round((b * a) / 255), a];
  const data = table.flatMap((c) => (alpha ? premultiplied(c) : c));
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      if (format === 3) {
        row.push(p);
      } else if (format === 4) {
        const v = (p[0] << 10) | (p[1] << 5) | p[2];
        row.push(v >> 8, v & 0xff);
      } else if (alpha) {
        const [r, g, b, a] = premultiplied(p);
        row.push(a, r, g, b);
      } else {
        // 予約バイトは仕様では 0 だが、実機はこれをアルファとして持つので、0 だとアルファを含む
        // 色変換をかけたときに消える。実際のファイルと同じく 0xFF を入れる。
        row.push(0xff, ...p);
      }
    }
    while (row.length % 4) row.push(0); // 行は 32 ビット境界まで詰める
    data.push(...row);
  }
  return tag(alpha ? 36 : 20, [
    ...u16(id), format, ...u16(width), ...u16(height),
    ...(format === 3 ? [table.length - 1] : []),
    ...deflateSync(Uint8Array.from(data)),
  ], true);
}

const be32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
// 8 ビット RGBA の PNG。pixel(x, y) は [r, g, b, a]。
function png(width, height, pixel) {
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) raw.push(...pixel(x, y));
  }
  const chunk = (type, data) => {
    const body = [...new TextEncoder().encode(type), ...data];
    return [...be32(data.length), ...body, ...be32(crc32(Uint8Array.from(body)))];
  };
  return [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    ...chunk('IDAT', [...deflateSync(Uint8Array.from(raw))]),
    ...chunk('IEND', []),
  ];
}

// 48x32 のなだらかなグラデーションの JPEG（sips で作成）。
const photo = [...readFileSync(new URL('assets/photo.jpg', import.meta.url))];
// JPEG を、量子化表・ハフマン表だけのストリーム (JPEGTables 用) と残りに分ける。
function splitJPEG(jpeg) {
  const tables = [0xff, 0xd8];
  const image = [0xff, 0xd8];
  let pos = 2;
  while (jpeg[pos + 1] !== 0xda) {
    const end = pos + 2 + ((jpeg[pos + 2] << 8) | jpeg[pos + 3]);
    (jpeg[pos + 1] === 0xdb || jpeg[pos + 1] === 0xc4 ? tables : image).push(...jpeg.slice(pos, end));
    pos = end;
  }
  return { tables: [...tables, 0xff, 0xd9], image: [...image, ...jpeg.slice(pos)] };
}

// 原点から右下へ size twips の正方形（時計回り。右側が内側なので fill1）。
export const square = (id, size, color) => DefineShape({
  id, bounds: [0, size, 0, size], fills: [solid(...color)],
  records: [['style', { moveTo: [0, 0], fill1: 1 }], ['line', size, 0], ['line', 0, size], ['line', -size, 0], ['line', 0, -size]],
});

// LZMA のリテラルと一致の両方を通すための、乱数と繰り返しが混ざった 4096 バイト。
let seed = 1;
const blob = Array.from({ length: 4096 }, (_, i) => {
  if (i % 512 >= 128) return 'Flapp LZMA '.charCodeAt(i % 11);
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 16) & 0xff;
});

export const rectRecords = (x, y, w, h, style) => [
  ['style', { moveTo: [x, y], ...style }], ['line', w, 0], ['line', 0, h], ['line', -w, 0], ['line', 0, -h],
];
const GRAD = 1400 / 32768; // グラデーションの定義域 (±16384) を 1400 twips 四方に縮める倍率
const COS45 = Math.SQRT1_2;
const COS30 = Math.sqrt(3) / 2;

export const fixtures = {
  // 背景色 + AVM1 の trace 1 回。実機の起動・trace 取得・画面取得の確認用。
  'trace-hello': swf({
    version: 8,
    tags: [SetBackgroundColor(0x33, 0x66, 0x99), traceTag('hello Flapp'), ShowFrame(), End()],
  }),
  // zlib 圧縮 (CWS)。
  'cws-hello': swf({
    version: 8, zlib: true,
    tags: [SetBackgroundColor(0x33, 0x99, 0x66), traceTag('hello CWS'), ShowFrame(), End()],
  }),
  // DefineSprite の入れ子。スプライト内のアクションが動くことで、タグ列の解釈を実機で裏付ける。
  'sprite-hello': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0x99, 0x66, 0x33),
      DefineSprite(1, 1, [traceTag('hello sprite'), ShowFrame(), End()]),
      PlaceObject2({ depth: 1, id: 1 }),
      ShowFrame(),
      End(),
    ],
  }),
  // zws-hello.swf の元になる無圧縮版。長いタグヘッダ (DefineBinaryData) を含む。
  'lzma-src': swf({
    version: 13,
    tags: [
      SetBackgroundColor(0x66, 0x33, 0x99),
      tag(87, [...u16(1), ...u32(0), ...blob]), // DefineBinaryData id=1
      traceTag('hello ZWS'),
      ShowFrame(),
      End(),
    ],
  }),
  // 辺を共有する 2 つの塗り (fill0 / fill1)、半透明、曲線、線。変形と色変換つきでもう 1 つ置く。
  'shape-fills': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineShape({
        id: 1, version: 3, bounds: [-30, 3530, -30, 1030],
        fills: [solid(255, 0, 0, 255), solid(0, 0, 255, 128), solid(0, 160, 0, 255)],
        lines: [lineStyle(60, 0, 0, 0, 255)],
        records: [
          // 左の正方形。右辺は右の正方形との共有辺で、進行方向の左側が塗り 2。
          ['style', { moveTo: [0, 0], fill1: 1 }], ['line', 1000, 0],
          ['style', { fill0: 2 }], ['line', 0, 1000],
          ['style', { fill0: 0 }], ['line', -1000, 0], ['line', 0, -1000],
          // 右の正方形の残り 3 辺。
          ['style', { moveTo: [1000, 0], fill1: 2 }], ['line', 1000, 0], ['line', 0, 1000], ['line', -1000, 0],
          // 2 次ベジェ 4 本の丸、線つき。
          ['style', { moveTo: [3500, 500], fill1: 3, line: 1 }],
          ['curve', 0, 500, -500, 0], ['curve', -500, 0, 0, -500], ['curve', 0, -500, 500, 0], ['curve', 500, 0, 0, 500],
        ],
      }),
      PlaceObject2({ depth: 1, id: 1, matrix: { tx: 400, ty: 300 } }),
      PlaceObject2({
        depth: 2, id: 1, matrix: { a: 0.5, b: 0.25, c: -0.25, d: 0.5, tx: 1200, ty: 1700 },
        cxform: { mult: [128, 256, 256, 192], add: [0, 0, 64, 0] },
      }),
      ShowFrame(),
      End(),
    ],
  }),
  // 可逆ビットマップの各形式（13x9 画素を補間なしで 4 倍に拡大）。上段左から
  // 24 ビット、カラーテーブル、15 ビット。下段はアルファつき 32 ビット、アルファつきカラーテーブル、
  // カラーテーブルの繰り返し塗り。右下は補間ありの塗りを回転・色変換して置いたもの。
  'bitmap-lossless': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineBitsLossless({ id: 1, format: 5, width: 13, height: 9, pixel: (x, y) => [x * 20, y * 28, (x ^ y) & 1 ? 255 : 0] }),
      DefineBitsLossless({
        id: 2, format: 3, width: 13, height: 9, table: [[255, 255, 255], [220, 0, 0], [0, 140, 0], [0, 0, 200]],
        pixel: (x, y) => (x + y * 2) % 4,
      }),
      DefineBitsLossless({ id: 3, format: 4, width: 13, height: 9, pixel: (x, y) => [x * 2, 31 - y * 3, (x + y) % 32] }),
      DefineBitsLossless({ id: 4, format: 5, alpha: true, width: 13, height: 9, pixel: (x, y) => [255, y * 28, 0, x * 21] }),
      DefineBitsLossless({
        id: 5, format: 3, alpha: true, width: 13, height: 9,
        table: [[0, 0, 0, 0], [0, 0, 255, 255], [0, 0, 255, 128], [255, 255, 0, 64]],
        pixel: (x, y) => (x + y) % 4,
      }),
      square(6, 4400, [0, 160, 160]), // アルファを見るための下地
      DefineShape({
        id: 7, version: 3, bounds: [0, 4000, 0, 1600],
        fills: [
          bitmapFill(0x43, 1, { a: 80, d: 80 }),
          bitmapFill(0x43, 2, { a: 80, d: 80, tx: 1200 }),
          bitmapFill(0x43, 3, { a: 80, d: 80, tx: 2400 }),
          bitmapFill(0x43, 4, { a: 80, d: 80, ty: 880 }),
          bitmapFill(0x43, 5, { a: 80, d: 80, tx: 1200, ty: 880 }),
          bitmapFill(0x42, 2, { a: 20, d: 20, tx: 2400, ty: 880 }),
        ],
        records: [
          ...rectRecords(0, 0, 1040, 720, { fill1: 1 }),
          ...rectRecords(1200, 0, 1040, 720, { fill1: 2 }),
          ...rectRecords(2400, 0, 1040, 720, { fill1: 3 }),
          ...rectRecords(0, 880, 1040, 720, { fill1: 4 }),
          ...rectRecords(1200, 880, 1040, 720, { fill1: 5 }),
          ...rectRecords(2400, 880, 1040, 720, { fill1: 6 }),
        ],
      }),
      DefineShape({
        id: 8, version: 3, bounds: [0, 1040, 0, 720],
        fills: [bitmapFill(0x41, 1, { a: 80, d: 80 })],
        records: rectRecords(0, 0, 1040, 720, { fill1: 1 }),
      }),
      PlaceObject2({ depth: 1, id: 6, matrix: { tx: 200, ty: 1000 } }),
      PlaceObject2({ depth: 2, id: 7, matrix: { tx: 300, ty: 200 } }),
      PlaceObject2({
        depth: 3, id: 8, matrix: { a: COS30, b: 0.5, c: -0.5, d: COS30, tx: 3900, ty: 1900 },
        cxform: { mult: [256, 128, 256, 192], add: [0, 64, 0, 0] },
      }),
      ShowFrame(),
      End(),
    ],
  }),
  // JPEG 系のビットマップ（48x32 を等倍で）。左上から JPEG2（古い SWF にある余分なヘッダつき）、
  // JPEGTables + DefineBits、JPEG3（アルファつき）、JPEG2 に入れた PNG。
  'bitmap-jpeg': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      tag(8, splitJPEG(photo).tables), // JPEGTables
      tag(21, [...u16(1), 0xff, 0xd9, 0xff, 0xd8, ...photo], true),
      tag(6, [...u16(2), ...splitJPEG(photo).image], true),
      tag(35, [
        ...u16(3), ...u32(photo.length), ...photo,
        ...deflateSync(Uint8Array.from({ length: 48 * 32 }, (_, i) => Math.round(((i % 48) * 255) / 47))),
      ], true),
      tag(21, [...u16(4), ...png(48, 32, (x, y) => [x * 5, 255 - y * 8, (x >> 2) & 1 ? 255 : 0, y < 16 ? 255 : 128])], true),
      square(5, 4400, [0, 160, 160]),
      DefineShape({
        id: 6, version: 3, bounds: [0, 4160, 0, 640],
        fills: [1, 2, 3, 4].map((id, i) => bitmapFill(0x41, id, { a: 20, d: 20, tx: i * 1080 })),
        records: [1, 2, 3, 4].flatMap((n, i) => rectRecords(i * 1080, 0, 960, 640, { fill1: n })),
      }),
      PlaceObject2({ depth: 1, id: 5, matrix: { tx: 200, ty: 400 } }),
      PlaceObject2({ depth: 2, id: 6, matrix: { tx: 300, ty: 200 } }),
      PlaceObject2({ depth: 3, id: 6, matrix: { a: 2, d: 2, tx: -600, ty: 1400 } }),
      ShowFrame(),
      End(),
    ],
  }),
  // フォントとテキスト。左上: DefineFont2 を使う 2 行の静的テキスト。右上: DefineFont3 と半透明の色、
  // 行列（横に拡大して傾ける）つきの DefineText2。左下: DefineFont（v1）。右下: 枠つき・中央寄せ・
  // 2 行のテキストフィールド（埋め込みフォント）。
  text: swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineFont2({ id: 1, name: 'Flapp Test' }),
      DefineFont2({ id: 2, version: 3, name: 'Flapp Test 3' }),
      DefineFont(3),
      DefineText({
        id: 10, bounds: [0, 1800, 0, 1800],
        records: [
          { fontId: 1, height: 800, color: [200, 0, 0], x: 0, y: 800, glyphs: glyphRun('LOL', 800) },
          { color: [0, 0, 200], x: 100, y: 1700, glyphs: glyphRun('IO', 800) },
        ],
      }),
      DefineText({
        id: 11, version: 2, bounds: [0, 1800, 0, 500], matrix: { a: 1.5, c: -0.3 },
        records: [{ fontId: 2, height: 400, color: [0, 120, 0, 128], x: 0, y: 400, glyphs: glyphRun('LOLI', 400) }],
      }),
      DefineText({
        id: 12, bounds: [0, 1300, 0, 600],
        records: [{ fontId: 3, height: 600, color: [0, 0, 0], x: 0, y: 600, glyphs: glyphRun('IOI', 600) }],
      }),
      DefineEditText({
        id: 13, bounds: [0, 2200, 0, 1300], fontId: 1, height: 500, color: [0, 0, 160, 255],
        text: 'LOL\rIO', multiline: true, border: true, useOutlines: true, align: 2, leading: 40,
      }),
      PlaceObject2({ depth: 1, id: 10, matrix: { tx: 200, ty: 100 } }),
      PlaceObject2({ depth: 2, id: 11, matrix: { tx: 2700, ty: 300 } }),
      PlaceObject2({ depth: 3, id: 12, matrix: { tx: 200, ty: 2200 } }),
      PlaceObject2({ depth: 4, id: 13, matrix: { tx: 2400, ty: 1700 } }),
      ShowFrame(),
      End(),
    ],
  }),
  // フィルタ。上段左から: ぼかし 4x4、ぼかし 8x2 を 3 回、影（45 度・距離 4・半透明の黒）、赤い光彩（強さ 2、2 回）。
  // 下段左から: 青い内側の光彩、ノックアウトの影、色行列（赤緑青の入れ替えとアルファ半分）、ぼかしと影の重ねがけ。
  filter: swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      square(1, 600, [255, 160, 0]),
      ...[
        [blurFilter(4, 4, 1)],
        [blurFilter(8, 2, 3)],
        [dropShadowFilter({ color: [0, 0, 0, 128], blur: 4, angle: Math.PI / 4, distance: 4 })],
        [glowFilter({ color: [255, 0, 0, 255], blur: 6, strength: 2, passes: 2 })],
        [glowFilter({ color: [0, 0, 255, 255], blur: 6, flags: 0x80 | 0x20 })],
        [dropShadowFilter({ color: [0, 0, 0, 255], blur: 2, angle: 0, distance: 6, flags: 0x40 | 0x20 })],
        [colorMatrixFilter([0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0.5, 0])],
        [blurFilter(3, 3, 1), dropShadowFilter({ color: [0, 0, 160, 255], blur: 4, angle: Math.PI / 2, distance: 5 })],
      ].map((filters, i) => PlaceObject3({
        depth: 1 + i, id: 1, filters, matrix: { tx: 400 + (i % 4) * 1100, ty: 400 + Math.floor(i / 4) * 1400 },
      })),
      ShowFrame(),
      End(),
    ],
  }),
  // ベベル（内側・外側・上に重ねる・ノックアウト）、グラデーション光彩（外側・内側）、グラデーションベベル、畳み込み。
  'filter-bevel': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      square(1, 800, [255, 160, 0]),
      DefineShape({ id: 2, version: 3, bounds: [0, 800, 0, 800], fills: [solid(255, 160, 0, 255), solid(0, 0, 200, 255)],
        records: [...rectRecords(0, 0, 800, 800, { fill1: 1 }), ...rectRecords(200, 200, 400, 400, { fill1: 2 })] }),
      ...[
        [1, bevelFilter({ shadow: [0, 0, 0, 255], highlight: [255, 255, 255, 255], blur: 4, angle: Math.PI / 4, distance: 4 })],
        [1, bevelFilter({ shadow: [0, 0, 0, 255], highlight: [255, 255, 255, 255], blur: 4, angle: Math.PI / 4, distance: 4, flags: 0x20 })],
        [1, bevelFilter({ shadow: [0, 0, 160, 255], highlight: [255, 255, 0, 255], blur: 4, angle: Math.PI / 4, distance: 4, flags: 0x30 })],
        [1, bevelFilter({ shadow: [0, 0, 255, 255], highlight: [255, 0, 0, 128], blur: 2, angle: -Math.PI / 3, distance: 6, strength: 2, flags: 0xe0 })],
        [1, gradientFilter({ type: 4, stops: [[0, 255, 255, 255, 0], [128, 255, 255, 0, 255], [255, 255, 0, 0, 255]], blur: 8, flags: 0x20 })],
        [1, gradientFilter({ type: 4, stops: [[0, 0, 0, 255, 0], [255, 0, 0, 255, 255]], blur: 6, angle: Math.PI / 4, distance: 4, strength: 2 })],
        [1, gradientFilter({ type: 7, stops: [[0, 0, 0, 200, 255], [128, 255, 0, 0, 0], [255, 255, 255, 255, 255]], blur: 4, angle: Math.PI / 4, distance: 4 })],
        [2, convolutionFilter({ x: 3, y: 3, matrix: [-2, -1, 0, -1, 1, 1, 0, 1, 2], color: [0, 160, 0, 255], bias: 20 })],
      ].map(([id, filter], i) => PlaceObject3({
        depth: 1 + i, id, filters: [filter], matrix: { tx: 300 + (i % 4) * 1150, ty: 400 + Math.floor(i / 4) * 1400 },
      })),
      ShowFrame(),
      End(),
    ],
  }),
  // DefineButtonCxform（DefineButton の中身に色変換をかける）と、PlaceObject3 の不透明な背景色（三角形・回転・アルファ付きの色・スプライト）。
  'button-cxform': swf({
    version: 11,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      square(1, 800, [255, 0, 0]),
      square(2, 800, [0, 0, 255]),
      DefineButton(3, [{ states: 1 | 8, id: 1, depth: 1 }, { states: 1, id: 2, depth: 2, matrix: { a: 0.5, d: 0.5, tx: 200, ty: 200 } }]),
      tag(23, [...u16(3), ...cxform({ mult: [128, 256, 256], add: [0, 128, 0] })]),
      DefineShape({ id: 4, version: 3, bounds: [0, 800, 0, 800], fills: [solid(200, 0, 160, 255)],
        records: [['style', { moveTo: [0, 800], fill1: 1 }], ['line', 800, 0], ['line', -400, -800], ['line', -400, 800]] }),
      DefineSprite(5, 1, [PlaceObject2({ depth: 1, id: 4, matrix: { tx: 100, ty: 100 } }), ShowFrame(), End()]),
      PlaceObject2({ depth: 1, id: 3, matrix: { tx: 400, ty: 400 } }),
      PlaceObject3({ depth: 2, id: 4, matrix: { tx: 1800, ty: 400 }, background: [0, 200, 200, 255] }),
      PlaceObject3({ depth: 3, id: 4, matrix: { a: COS30, b: 0.5, c: -0.5, d: COS30, tx: 3600, ty: 400 }, background: [0, 200, 200, 128] }),
      PlaceObject3({ depth: 4, id: 5, matrix: { a: 1.5, d: 1.5, tx: 400, ty: 1700 }, background: [255, 255, 0, 255] }),
      PlaceObject3({ depth: 5, id: 4, matrix: { tx: 2150, ty: 1950 }, cxform: { mult: [256, 256, 256, 128] }, background: [0, 0, 0, 255] }),
      ShowFrame(),
      End(),
    ],
  }),
  // ボタンは通常状態だけが表示される。左: DefineButton2（通常 = 赤と、色変換をかけた小さい青。
  // 乗った状態 = 青、押下 = 緑は表示されない）。右: DefineButton（通常 = 青）をスプライトの中に置く。
  button: swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      square(1, 1000, [255, 0, 0]),
      square(2, 1000, [0, 0, 255]),
      square(3, 1000, [0, 160, 0]),
      DefineButton2(4, [
        { states: 1 | 8, id: 1, depth: 1 },
        { states: 1, id: 2, depth: 2, matrix: { a: 0.4, d: 0.4, tx: 300, ty: 300 }, cxform: { mult: [256, 256, 256, 128], add: [128, 0, 0, 0] } },
        { states: 2, id: 2, depth: 1 },
        { states: 4, id: 3, depth: 1, matrix: { tx: 100, ty: 100 } },
      ]),
      DefineButton(5, [{ states: 1 | 2 | 4 | 8, id: 2, depth: 1, matrix: { a: 0.5, d: 0.5 } }]),
      DefineSprite(6, 1, [PlaceObject2({ depth: 1, id: 5, matrix: { tx: 200, ty: 200 } }), ShowFrame(), End()]),
      PlaceObject2({ depth: 1, id: 4, matrix: { tx: 400, ty: 400 } }),
      PlaceObject2({ depth: 2, id: 6, matrix: { a: COS30, b: 0.5, c: -0.5, d: COS30, tx: 2800, ty: 400 } }),
      ShowFrame(),
      End(),
    ],
  }),
  // 注意: 塗りを fill1 側だけに指定したモーフ図形は、実機（デバッガ版 35.0.0.60）が描画時に
  // 不定期にクラッシュする（存在しない塗りを参照する）。原因は未特定。ここでは fill0 側に指定している。
  // モーフ図形を比率 0, 1/4, 1/2, 3/4, 1 で並べる。上段: 赤い正方形から青いひし形（2 辺は曲線）へ。
  // 塗りの色、線の幅と色も変わる。下段: 線形グラデーションの色・位置・行列と、矩形の幅が変わる。
  morph: swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineMorphShape({
        id: 1, startBounds: [-10, 810, -10, 810], endBounds: [-160, 960, -160, 960],
        fills: [[0x00, 255, 0, 0, 255, 0, 0, 255, 255]],
        lines: [[...u16(20), ...u16(120), 0, 0, 0, 255, 0, 160, 0, 255]],
        startRecords: rectRecords(0, 0, 800, 800, { fill0: 1, line: 1 }),
        endRecords: [
          ['style', { moveTo: [400, -100] }],
          ['curve', 400, 0, 100, 500], ['line', -500, 500], ['curve', -400, 0, -100, -500], ['line', 500, -500],
        ],
      }),
      DefineMorphShape({
        id: 2, startBounds: [0, 400, 0, 800], endBounds: [0, 800, 0, 800],
        fills: [[
          0x10, ...matrix({ a: 400 / 32768, d: 400 / 32768, tx: 200, ty: 400 }), ...matrix({ a: 800 / 32768, d: 800 / 32768, tx: 400, ty: 400 }),
          2, 0, 255, 0, 0, 255, 64, 0, 0, 255, 255, 255, 255, 255, 0, 255, 255, 0, 255, 0, 255,
        ]],
        startRecords: rectRecords(0, 0, 400, 800, { fill0: 1 }),
        endRecords: [['style', { moveTo: [0, 0] }], ['line', 800, 0], ['line', 0, 800], ['line', -800, 0], ['line', 0, -800]],
      }),
      ...[0, 16384, 32768, 49152, 65535].flatMap((ratio, i) => [
        PlaceObject2({ depth: 1 + i, id: 1, ratio, matrix: { a: 0.7, d: 0.7, tx: 250 + i * 900, ty: 300 } }),
        PlaceObject2({ depth: 11 + i, id: 2, ratio, matrix: { tx: 200 + i * 900, ty: 1700 } }),
      ]),
      ShowFrame(),
      End(),
    ],
  }),
  // クリップ層（マスク）。左上: 半透明の塗りと太い線を持つ丸で、深度 3〜4 を切り抜く（深度 5 は対象外）。
  // 右上: スプライト（正方形 2 つ）をマスクにする。下: マスクの範囲の中にもう 1 つマスクがある入れ子。
  // 9 スライスの拡大（DefineScalingGrid）。枠（太い線つきの長方形）の四隅に赤い正方形、中央に青い正方形を置いたスプライトを、
  // 縦横の拡大率を変えて置く。四隅は拡大されず、辺は一方向だけ、中央は両方向に引き伸ばされる。
  // 右上は、入れ子のスプライト（緑の正方形）を持つもの。右下は、回転したもの。
  'scale9': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineShape({
        id: 1, version: 3, bounds: [-40, 1240, -40, 840],
        fills: [solid(255, 220, 120, 255), solid(220, 0, 0, 255), solid(0, 0, 220, 255)],
        lines: [lineStyle(80, 0, 0, 0, 255)],
        records: [
          ...rectRecords(0, 0, 1200, 800, { fill0: 1, line: 1 }),
          ...rectRecords(80, 80, 200, 200, { fill0: 2, line: 0 }), ...rectRecords(920, 80, 200, 200, { fill0: 2 }),
          ...rectRecords(80, 520, 200, 200, { fill0: 2 }), ...rectRecords(920, 520, 200, 200, { fill0: 2 }),
          ...rectRecords(500, 300, 200, 200, { fill0: 3 }),
        ],
      }),
      square(3, 200, [0, 160, 0]),
      DefineSprite(4, 1, [PlaceObject2({ depth: 1, id: 3 }), ShowFrame(), End()]),
      DefineSprite(2, 1, [PlaceObject2({ depth: 1, id: 1 }), ShowFrame(), End()]),
      DefineSprite(5, 1, [PlaceObject2({ depth: 1, id: 1 }), PlaceObject2({ depth: 2, id: 4, matrix: { tx: 500, ty: 300 } }), ShowFrame(), End()]),
      tag(78, [...u16(2), ...rect(300, 900, 300, 500)]), // DefineScalingGrid: 枠の内側（中央の 600×200 twips）
      tag(78, [...u16(5), ...rect(300, 900, 300, 500)]),
      PlaceObject2({ depth: 1, id: 2, matrix: { a: 3, d: 1, tx: 200, ty: 200 } }), // 横に 3 倍
      PlaceObject2({ depth: 2, id: 2, matrix: { a: 1, d: 3, tx: 200, ty: 1200 } }), // 縦に 3 倍
      PlaceObject2({ depth: 3, id: 2, matrix: { a: 0.5, d: 0.25, tx: 1700, ty: 2700 } }), // 縮小（四隅の大きさの合計より小さくなる）
      PlaceObject2({ depth: 4, id: 5, matrix: { a: 2, d: 1.5, tx: 2000, ty: 200 } }), // 入れ子のスプライトを持つもの
      PlaceObject2({ depth: 5, id: 2, matrix: { a: 2 * COS45, b: 2 * COS45, c: -COS45, d: COS45, tx: 3600, ty: 1600 } }), // 回転
      ShowFrame(), End(),
    ],
  }),
  mask: swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      square(1, 1200, [255, 0, 0]),
      square(2, 800, [0, 0, 255]),
      square(3, 300, [0, 160, 0]),
      DefineShape({
        id: 4, version: 3, bounds: [-700, 700, -700, 700],
        fills: [solid(0, 0, 0, 64)], lines: [lineStyle(200, 255, 0, 255, 255)],
        records: [
          ['style', { moveTo: [600, 0], fill1: 1, line: 1 }],
          ['curve', 0, 600, -600, 0], ['curve', -600, 0, 0, -600], ['curve', 0, -600, 600, 0], ['curve', 600, 0, 0, 600],
        ],
      }),
      square(5, 400, [0, 0, 0]),
      DefineSprite(6, 1, [
        PlaceObject2({ depth: 1, id: 5 }), PlaceObject2({ depth: 2, id: 5, matrix: { tx: 500, ty: 500 } }), ShowFrame(), End(),
      ]),
      square(7, 1400, [0, 0, 255]),
      square(8, 1000, [0, 0, 0]),
      square(9, 1600, [0, 0, 255]),
      // 丸のマスク
      PlaceObject2({ depth: 2, id: 4, matrix: { tx: 900, ty: 900 }, clipDepth: 4 }),
      PlaceObject2({ depth: 3, id: 1, matrix: { tx: 300, ty: 300 } }),
      PlaceObject2({ depth: 4, id: 2, matrix: { tx: 900, ty: 900 } }),
      PlaceObject2({ depth: 5, id: 3, matrix: { tx: 1500, ty: 300 } }),
      // スプライトのマスク
      PlaceObject2({ depth: 10, id: 6, matrix: { tx: 2600, ty: 400 }, clipDepth: 11 }),
      PlaceObject2({ depth: 11, id: 7, matrix: { tx: 2400, ty: 200 } }),
      // 入れ子
      PlaceObject2({ depth: 20, id: 8, matrix: { tx: 600, ty: 1900 }, clipDepth: 30 }),
      PlaceObject2({ depth: 21, id: 1, matrix: { tx: 400, ty: 1700 } }),
      PlaceObject2({ depth: 22, id: 8, matrix: { tx: 1100, ty: 2100 }, clipDepth: 23 }),
      PlaceObject2({ depth: 23, id: 9, matrix: { tx: 300, ty: 1600 } }),
      PlaceObject2({ depth: 24, id: 3, matrix: { tx: 700, ty: 2000 } }),
      ShowFrame(),
      End(),
    ],
  }),
  // ブレンドモード。赤・緑・青の横縞の上に、橙の四角を各モードで重ねる（上段は不透明、下段は半透明）。
  // 左から multiply, screen, lighten, darken, difference, add, subtract, invert, overlay, hardlight。
  // 右下は layer の中での alpha と erase。
  blend: swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineShape({
        id: 1, bounds: [0, 4400, 0, 600], fills: [solid(200, 40, 40), solid(40, 200, 40), solid(40, 40, 200)],
        records: [0, 1, 2].flatMap((i) => rectRecords(0, i * 200, 4400, 200, { fill1: i + 1 })),
      }),
      DefineShape({
        id: 2, version: 3, bounds: [0, 340, 0, 500], fills: [solid(255, 160, 64, 255)],
        records: rectRecords(0, 0, 340, 500, { fill1: 1 }),
      }),
      square(3, 700, [0, 0, 255]),
      DefineShape({
        id: 4, version: 3, bounds: [0, 400, 0, 400], fills: [solid(255, 255, 255, 128)],
        records: rectRecords(0, 0, 400, 400, { fill1: 1 }),
      }),
      DefineSprite(5, 1, [PlaceObject2({ depth: 1, id: 3 }), PlaceObject3({ depth: 2, id: 4, matrix: { tx: 150, ty: 150 }, blendMode: 11 }), ShowFrame(), End()]),
      DefineSprite(6, 1, [PlaceObject2({ depth: 1, id: 3 }), PlaceObject3({ depth: 2, id: 4, matrix: { tx: 150, ty: 150 }, blendMode: 12 }), ShowFrame(), End()]),
      PlaceObject2({ depth: 1, id: 1, matrix: { tx: 200, ty: 200 } }),
      PlaceObject2({ depth: 2, id: 1, matrix: { tx: 200, ty: 1000 } }),
      ...[3, 4, 5, 6, 7, 8, 9, 10, 13, 14].flatMap((mode, i) => [
        PlaceObject3({ depth: 10 + i, id: 2, matrix: { tx: 250 + i * 440, ty: 250 }, blendMode: mode }),
        PlaceObject3({
          depth: 30 + i, id: 2, matrix: { tx: 250 + i * 440, ty: 1050 }, blendMode: mode,
          cxform: { mult: [256, 256, 256, 128] },
        }),
      ]),
      PlaceObject2({ depth: 50, id: 1, matrix: { a: 0.5, tx: 200, ty: 2100 } }),
      PlaceObject3({ depth: 51, id: 5, matrix: { tx: 300, ty: 1900 }, blendMode: 2 }),
      PlaceObject3({ depth: 52, id: 6, matrix: { tx: 1300, ty: 1900 }, blendMode: 2 }),
      ShowFrame(),
      End(),
    ],
  }),
  // スタイル表の差し替え (NewStyles)。後の層（緑）が前の層（赤）の上に重なる。
  'shape-layers': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineShape({
        id: 1, version: 2, bounds: [0, 1200, 0, 1200],
        fills: [solid(255, 0, 0), solid(0, 0, 255)],
        records: [
          ...rectRecords(0, 0, 1200, 1200, { fill1: 1 }),
          // 差し替え前のビット幅 (2) で書いた番号 1 は、新しい表の 1 番（緑）を指す。
          ['style', { moveTo: [300, 300], fill1: 1, newStyles: { fills: [solid(0, 160, 0)] } }],
          ['line', 600, 0], ['line', 0, 600], ['line', -600, 0], ['line', 0, -600],
        ],
      }),
      PlaceObject2({ depth: 1, id: 1, matrix: { tx: 400, ty: 400 } }),
      ShowFrame(),
      End(),
    ],
  }),
  // 線形（45 度回転）・放射・焦点つき放射のグラデーションと、LINESTYLE2 の角。縮小してもう 1 つ置く。
  'shape-gradient': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineShape({
        id: 1, version: 4, bounds: [-40, 4440, -40, 1440],
        fills: [
          gradient({
            type: 0x10, matrix: { a: GRAD * COS45, b: GRAD * COS45, c: -GRAD * COS45, d: GRAD * COS45, tx: 700, ty: 700 },
            stops: [[0, 255, 0, 0, 255], [128, 255, 255, 0, 255], [255, 0, 0, 255, 255]],
          }),
          gradient({
            type: 0x12, matrix: { a: GRAD, d: GRAD, tx: 2200, ty: 700 },
            stops: [[0, 255, 255, 255, 255], [255, 0, 0, 0, 255]],
          }),
          gradient({
            type: 0x13, matrix: { a: GRAD, d: GRAD, tx: 3700, ty: 700 }, focal: 0.5,
            stops: [[0, 255, 255, 0, 255], [128, 255, 0, 0, 255], [255, 0, 0, 128, 255]],
          }),
        ],
        lines: [
          lineStyle2({ width: 40, join: 1, color: [0, 0, 0, 128] }),
          lineStyle2({ width: 80, join: 2, color: [0, 0, 0, 255] }),
        ],
        records: [
          ...rectRecords(0, 0, 1400, 1400, { fill1: 1, line: 0 }),
          ...rectRecords(1500, 0, 1400, 1400, { fill1: 2, line: 1 }),
          ...rectRecords(3000, 0, 1400, 1400, { fill1: 3, line: 2 }),
        ],
      }),
      PlaceObject2({ depth: 1, id: 1, matrix: { tx: 200, ty: 200 } }),
      PlaceObject2({ depth: 2, id: 1, matrix: { a: 0.5, d: 0.5, tx: 400, ty: 2000 } }),
      ShowFrame(),
      End(),
    ],
  }),
  // グラデーションの範囲の外（端の色・折り返し・繰り返し）と、線形の色空間での補間。
  'gradient-spread': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineShape({
        id: 1, version: 4, bounds: [200, 4600, 200, 3100],
        fills: [
          ...[0, 1, 2].map((spread) => gradient({
            type: 0x10, spread, matrix: { a: (400 / 32768) * COS45, b: (400 / 32768) * COS45, c: (-400 / 32768) * COS45, d: (400 / 32768) * COS45, tx: 900 + 1500 * spread, ty: 900 },
            stops: [[0, 255, 0, 0, 255], [128, 255, 255, 0, 255], [255, 0, 0, 255, 255]],
          })),
          gradient({ type: 0x12, spread: 1, matrix: { a: 600 / 32768, d: 600 / 32768, tx: 900, ty: 2400 }, stops: [[0, 255, 255, 255, 255], [255, 0, 100, 0, 255]] }),
          gradient({ type: 0x13, spread: 2, focal: 0.5, matrix: { a: 600 / 32768, d: 400 / 32768, tx: 2400, ty: 2400 }, stops: [[0, 255, 255, 0, 255], [255, 160, 0, 160, 255]] }),
          gradient({ type: 0x10, linearRGB: true, matrix: { a: 1400 / 32768, d: 1400 / 32768, tx: 3900, ty: 2100 }, stops: [[0, 255, 0, 0, 255], [255, 0, 255, 0, 255]] }),
          gradient({ type: 0x10, matrix: { a: 1400 / 32768, d: 1400 / 32768, tx: 3900, ty: 2700 }, stops: [[0, 255, 0, 0, 255], [255, 0, 255, 0, 255]] }),
        ],
        records: [
          ...rectRecords(200, 200, 1400, 1400, { fill1: 1 }),
          ...rectRecords(1700, 200, 1400, 1400, { fill1: 2 }),
          ...rectRecords(3200, 200, 1400, 1400, { fill1: 3 }),
          ...rectRecords(200, 1700, 1400, 1400, { fill1: 4 }),
          ...rectRecords(1700, 1700, 1400, 1400, { fill1: 5 }),
          ...rectRecords(3200, 1700, 1400, 700, { fill1: 6 }),
          ...rectRecords(3200, 2400, 1400, 700, { fill1: 7 }),
        ],
      }),
      PlaceObject2({ depth: 1, id: 1 }),
      ShowFrame(),
      End(),
    ],
  }),
  // 線の塗り（線形・放射グラデーション、ビットマップ）と、始端と終端で異なるキャップ。
  'line-fill': swf({
    version: 8,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      DefineBitsLossless({ id: 1, format: 5, width: 13, height: 9, pixel: (x, y) => [x * 20, y * 28, (x ^ y) & 1 ? 255 : 0] }),
      DefineShape({
        id: 2, version: 4, bounds: [0, 4800, 0, 3200],
        lines: [
          lineStyle2({ width: 240, endCap: 1, fill: gradient({ type: 0x10, matrix: { a: 2000 / 32768, d: 2000 / 32768, tx: 1300, ty: 400 },
            stops: [[0, 255, 0, 0, 255], [128, 255, 255, 0, 255], [255, 0, 0, 255, 255]] }) }),
          lineStyle2({ width: 160, join: 2, fill: gradient({ type: 0x12, matrix: { a: 1600 / 32768, d: 1600 / 32768, tx: 3600, ty: 600 },
            stops: [[0, 255, 255, 255, 255], [255, 0, 0, 0, 255]] }) }),
          lineStyle2({ width: 240, join: 2, fill: bitmapFill(0x42, 1, { a: 40, d: 40 }) }),
          lineStyle2({ width: 200, startCap: 0, endCap: 2, color: [0, 0, 160, 255] }),
          lineStyle2({ width: 200, startCap: 1, endCap: 0, color: [0, 120, 0, 255] }),
          lineStyle2({ width: 200, startCap: 2, endCap: 1, color: [160, 0, 0, 255] }),
          lineStyle2({ width: 160, startCap: 1, endCap: 2, color: [0, 0, 0, 255] }),
          lineStyle2({ width: 160, startCap: 0, endCap: 1, color: [120, 0, 120, 255] }),
        ],
        records: [
          ['style', { moveTo: [300, 400], line: 1 }], ['line', 2000, 0],
          ['style', { moveTo: [2800, 300], line: 2 }], ['line', 400, 600], ['line', 400, -600], ['line', 400, 600], ['line', 400, -600],
          ['style', { moveTo: [300, 1100], line: 3 }], ['line', 2000, 0], ['line', 0, 500], ['line', -2000, 0], ['line', 0, -500],
          ['style', { moveTo: [3000, 1500], line: 4 }], ['line', 1200, 0],
          ['style', { moveTo: [3000, 1900], line: 5 }], ['line', 1200, 0],
          ['style', { moveTo: [3000, 2300], line: 6 }], ['line', 1200, 0],
          ['style', { moveTo: [400, 2300], line: 7 }], ['curve', 600, 600, 600, -600],
          ['style', { moveTo: [400, 2900], line: 8 }], ['line', 600, 0], ['style', { moveTo: [1400, 2900] }], ['line', 600, 0],
          ['style', { moveTo: [2400, 2800], line: 8 }], ['line', 300, 0], ['line', 0, 300],
          ['style', { moveTo: [3200, 2700], line: 4 }], ['line', 800, 0], ['line', 0, 300], ['line', -800, 0], ['line', 0, -300],
        ],
      }),
      PlaceObject2({ depth: 1, id: 2 }),
      ShowFrame(),
      End(),
    ],
  }),
  // 配置・移動・色変換・削除・置き換え・スプライトの配置を 4 フレームで行い、あとは 120 フレームまで同じ絵。
  timeline: swf({
    version: 8, frames: 120,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      square(1, 800, [255, 0, 0]),
      square(2, 800, [0, 0, 255]),
      DefineSprite(3, 1, [
        PlaceObject2({ depth: 1, id: 2, matrix: { tx: 200, ty: 200 } }),
        PlaceObject2({ depth: 2, id: 1, matrix: { a: 0.5, d: 0.5 } }),
        ShowFrame(), End(),
      ]),
      PlaceObject2({ depth: 1, id: 1, matrix: { tx: 200, ty: 200 } }),
      ShowFrame(),
      PlaceObject2({ depth: 1, move: true, matrix: { tx: 1200, ty: 400 } }),
      PlaceObject2({ depth: 2, id: 2, matrix: { tx: 2400, ty: 200 } }),
      ShowFrame(),
      PlaceObject2({ depth: 1, move: true, cxform: { mult: [256, 256, 256, 256], add: [0, 128, 0, 0] } }),
      RemoveObject2(2),
      PlaceObject2({ depth: 5, id: 3, matrix: { a: COS30, b: 0.5, c: -0.5, d: COS30, tx: 2400, ty: 1400 } }),
      ShowFrame(),
      PlaceObject2({ depth: 1, id: 2, move: true }), // 置き換え。行列と色変換は引き継がれるはず
      PlaceObject2({ depth: 3, id: 1, matrix: { tx: 3600, ty: 2000 } }),
      ShowFrame(),
      ...Array.from({ length: 116 }, ShowFrame),
      End(),
    ],
  }),
  // 既に埋まっている深度への新規配置（移動フラグなし）。仕様に記載が無いので実機の挙動を確かめる。
  'place-occupied': swf({
    version: 8, frames: 120,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      square(1, 800, [255, 0, 0]),
      square(2, 800, [0, 0, 255]),
      PlaceObject2({ depth: 1, id: 1, matrix: { tx: 400, ty: 400 } }),
      ShowFrame(),
      PlaceObject2({ depth: 1, id: 2, matrix: { tx: 2400, ty: 1200 } }),
      ShowFrame(),
      ...Array.from({ length: 118 }, ShowFrame),
      End(),
    ],
  }),
};

// ボタンのイベント。A と B が隣り合い、C（DefineButton）が下にある。どの遷移でどのアクションが走るかを trace で確かめる。
// 実機へ送る入力の手順は test/fixtures/button-events.input.json。
{
  const events = { rollOver: 0x01, rollOut: 0x02, press: 0x04, release: 0x08, dragOut: 0x10, dragOver: 0x20, releaseOutside: 0x40 };
  const says = (text) => [PushString(text), Trace()];
  const records = (hit) => [
    { states: 1, id: 1, depth: 1 }, { states: 2, id: 2, depth: 1 }, { states: 4, id: 3, depth: 1 }, { states: 8, id: hit, depth: 1 },
  ];
  const button = (id, label, keys) => DefineButton2(id, records(1), [
    ...Object.entries(events).map(([name, cond]) => ({ cond, code: says(`${label} ${name}`) })),
    ...keys.map(([name, key]) => ({ key, code: says(`${label} key ${name}`) })),
  ]);
  fixtures['button-events'] = swf({
    version: 6, width: 240, height: 240,
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      square(1, 1200, [160, 160, 160]), square(2, 1200, [80, 120, 255]), square(3, 1200, [255, 80, 80]),
      // 当たり判定が円のボタン用（角は外れる）
      DefineShape({
        id: 4, bounds: [0, 1200, 0, 1200], fills: [solid(0, 0, 0)],
        records: [
          ['style', { moveTo: [600, 0], fill1: 1 }],
          ['curve', 600, 0, 0, 600], ['curve', 0, 600, -600, 0], ['curve', -600, 0, 0, -600], ['curve', 0, -600, 600, 0],
        ],
      }),
      button(10, 'A', [['a', 97], ['enter', 13], ['left', 1]]),
      button(11, 'B', [['a', 97], ['space', 32]]),
      DefineButton(12, records(4), [says('C release')]),
      PlaceObject2({ depth: 1, id: 10, matrix: { tx: 800, ty: 400 } }),
      PlaceObject2({ depth: 2, id: 11, matrix: { tx: 2000, ty: 400 } }),
      PlaceObject2({ depth: 3, id: 12, matrix: { tx: 800, ty: 2400 } }),
      // 同じキーに反応するボタンが複数あるとき、どれが実行されるか。E（ルート直下、深度 5）を先に置き、
      // D（深度 4 のクリップの中）と F（深度 6 のクリップの中）を後から置く。
      button(13, 'D', [['z', 122]]), button(14, 'E', [['z', 122], ['y', 121]]), button(15, 'F', [['y', 121]]),
      DefineSprite(16, 1, [PlaceObject2({ depth: 1, id: 13 }), ShowFrame(), End()]),
      DefineSprite(17, 1, [PlaceObject2({ depth: 1, id: 15 }), ShowFrame(), End()]),
      PlaceObject2({ depth: 5, id: 14, matrix: { a: 0.5, d: 0.5, tx: 3000, ty: 2400 } }),
      PlaceObject2({ depth: 4, id: 16, matrix: { a: 0.5, d: 0.5, tx: 2200, ty: 2400 } }),
      PlaceObject2({ depth: 6, id: 17, matrix: { a: 0.5, d: 0.5, tx: 3800, ty: 2400 } }),
      // 見えなくしたクリップの中のボタン G。
      button(18, 'G', [['x', 120]]),
      DefineSprite(19, 1, [PlaceObject2({ depth: 1, id: 18 }), ShowFrame(), End()]),
      PlaceObject2({ depth: 7, id: 19, name: 'hidden', matrix: { a: 0.5, d: 0.5, tx: 800, ty: 3800 } }),
      DoAction([PushString('hidden'), PushString('7'), PushString('0'), [0x23]]), // hidden._visible = 0
      ShowFrame(), End(),
    ],
  });
}

// --- 音 ---
// テスト用の音: 440 Hz、小さな音量（実機で鳴らしても耳障りにならない程度）、両端をなだらかにしたもの。16 ビットのサンプル列。
export function tone(rate, seconds, hz = 440) {
  const n = Math.round(rate * seconds);
  return Int16Array.from({ length: n }, (_, i) => Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 1600 * Math.min(1, i / 200, (n - i) / 200)));
}
const RATE_CODE = { 5512: 0, 11025: 1, 22050: 2, 44100: 3 };
const soundFormat = (format, rate, bits16, stereo) => (format << 4) | (RATE_CODE[rate] << 2) | (bits16 ? 2 : 0) | (stereo ? 1 : 0);
export const pcmBytes = (samples) => [...samples].flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
// SWF の ADPCM に符号化する（size は 1 サンプルの符号のビット数、2〜5）。モノラルのみ。
const ADPCM_STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411,
  1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
  10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const ADPCM_INDEX = { 2: [-1, 2], 3: [-1, -1, 2, 4], 4: [-1, -1, -1, -1, 2, 4, 6, 8], 5: [-1, -1, -1, -1, -1, -1, -1, -1, 1, 2, 4, 6, 8, 10, 13, 16] };
export function adpcmBytes(samples, size) {
  const bits = new Bits().ub(2, size - 2);
  let value = 0, index = 0;
  samples.forEach((sample, n) => {
    if (n % 4096 === 0) { // 4096 サンプルごとに、初期値（サンプルと表の位置）を置く
      value = sample;
      bits.sb(16, value).ub(6, index);
      return;
    }
    const step = ADPCM_STEPS[index];
    let diff = sample - value;
    let code = 0;
    if (diff < 0) {
      code = 1 << (size - 1);
      diff = -diff;
    }
    // 復号側と同じ計算で、差分にいちばん近い符号を選ぶ
    let delta = step >> (size - 1);
    for (let b = size - 2, s = step; b >= 0; b--, s >>= 1) {
      if (diff >= s) {
        code |= 1 << b;
        diff -= s;
        delta += s;
      }
    }
    value = Math.max(-32768, Math.min(32767, value + (code & (1 << (size - 1)) ? -delta : delta)));
    index = Math.max(0, Math.min(88, index + ADPCM_INDEX[size][code & ((1 << (size - 1)) - 1)]));
    bits.ub(size, code);
  });
  return bits.bytes();
}
// DefineSound。data は符号化済みのバイト列。
export const DefineSound = (id, format, rate, sampleCount, data, { bits16 = true, stereo = false } = {}) =>
  tag(14, [...u16(id), soundFormat(format, rate, bits16, stereo), ...u32(sampleCount), ...data], true);
// SOUNDINFO。envelope は [{ position, left, right }]（位置は 44100 Hz 換算、音量は 0〜32768）。
const soundInfo = ({ stop = false, noMultiple = false, inPoint, outPoint, loops, envelope } = {}) => [
  (stop ? 0x20 : 0) | (noMultiple ? 0x10 : 0) | (envelope ? 0x08 : 0) | (loops !== undefined ? 0x04 : 0) | (outPoint !== undefined ? 0x02 : 0) | (inPoint !== undefined ? 0x01 : 0),
  ...(inPoint !== undefined ? u32(inPoint) : []), ...(outPoint !== undefined ? u32(outPoint) : []), ...(loops !== undefined ? u16(loops) : []),
  ...(envelope ? [envelope.length, ...envelope.flatMap((e) => [...u32(e.position), ...u16(e.left), ...u16(e.right)])] : []),
];
const StartSound = (id, info) => tag(15, [...u16(id), ...soundInfo(info)]);
const mp3 = [...readFileSync(new URL('assets/tone.mp3', import.meta.url))];
const MP3_SAMPLES = 8064; // tone.mp3 は 576 サンプル × 14 フレーム

// イベント音: フレームに置いた StartSound で鳴る音。PCM、ADPCM、MP3 と、繰り返し・音量の変化・停止の指定。
fixtures['sound-event'] = swf({
  version: 8, frames: 40,
  tags: [
    SetBackgroundColor(0xee, 0xee, 0xee),
    DefineSound(1, 3, 22050, 6615, pcmBytes(tone(22050, 0.3))),
    DefineSound(2, 1, 22050, 6615, adpcmBytes(tone(22050, 0.3, 660), 4)),
    DefineSound(3, 2, 22050, MP3_SAMPLES, [...u16(0), ...mp3]),
    DefineSound(4, 3, 11025, 2205, [...tone(11025, 0.2, 330)].map((v) => ((v >> 8) + 128) & 0xff), { bits16: false }),
    DefineSound(5, 1, 11025, 2205, adpcmBytes(tone(11025, 0.2, 550), 2)),
    StartSound(1), ShowFrame(), // 1
    ...Array.from({ length: 5 }, ShowFrame),
    StartSound(2, { loops: 2 }), ShowFrame(), // 7
    ...Array.from({ length: 9 }, ShowFrame),
    StartSound(3, { envelope: [{ position: 0, left: 32768, right: 0 }, { position: 8000, left: 0, right: 32768 }] }), ShowFrame(), // 17
    ...Array.from({ length: 5 }, ShowFrame),
    StartSound(4, { inPoint: 2000, outPoint: 6000, loops: 3 }), ShowFrame(), // 23
    StartSound(4, { noMultiple: true }), StartSound(5), ShowFrame(), // 24: 4 は鳴っているので重ねない
    ShowFrame(),
    StartSound(4, { stop: true }), ShowFrame(), // 26: 4 を止める
    ...Array.from({ length: 13 }, ShowFrame),
    DoAction([[0x07]]), ShowFrame(), // 40: stop
    End(),
  ],
});

// ストリーム音: タイムラインの各フレームに音のデータ (SoundStreamBlock) を置く。フレームが進む間だけ鳴る。
// 1〜8 フレームに ADPCM のデータがあり、10 フレーム目で 3 フレーム目へ戻って（途中から鳴らし直し）、2 周目の 6 フレーム目で止まる。
const SoundStreamHead = (format, rate, samplesPerFrame, latencySeek) => tag(18, [
  soundFormat(0, rate, true, false), soundFormat(format, rate, true, false), ...u16(samplesPerFrame), ...(format === 2 ? u16(latencySeek ?? 0) : []),
]);
const SoundStreamBlock = (data) => tag(19, data, true);
{
  const perFrame = 1838; // 22050 Hz / 12 fps を切り上げ
  const all = tone(22050, (perFrame * 8) / 22050, 520);
  const block = (n) => SoundStreamBlock(adpcmBytes(all.subarray(n * perFrame, (n + 1) * perFrame), 4));
  // n = n + 1; if (n == 1) gotoAndPlay(3); を SWF 4 の命令で書く（2 周目はそのまま進む）
  const loopOnce = DoAction([
    PushString('n'), PushString('n'), [0x1c], PushString('1'), [0x0a], [0x1d],
    PushString('n'), [0x1c], PushString('1'), [0x0e], [0x12], [0x9d, 2, 0, 10, 0],
    PushString('3'), [0x9f, 1, 0, 1],
  ]);
  fixtures['sound-stream'] = swf({
    version: 6, frames: 12, // SWF 6: 未定義の変数は数値の 0 として扱われる
    tags: [
      SetBackgroundColor(0xee, 0xee, 0xee),
      SoundStreamHead(1, 22050, perFrame),
      ...Array.from({ length: 5 }, (_, n) => [block(n), ShowFrame()]).flat(), // 1〜5
      block(5), DoAction([PushString('n'), [0x1c], PushString('1'), [0x0e], [0x12], [0x9d, 2, 0, 1, 0], [0x07]]), ShowFrame(), // 6: 2 周目なら stop
      block(6), ShowFrame(), block(7), ShowFrame(), // 7, 8
      ShowFrame(), // 9: データなし
      loopOnce, ShowFrame(), // 10
      ShowFrame(), ShowFrame(),
      End(),
    ],
  });
}

// 太い線（幅 8 px）を持つ図形を、拡大・縦横比の違う拡大・斜めの変形をかけて置く。線幅がどう拡大されるかを確かめる。
// 外接矩形は広めに取る（実機は描画範囲を外接矩形から決めるので、線がはみ出すと切れてしまう）。
fixtures['stroke-scale'] = swf({
  version: 8, width: 240, height: 240,
  tags: [
    SetBackgroundColor(0xee, 0xee, 0xee),
    DefineShape({
      id: 1, version: 3, bounds: [-300, 700, -300, 700],
      fills: [solid(255, 255, 255, 255)], lines: [lineStyle(160, 81, 140, 204, 255)],
      records: [['style', { moveTo: [0, 0], fill1: 1, line: 1 }], ['line', 400, 0], ['line', 0, 400], ['line', -400, 0], ['line', 0, -400]],
    }),
    DefineSprite(2, 1, [PlaceObject2({ depth: 1, id: 1, matrix: { a: 1.267, d: 1.267 } }), ShowFrame(), End()]),
    PlaceObject2({ depth: 1, id: 1, matrix: { tx: 200, ty: 200 } }),
    PlaceObject2({ depth: 2, id: 1, matrix: { a: 2, d: 2, tx: 1200, ty: 200 } }),
    PlaceObject2({ depth: 3, id: 1, matrix: { a: 3, d: 1, tx: 2600, ty: 200 } }),
    PlaceObject2({ depth: 4, id: 1, matrix: { a: 1, d: 3, tx: 200, ty: 1600 } }),
    PlaceObject2({ depth: 5, id: 2, matrix: { a: 1.581, b: -0.255, c: -0.510, d: 1.446, tx: 1800, ty: 2400 } }),
    PlaceObject2({ depth: 6, id: 1, matrix: { a: 0.5, d: 0.5, tx: 3600, ty: 3200 } }),
    ShowFrame(), End(),
  ],
});

// --- SWF 4 のアクション（FFDec では SWF 4 の命令列を作れないので手で組む） ---
// 実物の SWF 4 と実機を突き合わせて見つかった挙動を、小さな SWF で固定する。
const GetVariable = [0x1c], SetVariable = [0x1d], StringAdd = [0x21], GetProperty = [0x22], SetProperty = [0x23];
const Stop = [0x07], Call = [0x9e, 0, 0];
const GotoFrame2 = (play) => [0x9f, 1, 0, play ? 1 : 0];
const FrameLabel = (name) => tag(43, cstr(name));
const str = (x) => (typeof x === 'string' ? PushString(x) : x.flat());
// trace(a add b add ...)。文字列は push、配列はその命令列（スタックに値を 1 つ残すもの）。
const tr = (...parts) => [...parts.flatMap((part, i) => [...str(part), ...(i ? StringAdd : [])]), ...Trace()];
const variable = (name) => [...PushString(name), ...GetVariable];
const property = (target, index) => [...str(target), ...PushString(String(index)), ...GetProperty];
const setProperty = (target, index, value) => [...PushString(target), ...PushString(String(index)), ...str(value), ...SetProperty];
const binary = (name, op, a, b) => tr(`${a} ${name} ${b} = [`, [PushString(a), PushString(b), [op]], ']');
const unary = (name, op, a) => tr(`${name} ${a} = [`, [PushString(a), [op]], ']');
const X = 0, CURRENTFRAME = 4, VISIBLE = 7, WIDTH = 8, HEIGHT = 9, TARGET = 11, NAME = 13;
// Shift-JIS のバイト列: あい / あ / い / ア / ヂ / 表 / 半角のｱ
const SJIS = { ai: [0x82, 0xa0, 0x82, 0xa2], a: [0x82, 0xa0], i: [0x82, 0xa2], kanaA: [0x83, 0x41], kanaDi: [0x83, 0x61], hyo: [0x95, 0x5c], hankaku: [0xb1] };
const bytes = (list) => [0x96, ...u16(list.length + 2), 0, ...list, 0]; // 文字列の push（バイト列をそのまま）
const turn45 = { a: Math.SQRT1_2, b: Math.SQRT1_2, c: -Math.SQRT1_2, d: Math.SQRT1_2 };

// クリップのプロパティ。SWF 4 と 5 以降で結果が変わるもの（クリップ名を変数として読む、_visible の型、
// 拡大率の控えの有無）と、変わらないもの（数値でない代入は無視、位置とアルファは切り捨てて持つ）がある。
// 幅と高さは、子孫の図形を 1 つずつ変換してから合わせた矩形（45 度 × 45 度で、元の正方形と同じ大きさになる）。
const clipProperties = (version) => swf({
  version,
  tags: [
    square(1, 800, [255, 0, 0]),
    DefineSprite(2, 1, [PlaceObject2({ depth: 1, id: 1, matrix: turn45 }), ShowFrame(), End()]),
    PlaceObject2({ depth: 1, id: 2, name: 'card', matrix: { tx: 100, ty: 40 } }),
    PlaceObject2({ depth: 2, id: 2, name: 'turned', matrix: { ...turn45, tx: 2400, ty: 1600 } }),
    PlaceObject2({ depth: 3, id: 1, name: 'shape' }),
    DefineSprite(3, 1, [PlaceObject2({ depth: 1, id: 1 }), ShowFrame(), End()]),
    PlaceObject2({ depth: 4, id: 3, name: 'num', matrix: { tx: 3000, ty: 200 } }),
    PlaceObject2({ depth: 5, id: 3, name: 'mirror', matrix: { a: -1.25, d: 1.25, tx: 4000, ty: 2000 } }),
    PlaceObject2({ depth: 6, id: 3, name: 'flip', matrix: { a: 1.25, d: -1.25, tx: 3000, ty: 3000 } }),
    DoAction([
      tr('eval card=[', variable('card'), ']'),
      tr('x via name=', property('card', X)),
      tr('x via eval=', property(variable('card'), X)),
      ...['abc', '', '12abc', ' 7', '8 ', '1e1'].flatMap((v) => [setProperty('card', X, v), tr(`x after "${v}"=`, property('card', X))]),
      setProperty('card', X, variable('nothing')), tr('x after undefined=', property('card', X)),
      ...['', 'abc', '2', '0', 'true'].flatMap((v) => [setProperty('card', VISIBLE, v), tr(`visible after "${v}"=`, property('card', VISIBLE))]),
      setProperty('card', NAME, 'renamed'), tr('name=', property('renamed', NAME), ' target=', property('renamed', TARGET)),
      tr('card size=', property('renamed', WIDTH), ',', property('renamed', HEIGHT)),
      tr('turned size=', property('turned', WIDTH), ',', property('turned', HEIGHT)),
      // 鏡像の行列で置かれたクリップ。
      ...['mirror', 'flip'].map((n) => tr(`${n}: `, property(n, 2), ' ', property(n, 3), ' ', property(n, 10))),
      setProperty('mirror', 2, '50'), tr('mirror xscale 50 -> ', property('mirror', 2), ' ', property('mirror', 3), ' ', property('mirror', 10)),
      setProperty('flip', 10, '90'), tr('flip rotation 90 -> ', property('flip', 2), ' ', property('flip', 3), ' ', property('flip', 10)),
      // 代入した値は固定小数に直して持つので、読み戻すと端数が変わる。
      ...['0.15', '2.999', '1.975', '-1.975', '0.049', '-0.049', '100.126'].flatMap((v) => [setProperty('num', X, v), tr(`x ${v} -> `, property('num', X))]),
      setProperty('num', X, [PushString('-16.85'), PushString('17'), [0x0a]]), tr('x -16.85+17 -> ', property('num', X)),
      ...['77', '33.3', '0.01', '150.5', '-50', '100'].flatMap((v) => [setProperty('num', 2, v), tr(`xscale ${v} -> `, property('num', 2), ' width=', property('num', WIDTH))]),
      // （回転の代入は、実機の固定小数の計算の端数が下の桁まで同じにはならないので、ここでは確かめない。test/avm1.test.js で、許容誤差つきで確かめる。）
      ...['33', '50', '99', '100.4', '0.3', '-10', '300', '100'].flatMap((v) => [setProperty('num', 6, v), tr(`alpha ${v} -> `, property('num', 6))]),
      Stop,
    ]),
    ShowFrame(), End(),
  ],
});

Object.assign(fixtures, {
  // 数値への変換と演算。SWF 4 は文字列の先頭の数値だけを読み、読めなければ 0 にする。
  'as-swf4-convert': swf({
    version: 4,
    tags: [
      DoAction([
        ...['abc', '12abc', '', ' 12', '12 ', '1e2', '0x10', '010', '1.5', '.5', '-3', '+3', '1,5', 'Infinity', 'NaN'].map((a) => binary('+', 0x0a, a, '1')),
        ...[['abc', '1'], ['2', '10'], ['abc', 'abd'], ['', '1'], ['1', '']].map(([a, b]) => binary('<', 0x0f, a, b)),
        ...[['abc', '0'], ['', '0'], ['1.0', '1'], ['abc', 'xyz']].map(([a, b]) => binary('==', 0x0e, a, b)),
        ...['abc', '0', '', '1', '0.0', ' ', '12abc'].map((a) => unary('not', 0x12, a)),
        ...[['1', '0'], ['7', '2'], ['abc', '2']].map(([a, b]) => binary('/', 0x0d, a, b)),
        ...[['1', 'abc'], ['abc', ''], ['2', '3']].flatMap(([a, b]) => [binary('and', 0x10, a, b), binary('or', 0x11, a, b)]),
        ...[['1.0', '1'], ['A', 'a']].map(([a, b]) => binary('eq', 0x13, a, b)),
        ...[['a', 'b'], ['', 'a'], ['a', ''], ['10', '9']].map(([a, b]) => binary('lt', 0x29, a, b)),
        ...['3.7', '-3.7', 'abc', '1e20', ''].map((a) => unary('int', 0x18, a)),
        ...['0', '-5', '1', 'abc'].map((a) => unary('random', 0x30, a)),
        ...[['0', '2'], ['-1', '2'], ['2', '-1'], ['2', '100'], ['10', '2'], ['2', '0'], ['abc', '2'], ['2', 'abc'], ['1.9', '1.9']]
          .map(([i, n]) => tr(`substring(hello, ${i}, ${n}) = [`, [PushString('hello'), PushString(i), PushString(n), [0x15]], ']')),
        tr('1/3 = ', [PushString('1'), PushString('3'), [0x0d]]),
        tr('undefined + 1 = [', [variable('nothing'), PushString('1'), [0x0a]], ']'),
        tr('undefined eq empty = [', [variable('nothing'), PushString(''), [0x13]], ']'),
        tr('not undefined = [', [variable('nothing'), [0x12]], ']'),
        Stop,
      ]),
      ShowFrame(), End(),
    ],
  }),
  'as-swf4-clip': clipProperties(4),
  'as-swf6-clip': clipProperties(6),
  // SWF 5 以前の文字列は UTF-8 ではなく、作成環境の文字コードのバイト列（ここでは Shift-JIS）。
  // 長さや切り出しはバイト単位、mb 付きの命令は文字単位になる。
  'as-swf4-sjis': swf({
    version: 4,
    tags: [
      DefineSprite(1, 1, [ShowFrame(), End()]),
      PlaceObject2({ depth: 1, id: 1, name: SJIS.hyo }),
      PlaceObject2({ depth: 2, id: 1, name: [...SJIS.kanaA, 0x78] }), // "アx"
      DoAction([
        PushString('s'), bytes(SJIS.ai), SetVariable,
        tr('s=', variable('s')),
        tr('length=', [variable('s'), [0x14]], ' mblength=', [variable('s'), [0x31]]),
        tr('substring(s,1,2)=', [variable('s'), PushString('1'), PushString('2'), [0x15]]),
        tr('substring(s,2,2)=[', [variable('s'), PushString('2'), PushString('2'), [0x15]], ']'),
        tr('substring(s,3,1)=[', [variable('s'), PushString('3'), PushString('1'), [0x15]], ']'),
        tr('mbsubstring(s,2,1)=', [variable('s'), PushString('2'), PushString('1'), [0x35]]),
        tr('mbsubstring(s,1,5)=', [variable('s'), PushString('1'), PushString('5'), [0x35]]),
        tr('ord=', [variable('s'), [0x32]], ' mbord=', [variable('s'), [0x36]]),
        tr('chr(177)=', [PushString('177'), [0x33]], ' mbchr(33440)=', [PushString('33440'), [0x37]], ' mbchr(65)=', [PushString('65'), [0x37]]),
        tr('chr(130) add chr(160)=', [PushString('130'), [0x33], PushString('160'), [0x33], StringAdd]),
        tr('length(hankaku)=', [bytes(SJIS.hankaku), [0x14]], ' mblength=', [bytes(SJIS.hankaku), [0x31]]),
        tr('a eq a=', [bytes(SJIS.a), bytes(SJIS.a), [0x13]], ' a eq i=', [bytes(SJIS.a), bytes(SJIS.i), [0x13]], ' a lt i=', [bytes(SJIS.a), bytes(SJIS.i), [0x29]]),
        tr('s add x=', [variable('s'), PushString('x'), StringAdd]),
        // 2 バイト目が英字のコード（ア = 83 41、ヂ = 83 61）。名前の大文字小文字を同一視するとき、ここが巻き込まれるか。
        bytes(SJIS.kanaA), PushString('set by A'), SetVariable,
        tr('var kanaA=[', [bytes(SJIS.kanaA), GetVariable], '] var kanaDi=[', [bytes(SJIS.kanaDi), GetVariable], ']'),
        PushString('ABC'), PushString('set by ABC'), SetVariable,
        tr('var abc=[', variable('abc'), ']'),
        // 名前が Shift-JIS のクリップ（表 = 95 5C。2 バイト目が "\\" と同じ）
        tr('name=', property([bytes(SJIS.hyo)], NAME), ' target=', property([bytes(SJIS.hyo)], TARGET)),
        tr('clip Ax via Ax=[', property([bytes([...SJIS.kanaA, 0x78])], NAME), '] via Dix=[', property([bytes([...SJIS.kanaDi, 0x78])], NAME), '] via AX=[', property([bytes([...SJIS.kanaA, 0x58])], NAME), ']'),
        Stop,
      ]),
      ShowFrame(), End(),
    ],
  }),
  // 変数と連動するテキストフィールド（定義で変数名を指定したもの）。変数が未定義なら、最初の文字列が変数に入る。
  // 先に値が入っている変数には、フィールドの方が合わせる。
  'as-swf4-edittext': swf({
    version: 4, frames: 3,
    tags: [
      DefineEditText({ id: 1, bounds: [0, 2000, 0, 400], height: 240, color: [0, 0, 0, 255], text: 'init one', variable: 'one' }),
      DefineEditText({ id: 2, bounds: [0, 2000, 0, 400], height: 240, color: [0, 0, 0, 255], text: 'init two', variable: 'two' }),
      DefineEditText({ id: 3, bounds: [0, 2000, 0, 400], height: 240, color: [0, 0, 0, 255], text: 'init three', variable: '/:three' }),
      DefineSprite(4, 1, [PlaceObject2({ depth: 1, id: 3 }), DoAction([tr('in clip: three=[', variable('three'), '] /:three=[', variable('/:three'), ']')]), ShowFrame(), End()]),
      DoAction([PushString('two'), PushString('set before'), SetVariable, tr('frame 1 before place: one=[', variable('one'), '] two=[', variable('two'), ']')]),
      PlaceObject2({ depth: 1, id: 1, matrix: { tx: 200, ty: 200 } }),
      PlaceObject2({ depth: 2, id: 2, matrix: { tx: 200, ty: 800 } }),
      PlaceObject2({ depth: 3, id: 4, name: 'clip', matrix: { tx: 200, ty: 1400 } }),
      ShowFrame(),
      DoAction([
        tr('frame 2: one=[', variable('one'), '] two=[', variable('two'), '] three=[', variable('three'), ']'),
        PushString('one'), PushString('changed'), SetVariable,
        tr('after set: one=[', variable('one'), ']'),
      ]),
      ShowFrame(),
      DoAction([tr('frame 3: one=[', variable('one'), ']'), Stop]),
      ShowFrame(), End(),
    ],
  }),
  // call: 同じクリップのフレームのアクションを、その場で実行する。
  // （デバッガ版の実機はスプライト内のフレームを call すると落ちるので、ルートだけで確かめる。）
  'as-swf4-call': swf({
    version: 4, frames: 4,
    tags: [
      DoAction([tr('f1'), PushString('lab'), Call, tr('after call'), PushString('3'), Call, tr('after call by number')]), ShowFrame(),
      DoAction([tr('f2')]), ShowFrame(),
      FrameLabel('lab'), DoAction([tr('in lab'), PushString('end'), GotoFrame2(false), tr('lab done')]), ShowFrame(),
      FrameLabel('end'), DoAction([tr('f4'), Stop]), ShowFrame(),
      End(),
    ],
  }),
  // ターゲットパス。".." は親を指す 1 つの要素。同名の変数があっても、パスは子のクリップを指す。
  'as-swf4-path': swf({
    version: 4, frames: 2,
    tags: [
      DefineSprite(1, 3, [
        DoAction([Stop]), ShowFrame(), ShowFrame(),
        DoAction([tr('leaf f3 parent t=', variable('..:t'), ' self=', property('../t', CURRENTFRAME)), PushString('../..:2'), GotoFrame2(false)]), ShowFrame(),
        End(),
      ]),
      DefineSprite(2, 1, [
        PlaceObject2({ depth: 1, id: 1, name: 't' }),
        DoAction([
          PushString('t'), PushString('5'), SetVariable,
          PushString('t:3'), GotoFrame2(false),
          tr('mid t=', variable('t'), ' child frame=', property('t', CURRENTFRAME)),
        ]),
        ShowFrame(), End(),
      ]),
      PlaceObject2({ depth: 1, id: 2, name: 'm' }),
      DoAction([tr('root f1'), Stop]), ShowFrame(),
      DoAction([tr('root f2 /m/t frame=', property('/m/t', CURRENTFRAME), ' /m:t=', variable('/m:t'), ' m/t:t=[', variable('m/t:t'), ']')]), ShowFrame(),
      End(),
    ],
  }),
  // タグが深度 16384 以上（スクリプトが作るクリップの領域）に置いたクリップは、先頭フレームへ戻っても作り直されない。
  'as-swf4-highdepth': swf({
    version: 4, frames: 3,
    tags: [
      DefineSprite(1, 1, [DoAction([tr('created')]), ShowFrame(), End()]),
      PlaceObject2({ depth: 20000, id: 1, name: 'high' }),
      PlaceObject2({ depth: 5, id: 1, name: 'low' }),
      DoAction([tr('f1')]), ShowFrame(),
      RemoveObject2(5), ShowFrame(),
      DoAction([
        Stop,
        PushString('n'), variable('n'), PushString('1'), [0x0a], SetVariable,
        variable('n'), PushString('2'), [0x0f], [0x12], [0x9d, 2, 0, 10, 0], // if (!(n < 2)) 以降を飛ばす
        PushString('1'), GotoFrame2(true),
      ]),
      ShowFrame(), End(),
    ],
  }),
});

// 別のクリップのフレームを call すると、呼ばれた側のクリップを対象に実行される。四角が (150, 100) px に動けば、
// 対象も変数も card のもの。デバッガ版の実機はスプライト内のフレームを call すると落ちるので trace の期待値を
// 作れない。リリース版の実機の画面で確かめた結果を test/avm1.test.js で固定する。
export const callOtherClip = swf({
  version: 4,
  tags: [
    square(1, 800, [255, 0, 0]),
    DefineSprite(2, 2, [
      PlaceObject2({ depth: 1, id: 1 }),
      DoAction([PushString('x'), PushString('card-var'), SetVariable, Stop]), ShowFrame(),
      DoAction([
        setProperty('', X, '150'),
        variable('x'), PushString('card-var'), [0x13], [0x12], [0x9d, 2, 0, 12, 0], // if (x ne "card-var") 以降を飛ばす
        setProperty('', 1, '100'),
      ]),
      ShowFrame(), End(),
    ]),
    PlaceObject2({ depth: 1, id: 2, name: 'card', matrix: { tx: 400, ty: 400 } }),
    DoAction([PushString('x'), PushString('root-var'), SetVariable, PushString('card:2'), Call, Stop]),
    ShowFrame(), End(),
  ],
});

// --- ビデオ（仕様 14 章） ---
export const DefineVideoStream = (id, numFrames, width, height, codec, smoothing = false) =>
  tag(60, [...u16(id), ...u16(numFrames), ...u16(width), ...u16(height), smoothing ? 1 : 0, codec]);
const VideoFrame = (id, n, data) => tag(61, [...u16(id), ...u16(n), ...data], true);
// 埋め込みのビデオを 1 フレームにつき 1 枚ずつ進めて、最後のフレームで止まるタイムライン。表示するフレームは ratio で指定する。
// extra(n) は、フレーム n に足すタグ。
const videoTimeline = (id, packets, place, extra = () => []) => packets.flatMap((data, n) => [
  VideoFrame(id, n, data),
  n === 0 ? PlaceObject2({ depth: 1, id, ratio: 0, matrix: place }) : PlaceObject2({ depth: 1, move: true, ratio: n }),
  ...extra(n),
  ...(n === packets.length - 1 ? [DoAction([Stop])] : []),
  ShowFrame(),
]);

// Sorenson H.263: ffmpeg で作った 8 フレームを 2 倍に拡大して再生する。6 フレーム目からは、フレーム 2 で止まったままの
// もう 1 つのインスタンスを右に置く（差分フレームなので、キーフレーム 0 から順に復号しないと出せない）。
const h263Packets = parseFLV(readFileSync(new URL('assets/video-h263.flv', import.meta.url))).video.map((t) => [...t.data]);
fixtures['video-h263'] = swf({
  version: 8, frames: h263Packets.length,
  tags: [
    SetBackgroundColor(0xee, 0xee, 0xee),
    DefineVideoStream(1, h263Packets.length, 64, 48, 2),
    ...videoTimeline(1, h263Packets, { a: 2, d: 2, tx: 200, ty: 200 }, (n) => (n === 5 ? [PlaceObject2({ depth: 2, id: 1, ratio: 2, matrix: { tx: 3200, ty: 200 } })] : [])),
    End(),
  ],
});

// Screen Video のテスト用の絵。40×24 px で、ブロックは 16×16（右端と上端は半端な大きさのブロックになる）。
// フレーム 0 は全体（キーフレーム）、フレーム 1 と 2 は、それぞれ 1 つのブロックだけが変わる。
export const SCREEN_VIDEO = { width: 40, height: 24, block: 16, frames: 3 };
/** フレーム n の、(x, y)（左上が原点）の画素 [r, g, b]。 */
export function screenVideoPixel(n, x, y) {
  if (n >= 1 && x >= 16 && x < 32 && y >= 8) return [255, 200 - (x - 16) * 8, 0]; // 下の段の中央のブロック
  if (n >= 2 && x >= 32 && y < 8) return [0, 255 - y * 16, 255]; // 上の段の右端のブロック
  return [x * 6, y * 10, 128];
}
// SCREENVIDEOPACKET。ブロックは左下から右上へ並び、ブロックの中の画素も下の行から BGR で入る。変わらないブロックは長さ 0。
// 先頭には、FLV のビデオタグと同じ 1 バイト（上位 4 ビットがフレームの種類、下位がコーデック）を付ける。仕様書の VideoFrame の表には
// 無いが、実機はこれが無いと何も表示しない。
function screenVideoPacket(n) {
  const { width, height, block } = SCREEN_VIDEO;
  const out = [(n === 0 ? 0x10 : 0x20) | 3, ((block / 16 - 1) << 4) | (width >> 8), width & 0xff, ((block / 16 - 1) << 4) | (height >> 8), height & 0xff];
  for (let bottom = 0; bottom < height; bottom += block) {
    for (let left = 0; left < width; left += block) {
      const pixels = [];
      let changed = n === 0;
      for (let row = 0; row < Math.min(block, height - bottom); row++) {
        const y = height - 1 - (bottom + row);
        for (let x = left; x < Math.min(left + block, width); x++) {
          const color = screenVideoPixel(n, x, y);
          pixels.push(color[2], color[1], color[0]);
          if (n > 0 && String(screenVideoPixel(n - 1, x, y)) !== String(color)) changed = true;
        }
      }
      const data = changed ? [...deflateSync(Uint8Array.from(pixels))] : [];
      out.push(data.length >> 8, data.length & 0xff, ...data);
    }
  }
  return out;
}
fixtures['video-screen'] = swf({
  version: 8, frames: SCREEN_VIDEO.frames,
  tags: [
    SetBackgroundColor(0xee, 0xee, 0xee),
    DefineVideoStream(1, SCREEN_VIDEO.frames, SCREEN_VIDEO.width, SCREEN_VIDEO.height, 3),
    ...videoTimeline(1, Array.from({ length: SCREEN_VIDEO.frames }, (_, n) => screenVideoPacket(n)), { a: 4, d: 4, tx: 200, ty: 200 }),
    End(),
  ],
});

// VP6: tools/mkvp6.js で作った 8 フレーム（フレーム 0 と 4 がキーフレーム）を 2 倍に拡大して再生する。
// データは、FLV のパケットから先頭の 1 バイト（削る画素数）を除いたもの。絵は 64×48 px で符号化されていて、
// DefineVideoStream の大きさ（62×44 px）に切り取られる。6 フレーム目からは、フレーム 5 で止まったままのもう 1 つの
// インスタンスを右に置く（キーフレーム 4 から復号される）。
const vp6Packets = (name) => parseFLV(readFileSync(new URL(`assets/${name}`, import.meta.url))).video.map((t) => [...t.data.subarray(1)]);
fixtures['video-vp6'] = swf({
  version: 8, frames: 8,
  tags: [
    SetBackgroundColor(0xee, 0xee, 0xee),
    DefineVideoStream(1, 8, 62, 44, 4),
    ...videoTimeline(1, vp6Packets('video-vp6.flv'), { a: 2, d: 2, tx: 200, ty: 200 }, (n) => (n === 5 ? [PlaceObject2({ depth: 2, id: 1, ratio: 5, matrix: { tx: 3200, ty: 200 } })] : [])),
    End(),
  ],
});
// アルファ付きの VP6: 背景の色が透けて見える。
fixtures['video-vp6a'] = swf({
  version: 8, frames: 8,
  tags: [
    SetBackgroundColor(0x33, 0x66, 0xcc),
    DefineVideoStream(1, 8, 62, 44, 5),
    ...videoTimeline(1, vp6Packets('video-vp6a.flv'), { a: 2, d: 2, tx: 200, ty: 200 }),
    End(),
  ],
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../test/fixtures/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(fixtures)) {
    writeFileSync(new URL(`${name}.swf`, dir), bytes);
    console.log(`${name}.swf ${bytes.length} bytes`);
  }
  // 比較ページ (web/compare.html) が読む一覧。
  const names = [...Object.keys(fixtures), 'zws-hello'].sort();
  writeFileSync(new URL('index.json', dir), `${JSON.stringify(names)}\n`);
}
