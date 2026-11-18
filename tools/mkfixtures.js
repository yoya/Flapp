// テスト用 SWF を生成して test/fixtures/ に書き出す。
// 仕様: docs/swf-file-format-spec-v19.pdf 1〜3 章（基本型・ヘッダ・表示リスト）、5 章（アクション）、6〜7 章（図形）。
//
// 多フレームのものは、10 フレーム目までに絵が止まり、その後は長く同じ絵が続くように作る
// （実機の画面は再生開始から数秒後に取るので、どのフレームで取っても同じ絵になる必要がある）。
//
// zws-hello.swf だけはここで生成しない（Node に LZMA 圧縮が無いため）。lzma-src.swf を
// 次のコマンドで圧縮したものをコミットしている:
//   python3 -c 'import lzma,struct;d=open("test/fixtures/lzma-src.swf","rb").read();c=lzma.compress(d[8:],format=lzma.FORMAT_ALONE);open("test/fixtures/zws-hello.swf","wb").write(b"ZWS"+d[3:8]+struct.pack("<I",len(c)-13)+c[:5]+c[13:])'
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

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

export function tag(code, body = []) {
  return body.length < 0x3f
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
export function PlaceObject2({ depth, id, move = false, matrix: m, cxform: cx, name, clipDepth }) {
  const flags = (move ? 0x01 : 0) | (id !== undefined ? 0x02 : 0) | (m ? 0x04 : 0) | (cx ? 0x08 : 0) |
    (name !== undefined ? 0x20 : 0) | (clipDepth !== undefined ? 0x40 : 0);
  return tag(26, [
    flags, ...u16(depth),
    ...(id !== undefined ? u16(id) : []),
    ...(m ? matrix(m) : []),
    ...(cx ? cxform(cx) : []),
    ...(name !== undefined ? cstr(name) : []),
    ...(clipDepth !== undefined ? u16(clipDepth) : []),
  ]);
}

// --- 図形 ---
// 色は [r, g, b]（DefineShape / 2）か [r, g, b, a]（DefineShape3 / 4）。
export const solid = (...color) => [0x00, ...color];
// type: 0x10 線形、0x12 放射、0x13 焦点つき放射。stops は [ratio, ...color] の列。
const gradient = ({ type, matrix: m, stops, focal }) => [
  type, ...matrix(m), stops.length, ...stops.flat(),
  ...(type === 0x13 ? u16(Math.round(focal * 256)) : []),
];
export const lineStyle = (width, ...color) => [...u16(width), ...color];
// LINESTYLE2 (DefineShape4)。join: 0 丸 / 1 ベベル / 2 マイター。
const lineStyle2 = ({ width, join = 0, miterLimit = 3, color }) => [
  ...u16(width),
  ...new Bits().ub(2, 0).ub(2, join).ub(4, 0).ub(8, 0).bytes(),
  ...(join === 2 ? u16(Math.round(miterLimit * 256)) : []),
  ...color,
];

/**
 * DefineShape〜DefineShape4。records は次の列（座標は twips）:
 *   ['style', { moveTo: [x, y], fill0, fill1, line, newStyles: { fills, lines } }]
 *                                                       番号は 1 始まり、0 は「なし」。newStyles はスタイル表の差し替え
 *   ['line', dx, dy]
 *   ['curve', 制御点 dx, dy, 終点 dx, dy]               終点は制御点からの差分
 */
export function DefineShape({ id, version = 1, bounds, fills = [], lines = [], records }) {
  let fillBits = 32 - Math.clz32(fills.length);
  let lineBits = 32 - Math.clz32(lines.length);
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
  bits.ub(6, 0); // EndShapeRecord
  return tag({ 1: 2, 2: 22, 3: 32, 4: 83 }[version], [
    ...u16(id), ...rect(...bounds),
    ...(version === 4 ? [...rect(...bounds), 0x01] : []), // EdgeBounds（ここでは同じ値）、UsesScalingStrokes
    fills.length, ...fills.flat(),
    lines.length, ...lines.flat(),
    ...bits.bytes(),
  ]);
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

const rectRecords = (x, y, w, h, style) => [
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
