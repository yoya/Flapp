// AVM2 の命令（仕様: docs/avm2overview.pdf 5 章）。
// 各命令の名前とオペランドの形。オペランドの形は 1 文字ずつ:
//   u: u30（番号や個数）  b: 1 バイト  o: 分岐先（符号つき 24 ビット、次の命令からの相対位置）
//   i: 符号つき 1 バイト (pushbyte)  d: デバッグ情報（読み飛ばす）  s: lookupswitch（既定の分岐先、個数、各分岐先）
export const OPS = {
  0x01: ['bkpt', ''], 0x02: ['nop', ''], 0x03: ['throw', ''], 0x04: ['getsuper', 'u'], 0x05: ['setsuper', 'u'], 0x06: ['dxns', 'u'], 0x07: ['dxnslate', ''],
  0x08: ['kill', 'u'], 0x09: ['label', ''],
  0x0c: ['ifnlt', 'o'], 0x0d: ['ifnle', 'o'], 0x0e: ['ifngt', 'o'], 0x0f: ['ifnge', 'o'], 0x10: ['jump', 'o'], 0x11: ['iftrue', 'o'], 0x12: ['iffalse', 'o'],
  0x13: ['ifeq', 'o'], 0x14: ['ifne', 'o'], 0x15: ['iflt', 'o'], 0x16: ['ifle', 'o'], 0x17: ['ifgt', 'o'], 0x18: ['ifge', 'o'],
  0x19: ['ifstricteq', 'o'], 0x1a: ['ifstrictne', 'o'], 0x1b: ['lookupswitch', 's'],
  0x1c: ['pushwith', ''], 0x1d: ['popscope', ''], 0x1e: ['nextname', ''], 0x1f: ['hasnext', ''],
  0x20: ['pushnull', ''], 0x21: ['pushundefined', ''], 0x23: ['nextvalue', ''], 0x24: ['pushbyte', 'i'], 0x25: ['pushshort', 'u'],
  0x26: ['pushtrue', ''], 0x27: ['pushfalse', ''], 0x28: ['pushnan', ''], 0x29: ['pop', ''], 0x2a: ['dup', ''], 0x2b: ['swap', ''],
  0x2c: ['pushstring', 'u'], 0x2d: ['pushint', 'u'], 0x2e: ['pushuint', 'u'], 0x2f: ['pushdouble', 'u'], 0x30: ['pushscope', ''], 0x31: ['pushnamespace', 'u'],
  0x32: ['hasnext2', 'uu'],
  0x40: ['newfunction', 'u'], 0x41: ['call', 'u'], 0x42: ['construct', 'u'], 0x43: ['callmethod', 'uu'], 0x44: ['callstatic', 'uu'], 0x45: ['callsuper', 'uu'],
  0x46: ['callproperty', 'uu'], 0x47: ['returnvoid', ''], 0x48: ['returnvalue', ''], 0x49: ['constructsuper', 'u'], 0x4a: ['constructprop', 'uu'],
  0x4c: ['callproplex', 'uu'], 0x4e: ['callsupervoid', 'uu'], 0x4f: ['callpropvoid', 'uu'],
  0x50: ['sxi1', ''], 0x51: ['sxi8', ''], 0x52: ['sxi16', ''], 0x53: ['applytype', 'u'],
  0x55: ['newobject', 'u'], 0x56: ['newarray', 'u'], 0x57: ['newactivation', ''], 0x58: ['newclass', 'u'], 0x59: ['getdescendants', 'u'], 0x5a: ['newcatch', 'u'],
  0x5d: ['findpropstrict', 'u'], 0x5e: ['findproperty', 'u'], 0x5f: ['finddef', 'u'], 0x60: ['getlex', 'u'], 0x61: ['setproperty', 'u'],
  0x62: ['getlocal', 'u'], 0x63: ['setlocal', 'u'], 0x64: ['getglobalscope', ''], 0x65: ['getscopeobject', 'b'], 0x66: ['getproperty', 'u'],
  0x68: ['initproperty', 'u'], 0x6a: ['deleteproperty', 'u'], 0x6c: ['getslot', 'u'], 0x6d: ['setslot', 'u'], 0x6e: ['getglobalslot', 'u'], 0x6f: ['setglobalslot', 'u'],
  0x70: ['convert_s', ''], 0x71: ['esc_xelem', ''], 0x72: ['esc_xattr', ''], 0x73: ['convert_i', ''], 0x74: ['convert_u', ''], 0x75: ['convert_d', ''],
  0x76: ['convert_b', ''], 0x77: ['convert_o', ''], 0x78: ['checkfilter', ''],
  0x80: ['coerce', 'u'], 0x81: ['coerce_b', ''], 0x82: ['coerce_a', ''], 0x83: ['coerce_i', ''], 0x84: ['coerce_d', ''], 0x85: ['coerce_s', ''],
  0x86: ['astype', 'u'], 0x87: ['astypelate', ''], 0x88: ['coerce_u', ''], 0x89: ['coerce_o', ''],
  0x90: ['negate', ''], 0x91: ['increment', ''], 0x92: ['inclocal', 'u'], 0x93: ['decrement', ''], 0x94: ['declocal', 'u'], 0x95: ['typeof', ''], 0x96: ['not', ''],
  0x97: ['bitnot', ''],
  0xa0: ['add', ''], 0xa1: ['subtract', ''], 0xa2: ['multiply', ''], 0xa3: ['divide', ''], 0xa4: ['modulo', ''], 0xa5: ['lshift', ''], 0xa6: ['rshift', ''],
  0xa7: ['urshift', ''], 0xa8: ['bitand', ''], 0xa9: ['bitor', ''], 0xaa: ['bitxor', ''], 0xab: ['equals', ''], 0xac: ['strictequals', ''],
  0xad: ['lessthan', ''], 0xae: ['lessequals', ''], 0xaf: ['greaterthan', ''], 0xb0: ['greaterequals', ''], 0xb1: ['instanceof', ''], 0xb2: ['istype', 'u'],
  0xb3: ['istypelate', ''], 0xb4: ['in', ''],
  0xc0: ['increment_i', ''], 0xc1: ['decrement_i', ''], 0xc2: ['inclocal_i', 'u'], 0xc3: ['declocal_i', 'u'], 0xc4: ['negate_i', ''], 0xc5: ['add_i', ''],
  0xc6: ['subtract_i', ''], 0xc7: ['multiply_i', ''],
  0xd0: ['getlocal_0', ''], 0xd1: ['getlocal_1', ''], 0xd2: ['getlocal_2', ''], 0xd3: ['getlocal_3', ''],
  0xd4: ['setlocal_0', ''], 0xd5: ['setlocal_1', ''], 0xd6: ['setlocal_2', ''], 0xd7: ['setlocal_3', ''],
  0xef: ['debug', 'd'], 0xf0: ['debugline', 'u'], 0xf1: ['debugfile', 'u'], 0xf2: ['bkptline', 'u'], 0xf3: ['timestamp', ''],
};

