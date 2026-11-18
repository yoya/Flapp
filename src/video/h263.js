// Sorenson H.263 の復号。仕様: docs/swf-file-format-spec-v19.pdf 14 章（ピクチャ層とマクロブロック層の違い）と、
// ITU-T H.263（1996 年版）のマクロブロック層・ブロック層（可変長符号の表は H.263 の Table 7・8・12・14・16）。
//
// 入力は信用しない。寸法には上限があり、ビット列が尽きたり表に無い符号が出たりしたら VideoError を投げる
// （呼び出し側は、そのフレームを捨てて前の絵を出し続ける）。
//
// 1 フレームを復号すると、輝度 (Y) と色差 (Cb, Cr) の面ができる。次のフレームは、それを参照して動き補償を行う。

export class VideoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VideoError';
  }
}

export const MAX_VIDEO_PIXELS = 1 << 22; // 1 フレームの画素数の上限（2048×2048 相当）

// --- 可変長符号の表。[符号, ビット数] の並びで、位置が値になる。 ---
// MCBPC（イントラピクチャ）: 位置 = (種類が INTRA+Q なら 4) + 色差のブロックパターン。位置 8 は詰め物。
const MCBPC_INTRA = [[1, 1], [1, 3], [2, 3], [3, 3], [1, 4], [1, 6], [2, 6], [3, 6], [1, 9]];
// MCBPC（インターピクチャ）: 位置 = 種類 × 4 + 色差のブロックパターン。種類は TYPES の順。位置 20 は詰め物。
const MCBPC_INTER = [
  [1, 1], [3, 4], [2, 4], [5, 6], [3, 5], [4, 8], [3, 8], [3, 7], [3, 3], [7, 7], [6, 7], [5, 9], [4, 6], [4, 9], [3, 9], [2, 9],
  [2, 3], [5, 7], [4, 7], [5, 8], [1, 9], null, null, null, [2, 11], [12, 13], [14, 13], [15, 13],
];
const TYPES = [
  { intra: false, quant: false, four: false }, { intra: true, quant: false, four: false }, { intra: false, quant: true, four: false },
  { intra: true, quant: true, four: false }, { intra: false, quant: false, four: true }, null, { intra: false, quant: true, four: true },
];
// CBPY: 位置 = 輝度 4 ブロックのパターン（イントラの場合。インターでは反転して使う）。
const CBPY = [[3, 4], [5, 5], [4, 5], [9, 4], [3, 5], [7, 4], [2, 6], [11, 4], [2, 5], [3, 6], [5, 4], [10, 4], [4, 4], [8, 4], [6, 4], [3, 2]];
// 動きベクトルの差分: 位置 = 絶対値（半画素単位）。0 以外は、後ろに符号の 1 ビットが付く。
const MVD = [
  [1, 1], [1, 2], [1, 3], [1, 4], [3, 6], [5, 7], [4, 7], [3, 7], [11, 9], [10, 9], [9, 9], [17, 10], [16, 10], [15, 10], [14, 10], [13, 10], [12, 10],
  [11, 10], [10, 10], [9, 10], [8, 10], [7, 10], [6, 10], [5, 10], [4, 10], [7, 11], [6, 11], [5, 11], [4, 11], [3, 11], [2, 11], [3, 12], [2, 12],
];
// 変換係数 (TCOEF): 位置 102 がエスケープ。位置ごとの (LAST, RUN, LEVEL) は下の TCOEF_EVENTS。
const TCOEF = [
  [0x2, 2], [0xf, 4], [0x15, 6], [0x17, 7], [0x1f, 8], [0x25, 9], [0x24, 9], [0x21, 10], [0x20, 10], [0x7, 11], [0x6, 11], [0x20, 11],
  [0x6, 3], [0x14, 6], [0x1e, 8], [0xf, 10], [0x21, 11], [0x50, 12], [0xe, 4], [0x1d, 8], [0xe, 10], [0x51, 12],
  [0xd, 5], [0x23, 9], [0xd, 10], [0xc, 5], [0x22, 9], [0x52, 12], [0xb, 5], [0xc, 10], [0x53, 12], [0x13, 6], [0xb, 10], [0x54, 12],
  [0x12, 6], [0xa, 10], [0x11, 6], [0x9, 10], [0x10, 6], [0x8, 10], [0x16, 7], [0x55, 12], [0x15, 7], [0x14, 7], [0x1c, 8], [0x1b, 8],
  [0x21, 9], [0x20, 9], [0x1f, 9], [0x1e, 9], [0x1d, 9], [0x1c, 9], [0x1b, 9], [0x1a, 9], [0x22, 11], [0x23, 11], [0x56, 12], [0x57, 12],
  [0x7, 4], [0x19, 9], [0x5, 11], [0xf, 6], [0x4, 11], [0xe, 6], [0xd, 6], [0xc, 6], [0x13, 7], [0x12, 7], [0x11, 7], [0x10, 7],
  [0x1a, 8], [0x19, 8], [0x18, 8], [0x17, 8], [0x16, 8], [0x15, 8], [0x14, 8], [0x13, 8], [0x18, 9], [0x17, 9], [0x16, 9], [0x15, 9],
  [0x14, 9], [0x13, 9], [0x12, 9], [0x11, 9], [0x7, 10], [0x6, 10], [0x5, 10], [0x4, 10], [0x24, 11], [0x25, 11], [0x26, 11], [0x27, 11],
  [0x58, 12], [0x59, 12], [0x5a, 12], [0x5b, 12], [0x5c, 12], [0x5d, 12], [0x5e, 12], [0x5f, 12], [0x3, 7],
];
// TCOEF の各位置の [LAST, RUN, LEVEL]。LAST = 0 は RUN 0〜26、LAST = 1 は RUN 0〜40。RUN ごとの LEVEL の最大値を並べて作る。
const TCOEF_EVENTS = [];
[[12, 6, 4, 3, 3, 3, 3, 2, 2, 2, 2, ...new Array(16).fill(1)], [3, 2, ...new Array(39).fill(1)]].forEach((maxLevels, last) => {
  maxLevels.forEach((max, run) => { for (let level = 1; level <= max; level++) TCOEF_EVENTS.push([last, run, level]); });
});
const ESCAPE = 102;

