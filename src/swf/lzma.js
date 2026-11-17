// LZMA デコーダ（ZWS 用）。7-Zip の LZMA 仕様書（lzma-specification、パブリックドメイン）の
// 参照デコーダと同じ手順。出力長が既知なので、辞書は出力バッファそのものを使う。
import { SWFError } from './reader.js';

const NUM_POS_BITS_MAX = 4;
const NUM_STATES = 12;
const NUM_ALIGN_BITS = 4;
const END_POS_MODEL_INDEX = 14;
const NUM_FULL_DISTANCES = 1 << (END_POS_MODEL_INDEX >>> 1);
const MATCH_MIN_LEN = 2;
const TOP_VALUE = 1 << 24;

const probs = (n) => new Uint16Array(n).fill(1024);
const trees = (count, bits) => Array.from({ length: count }, () => probs(1 << bits));
const lenDecoder = () => ({
  choice: probs(2),
  low: trees(1 << NUM_POS_BITS_MAX, 3),
  mid: trees(1 << NUM_POS_BITS_MAX, 3),
  high: probs(1 << 8),
});

/**
 * @param {Uint8Array} props   LZMA プロパティ 5 バイト（lc/lp/pb と辞書サイズ）
 * @param {Uint8Array} data    圧縮データ
 * @param {number} outSize     展開後のバイト数。ここまで出力したら終了し、それ以上は読まない
 * @returns {Uint8Array}       展開結果（終端マーカーで早く終わった場合は outSize より短い）
 */
