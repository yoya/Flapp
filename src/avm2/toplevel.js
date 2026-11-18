// AS3 の基本の組み込み: Object、Class、Function、Array、String、Number / int / uint、Boolean、Math、Error とその派生、大域関数。
import { ASArray, ASClass, ASFunction, ASObject, ASThrown, publicKey } from './object.js';

const MAX_ARRAY = 1 << 24;

export function installToplevel(vm) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const num = (v) => vm.toNumber(v);
  const int = (v) => vm.toInt32(v);
  const publicName = (name) => ({ name, keys: [publicKey(name)], late: true });

  // --- Object / Class / Function ---
  c.Object = vm.defineClass({
    name: 'Object', base: null, dynamic: true,
    callAsFunction: ([v]) => (v === null || v === undefined ? new ASObject(c.Object) : v),
    prototypeMethods: {
      toString: (self) => (self instanceof ASClass ? `[class ${self.shortName}]` : self instanceof ASFunction ? 'function Function() {}' : `[object ${vm.classOf(self)?.shortName ?? 'Object'}]`),
      valueOf: (self) => self,
      toLocaleString: (self) => str(self),
      hasOwnProperty: (self, [name]) => (self instanceof ASArray && /^\d+$/.test(str(name)) ? Number(str(name)) in self.items
        : vm.hasTrait(self, publicName(str(name))) || (self instanceof ASObject && self.values.has(publicKey(str(name))))),
      propertyIsEnumerable: (self, [name]) => vm.enumerate(self).map(String).includes(str(name)),
      isPrototypeOf: (self, [v]) => { for (let p = v instanceof ASObject ? (v.proto !== undefined ? v.proto : v.klass?.prototype) : null; p; p = p.proto) if (p === self) return true; return false; },
      setPropertyIsEnumerable: (self, [name, on]) => { if (self instanceof ASObject) { (self.hidden ??= new Set())[vm.toBoolean(on ?? true) ? 'delete' : 'add'](publicKey(str(name))); } },
    },
  });
  c.Class = vm.defineClass({ name: 'Class', getters: { prototype: (self) => self.prototype } });
  c.Function = vm.defineClass({
    name: 'Function', dynamic: true,
    getters: { length: (self) => self.method?.paramTypes.length ?? 0 },
    methods: {
      call: (self, [thisArg, ...args]) => vm.call(self, thisArg ?? null, args),
      apply: (self, [thisArg, list]) => vm.call(self, thisArg ?? null, list instanceof ASArray ? list.items.slice() : []),
    },
  });
  // ここまでに作ったオブジェクトには、まだクラスが付いていない。付け直す。
  for (const klass of [c.Object, c.Class, c.Function]) {
    klass.klass = c.Class;
    klass.prototype.klass = c.Object;
    for (const table of [klass.instanceTraits, klass.staticTraits]) {
      for (const t of table.values()) for (const f of [t.fn, t.get, t.set]) if (f) f.klass = c.Function;
    }
    for (const f of klass.prototype.values.values()) if (f instanceof ASFunction) f.klass = c.Function;
  }
  c.Class.prototype.proto = c.Object.prototype;
  c.Function.prototype.proto = c.Object.prototype;

  // --- 数値・真偽・文字列 ---
  // 数値の書式。どれも実機の出力に合わせてある（ECMAScript の規定とは違うところがある）。
  const radixText = (n, radix) => {
    const r = radix === undefined ? 10 : int(radix);
    if (r < 2 || r > 36) vm.throwError('RangeError', 1003, `The radix argument must be between 2 and 36; got ${r}.`);
    // 10 進以外では、小数部を切り捨てた整数として書く。
    return r === 10 || !Number.isFinite(n) ? str(n) : (Math.trunc(n) + 0).toString(r);
  };
  const digitsArg = (d, low, high) => {
    const n = d === undefined ? 0 : int(d);
    if (n < low || n > high) {
      vm.throwError('RangeError', 1002, 'Number.toPrecision has a range of 1 to 21. Number.toFixed and Number.toExponential have a range of 0 to 20. Specified value is not within expected range.');
    }
    return n;
  };
  // 正の有限値 x の、厳密な 10 進展開。digits は先頭の 0 を除いた全桁、exponent は先頭の桁の位（x = d.ddd × 10^exponent）。
  const exactDecimal = (x) => {
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, x);
    const high = bits.getUint32(0);
    const biased = (high >>> 20) & 0x7ff;
    const mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(bits.getUint32(4));
    const m = biased ? mantissa | (1n << 52n) : mantissa;
    const e = (biased || 1) - 1075; // x = m × 2^e
    const digits = (e >= 0 ? m << BigInt(e) : m * 5n ** BigInt(-e)).toString();
    return { digits, exponent: digits.length - 1 + (e >= 0 ? 0 : e) };
  };
  // toFixed: 四捨五入。ただし、残る桁がすべて 0 になる小さな値は、繰り上がらずに 0 になる（(0.9).toFixed(0) は "0"）。
  const fixed = (x, places) => {
    if (!Number.isFinite(x)) return str(x);
    const zero = `0${places ? `.${'0'.repeat(places)}` : ''}`;
    if (x === 0) return zero;
    if (exactDecimal(Math.abs(x)).exponent < -places) return (x < 0 ? '-' : '') + zero;
    if (Math.abs(x) >= 1e21) return `${BigInt(x)}${places ? `.${'0'.repeat(places)}` : ''}`;
    return x.toFixed(places);
  };
  const numberMethods = {
    toString: (self, [radix]) => radixText(num(self), radix),
    valueOf: (self) => self,
    toFixed: (self, [d]) => fixed(num(self), digitsArg(d, 0, 20)),
    // toExponential: 厳密な値を、指定の桁で切り捨てる（丸めない）。小数部が 0 桁のときだけは、最短の表記の先頭の桁になる
    // （1e-7 は厳密には 9.99…e-8 だが "1e-7"）。指数が 0 なら "e+0" は付かない。
    toExponential: (self, [d]) => {
      const x = num(self);
      const places = digitsArg(d, 0, 20);
      if (!Number.isFinite(x)) return str(x);
      if (x === 0) return places ? `0.${'0'.repeat(places)}e-16` : '1e-15'; // 0 のときの実機の出力
      const shortest = /^(\d)[^e]*e([+-]\d+)$/.exec(Math.abs(x).toExponential());
      const { digits, exponent } = places ? exactDecimal(Math.abs(x)) : { digits: shortest[1], exponent: Number(shortest[2]) };
      const shown = digits.slice(0, places + 1).padEnd(places + 1, '0');
      return `${x < 0 ? '-' : ''}${shown[0]}${places ? `.${shown.slice(1)}` : ''}${exponent ? `e${exponent < 0 ? '-' : '+'}${Math.abs(exponent)}` : ''}`;
    },
    // toPrecision: 元の値の位が桁数以上なら指数表記、そうでなければ小数表記（四捨五入で位が上がっても、小数の桁数はそのまま）。
    toPrecision: (self, [d]) => {
      const x = num(self);
      if (d === undefined || !Number.isFinite(x)) return str(x);
      const places = digitsArg(d, 1, 21);
      if (x === 0) return fixed(0, places);
      const { exponent } = exactDecimal(Math.abs(x));
      return exponent >= places ? x.toPrecision(places) : fixed(x, places - 1 - exponent);
    },
  };
  c.Number = vm.defineClass({
    name: 'Number', final: true, allocate: (k, args) => (args.length ? num(args[0]) : 0), callAsFunction: (args) => (args.length ? num(args[0]) : 0), methods: numberMethods,
    staticValues: { MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: Number.MIN_VALUE, NaN, NEGATIVE_INFINITY: -Infinity, POSITIVE_INFINITY: Infinity },
  });
  c.int = vm.defineClass({
    name: 'int', final: true, allocate: (k, [v]) => int(v), callAsFunction: ([v]) => int(v), methods: numberMethods,
    staticValues: { MAX_VALUE: 2147483647, MIN_VALUE: -2147483648 },
  });
  c.uint = vm.defineClass({
    name: 'uint', final: true, allocate: (k, [v]) => vm.toUint32(v), callAsFunction: ([v]) => vm.toUint32(v), methods: numberMethods,
    staticValues: { MAX_VALUE: 4294967295, MIN_VALUE: 0 },
  });
  c.Boolean = vm.defineClass({
    name: 'Boolean', final: true, allocate: (k, [v]) => vm.toBoolean(v), callAsFunction: ([v]) => vm.toBoolean(v),
    methods: { toString: (self) => str(self), valueOf: (self) => self },
  });
  const clampIndex = (i, length) => { const n = num(i); return Number.isNaN(n) ? 0 : n < 0 ? Math.max(0, length + Math.trunc(n)) : Math.min(Math.trunc(n), length); };
  c.String = vm.defineClass({
    name: 'String', final: true,
    allocate: (k, args) => (args.length ? str(args[0]) : ''), callAsFunction: (args) => (args.length ? str(args[0]) : ''),
    getters: { length: (self) => self.length },
    methods: {
      toString: (self) => self,
      valueOf: (self) => self,
      charAt: (self, [i]) => self.charAt(num(i ?? 0)),
      charCodeAt: (self, [i]) => self.charCodeAt(num(i ?? 0)),
      indexOf: (self, [s, from]) => self.indexOf(str(s), from === undefined ? 0 : num(from)),
      lastIndexOf: (self, [s, from]) => self.lastIndexOf(str(s), from === undefined ? Infinity : num(from)),
      substr: (self, [start, length]) => { const a = clampIndex(start ?? 0, self.length); const n = length === undefined ? Infinity : num(length); return n <= 0 || Number.isNaN(n) ? '' : self.slice(a, a + Math.trunc(Math.min(n, self.length))); },
      substring: (self, [start, end]) => self.substring(num(start ?? 0), end === undefined ? self.length : num(end)),
      slice: (self, [start, end]) => self.slice(num(start ?? 0), end === undefined ? self.length : num(end)),
      toUpperCase: (self) => self.toUpperCase(),
      toLowerCase: (self) => self.toLowerCase(),
      toLocaleUpperCase: (self) => self.toUpperCase(),
      toLocaleLowerCase: (self) => self.toLowerCase(),
      concat: (self, args) => self + args.map(str).join(''),
      localeCompare: (self, [other]) => (self < str(other) ? -1 : self > str(other) ? 1 : 0),
      // 区切りは文字列だけ（正規表現は未対応）
      split: (self, [sep, limit]) => {
        const parts = sep === undefined ? [self] : self.split(str(sep));
        return new ASArray(vm, limit === undefined ? parts : parts.slice(0, Math.max(0, vm.toUint32(limit))));
      },
      replace: (self, [pattern, repl]) => self.replace(str(pattern), () => str(repl)),
    },
    staticMethods: { fromCharCode: (_, codes) => String.fromCharCode(...codes.map((v) => vm.toUint32(v) & 0xffff)) },
  });

  // --- Array ---
  const items = (self) => (self instanceof ASArray ? self.items : []);
  const grow = (self, n) => { if (self.items.length + n > MAX_ARRAY) vm.throwError('RangeError', 1005, 'Array index out of bounds.'); vm.charge(n); };
  const compare = (a, b) => { const x = str(a), y = str(b); return x < y ? -1 : x > y ? 1 : 0; };
  // 並べ替え。実機と同じ並びになるように、実機と同じ手順のクイックソートにしてある（区間の中央を軸にし、4 個未満は直接比べる。
  // 等しい要素の順序は保たれないので、その並びも手順で決まる）。比較 1 回ごとに実行時間の上限を消費する。
  const quicksort = (v, cmp) => {
    const swap = (i, j) => { const t = v[i]; v[i] = v[j]; v[j] = t; };
    const c2 = (i, j) => { vm.step(4); return cmp(v[i], v[j]); };
    const stack = [];
    let lo = 0;
    let hi = v.length - 1;
    if (lo >= hi) return;
    for (;;) {
      const size = hi - lo + 1;
      if (size === 2) {
        if (c2(lo, lo + 1) > 0) swap(lo, lo + 1);
      } else if (size === 3) {
        const first = c2(lo, lo + 1) > 0;
        if (first) swap(lo, lo + 1);
        if (c2(lo + 1, lo + 2) > 0) {
          swap(lo + 1, lo + 2);
          if (c2(lo, lo + 1) > 0) swap(lo, lo + 1);
        }
      } else if (size >= 4) {
        swap(lo + (size >> 1), lo); // 軸を先頭へ
        let left = lo;
        let right = hi + 1;
        for (;;) {
          do left++; while (left <= hi && c2(left, lo) <= 0);
          do right--; while (right > lo && c2(right, lo) >= 0);
          if (right < left) break;
          swap(left, right);
        }
        swap(lo, right);
        // 小さい方の区間を先に片付ける（大きさは符号なしで比べる: 空の区間は「最大」扱いになる）。
        if (((right - 1 - lo) >>> 0) >= ((hi - left) >>> 0)) {
          if (lo + 1 < right) stack.push([lo, right - 1]);
          if (left < hi) { lo = left; continue; }
        } else {
          if (left < hi) stack.push([left, hi]);
          if (lo + 1 < right) { hi = right - 1; continue; }
        }
      }
      const next = stack.pop();
      if (!next) return;
      [lo, hi] = next;
    }
  };
  // sort / sortOn の本体。keyed は並べる要素 { value, key... } 、cmp はその比較。フラグに従って、並べ替えるか番号の配列を返す。
  const sortWith = (self, cmp, flags) => {
    // undefined は比べずに末尾へ集める。
    const defined = [];
    self.items.forEach((value, index) => { if (value !== undefined) defined.push({ value, index }); });
    const holes = self.items.length - defined.length;
    const order = flags & 2 ? (a, b) => -cmp(a.value, b.value) : (a, b) => cmp(a.value, b.value);
    quicksort(defined, order);
    if (flags & 4) for (let i = 1; i < defined.length; i++) if (order(defined[i - 1], defined[i]) === 0) return 0; // UNIQUESORT: 等しい要素があれば何もしない
    if (flags & 8) { // RETURNINDEXEDARRAY: 元の配列は変えず、並べた順の番号を返す
      const rest = [];
      self.items.forEach((value, index) => { if (value === undefined) rest.push(index); });
      return new ASArray(vm, [...defined.map((e) => e.index), ...rest]);
    }
    self.items = [...defined.map((e) => e.value), ...new Array(holes).fill(undefined)];
    return self;
  };
  const comparer = (flags) => {
    if (flags & 16) return (a, b) => { const x = num(a), y = num(b); return x < y ? -1 : x > y ? 1 : 0; };
    if (flags & 1) return (a, b) => { const x = str(a).toLowerCase(), y = str(b).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };
    return compare;
  };
  c.Array = vm.defineClass({
    name: 'Array', dynamic: true,
    allocate: () => new ASArray(vm),
    // new Array(n) は長さ n、それ以外は引数が要素になる
    construct: (self, args) => {
      if (args.length === 1 && typeof args[0] === 'number') {
        const n = args[0];
        if (!Number.isInteger(n) || n < 0 || n > MAX_ARRAY) vm.throwError('RangeError', 1005, `Array index out of bounds ${n}.`);
        vm.charge(n);
        self.items.length = n;
      } else {
        grow(self, args.length);
        self.items.push(...args);
      }
    },
    callAsFunction: (args) => vm.construct(c.Array, args),
    getters: { length: (self) => self.items.length },
    setters: { length: (self, v) => { const n = vm.toUint32(v); if (n > MAX_ARRAY) vm.throwError('RangeError', 1005, 'Array index out of bounds.'); if (n > self.items.length) vm.charge(n - self.items.length); self.items.length = n; } },
    methods: {
      push: (self, args) => { grow(self, args.length); return self.items.push(...args); },
      pop: (self) => self.items.pop(),
      shift: (self) => self.items.shift(),
      unshift: (self, args) => { grow(self, args.length); return self.items.unshift(...args); },
      join: (self, [sep]) => self.items.map((v) => (v === null || v === undefined ? '' : str(v))).join(sep === undefined ? ',' : str(sep)),
      toString: (self) => Array.from(self.items, (v) => (v === null || v === undefined ? '' : str(v))).join(','),
      concat: (self, args) => new ASArray(vm, self.items.concat(...args.map((v) => (v instanceof ASArray ? v.items : [v])))),
      slice: (self, [a, b]) => new ASArray(vm, self.items.slice(a === undefined ? 0 : num(a), b === undefined ? 16777215 : num(b))),
      splice: (self, [start, count, ...more]) => {
        grow(self, more.length);
        return new ASArray(vm, start === undefined ? [] : self.items.splice(num(start), count === undefined ? self.items.length : num(count), ...more));
      },
      reverse: (self) => { self.items.reverse(); return self; },
      indexOf: (self, [v, from]) => self.items.indexOf(v, from === undefined ? 0 : num(from)),
      lastIndexOf: (self, [v, from]) => self.items.lastIndexOf(v, from === undefined ? self.items.length - 1 : num(from)),
      // sort() / sort(フラグ) / sort(比較関数) / sort(比較関数, フラグ)
      sort: (self, [arg, more]) => {
        const flags = typeof arg === 'number' ? arg : typeof more === 'number' ? more : 0;
        return sortWith(self, arg instanceof ASFunction ? (a, b) => num(vm.call(arg, null, [a, b])) : comparer(flags), flags);
      },
      // sortOn(項目名, フラグ) / sortOn([項目名...], [フラグ...]): 要素のプロパティの値で並べる。先の項目が等しければ次の項目で比べる。
      sortOn: (self, [names, options]) => {
        const fields = (names instanceof ASArray ? names.items : [names]).map((name) => publicName(str(name)));
        const flagOf = (i) => (options instanceof ASArray ? int(options.items[i] ?? 0) : int(options ?? 0));
        const parts = fields.map((_, i) => ({ cmp: comparer(flagOf(i)), sign: flagOf(i) & 2 ? -1 : 1 }));
        const keys = new Map(); // 要素 → 各項目の値
        const keyOf = (item) => {
          if (!keys.has(item)) keys.set(item, fields.map((field) => (item === null || item === undefined ? undefined : vm.getProperty(item, field))));
          return keys.get(item);
        };
        const cmp = (a, b) => {
          const x = keyOf(a), y = keyOf(b);
          for (let i = 0; i < parts.length; i++) {
            const r = parts[i].sign * parts[i].cmp(x[i], y[i]);
            if (r) return r;
          }
          return 0;
        };
        return sortWith(self, cmp, flagOf(0) & ~2);
      },
      forEach: (self, [fn, thisArg]) => { if (fn instanceof ASFunction) self.items.slice().forEach((v, i) => { vm.call(fn, thisArg ?? null, [v, i, self]); }); },
      map: (self, [fn, thisArg]) => new ASArray(vm, fn instanceof ASFunction ? self.items.slice().map((v, i) => vm.call(fn, thisArg ?? null, [v, i, self])) : []),
      filter: (self, [fn, thisArg]) => new ASArray(vm, fn instanceof ASFunction ? self.items.slice().filter((v, i) => vm.toBoolean(vm.call(fn, thisArg ?? null, [v, i, self]))) : []),
      some: (self, [fn, thisArg]) => fn instanceof ASFunction && self.items.slice().some((v, i) => vm.toBoolean(vm.call(fn, thisArg ?? null, [v, i, self]))),
      every: (self, [fn, thisArg]) => !(fn instanceof ASFunction) || self.items.slice().every((v, i) => vm.toBoolean(vm.call(fn, thisArg ?? null, [v, i, self]))),
    },
    staticValues: { CASEINSENSITIVE: 1, DESCENDING: 2, UNIQUESORT: 4, RETURNINDEXEDARRAY: 8, NUMERIC: 16 },
  });
  void items;

  // --- Math ---
  const math = {};
  for (const name of ['abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'exp', 'floor', 'log', 'sin', 'sqrt', 'tan']) math[name] = (_, [v]) => Math[name](num(v));
  Object.assign(math, {
    atan2: (_, [y, x]) => Math.atan2(num(y), num(x)),
    pow: (_, [a, b]) => num(a) ** num(b),
    round: (_, [v]) => { const n = num(v); return Math.floor(n + 0.5); },
    max: (_, args) => (args.length ? Math.max(...args.map(num)) : -Infinity),
    min: (_, args) => (args.length ? Math.min(...args.map(num)) : Infinity),
    random: () => vm.random(),
  });
  c.Math = vm.defineClass({
    name: 'Math', final: true, staticMethods: math,
    staticValues: { E: Math.E, LN10: Math.LN10, LN2: Math.LN2, LOG10E: Math.LOG10E, LOG2E: Math.LOG2E, PI: Math.PI, SQRT1_2: Math.SQRT1_2, SQRT2: Math.SQRT2 },
  });

  // --- Error とその派生 ---
  c.Error = vm.defineClass({
    name: 'Error', dynamic: true,
    slots: { message: '', name: 'Error' },
    construct: (self, [message, id]) => {
      self.values.set(publicKey('message'), message === undefined ? '' : str(message));
      self.values.set(publicKey('name'), self.klass.shortName);
      self.errorID = id === undefined ? 0 : int(id);
    },
    callAsFunction: (args) => vm.construct(c.Error, args),
    getters: { errorID: (self) => self.errorID ?? 0 },
    methods: { getStackTrace: () => null },
    prototypeMethods: {
      toString: (self) => {
        const message = str(vm.getProperty(self, publicName('message')));
        const name = str(vm.getProperty(self, publicName('name')));
        return message === '' ? name : `${name}: ${message}`;
      },
    },
  });
  for (const name of ['TypeError', 'ReferenceError', 'RangeError', 'ArgumentError', 'EvalError', 'SecurityError', 'SyntaxError', 'URIError', 'VerifyError', 'DefinitionError', 'UninitializedError']) {
    c[name] = vm.defineClass({ name, base: c.Error, dynamic: true, construct: (self, args) => vm.call(c.Error.constructorFn, self, args), callAsFunction: (args) => vm.construct(c[name], args) });
  }
  c.Namespace = vm.defineClass({
    name: 'Namespace', final: true, getters: { uri: (self) => self.namespace?.uri ?? '', prefix: () => undefined },
    methods: { toString: (self) => self.namespace?.uri ?? '', valueOf: (self) => self.namespace?.uri ?? '' },
  });

  // --- 大域の関数と値 ---
  const globals = {
    trace: (_, args) => { vm.trace(args.map(str).join(' ')); },
    isNaN: (_, [v]) => Number.isNaN(num(v)),
    isFinite: (_, [v]) => Number.isFinite(num(v)),
    parseInt: (_, [s, radix]) => {
      const text = str(s).trim();
      const r = radix === undefined ? 0 : int(radix);
      const m = /^([+-]?)(0[xX])?/.exec(text);
      const base = r === 0 ? (m[2] ? 16 : 10) : r;
      if (base < 2 || base > 36) return NaN;
      const digits = text.slice(m[0].length - (m[2] && base !== 16 ? 2 : 0));
      const n = parseInt(digits, base);
      return m[1] === '-' ? -n : n;
    },
    parseFloat: (_, [s]) => { const m = /^\s*[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(str(s)); return m ? Number(m[0]) : NaN; },
    escape: (_, [s]) => encodeURIComponent(str(s)).replace(/[!'()~]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%2B|%2F|%40/g, (e) => decodeURIComponent(e)),
    unescape: (_, [s]) => str(s).replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g, (all, u, h) => String.fromCharCode(parseInt(u ?? h, 16))),
    encodeURIComponent: (_, [s]) => encodeURIComponent(str(s)),
    decodeURIComponent: (_, [s]) => { try { return decodeURIComponent(str(s)); } catch { return vm.throwError('URIError', 1052, 'Invalid URI passed to decodeURIComponent function.'); } },
    encodeURI: (_, [s]) => encodeURI(str(s)),
    decodeURI: (_, [s]) => { try { return decodeURI(str(s)); } catch { return vm.throwError('URIError', 1052, 'Invalid URI passed to decodeURI function.'); } },
  };
  for (const [name, impl] of Object.entries(globals)) vm.defineGlobal(name, vm.native(impl, name));
  vm.defineGlobal('NaN', NaN);
  vm.defineGlobal('Infinity', Infinity);
  vm.defineGlobal('undefined', undefined);
  void ASThrown;
}
