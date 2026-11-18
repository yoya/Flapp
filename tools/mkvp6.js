// SPDX-License-Identifier: LGPL-2.1-or-later
// VP6 のテスト用の素材（tools/assets/video-vp6.flv と video-vp6a.flv）を作る。
//
//   node tools/mkvp6.js
//
// コミットできる VP6 の素材が無い（ffmpeg に VP6 のエンコーダは無く、世の中のサンプルは他人の著作物）ので、ここで作る。
// 絵に意味は無い（乱数で決めた係数と動きベクトル）。狙いは、復号器のいろいろな経路を通ること:
// キーフレームと差分フレーム、マクロブロックの種類のすべて、端数のあるベクトルと絵の外を指すベクトル、ゴールデンフレーム、
// ブロックの境目のフィルタ、補間のフィルタの切り替え、確率のモデルと係数の順序の更新、大きな係数と長い 0 の連続。
// ハフマン符号の係数と、係数を別の区画に分ける形は作らない。
//
// 作り方: 復号器（src/video/vp6.js）は、レンジ符号から「この確率で 1 ビット読む」を繰り返して構文を読み進める。
// そこで、復号器のレンジ符号を「次に読ませたいビットを返して、同じ確率で符号化する」ものに差し替えて、復号器を 1 回走らせる。
// 確率のモデルや前後の文脈は復号器が持っているので、ここには「どのビットをどの順に読ませるか」（構文）だけを書けばよい。
// このファイルは復号器の内部に寄りかかっているので、復号器と同じ LGPL にしている。
//
// 復号の正しさは、作ったストリームを ffmpeg で復号した結果（下のコマンド）と比べて確かめる（test/video.test.js）:
//   ffmpeg -i video-vp6.flv  -fps_mode passthrough -f rawvideo -pix_fmt yuv420p  video-vp6.yuv;   gzip -9n video-vp6.yuv
//   ffmpeg -i video-vp6a.flv -fps_mode passthrough -f rawvideo -pix_fmt yuva420p video-vp6a.yuva; gzip -9n video-vp6a.yuva
import { writeFileSync } from 'node:fs';
import { VP6Decoder, internals } from '../src/video/vp6.js';

const { RangeDecoder, PVA_TREE, PC_TREE, PCR_TREE, PMBT_TREE } = internals;

const COLS = 4, ROWS = 3; // マクロブロックの数（64×48 px）
const ADJUST = 0x24; // 表示するのは、右を 2 px、下を 4 px 削った 62×44 px
const QUANTIZER = 44;
const INTER_NOVEC_PF = 0, INTRA = 1, INTER_DELTA_PF = 2, INTER_V1_PF = 3, INTER_V2_PF = 4,
  INTER_NOVEC_GF = 5, INTER_DELTA_GF = 6, INTER_4V = 7, INTER_V1_GF = 8, INTER_V2_GF = 9;

/** レンジ符号の符号化（復号器の RangeDecoder の逆。VP8 の bool encoder と同じ算術符号）。 */
class RangeEncoder {
  constructor() {
    this.low = 0;
    this.range = 255;
    this.count = -24;
    this.out = [];
  }

  put(bit, prob) {
    const split = 1 + (((this.range - 1) * prob) >> 8);
    let low = this.low, range = split;
    if (bit) {
      low += split;
      range = this.range - split;
    }
    let shift = Math.clz32(range) - 24;
    range <<= shift;
    this.count += shift;
    if (this.count >= 0) {
      const offset = shift - this.count;
      if ((low * 2 ** (offset - 1)) >= 2 ** 31) {
        // 繰り上がり
        let x = this.out.length - 1;
        while (x >= 0 && this.out[x] === 0xff) this.out[x--] = 0;
        this.out[x]++;
      }
      this.out.push((low >>> (24 - offset)) & 0xff);
      low = (low << offset) & 0xffffff;
      shift = this.count;
      this.count -= 8;
    }
    this.low = (low << shift) >>> 0;
    this.range = range;
  }

  finish() {
    for (let i = 0; i < 32; i++) this.put(0, 128);
    return this.out;
  }
}

// ---- 構文: 復号器に読ませるビットの列を作る ----

