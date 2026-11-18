// AVM1 の型変換と比較。SWF のバージョンで結果が変わるものがあるので、すべて vm を受け取る。
import { AVMFunction, AVMObject } from './object.js';

/** typeof の結果。 */
export function typeOf(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (v instanceof AVMObject) return v.isMovieClip ? 'movieclip' : v instanceof AVMFunction ? 'function' : 'object';
  return typeof v;
}

/**
 * オブジェクトを基本型にする。valueOf() を呼ぶだけで、toString() は試さない
 * （実機では Number([5]) は NaN、[1] == 1 は false になる）。基本型にならなければ元のオブジェクトを返す。
 */
export function toPrimitive(vm, v) {
  if (!(v instanceof AVMObject) || v.isMovieClip) return v;
  if (v.primitive !== undefined) return v.primitive; // String / Number / Boolean のラッパー
  const fn = v.get('valueOf');
  if (fn instanceof AVMFunction) {
    const r = vm.call(fn, v, []);
    if (!(r instanceof AVMObject)) return r;
  }
  return v;
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const HEX = /^[+-]?0[xX][0-9a-fA-F]+$/;
const OCTAL = /^[+-]?0[0-7]+$/; // "010" は 8 として読まれる

const PREFIX = /^[\t\n\r ]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;

function stringToNumber(vm, s) {
  // SWF 4 は先頭の数値として読める部分だけを使い、読めなければ 0（"12abc" は 12、"abc" や "" は 0）。
  if (vm.version < 5) return Number(PREFIX.exec(s)?.[0] ?? 0);
  if (vm.version >= 6 && HEX.test(s)) {
    const n = parseInt(s.replace(/^[+-]/, ''), 16);
    return s[0] === '-' ? -n : n;
  }
  if (vm.version >= 6 && OCTAL.test(s)) return parseInt(s, 8);
  const t = s.replace(/^[\t\n\r ]+/, '');
  return DECIMAL.test(t) ? Number(t) : NaN;
}

export function toNumber(vm, v) {
  switch (typeof v) {
    case 'number': return v;
    case 'boolean': return v ? 1 : 0;
    case 'string': return stringToNumber(vm, v);
    case 'undefined': return vm.version >= 7 ? NaN : 0;
    default: {
      if (v === null) return vm.version >= 7 ? NaN : 0;
      if (v.isMovieClip) return NaN;
      const p = toPrimitive(vm, v);
      return p instanceof AVMObject ? NaN : toNumber(vm, p);
    }
  }
}

// x に 10^exp を掛ける。10 を 2 乗しながら、その都度 x に掛ける（負なら割る）。
// 一度に 10^exp を作ると 1e-324 のような値で途中が無限大になる。実機の出力と合うのはこの順序。
function decimalShift(x, exp) {
  let base = 10;
  for (let e = Math.abs(exp); e > 0; e >>= 1, base *= base) {
    if (e & 1) x = exp < 0 ? x / base : x * base;
  }
  return x;
}

const bits = new DataView(new ArrayBuffer(8));
const exponentOf = (x) => {
  bits.setFloat64(0, x);
  return ((bits.getUint32(0) >>> 20) & 0x7ff) - 1023;
};

/**
 * 数値の文字列化。実機は「値を [0, 10) に寄せて、10 倍しながら 1 桁ずつ取り出し、16 桁目で丸める」
 * という素朴な方法を使うので、桁の多い値では正確な 15 桁丸めと 1 つずれることがある
 * （例: Number.MAX_VALUE は 1.79769313486231e+308）。その手順をそのままなぞる。
 */
export function numberToString(n) {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  if (n === 0) return '0';
  if (Number.isInteger(n) && n >= -2147483648 && n <= 2147483647) return String(n);

  const buf = [];
  if (n < 0) {
    n = -n;
    buf.push('-');
  }
  let exp2 = exponentOf(n);
  if (exp2 === -1023) exp2 = exponentOf(n * 2 ** 54) - 54; // 非正規化数
  const scaled = exp2 * 0.301029995663981; // log10(2)（実機と同じ精度の定数）
  let exp = Math.sign(scaled) * Math.round(Math.abs(scaled));
  let mantissa = decimalShift(n, -exp);
  if (Math.trunc(mantissa) === 0) mantissa = decimalShift(n, -(--exp));
  if (Math.trunc(mantissa) >= 10) mantissa = decimalShift(n, -(++exp));
  const digit = () => {
    const d = Math.trunc(mantissa);
    mantissa = (mantissa - d) * 10;
    return d;
  };
  const digits = (count) => { for (let i = 0; i < count; i++) buf.push(String(digit())); };

  if (exp >= 15) { // 1.2345e+15
    digits(1);
    buf.push('.');
    digits(14);
  } else if (exp >= 0) { // 12345.678901234
    buf.push('0');
    digits(exp + 1);
    buf.push('.');
    digits(15 - exp - 1);
    exp = 0;
  } else if (exp >= -5) { // 0.0012345678901234
    buf.push('0', '0', '.');
    for (let i = 0; i < -exp - 1; i++) buf.push('0');
    digits(15);
    exp = 0;
  } else { // 1.345e-15
    buf.push('0');
    const first = digit();
    if (first !== 0) buf.push(String(first));
    buf.push('.');
    digits(14);
  }

  // 次の 1 桁を見て四捨五入する。9 は 0 にして繰り上げる。
  if (digit() >= 5) {
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i] === '9') buf[i] = '0';
      else if (buf[i] >= '0') {
        buf[i] = String(Number(buf[i]) + 1);
        break;
      }
    }
  }
  while (buf[buf.length - 1] === '0') buf.pop();
  if (buf[buf.length - 1] === '.') buf.pop();

  if (exp !== 0) {
    // 先頭の 0 を落とす（負の数は先頭が '-' なので落ちない。実機の挙動どおり）。
    let lead = 0;
    while (lead < buf.length && buf[lead] === '0') lead++;
    buf.splice(0, lead);
    if (buf.length === 0) {
      buf.push('1'); // 9.99... が繰り上がって全部 0 になった場合
      exp++;
    } else {
      let last = buf.length - 1;
      while (last > 0 && buf[last] === '0') last--;
      if (last === 0) { // 100e15 → 1e17
        exp += buf.length - 1;
        buf.length = 1;
      }
    }
    buf.push(`e${exp < 0 ? '-' : '+'}${Math.abs(exp)}`);
  }
  // 残った先頭の 0（"012.5" や "-01.5e-7"）を落とす。
  const i = buf[0] === '-' ? 1 : 0;
  if (buf[i] === '0' && buf[i + 1] !== '.') buf.splice(i, 1);
  return buf.join('');
}

