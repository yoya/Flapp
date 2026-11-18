// zlib 展開。出力は limit バイトで打ち切る（展開爆弾への備え）。
import { SWFError } from './reader.js';

/**
 * @param {Uint8Array} data  zlib 形式の圧縮データ
 * @param {number} limit     出力の上限バイト数
 * @returns {Promise<{ bytes: Uint8Array, truncated: boolean }>} truncated は上限で打ち切ったかどうか
 */
export async function inflate(data, limit) {
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  // 書き込み側の失敗は読み取り側のエラーとして現れるので、ここでは握りつぶす。
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});

  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > limit) {
        chunks.push(value.subarray(0, limit - total));
        total = limit;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } catch (e) {
    throw new SWFError(`zlib: ${e.message}`);
  }

  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    bytes.set(c, pos);
    pos += c.length;
  }
  return { bytes, truncated };
}

// --- 同期版の展開（RFC 1951 の deflate）。ByteArray.uncompress や Screen Video のように、その場で結果が要るところで使う。 ---
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// 符号長の並びから、正準ハフマン符号の表（長さごとの個数と、符号順の記号）を作る。
function huffman(lengths) {
  const count = new Uint16Array(16);
  for (const length of lengths) count[length]++;
  count[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + count[i - 1];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((length, symbol) => { if (length) symbols[offsets[length]++] = symbol; });
  return { count, symbols };
}

/**
 * deflate のストリームを展開する（zlib の 2 バイトのヘッダは、呼び出し側が start で読み飛ばす）。
 * @param {Uint8Array} data
 * @param {number} start  deflate のストリームが始まる位置
 * @param {number} limit  出力の上限バイト数（超えたら失敗）
 * @returns {Uint8Array | null} 壊れたデータや上限の超過なら null
 */
export function inflateSync(data, start, limit) {
  let pos = start;
  let hold = 0;
  let held = 0;
  let out = new Uint8Array(Math.min(Math.max(data.length * 3, 1024), limit));
  let size = 0;
  const fail = () => { throw new RangeError('bad deflate data'); };
  const bits = (n) => {
    while (held < n) {
      if (pos >= data.length) fail();
      hold |= data[pos++] << held;
      held += 8;
    }
    const v = hold & ((1 << n) - 1);
    hold >>>= n;
    held -= n;
    return v;
  };
  const decode = (table) => {
    let code = 0, first = 0, index = 0;
    for (let length = 1; length <= 15; length++) {
      code |= bits(1);
      const count = table.count[length];
      if (code - count < first) return table.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return fail();
  };
  const reserve = (n) => {
    if (size + n > limit) fail(); // 展開爆弾への備え
    if (size + n <= out.length) return;
    const bigger = new Uint8Array(Math.min(Math.max(out.length * 2, size + n), limit));
    bigger.set(out.subarray(0, size));
    out = bigger;
  };
  const fixedLengths = new Array(288).fill(8).fill(9, 144, 256).fill(7, 256, 280);
  try {
    for (let last = 0; !last;) {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        hold = held = 0;
        if (pos + 4 > data.length) fail();
        const length = data[pos] | (data[pos + 1] << 8);
        if ((length ^ 0xffff) !== (data[pos + 2] | (data[pos + 3] << 8)) || pos + 4 + length > data.length) fail();
        reserve(length);
        out.set(data.subarray(pos + 4, pos + 4 + length), size);
        size += length;
        pos += 4 + length;
        continue;
      }
      if (type === 3) fail();
      let literals, distances;
      if (type === 1) {
        literals = huffman(fixedLengths);
        distances = huffman(new Array(30).fill(5));
      } else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) fail();
        const codeLengths = new Array(19).fill(0);
        for (let i = 0; i < ncode; i++) codeLengths[CODE_ORDER[i]] = bits(3);
        const codes = huffman(codeLengths);
        const lengths = [];
        while (lengths.length < nlen + ndist) {
          const symbol = decode(codes);
          if (symbol < 16) lengths.push(symbol);
          else {
            if (symbol === 16 && !lengths.length) fail();
            const [value, repeat] = symbol === 16 ? [lengths[lengths.length - 1], 3 + bits(2)] : symbol === 17 ? [0, 3 + bits(3)] : [0, 11 + bits(7)];
            for (let i = 0; i < repeat; i++) lengths.push(value);
          }
        }
        if (lengths.length > nlen + ndist) fail();
        literals = huffman(lengths.slice(0, nlen));
        distances = huffman(lengths.slice(nlen));
      }
      for (;;) {
        const symbol = decode(literals);
        if (symbol === 256) break;
        if (symbol < 256) {
          reserve(1);
          out[size++] = symbol;
          continue;
        }
        if (symbol > 285) fail();
        const length = LENGTH_BASE[symbol - 257] + bits(LENGTH_EXTRA[symbol - 257]);
        const code = decode(distances);
        if (code > 29) fail();
        const distance = DIST_BASE[code] + bits(DIST_EXTRA[code]);
        if (distance > size) fail();
        reserve(length);
        for (let i = 0; i < length; i++, size++) out[size] = out[size - distance];
      }
    }
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  return out.subarray(0, size);
}
