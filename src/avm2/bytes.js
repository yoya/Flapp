// flash.utils.ByteArray と、その圧縮・展開（zlib / deflate）。
//
// 大きさには上限を設ける（1 つあたり MAX_BYTES）。伸ばしたぶんは、スクリプトの割り当ての上限から引く。
// 展開は同期で行う必要があるので、ここに自前の実装を持つ（出力は上限で打ち切る）。
// AMF（readObject / writeObject）は未対応。
import { ASObject } from './object.js';

const MAX_BYTES = 1 << 26; // 64 MB

// --- deflate の展開（RFC 1951）。壊れたデータなら null。 ---
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

function inflateRaw(data, start, limit) {
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

// 圧縮: 無圧縮のブロックに包むだけ（形式としては正しい deflate。実機の出力とはバイト列が違う）。
function deflateStored(bytes) {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(bytes.length + blocks * 5);
  let at = 0;
  for (let i = 0; i < blocks; i++) {
    const part = bytes.subarray(i * 65535, (i + 1) * 65535);
    out.set([i === blocks - 1 ? 1 : 0, part.length & 0xff, part.length >> 8, ~part.length & 0xff, (~part.length >> 8) & 0xff], at);
    out.set(part, at + 5);
    at += 5 + part.length;
  }
  return out;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function installBytes(vm) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const num = (v) => vm.toNumber(v);

  // --- flash.errors ---
  const errorClass = (name, base) => vm.defineClass({
    name: `flash.errors::${name}`, base, dynamic: true,
    construct: (self, args) => vm.call(c.Error.constructorFn, self, args),
  });
  c.IOError = errorClass('IOError', c.Error);
  c.EOFError = errorClass('EOFError', c.IOError);
  c.IllegalOperationError = errorClass('IllegalOperationError', c.Error);
  c.MemoryError = errorClass('MemoryError', c.Error);
  errorClass('InvalidSWFError', c.Error);
  errorClass('StackOverflowError', c.Error);
  errorClass('ScriptTimeoutError', c.Error);

  // --- ByteArray ---
  const B = (self) => self.bytes;
  // 長さを n にする。縮めても中身は消さないので、縮めてから伸ばすと前の中身が見える（実機で確認）。
  const resize = (b, n) => {
    if (n > MAX_BYTES) vm.throwError('MemoryError', 1000, 'The system is out of memory.');
    if (n > b.data.length) {
      const capacity = Math.min(Math.max(n, b.data.length * 2, 64), MAX_BYTES);
      vm.charge((capacity - b.data.length) >> 3);
      const bigger = new Uint8Array(capacity);
      bigger.set(b.data.subarray(0, b.length));
      b.data = bigger;
    }
    b.length = n;
    b.view = null;
  };
  const view = (b) => (b.view ??= new DataView(b.data.buffer));
  // 読み取り: 現在位置から n バイトあることを確かめて、位置を進める。読み始めの位置を返す。
  const take = (b, n) => {
    if (b.position + n > b.length) vm.throwError('EOFError', 2030, 'End of file was encountered.');
    b.position += n;
    return b.position - n;
  };
  // 書き込み: 現在位置から n バイトぶんの場所を用意して、位置を進める。書き始めの位置を返す。
  const room = (b, n) => {
    if (b.position + n > b.length) resize(b, b.position + n);
    b.position += n;
    return b.position - n;
  };
  const put = (b, bytes) => {
    vm.step(bytes.length >> 6);
    const at = room(b, bytes.length); // 場所を取ると data が作り直されることがあるので、先に取る
    b.data.set(bytes, at);
  };
  // 文字列として読むときは、最初の 0 のバイトで終わる（位置は、指定の長さぶん進む。実機で確認）。
  const text = (b, n, charset) => {
    const at = take(b, n);
    const bytes = b.data.subarray(at, at + n);
    const end = bytes.indexOf(0);
    return decode(end < 0 ? bytes : bytes.subarray(0, end), charset);
  };
  const decode = (bytes, charset = 'utf-8') => {
    vm.step(bytes.length >> 4);
    let decoder;
    try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); } // 知らない文字コードは UTF-8 として読む
    return decoder.decode(bytes);
  };
  const encode = (text, charset = 'utf-8') => {
    vm.step(text.length >> 4);
    if (/^(iso-8859-1|latin1|us-ascii|ascii)$/i.test(charset)) return Uint8Array.from(text, (ch) => (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 63));
    return new TextEncoder().encode(text);
  };
  const other = (v, label) => { if (!(v instanceof ASObject) || !v.bytes) vm.throwError('TypeError', 2007, `Parameter ${label} must be non-null.`); return v.bytes; };
  // 数値の読み書き: [名前, バイト数, DataView の読み取り, 書き込み]
  const NUMBERS = [
    ['Byte', 1, 'getInt8', 'setInt8'], ['UnsignedByte', 1, 'getUint8', null], ['Short', 2, 'getInt16', 'setInt16'], ['UnsignedShort', 2, 'getUint16', null],
    ['Int', 4, 'getInt32', 'setInt32'], ['UnsignedInt', 4, 'getUint32', 'setUint32'], ['Float', 4, 'getFloat32', 'setFloat32'], ['Double', 8, 'getFloat64', 'setFloat64'],
  ];
  const methods = {
    readBoolean: (self) => B(self).data[take(B(self), 1)] !== 0,
    writeBoolean: (self, [v]) => { put(B(self), [vm.toBoolean(v) ? 1 : 0]); },
    readUTF: (self) => { const b = B(self); return text(b, view(b).getUint16(take(b, 2), b.little)); },
    readUTFBytes: (self, [length]) => text(B(self), vm.toUint32(length)),
    readMultiByte: (self, [length, charset]) => text(B(self), vm.toUint32(length), str(charset)),
    writeUTF: (self, [v]) => {
      const b = B(self);
      const bytes = encode(str(v));
      if (bytes.length > 65535) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
      const at = room(b, 2);
      view(b).setUint16(at, bytes.length, b.little);
      put(b, bytes);
    },
    writeUTFBytes: (self, [v]) => { put(B(self), encode(str(v))); },
    writeMultiByte: (self, [v, charset]) => { put(B(self), encode(str(v), str(charset))); },
    // readBytes(読み込み先, 先の位置, 長さ): 長さ 0 は「残り全部」。
    readBytes: (self, [target, offset = 0, length = 0]) => {
      const b = B(self);
      const to = other(target, 'bytes');
      const n = vm.toUint32(length) || Math.max(0, b.length - b.position);
      const at = take(b, n);
      const chunk = b.data.slice(at, at + n); // 先に写しを取る（読み込み先が自分自身でもよいように）
      const start = vm.toUint32(offset);
      if (start + n > to.length) resize(to, start + n);
      vm.step(n >> 6);
      to.data.set(chunk, start);
    },
    // writeBytes(元, 元の位置, 長さ): 長さ 0 は「元の位置から最後まで」。
    writeBytes: (self, [source, offset = 0, length = 0]) => {
      const from = other(source, 'bytes');
      const start = vm.toUint32(offset);
      const n = vm.toUint32(length) || Math.max(0, from.length - start);
      if (start + n > from.length) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
      put(B(self), from.data.slice(start, start + n));
    },
    clear: (self) => { Object.assign(B(self), { data: new Uint8Array(0), length: 0, position: 0, view: null }); },
    toString: (self) => { const b = B(self); return decode(b.data.subarray(0, b.length)); },
    // 圧縮と展開。失敗したら IOError で、中身は変わらない。
    // 空のものは、どちらも何もしない。
    compress: (self, [algorithm = 'zlib']) => {
      const b = B(self);
      if (!b.length) return;
      const raw = b.data.slice(0, b.length);
      vm.step(raw.length >> 4);
      const body = deflateStored(raw);
      let out = body;
      if (str(algorithm) === 'zlib') {
        out = new Uint8Array(body.length + 6);
        out.set([0x78, 0x01]);
        out.set(body, 2);
        new DataView(out.buffer).setUint32(body.length + 2, adler32(raw));
      } else if (str(algorithm) !== 'deflate') vm.throwError('IOError', 2058, 'There was an error decompressing the data.');
      resize(b, 0);
      resize(b, out.length);
      b.data.set(out);
      b.position = out.length;
    },
    uncompress: (self, [algorithm = 'zlib']) => {
      const b = B(self);
      if (!b.length) return;
      const zlib = str(algorithm) === 'zlib';
      const source = b.data.subarray(0, b.length);
      vm.step(source.length >> 2);
      const header = zlib && source.length >= 2 && (source[0] & 15) === 8 && ((source[0] << 8) | source[1]) % 31 === 0 && !(source[1] & 32);
      const out = (zlib ? header : str(algorithm) === 'deflate') ? inflateRaw(source, zlib ? 2 : 0, MAX_BYTES) : null;
      if (!out) vm.throwError('IOError', 2058, 'There was an error decompressing the data.');
      vm.step(out.length >> 4);
      const copy = out.slice();
      resize(b, 0);
      resize(b, copy.length);
      b.data.set(copy);
      b.position = 0;
    },
  };
  methods.deflate = (self) => methods.compress(self, ['deflate']);
  methods.inflate = (self) => methods.uncompress(self, ['deflate']);
  for (const [name, size, get, set] of NUMBERS) {
    methods[`read${name}`] = (self) => { const b = B(self); return view(b)[get](take(b, size), b.little); };
    if (set) methods[`write${name}`] = (self, [v]) => { const b = B(self); const at = room(b, size); view(b)[set](at, size === 8 || name === 'Float' ? num(v) : vm.toInt32(v), b.little); };
  }
  const input = vm.defineClass({ name: 'flash.utils::IDataInput', base: null, isInterface: true });
  const output = vm.defineClass({ name: 'flash.utils::IDataOutput', base: null, isInterface: true });
  c.ByteArray = vm.defineClass({
    name: 'flash.utils::ByteArray', interfaces: [input, output],
    allocate: (klass) => Object.assign(new ASObject(klass), { bytes: { data: new Uint8Array(0), length: 0, position: 0, little: false, view: null } }),
    construct: () => {},
    getters: {
      length: (self) => B(self).length, position: (self) => B(self).position, bytesAvailable: (self) => Math.max(0, B(self).length - B(self).position),
      endian: (self) => (B(self).little ? 'littleEndian' : 'bigEndian'), objectEncoding: () => 3,
    },
    setters: {
      length: (self, v) => { const b = B(self); resize(b, vm.toUint32(v)); b.position = Math.min(b.position, b.length); },
      position: (self, v) => { B(self).position = vm.toUint32(v); },
      endian: (self, v) => {
        if (str(v) !== 'littleEndian' && str(v) !== 'bigEndian') vm.throwError('ArgumentError', 2008, 'Parameter type must be one of the accepted values.');
        B(self).little = str(v) === 'littleEndian';
      },
      objectEncoding: () => {},
    },
    methods,
    staticValues: { defaultObjectEncoding: 3 },
  });
  // bytes[i] の読み書き（vm.js から呼ばれる）。範囲外への書き込みは、そこまで伸ばす。
  vm.byteAt = (obj, i) => (i < obj.bytes.length ? obj.bytes.data[i] : undefined);
  vm.setByteAt = (obj, i, v) => {
    const b = obj.bytes;
    if (i >= b.length) resize(b, i + 1);
    b.data[i] = vm.toInt32(v);
  };
  vm.defineClass({ name: 'flash.utils::Endian', final: true, staticValues: { BIG_ENDIAN: 'bigEndian', LITTLE_ENDIAN: 'littleEndian' } });
}