const bits = (d, value, n) => { for (let i = n - 1; i >= 0; i--) d.push((value >> i) & 1); };
const zeros = (d, n) => { for (let i = 0; i < n; i++) d.push(0); };

// 木（[進む数, 確率の番号] の並び）の中で、値 value の葉に着くまでのビットの列。
function treePath(tree, value) {
  const walk = (at, path) => {
    if (tree[at] <= 0) return -tree[at] === value ? path : null;
    return walk(at + 2, [...path, 0]) ?? walk(at + tree[at] * 2, [...path, 1]);
  };
  return walk(0, []);
}

// 5 以上の係数の、値の範囲ごとの [最小値, 続くビット数]
const CATEGORIES = [[5, 1], [7, 2], [11, 3], [19, 4], [35, 5], [67, 11]];

// 1 ブロックぶんの係数（読む順に並べた 64 個。量子化を戻す前の値）。
function block(d, coeffs) {
  let last = 63;
  while (last >= 0 && !coeffs[last]) last--;
  let idx = 0, ct = 1;
  while (idx < 64) {
    const v = coeffs[idx];
    if (v) {
      if (!(idx > 1 && ct === 0)) d.push(1); // 0 の連続の直後は、係数があるものとして読まれる
      const abs = Math.abs(v);
      if (abs === 1) {
        d.push(0);
        ct = 1;
      } else {
        d.push(1);
        if (abs === 2) d.push(0, 0);
        else if (abs <= 4) d.push(0, 1, abs - 3);
        else {
          const category = CATEGORIES.findLastIndex(([min]) => abs >= min);
          d.push(1, ...treePath(PC_TREE, category));
          bits(d, abs - CATEGORIES[category][0], CATEGORIES[category][1]);
        }
        ct = 2;
      }
      d.push(v < 0 ? 1 : 0);
      idx++;
    } else {
      d.push(0);
      ct = 0;
      if (idx === 0) {
        idx++;
        continue;
      }
      if (idx > last) {
        d.push(0); // ブロックの終わり
        return;
      }
      d.push(1);
      let run = 0;
      while (!coeffs[idx + run]) run++;
      if (run <= 8) d.push(...treePath(PCR_TREE, run));
      else {
        d.push(...treePath(PCR_TREE, 0));
        for (let i = 0; i < 6; i++) d.push(((run - 9) >> i) & 1);
      }
      idx += run;
    }
  }
}

// 動きベクトルの差分（1/4 画素単位）。
function vector(d, dx, dy) {
  for (const delta of [dx, dy]) {
    const abs = Math.abs(delta);
    if (abs < 8) d.push(0, ...treePath(PVA_TREE, abs));
    else {
      d.push(1);
      for (const j of [0, 1, 2, 7, 6, 5, 4]) d.push((abs >> j) & 1);
      if (abs & 0xf0) d.push((abs >> 3) & 1);
      else if (!(abs & 8)) throw new Error(`vector delta ${delta} cannot be coded`);
    }
    if (abs) d.push(delta < 0 ? 1 : 0);
  }
}

// 確率のモデルの「更新しない」の並び。update に { 何番目: 新しい値（7 ビット） } を渡すと、そこだけ更新する。
function models(d, count, update = {}) {
  for (let i = 0; i < count; i++) {
    if (i in update) {
      d.push(1);
      bits(d, update[i], 7);
    } else d.push(0);
  }
}

// 係数のモデル（DC の値、係数の順序、0 の連続、AC）。
function coeffModels(d, { dccv, reorder, runv, ract } = {}) {
  models(d, 22, dccv);
  if (reorder) {
    d.push(1);
    for (let pos = 1; pos < 64; pos++) {
      if (pos in reorder) {
        d.push(1);
        bits(d, reorder[pos], 4);
      } else d.push(0);
    }
  } else d.push(0);
  models(d, 28, runv);
  models(d, 396, ract);
}

// 補間のフィルタの指定。mode 2 は、分散としきい値・ベクトルの長さで 4 タップと双一次を切り替える。
function filterInfo(d, { mode, variance = 0, maxVector = 0, selection }) {
  if (mode === 2) {
    d.push(1);
    bits(d, variance, 5);
    bits(d, maxVector, 3);
  } else d.push(0, mode);
  bits(d, selection, 4);
}

// ---- 中身: 乱数で決める ----

function random(seed) {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 10) % n;
  };
}

