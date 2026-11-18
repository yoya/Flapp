// ABC ファイル（ActionScript 3 のバイトコード）の解析。仕様: docs/avm2overview.pdf 4 章。
//
// 入力は信用しない。個数はすべて残りバイト数で頭打ちにし、定数プールなどへの添字は範囲を確かめてから使う
// （範囲外の添字は、ここでは検査せず、参照する側が undefined として扱う）。

export class ABCError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ABCError';
  }
}

class ABCReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }

  need(n) {
    if (n < 0 || this.pos + n > this.bytes.length) throw new ABCError(`unexpected end of ABC data at offset ${this.pos}`);
  }

  u8() {
    this.need(1);
    return this.bytes[this.pos++];
  }

  u16() {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  d64() {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  // 可変長の 32 ビット整数（1〜5 バイト、下位 7 ビットずつ）。
  u32() {
    let v = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = this.u8();
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
    }
    return v >>> 0;
  }

  u30() {
    return this.u32() & 0x3fffffff;
  }

  s32() {
    return this.u32() | 0;
  }

  // 個数。1 要素が最低 min バイトを占めるので、残りバイト数を超える個数は壊れたデータ。
  count(min = 1) {
    const n = this.u30();
    if (n * min > this.bytes.length - this.pos) throw new ABCError(`count ${n} at offset ${this.pos} exceeds the remaining data`);
    return n;
  }

  bytesView(n) {
    this.need(n);
    const v = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
}

/** 名前空間の種類。 */
export const NS_KIND = { 0x08: 'namespace', 0x16: 'package', 0x17: 'packageInternal', 0x18: 'protected', 0x19: 'explicit', 0x1a: 'staticProtected', 0x05: 'private' };
const MULTINAME_KIND = {
  0x07: 'QName', 0x0d: 'QNameA', 0x0f: 'RTQName', 0x10: 'RTQNameA', 0x11: 'RTQNameL', 0x12: 'RTQNameLA',
  0x09: 'Multiname', 0x0e: 'MultinameA', 0x1b: 'MultinameL', 0x1c: 'MultinameLA', 0x1d: 'TypeName',
};
const TRAIT_KIND = ['slot', 'method', 'getter', 'setter', 'class', 'function', 'const'];

// 定数プールの値の種類（既定値や定数スロットの値）→ 値。
function constantValue(abc, kind, index) {
  switch (kind) {
    case 0x00: return undefined;
    case 0x01: return abc.strings[index];
    case 0x03: return abc.ints[index];
    case 0x04: return abc.uints[index];
    case 0x06: return abc.doubles[index];
    case 0x0a: return false;
    case 0x0b: return true;
    case 0x0c: return null;
    default: return abc.namespaces[index] !== undefined && NS_KIND[kind] ? abc.namespaces[index] : undefined; // 名前空間
  }
}

function traits(r, abc) {
  const list = [];
  for (let n = r.count(2); n > 0; n--) {
    const name = r.u30();
    const tag = r.u8();
    const kind = TRAIT_KIND[tag & 0x0f];
    if (!kind) throw new ABCError(`unknown trait kind ${tag & 0x0f}`);
    const trait = { name, kind, final: (tag & 0x10) !== 0, override: (tag & 0x20) !== 0 };
    if (kind === 'slot' || kind === 'const') {
      trait.slotId = r.u30();
      trait.typeName = r.u30();
      const vindex = r.u30();
      trait.value = vindex === 0 ? undefined : constantValue(abc, r.u8(), vindex);
      trait.hasValue = vindex !== 0;
    } else if (kind === 'class') {
      trait.slotId = r.u30();
      trait.classIndex = r.u30();
    } else if (kind === 'function') {
      trait.slotId = r.u30();
      trait.method = r.u30();
    } else {
      trait.dispId = r.u30();
      trait.method = r.u30();
    }
    if (tag & 0x40) trait.metadata = Array.from({ length: r.count() }, () => r.u30());
    list.push(trait);
  }
  return list;
}

/**
 * ABC を解析する。添字（名前や型など）は、定数プールへの番号のまま持つ。
 * @param {Uint8Array} bytes
 * @returns {object} { minor, major, ints, uints, doubles, strings, namespaces, nsSets, multinames,
 *                     methods, metadata, instances, classes, scripts, bodies }
 */
export function parseABC(bytes) {
  const r = new ABCReader(bytes);
  const abc = { minor: r.u16(), major: r.u16() };
  if (abc.major !== 46) throw new ABCError(`unsupported ABC version ${abc.major}.${abc.minor}`);

  // 定数プール。各表の 0 番は「無し」を表す特別な値で、データには入っていない（個数は 1 つ多く書かれている）。
  const pool = (min, read, zero) => {
    const n = r.count(min);
    const list = [zero];
    for (let i = 1; i < n; i++) list.push(read());
    return list;
  };
  abc.ints = pool(1, () => r.s32(), 0);
  abc.uints = pool(1, () => r.u32(), 0);
  abc.doubles = pool(8, () => r.d64(), NaN);
  const decoder = new TextDecoder();
  abc.strings = pool(1, () => decoder.decode(r.bytesView(r.count())), '');
  abc.namespaces = pool(2, () => {
    const kind = r.u8();
    if (!NS_KIND[kind]) throw new ABCError(`unknown namespace kind 0x${kind.toString(16)}`);
    // 同じ名前でも private などは別の名前空間なので、1 つずつ別のオブジェクトにする。
    return { kind: NS_KIND[kind], uri: abc.strings[r.u30()] ?? '' };
  }, { kind: 'any', uri: '*' });
  abc.nsSets = pool(1, () => Array.from({ length: r.count() }, () => abc.namespaces[r.u30()]), []);
  abc.multinames = pool(1, () => {
    const code = r.u8();
    const kind = MULTINAME_KIND[code];
    if (!kind) throw new ABCError(`unknown multiname kind 0x${code.toString(16)}`);
    const m = { kind: kind.replace(/A$/, ''), attribute: kind.endsWith('A') };
    if (m.kind === 'QName') {
      m.ns = abc.namespaces[r.u30()];
      m.name = abc.strings[r.u30()];
    } else if (m.kind === 'RTQName') {
      m.name = abc.strings[r.u30()];
    } else if (m.kind === 'Multiname') {
      m.name = abc.strings[r.u30()];
      m.nsSet = abc.nsSets[r.u30()];
    } else if (m.kind === 'MultinameL') {
      m.nsSet = abc.nsSets[r.u30()];
    } else if (m.kind === 'TypeName') {
      m.base = r.u30();
      m.params = Array.from({ length: r.count() }, () => r.u30());
    }
    return m;
  }, { kind: 'any' });

  abc.methods = Array.from({ length: r.count() }, () => {
    const paramCount = r.count();
    const method = { returnType: r.u30(), paramTypes: Array.from({ length: paramCount }, () => r.u30()), name: abc.strings[r.u30()] ?? '' };
    const flags = r.u8();
    Object.assign(method, {
      needArguments: (flags & 0x01) !== 0, needActivation: (flags & 0x02) !== 0, needRest: (flags & 0x04) !== 0, setDxns: (flags & 0x40) !== 0,
      optional: [], body: null,
    });
    // 既定値は、後ろの引数から optional.length 個ぶん。
    if (flags & 0x08) method.optional = Array.from({ length: r.count(2) }, () => { const index = r.u30(); return constantValue(abc, r.u8(), index); });
    if (flags & 0x80) method.paramNames = Array.from({ length: paramCount }, () => abc.strings[r.u30()]);
    return method;
  });

  abc.metadata = Array.from({ length: r.count() }, () => {
    const name = abc.strings[r.u30()];
    const n = r.count(2);
    const keys = Array.from({ length: n }, () => abc.strings[r.u30()]);
    return { name, items: keys.map((key) => ({ key, value: abc.strings[r.u30()] })) };
  });

  const classCount = r.count();
  abc.instances = Array.from({ length: classCount }, () => {
    const inst = { name: r.u30(), superName: r.u30() };
    const flags = r.u8();
    Object.assign(inst, { sealed: (flags & 0x01) !== 0, final: (flags & 0x02) !== 0, isInterface: (flags & 0x04) !== 0 });
    if (flags & 0x08) inst.protectedNs = abc.namespaces[r.u30()];
    inst.interfaces = Array.from({ length: r.count() }, () => r.u30());
    inst.init = r.u30();
    inst.traits = traits(r, abc);
    return inst;
  });
  abc.classes = Array.from({ length: classCount }, () => ({ init: r.u30(), traits: traits(r, abc) }));
  abc.scripts = Array.from({ length: r.count() }, () => ({ init: r.u30(), traits: traits(r, abc) }));

  abc.bodies = Array.from({ length: r.count() }, () => {
    const body = { method: r.u30(), maxStack: r.u30(), localCount: r.u30(), initScopeDepth: r.u30(), maxScopeDepth: r.u30() };
    body.code = r.bytesView(r.count());
    body.exceptions = Array.from({ length: r.count(5) }, () => ({ from: r.u30(), to: r.u30(), target: r.u30(), type: r.u30(), varName: r.u30() }));
    body.traits = traits(r, abc);
    if (abc.methods[body.method]) abc.methods[body.method].body = body;
    return body;
  });
  return abc;
}

/** multiname を読みやすい文字列にする（デバッグ・逆アセンブル用）。 */
export function multinameText(abc, index) {
  const m = abc.multinames[index];
  if (!m) return `?${index}`;
  if (index === 0) return '*';
  if (m.kind === 'QName') return m.ns?.uri ? `${m.ns.uri}::${m.name}` : `${m.name}`;
  if (m.kind === 'Multiname') return `{${m.nsSet.length}}::${m.name}`;
  if (m.kind === 'MultinameL') return `{${m.nsSet.length}}::[late]`;
  if (m.kind === 'RTQName') return `[ns]::${m.name}`;
  if (m.kind === 'RTQNameL') return '[ns]::[late]';
  return `${multinameText(abc, m.base)}.<${m.params.map((p) => multinameText(abc, p)).join(',')}>`;
}
