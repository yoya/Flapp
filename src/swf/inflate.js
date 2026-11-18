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
