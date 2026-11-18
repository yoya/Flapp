// flash.utils.ByteArray と、その圧縮・展開（zlib / deflate）。
//
// 大きさには上限を設ける（1 つあたり MAX_BYTES）。伸ばしたぶんは、スクリプトの割り当ての上限から引く。
// 展開は同期で行う必要があるので、自前の実装（swf/inflate.js の inflateSync）を使う。
// AMF（readObject / writeObject）は未対応。
import { inflateSync } from '../swf/inflate.js';
import { ASObject } from './object.js';

const MAX_BYTES = 1 << 26; // 64 MB

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
      const out = (zlib ? header : str(algorithm) === 'deflate') ? inflateSync(source, zlib ? 2 : 0, MAX_BYTES) : null;
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