export function lzmaDecode(props, data, outSize) {
  const corrupt = (why) => new SWFError(`LZMA: ${why}`);
  if (props.length < 5) throw corrupt('properties too short');
  let d = props[0];
  if (d >= 9 * 5 * 5) throw corrupt('invalid properties');
  const lc = d % 9;
  d = (d - lc) / 9;
  const lp = d % 5;
  const pb = (d - lp) / 5;
  const dictSize = Math.max(4096, (props[1] | (props[2] << 8) | (props[3] << 16) | (props[4] << 24)) >>> 0);

  // --- レンジデコーダ ---
  let inPos = 0;
  const readByte = () => {
    if (inPos >= data.length) throw corrupt('unexpected end of data');
    return data[inPos++];
  };
  let range = 0xffffffff;
  let code = 0;
  if (readByte() !== 0) throw corrupt('bad first byte');
  for (let i = 0; i < 4; i++) code = ((code << 8) | readByte()) >>> 0;
  if (code === range) throw corrupt('bad initial code');

  const normalize = () => {
    if (range < TOP_VALUE) {
      range = (range << 8) >>> 0;
      code = ((code << 8) | readByte()) >>> 0;
    }
  };
  const decodeBit = (p, i) => {
    const v = p[i];
    const bound = (range >>> 11) * v;
    let bit;
    if (code < bound) {
      p[i] = v + ((2048 - v) >> 5);
      range = bound;
      bit = 0;
    } else {
      p[i] = v - (v >> 5);
      code -= bound;
      range -= bound;
      bit = 1;
    }
    normalize();
    return bit;
  };
  const decodeDirectBits = (n) => {
    let res = 0;
    for (; n > 0; n--) {
      range >>>= 1;
      code = (code - range) >>> 0;
      const t = 0 - (code >>> 31); // 引きすぎたら -1
      code = (code + (range & t)) >>> 0;
      if (code === range) throw corrupt('bad direct bits');
      normalize();
      res = res * 2 + t + 1;
    }
    return res;
  };
  const decodeTree = (p, bits) => {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) + decodeBit(p, m);
    return m - (1 << bits);
  };
  const decodeReverse = (p, offset, bits) => {
    let m = 1;
    let sym = 0;
    for (let i = 0; i < bits; i++) {
      const bit = decodeBit(p, offset + m);
      m = (m << 1) + bit;
      sym |= bit << i;
    }
    return sym;
  };
  const decodeLen = (ld, posState) => {
    if (decodeBit(ld.choice, 0) === 0) return decodeTree(ld.low[posState], 3);
    if (decodeBit(ld.choice, 1) === 0) return 8 + decodeTree(ld.mid[posState], 3);
    return 16 + decodeTree(ld.high, 8);
  };

  // --- 確率モデル ---
  const litProbs = probs(0x300 << (lc + lp));
  const isMatch = probs(NUM_STATES << NUM_POS_BITS_MAX);
  const isRep = probs(NUM_STATES);
  const isRepG0 = probs(NUM_STATES);
  const isRepG1 = probs(NUM_STATES);
  const isRepG2 = probs(NUM_STATES);
  const isRep0Long = probs(NUM_STATES << NUM_POS_BITS_MAX);
  const posSlot = trees(4, 6);
  const posDecoders = probs(1 + NUM_FULL_DISTANCES - END_POS_MODEL_INDEX);
  const alignDecoder = probs(1 << NUM_ALIGN_BITS);
  const lenDec = lenDecoder();
  const repLenDec = lenDecoder();

  const decodeDistance = (len) => {
    const slot = decodeTree(posSlot[Math.min(len, 3)], 6);
    if (slot < 4) return slot;
    const directBits = (slot >> 1) - 1;
    let dist = (2 | (slot & 1)) * 2 ** directBits; // 最大 0xFFFFFFFF になるので倍精度で持つ
    if (slot < END_POS_MODEL_INDEX) {
      dist += decodeReverse(posDecoders, dist - slot, directBits);
    } else {
      dist += decodeDirectBits(directBits - NUM_ALIGN_BITS) * (1 << NUM_ALIGN_BITS);
      dist += decodeReverse(alignDecoder, 0, NUM_ALIGN_BITS);
    }
    return dist;
  };

  // --- 本体 ---
  const out = new Uint8Array(outSize);
  let pos = 0;
  let rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
  let state = 0;
  const posMask = (1 << pb) - 1;
  const lpMask = (1 << lp) - 1;

  for (;;) {
    // 必要な長さが揃ったら終わる。終端マーカーの有無は問わない（後続のデータは読まない）。
    if (pos === outSize) break;

    const posState = pos & posMask;
    if (decodeBit(isMatch, (state << NUM_POS_BITS_MAX) + posState) === 0) {
      // リテラル
      const prev = pos > 0 ? out[pos - 1] : 0;
      const base = 0x300 * (((pos & lpMask) << lc) + (prev >>> (8 - lc)));
      let symbol = 1;
      if (state >= 7) {
        if (rep0 >= pos) throw corrupt('bad distance');
        let matchByte = out[pos - rep0 - 1];
        do {
          const matchBit = (matchByte >> 7) & 1;
          matchByte <<= 1;
          const bit = decodeBit(litProbs, base + ((1 + matchBit) << 8) + symbol);
          symbol = (symbol << 1) | bit;
          if (matchBit !== bit) break;
        } while (symbol < 0x100);
      }
      while (symbol < 0x100) symbol = (symbol << 1) | decodeBit(litProbs, base + symbol);
      out[pos++] = symbol - 0x100;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }

    let len;
    if (decodeBit(isRep, state) !== 0) {
      // 直近の距離を再利用
      if (pos === 0) throw corrupt('repeat at start');
      if (decodeBit(isRepG0, state) === 0) {
        if (decodeBit(isRep0Long, (state << NUM_POS_BITS_MAX) + posState) === 0) {
          if (rep0 >= pos) throw corrupt('bad distance');
          state = state < 7 ? 9 : 11;
          out[pos] = out[pos - rep0 - 1];
          pos++;
          continue;
        }
      } else {
        let dist;
        if (decodeBit(isRepG1, state) === 0) {
          dist = rep1;
        } else {
          if (decodeBit(isRepG2, state) === 0) {
            dist = rep2;
          } else {
            dist = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = dist;
      }
      len = decodeLen(repLenDec, posState);
      state = state < 7 ? 8 : 11;
    } else {
      // 新しい距離
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = decodeLen(lenDec, posState);
      state = state < 7 ? 7 : 10;
      rep0 = decodeDistance(len);
      if (rep0 === 0xffffffff) {
        if (code !== 0) throw corrupt('bad end marker');
        break; // 終端マーカー
      }
    }
    if (rep0 >= dictSize || rep0 >= pos) throw corrupt('bad distance');

    len = Math.min(len + MATCH_MIN_LEN, outSize - pos); // 宣言された長さを超える分は書かない
    for (; len > 0; len--, pos++) out[pos] = out[pos - rep0 - 1]; // 重なりがあるので 1 バイトずつ
  }

  return pos === outSize ? out : out.subarray(0, pos);
}