/**
 * メソッド本体の命令列を、1 命令ずつの配列にする。
 * @returns {Array<{ at: number, next: number, op: number, name: string, args: number[] }>}
 *   args: u / b / i はその値、o は分岐先の絶対位置、s は [既定の分岐先, ...各分岐先]（絶対位置）
 * 不明な命令や途中で切れた命令があれば、そこで打ち切って { broken: true } の要素を最後に入れる。
 */
export function decodeCode(code) {
  const out = [];
  let p = 0;
  const u30 = () => {
    let v = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (p >= code.length) throw new RangeError('truncated');
      const b = code[p++];
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
    }
    return v & 0x3fffffff;
  };
  const s24 = () => {
    if (p + 3 > code.length) throw new RangeError('truncated');
    const v = code[p] | (code[p + 1] << 8) | ((code[p + 2] << 24) >> 8);
    p += 3;
    return v;
  };
  while (p < code.length) {
    const at = p;
    const op = code[p++];
    const def = OPS[op];
    if (!def) {
      out.push({ at, next: code.length, op, name: `unknown_${op.toString(16)}`, args: [], broken: true });
      break;
    }
    const args = [];
    try {
      for (const kind of def[1]) {
        if (kind === 'u') args.push(u30());
        else if (kind === 'b') args.push(code[p++] ?? 0);
        else if (kind === 'i') args.push(((code[p++] ?? 0) << 24) >> 24);
        else if (kind === 'o') { const off = s24(); args.push(p + off); }
        else if (kind === 'd') { p++; u30(); p++; u30(); }
        else if (kind === 's') {
          // lookupswitch の分岐先は、命令の先頭からの相対位置。
          args.push(at + s24());
          const n = u30();
          if (n > code.length) throw new RangeError('truncated');
          for (let i = 0; i <= n; i++) args.push(at + s24());
        }
      }
    } catch {
      out.push({ at, next: code.length, op, name: def[0], args, broken: true });
      break;
    }
    out.push({ at, next: p, op, name: def[0], args });
  }
  return out;
}