function coefficients(rnd, rich, dc) {
  const c = new Array(64).fill(0);
  c[0] = dc;
  if (rich) {
    for (let k = rnd(4); k > 0; k--) c[1 + rnd(9)] = rnd(9) - 4;
    if (rnd(4) === 0) c[10 + rnd(54)] = rnd(2) ? 1 : -1; // 遠い係数（全体の逆 DCT と、長い 0 の連続）
    if (rnd(5) === 0) c[1 + rnd(3)] = (rnd(2) ? 1 : -1) * (5 + rnd(80)); // 大きな係数
  }
  return c;
}

// DC は、周りのブロックからの予測との差で送る。差を乱数のまま積み上げると、すぐに白や黒に張り付いてしまうので、
// 積み上げた値（state。フレームごとに、面の種類と、絵そのものか差分かで分ける）が limit を超えないように決める。
function dcDelta(rnd, state, key, limit) {
  let delta = rnd(5) - 2;
  if (Math.abs((state[key] ?? 0) + delta) > limit) delta = -delta;
  state[key] = (state[key] ?? 0) + delta;
  return delta;
}

// マクロブロックの 6 つのブロック。intra は、絵そのもの（参照する絵との差分でない）か。
function macroblock(d, rnd, intra, state) {
  for (let b = 0; b < 6; b++) {
    const chroma = b >= 4;
    let dc = intra ? dcDelta(rnd, state, chroma ? `c${b}` : 'y', 5) : dcDelta(rnd, state, chroma ? `rc${b}` : 'ry', 1);
    // フレームで最初の、絵そのものの色差のブロックは、予測が 128 から始まる。打ち消して、中間の色から始める。
    if (intra && chroma && !state[`first${b}`]) {
      state[`first${b}`] = true;
      dc -= 128;
    }
    block(d, coefficients(rnd, intra || rnd(3) === 0, dc));
  }
}

const frame = (key) => [(key ? 0 : 0x80) | (QUANTIZER << 1)];

// キーフレーム。見出しは、Flash のエンコーダが作るものと同じ形（サブバージョン 8、係数は見出しと同じ区画）。
function keyFrame(rnd, options) {
  const header = [...frame(true), (8 << 3) | 6, ROWS, COLS, ROWS, COLS];
  const d = [];
  bits(d, 0, 2);
  filterInfo(d, options.filter);
  d.push(0); // ハフマン符号を使わない
  coeffModels(d, options.models);
  const state = {};
  for (let n = 0; n < ROWS * COLS; n++) macroblock(d, rnd, true, state);
  return { header, decisions: d };
}

// 差分フレーム。types は、マクロブロックの種類の並び（足りなければ繰り返す）。
function interFrame(rnd, { golden = 0, deblock = 0, filter = null, models: update, types }) {
  const d = [golden, deblock];
  if (deblock) d.push(0);
  if (filter) {
    d.push(1);
    filterInfo(d, filter);
  } else d.push(0);
  d.push(0); // ハフマン符号を使わない
  zeros(d, 6); // マクロブロックの種類のモデルは、そのまま
  models(d, 4 + 14 + 16); // ベクトルのモデルも、そのまま
  coeffModels(d, update);
  let previous = INTER_NOVEC_PF;
  const state = {};
  const delta = () => vector(d, rnd(61) - 30, rnd(61) - 30);
  for (let n = 0; n < ROWS * COLS; n++) {
    const type = types[n % types.length];
    if (type === previous) d.push(1);
    else d.push(0, ...treePath(PMBT_TREE, type));
    previous = type;
    if (type === INTER_DELTA_PF || type === INTER_DELTA_GF) delta();
    else if (type === INTER_4V) {
      // ブロックごとに: ベクトル無し、差分、候補 1、候補 2
      const kinds = [0, 1, 2, 3].map(() => rnd(4));
      for (const kind of kinds) bits(d, kind, 2);
      for (const kind of kinds) if (kind === 1) delta();
    }
    macroblock(d, rnd, type === INTRA, state);
  }
  return { header: frame(false), decisions: d };
}