export function toStr(vm, v) {
  switch (typeof v) {
    case 'string': return v;
    case 'number': return numberToString(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'undefined': return vm.version >= 7 ? 'undefined' : '';
    default: {
      if (v === null) return 'null';
      if (v.isMovieClip || v.isTextField) return v.targetPath();
      if (v instanceof AVMFunction) return '[type Function]';
      if (v.primitive !== undefined) return toStr(vm, v.primitive);
      const fn = v.get('toString');
      if (fn instanceof AVMFunction) {
        const r = vm.call(fn, v, []);
        if (typeof r === 'string') return r;
      }
      return '[type Object]';
    }
  }
}

export function toBool(vm, v) {
  switch (typeof v) {
    case 'boolean': return v;
    case 'number': return !Number.isNaN(v) && v !== 0;
    case 'string': {
      if (vm.version >= 7) return v !== '';
      const n = stringToNumber(vm, v);
      return !Number.isNaN(n) && n !== 0;
    }
    case 'undefined': return false;
    default: return v !== null;
  }
}

/** ECMAScript の ToInt32。 */
export function toInt32(vm, v) {
  return toNumber(vm, v) | 0;
}

/** == の比較 (ActionEquals2)。 */
export function looseEquals(vm, a, b) {
  const ta = typeOf(a);
  const tb = typeOf(b);
  const nullish = (t) => t === 'undefined' || t === 'null';
  if (nullish(ta) || nullish(tb)) return nullish(ta) && nullish(tb);
  if (ta === tb) return a === b || (ta === 'number' && Number.isNaN(a) && Number.isNaN(b)); // NaN == NaN は真
  const isObject = (t) => t === 'object' || t === 'function' || t === 'movieclip';
  if (isObject(ta) && isObject(tb)) return a === b;
  if (isObject(ta)) {
    const p = toPrimitive(vm, a);
    return p instanceof AVMObject ? false : looseEquals(vm, p, b);
  }
  if (isObject(tb)) {
    const p = toPrimitive(vm, b);
    return p instanceof AVMObject ? false : looseEquals(vm, a, p);
  }
  // 残りは 真偽 / 数値 / 文字列 の異なる組み合わせ。数値にして比べる。
  return toNumber(vm, a) === toNumber(vm, b);
}

/** < の比較 (ActionLess2)。どちらかが NaN なら undefined。 */
export function lessThan(vm, a, b) {
  const pa = toPrimitive(vm, a);
  const pb = toPrimitive(vm, b);
  if (typeof pa === 'string' && typeof pb === 'string') {
    // 実機では、空文字列は空でないどの文字列よりも「大きい」（"" < "a" は偽、"a" < "" は真）。
    if (pa === '' || pb === '') return pa !== '' && pb === '';
    return pa < pb;
  }
  const na = toNumber(vm, pa);
  const nb = toNumber(vm, pb);
  if (Number.isNaN(na) || Number.isNaN(nb)) return undefined;
  return na < nb;
}