// 表を、先頭から 1 ビットずつたどる二分木にする。node[bit] は、次の node か、値（葉）。
function tree(table) {
  const root = [null, null];
  table.forEach((entry, value) => {
    if (!entry) return;
    const [code, bits] = entry;
    let node = root;
    for (let i = bits - 1; i > 0; i--) node = node[(code >> i) & 1] ??= [null, null];
    node[code & 1] = { value };
  });
  return root;
}
const TREES = { mcbpcIntra: tree(MCBPC_INTRA), mcbpcInter: tree(MCBPC_INTER), cbpy: tree(CBPY), mvd: tree(MVD), tcoef: tree(TCOEF) };

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const SIZES = { 2: [352, 288], 3: [176, 144], 4: [128, 96], 5: [320, 240], 6: [160, 120] };
// 4 つの動きベクトルの和から色差のベクトルを作るときの丸め（H.263 6.1.1 の表）。
const CHROMA_ROUND = [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2];
// 逆 DCT の基底。COS[u][x] = c(u) cos((2x + 1) u π / 16) / 2
const COS = Array.from({ length: 8 }, (_, u) => Float64Array.from({ length: 8 }, (_, x) => (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2));

class Bits {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0; // ビット位置
  }

  bit() {
    if (this.pos >= this.bytes.length * 8) throw new VideoError('video data ends in the middle of a picture');
    const v = (this.bytes[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }

  bits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }

  // 符号つきの n ビット（2 の補数）
  signed(n) {
    const v = this.bits(n);
    return v >= 1 << (n - 1) ? v - (1 << n) : v;
  }

  code(root) {
    let node = root;
    for (;;) {
      node = node[this.bit()];
      if (!node) throw new VideoError('invalid variable length code in video data');
      if (!Array.isArray(node)) return node.value;
    }
  }
}

/** ピクチャの先頭（寸法や種類）だけを読む。{ version, width, height, type, quant, reader } を返す。 */
export function readPictureHeader(bytes) {
  const r = new Bits(bytes);
  if (r.bits(17) !== 1) throw new VideoError('H.263 picture start code is missing');
  const version = r.bits(5);
  if (version > 1) throw new VideoError(`H.263 version ${version} is not supported`);
  r.bits(8); // TemporalReference（時刻は SWF のフレームや FLV のタグが決める）
  const size = r.bits(3);
  let width, height;
  if (size === 0) [width, height] = [r.bits(8), r.bits(8)];
  else if (size === 1) [width, height] = [r.bits(16), r.bits(16)];
  else if (SIZES[size]) [width, height] = SIZES[size];
  else throw new VideoError('reserved H.263 picture size');
  if (width < 1 || height < 1 || width * height > MAX_VIDEO_PIXELS) throw new VideoError(`video frame size ${width}x${height} is out of range`);
  const type = r.bits(2); // 0: イントラ、1: インター、2: 使い捨てのインター
  if (type === 3) throw new VideoError('reserved H.263 picture type');
  r.bit(); // DeblockingFlag（参考情報）
  const quant = r.bits(5);
  if (quant === 0) throw new VideoError('H.263 quantizer is zero');
  while (r.bit()) r.bits(8); // ExtraInformation
  return { version, width, height, type, quant, reader: r };
}

/** H.263 のストリーム 1 本ぶんの復号器。フレームを順に decode に渡す。 */
export class H263Decoder {
  constructor() {
    this.picture = null; // 直前に復号したフレーム { width, height, stride, y, cb, cr }
    this.reference = null; // 動き補償の参照（使い捨てでない最後のフレーム）
  }

  /**
   * 1 フレームを復号する。インターフレームは、参照フレームが無ければ（キーフレームより前なら）失敗する。
   * @param {Uint8Array} bytes H263VIDEOPACKET
   * @returns {{ width, height, stride, y: Uint8ClampedArray, cb: Uint8ClampedArray, cr: Uint8ClampedArray }} stride は輝度の 1 行の長さ（16 の倍数）
   */
  decode(bytes) {
    const header = readPictureHeader(bytes);
    const { width, height, type, reader: r } = header;
    const mbWidth = (width + 15) >> 4, mbHeight = (height + 15) >> 4;
    const stride = mbWidth * 16, lines = mbHeight * 16;
    const ref = this.reference;
    if (type !== 0 && (!ref || ref.width !== width || ref.height !== height)) throw new VideoError('H.263 inter frame without a matching key frame');
    const out = { width, height, stride, y: new Uint8ClampedArray(stride * lines), cb: new Uint8ClampedArray((stride * lines) >> 2), cr: new Uint8ClampedArray((stride * lines) >> 2) };
    // 動きベクトルは 8×8 のブロックごとに持つ（予測に使う）。左右に 1 列ずつ、常に 0 の列を置く。
    const mvStride = mbWidth * 2 + 2;
    const mvx = new Int16Array(mvStride * mbHeight * 2), mvy = new Int16Array(mvStride * mbHeight * 2);
    const block = new Float64Array(64), temp = new Float64Array(64);
    let quant = header.quant;

    // 係数を読んで逆量子化し、逆 DCT した結果を block に入れる。coded が偽なら、イントラの直流成分だけ。何も無ければ false。
    const readBlock = (intra, coded) => {
      block.fill(0);
      let i = 0;
      if (intra) {
        const dc = r.bits(8);
        block[0] = (dc === 255 ? 128 : dc) * 8;
        i = 1;
      } else if (!coded) return false;
      const qmul = quant * 2, qadd = (quant - 1) | 1;
      while (coded) {
        const index = r.code(TREES.tcoef);
        let last, run, level;
        if (index === ESCAPE) {
          // バージョン 1 では、レベルが 7 ビットか 11 ビットかを示すビットが先に付く。バージョン 0 は H.263 と同じ 8 ビット。
          const wide = header.version === 1 ? r.bit() : -1;
          last = r.bit();
          run = r.bits(6);
          level = wide === -1 ? r.signed(8) : wide ? r.signed(11) : r.signed(7);
        } else {
          [last, run, level] = TCOEF_EVENTS[index];
          if (r.bit()) level = -level;
        }
        i += run;
        if (i >= 64) throw new VideoError('too many coefficients in a video block');
        block[ZIGZAG[i++]] = level < 0 ? level * qmul - qadd : level > 0 ? level * qmul + qadd : 0;
        if (last) break;
      }
      // 逆 DCT（行、列の順）
      for (let row = 0; row < 8; row++) {
        for (let x = 0; x < 8; x++) {
          let sum = 0;
          for (let u = 0; u < 8; u++) sum += COS[u][x] * block[row * 8 + u];
          temp[row * 8 + x] = sum;
        }
      }
      for (let col = 0; col < 8; col++) {
        for (let y = 0; y < 8; y++) {
          let sum = 0;
          for (let v = 0; v < 8; v++) sum += COS[v][y] * temp[v * 8 + col];
          block[y * 8 + col] = Math.round(sum);
        }
      }
      return true;
    };
    // 参照面 src（幅 w、高さ h）の、半画素単位のベクトル (mx, my) だけずれた size×size の領域を、dst の (x, y) に写す。
    // 面の外は、端の画素が続いているものとして読む（制限なしの動きベクトル）。
    const predict = (dst, src, w, h, x, y, size, mx, my) => {
      const sx = x + (mx >> 1), sy = y + (my >> 1);
      const fx = mx & 1, fy = my & 1;
      const at = (px, py) => src[Math.min(Math.max(py, 0), h - 1) * w + Math.min(Math.max(px, 0), w - 1)];
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const a = at(sx + i, sy + j);
          let v;
          if (!fx && !fy) v = a;
          else if (fx && !fy) v = (a + at(sx + i + 1, sy + j) + 1) >> 1;
          else if (!fx) v = (a + at(sx + i, sy + j + 1) + 1) >> 1;
          else v = (a + at(sx + i + 1, sy + j) + at(sx + i, sy + j + 1) + at(sx + i + 1, sy + j + 1) + 2) >> 2;
          dst[(y + j) * w + x + i] = v;
        }
      }
    };
    // block（残差か、イントラの画素値）を、面 dst の (x, y) の 8×8 に書く。add が真なら、予測値に足す。
    const store = (dst, w, x, y, add) => {
      for (let j = 0; j < 8; j++) {
        const row = (y + j) * w + x;
        for (let i = 0; i < 8; i++) dst[row + i] = add ? dst[row + i] + block[j * 8 + i] : block[j * 8 + i];
      }
    };
    const median = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

    for (let mby = 0; mby < mbHeight; mby++) {
      for (let mbx = 0; mbx < mbWidth; mbx++) {
        const px = mbx * 16, py = mby * 16;
        const mv = (k) => (mby * 2 + (k >> 1)) * mvStride + mbx * 2 + 1 + (k & 1); // ブロック k の動きベクトルの位置
        if (type !== 0 && r.bit()) {
          // 符号化されていないマクロブロック: 参照フレームの同じ位置を写す。
          predict(out.y, ref.y, stride, lines, px, py, 16, 0, 0);
          predict(out.cb, ref.cb, stride >> 1, lines >> 1, px >> 1, py >> 1, 8, 0, 0);
          predict(out.cr, ref.cr, stride >> 1, lines >> 1, px >> 1, py >> 1, 8, 0, 0);
          continue;
        }
        let mcbpc;
        do mcbpc = r.code(type === 0 ? TREES.mcbpcIntra : TREES.mcbpcInter); while (mcbpc === (type === 0 ? 8 : 20)); // 詰め物を読み飛ばす
        const kind = type === 0 ? { intra: true, quant: mcbpc >= 4, four: false } : TYPES[mcbpc >> 2];
        const cbpy = r.code(TREES.cbpy) ^ (kind.intra ? 0 : 15);
        const cbp = (cbpy << 2) | (mcbpc & 3); // 上位から順に、輝度 4 つ、Cb、Cr
        if (kind.quant) quant = Math.min(31, Math.max(1, quant + [-1, -2, 1, 2][r.bits(2)]));
        if (!kind.intra) {
          for (let k = 0; k < (kind.four ? 4 : 1); k++) {
            // 予測値は、左・上・右上のベクトルの中央値。最上段では左だけ（左端なら 0）。
            const at = mv(k);
            let predX, predY;
            if (mby === 0 && k < 2) [predX, predY] = [mvx[at - 1], mvy[at - 1]];
            else {
              const above = at - mvStride, corner = above + (k === 0 ? 2 : k === 3 ? -1 : 1);
              predX = median(mvx[at - 1], mvx[above], mvx[corner]);
              predY = median(mvy[at - 1], mvy[above], mvy[corner]);
            }
            const read = (pred) => {
              const size = r.code(TREES.mvd);
              const v = pred + (size && r.bit() ? -size : size);
              return v < -32 ? v + 64 : v > 31 ? v - 64 : v; // -16〜+15.5 画素の範囲に折り返す
            };
            const x = read(predX), y = read(predY);
            for (const j of kind.four ? [k] : [0, 1, 2, 3]) { mvx[mv(j)] = x; mvy[mv(j)] = y; }
          }
          // 動き補償。色差のベクトルは、輝度のベクトル（4 つのときはその和）から作る。
          let cx, cy;
          if (kind.four) {
            let sumX = 0, sumY = 0;
            for (let k = 0; k < 4; k++) {
              predict(out.y, ref.y, stride, lines, px + (k & 1) * 8, py + (k >> 1) * 8, 8, mvx[mv(k)], mvy[mv(k)]);
              sumX += mvx[mv(k)];
              sumY += mvy[mv(k)];
            }
            const round = (sum) => (sum < 0 ? -(CHROMA_ROUND[-sum & 15] + (-sum >> 3)) : CHROMA_ROUND[sum & 15] + (sum >> 3));
            [cx, cy] = [round(sumX), round(sumY)];
          } else {
            const x = mvx[mv(0)], y = mvy[mv(0)];
            predict(out.y, ref.y, stride, lines, px, py, 16, x, y);
            // 半画素単位のまま 2 で割り、端数があれば半画素にする。
            [cx, cy] = [((x >> 2) << 1) | (x & 3 ? 1 : 0), ((y >> 2) << 1) | (y & 3 ? 1 : 0)];
          }
          predict(out.cb, ref.cb, stride >> 1, lines >> 1, px >> 1, py >> 1, 8, cx, cy);
          predict(out.cr, ref.cr, stride >> 1, lines >> 1, px >> 1, py >> 1, 8, cx, cy);
        }
        for (let k = 0; k < 6; k++) {
          if (!readBlock(kind.intra, (cbp & (32 >> k)) !== 0)) continue;
          if (k < 4) store(out.y, stride, px + (k & 1) * 8, py + (k >> 1) * 8, !kind.intra);
          else store(k === 4 ? out.cb : out.cr, stride >> 1, px >> 1, py >> 1, !kind.intra);
        }
      }
    }
    this.picture = out;
    if (type !== 2) this.reference = out; // 使い捨てのフレームは、後のフレームから参照されない
    return out;
  }
}

/** 復号したフレーム（Y, Cb, Cr）を RGBA にする。色の変換は ITU-R BT.601（輝度 16〜235）。 */
export function toRGBA(picture) {
  const { width, height, stride, y, cb, cr } = picture;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const luma = 1.164 * (y[py * stride + px] - 16);
      const c = (py >> 1) * (stride >> 1) + (px >> 1);
      const u = cb[c] - 128, v = cr[c] - 128;
      const i = (py * width + px) * 4;
      rgba[i] = luma + 1.596 * v;
      rgba[i + 1] = luma - 0.392 * u - 0.813 * v;
      rgba[i + 2] = luma + 2.017 * u;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}