function script(seed) {
  const rnd = random(seed);
  return [
    keyFrame(rnd, { filter: { mode: 2, variance: 2, maxVector: 3, selection: 5 }, models: { dccv: { 0: 100, 13: 70 } } }),
    interFrame(rnd, { types: [INTER_NOVEC_PF, INTER_DELTA_PF, INTER_DELTA_PF, INTRA, INTER_4V, INTER_V1_PF, INTER_V2_PF, INTER_DELTA_PF, INTER_NOVEC_PF, INTER_NOVEC_PF, INTER_4V, INTER_DELTA_PF] }),
    interFrame(rnd, { golden: 1, deblock: 1, models: { ract: { 5: 90, 200: 40 }, runv: { 3: 60 } }, types: [INTER_DELTA_PF, INTER_V1_PF, INTER_DELTA_PF, INTER_V2_PF, INTER_4V] }),
    interFrame(rnd, { deblock: 1, filter: { mode: 0, selection: 0 }, types: [INTER_NOVEC_GF, INTER_DELTA_GF, INTER_V1_GF, INTER_DELTA_PF, INTER_V2_GF, INTER_DELTA_GF, INTRA] }),
    keyFrame(rnd, { filter: { mode: 1, selection: 9 }, models: { reorder: { 1: 3, 7: 0, 20: 1 } } }),
    interFrame(rnd, { types: [INTER_DELTA_PF, INTER_4V, INTER_DELTA_PF, INTER_NOVEC_PF] }),
    interFrame(rnd, { deblock: 1, filter: { mode: 2, variance: 0, maxVector: 7, selection: 12 }, models: { reorder: { 2: 5 } }, types: [INTER_DELTA_PF, INTER_DELTA_GF, INTER_4V] }),
    interFrame(rnd, { golden: 1, types: [INTER_NOVEC_PF, INTER_DELTA_PF, INTER_NOVEC_GF, INTER_V1_PF] }),
  ];
}

// ---- 符号化: 復号器に、用意したビットを読ませる ----

function encode(context, { header, decisions }) {
  const encoder = new RangeEncoder();
  let at = 0;
  const next = (prob) => {
    if (at >= decisions.length) throw new Error('the decoder reads more than the script has');
    const bit = decisions[at++];
    encoder.put(bit, prob);
    return bit;
  };
  const proto = RangeDecoder.prototype, { getProb, get } = proto;
  proto.getProb = next;
  proto.get = () => next(128);
  try {
    context.decodeFrame(Uint8Array.from([...header, 0, 0, 0]), 0, header.length + 3);
  } finally {
    Object.assign(proto, { getProb, get });
  }
  if (at !== decisions.length) throw new Error(`the decoder left ${decisions.length - at} of ${decisions.length} decisions unread`);
  return [...header, ...encoder.finish()];
}

const u24 = (v) => [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
const u32 = (v) => [v >>> 24, ...u24(v)];

// ビデオだけの FLV（12 フレーム毎秒）。
function flv(codec, packets) {
  const out = [0x46, 0x4c, 0x56, 1, 1, ...u32(9), ...u32(0)];
  packets.forEach(({ key, data }, n) => {
    const body = [(key ? 0x10 : 0x20) | codec, ADJUST, ...data];
    out.push(9, ...u24(body.length), ...u24(Math.round((n * 1000) / 12)), 0, ...u24(0), ...body, ...u32(11 + body.length));
  });
  return Uint8Array.from(out);
}

const colour = new VP6Decoder().color;
const colourFrames = script(2024).map((f) => ({ key: !(f.header[0] & 0x80), data: encode(colour, f) }));
const alpha = new VP6Decoder(true).alpha;
const alphaFrames = script(77).map((f) => encode(alpha, f));

const files = {
  'video-vp6.flv': flv(4, colourFrames),
  // アルファ付き: 色のデータの長さ（3 バイト）、色のデータ、アルファのデータ
  'video-vp6a.flv': flv(5, colourFrames.map(({ key, data }, n) => ({ key, data: [...u24(data.length), ...data, ...alphaFrames[n]] }))),
};

// 作ったストリームを、手を加えていない復号器で読めることを確かめてから書き出す。
for (const [decoder, frames] of [[new VP6Decoder(), colourFrames.map((f) => f.data)], [new VP6Decoder(), alphaFrames]]) {
  for (const data of frames) decoder.decode(Uint8Array.from(data));
}
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(new URL(`assets/${name}`, import.meta.url), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
