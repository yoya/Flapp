// SWF の基本データ型の読み取り（仕様 1 章）。入力は信頼できないものとして、範囲外の読み取りは必ず例外にする。

export class SWFError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SWFError';
  }
}

export class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0; // 次に読むバイト位置
    this.bit = 0; // そのバイトの中で消費済みのビット数 (0〜7)
  }

  /** バイト境界に揃えたときの残りバイト数。 */
  get remaining() {
    return this.bytes.length - this.pos - (this.bit ? 1 : 0);
  }

  /** ビット値の読みかけを捨ててバイト境界に揃える。 */
  align() {
    if (this.bit) {
      this.bit = 0;
      this.pos++;
    }
  }

  // 整数型は常にバイト境界から始まる。n バイト確保して先頭位置を返す。
  #take(n) {
    this.align();
    if (!Number.isInteger(n) || n < 0 || n > this.bytes.length - this.pos) {
      throw new SWFError(`cannot read ${n} bytes at offset ${this.pos} (size ${this.bytes.length})`);
    }
    const p = this.pos;
    this.pos += n;
    return p;
  }

  u8() { return this.bytes[this.#take(1)]; }
  u16() { return this.view.getUint16(this.#take(2), true); }
  u32() { return this.view.getUint32(this.#take(4), true); }
  s8() { return this.view.getInt8(this.#take(1)); }
  s16() { return this.view.getInt16(this.#take(2), true); }
  s32() { return this.view.getInt32(this.#take(4), true); }

  /** FIXED: 16.16 固定小数。 */
  fixed() { return this.s32() / 65536; }
  /** FIXED8: 8.8 固定小数。 */
  fixed8() { return this.s16() / 256; }

  /** n バイトの部分ビュー（コピーしない）。 */
  bytesView(n) {
    const p = this.#take(n);
    return this.bytes.subarray(p, p + n);
  }

  /** EncodedU32: 1〜5 バイトの可変長符号なし整数。 */
  encodedU32() {
    let v = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = this.u8();
      v = (v | ((b & 0x7f) << shift)) >>> 0;
      if (!(b & 0x80)) break;
    }
    return v;
  }

  /** UB[n]: 符号なしビット値。上位ビットから順に並ぶ。 */
  ub(n) {
    if (!Number.isInteger(n) || n < 0 || n > 32) throw new SWFError(`invalid bit count ${n}`);
    let v = 0;
    while (n > 0) {
      if (this.pos >= this.bytes.length) {
        throw new SWFError(`cannot read bits at offset ${this.pos} (size ${this.bytes.length})`);
      }
      const avail = 8 - this.bit;
      const take = Math.min(avail, n);
      const chunk = (this.bytes[this.pos] >> (avail - take)) & ((1 << take) - 1);
      v = v * (1 << take) + chunk; // 32 ビットで符号が立たないよう乗算で積む
      this.bit += take;
      if (this.bit === 8) {
        this.bit = 0;
        this.pos++;
      }
      n -= take;
    }
    return v;
  }

  /** SB[n]: 符号付きビット値（最上位ビットを符号拡張）。 */
  sb(n) {
    const v = this.ub(n);
    return n > 0 && v >= 2 ** (n - 1) ? v - 2 ** n : v;
  }

  /** FB[n]: 16.16 固定小数のビット値。 */
  fb(n) { return this.sb(n) / 65536; }

  /** RECT。単位は twips。 */
  rect() {
    this.align();
    const nbits = this.ub(5);
    const xmin = this.sb(nbits);
    const xmax = this.sb(nbits);
    const ymin = this.sb(nbits);
    const ymax = this.sb(nbits);
    this.align();
    return { xmin, xmax, ymin, ymax };
  }
}
