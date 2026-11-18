// Vector.<T>。要素の型ごとに別のクラスになる（Vector.<int> と Vector.<String> は別物）。
import { ASArray, ASClass, ASFunction, ASVector } from './object.js';

const MAX_LENGTH = 1 << 24;

export function installVector(vm) {
  const c = vm.classes;
  const num = (v) => vm.toNumber(v);
  const fixedError = () => vm.throwError('RangeError', 1126, 'Cannot change the length of a fixed Vector.');
  const grow = (self, n) => {
    if (self.fixed) fixedError();
    if (self.items.length + n > MAX_LENGTH) vm.throwError('RangeError', 1125, `The index ${self.items.length + n} is out of range ${self.items.length}.`);
    vm.charge(n);
  };
  const convert = (self, v) => self.klass.vector.convert(v);
  const like = (self, items) => new ASVector(self.klass, items); // 同じ型の Vector
  const callback = (fn) => { if (!(fn instanceof ASFunction)) vm.throwError('TypeError', 2007, 'Parameter callback must be non-null.'); return fn; };
  const each = (self, fn, thisArg, visit) => { callback(fn); self.items.slice().forEach((v, i) => visit(vm.call(fn, thisArg ?? null, [v, i, self]), v)); };

  c.Vector = vm.defineClass({
    name: '__AS3__.vec::Vector', final: true, dynamic: true,
    allocate: (klass) => { if (!klass.vector) vm.throwError('TypeError', 1007, 'Instantiation attempted on a non-constructor.'); return new ASVector(klass); },
    construct: (self, [length = 0, fixed = false]) => {
      const n = vm.toUint32(length);
      if (n > MAX_LENGTH) vm.throwError('RangeError', 1125, `The index ${n} is out of range 0.`);
      vm.charge(n);
      self.items = new Array(n).fill(self.klass.vector.initial);
      self.fixed = vm.toBoolean(fixed);
    },
    getters: { length: (self) => self.items.length, fixed: (self) => self.fixed },
    setters: {
      length: (self, v) => {
        const n = vm.toUint32(v);
        if (self.fixed) fixedError();
        if (n > MAX_LENGTH) vm.throwError('RangeError', 1125, `The index ${n} is out of range ${self.items.length}.`);
        const old = self.items.length;
        if (n > old) vm.charge(n - old);
        self.items.length = n;
        if (n > old) self.items.fill(self.klass.vector.initial, old);
      },
      fixed: (self, v) => { self.fixed = vm.toBoolean(v); },
    },
    methods: {
      push: (self, args) => { grow(self, args.length); for (const v of args) self.items.push(convert(self, v)); return self.items.length; },
      pop: (self) => { if (self.fixed) fixedError(); return self.items.length ? self.items.pop() : self.klass.vector.empty; },
      shift: (self) => { if (self.fixed) fixedError(); return self.items.length ? self.items.shift() : self.klass.vector.empty; },
      unshift: (self, args) => { grow(self, args.length); self.items.unshift(...args.map((v) => convert(self, v))); return self.items.length; },
      insertAt: (self, [index, v]) => { grow(self, 1); const i = vm.toInt32(index); self.items.splice(i < 0 ? Math.max(0, self.items.length + i) : i, 0, convert(self, v)); },
      removeAt: (self, [index]) => {
        if (self.fixed) fixedError();
        const i = vm.toInt32(index) < 0 ? self.items.length + vm.toInt32(index) : vm.toInt32(index);
        if (i < 0 || i >= self.items.length) vm.throwError('RangeError', 1125, `The index ${vm.toInt32(index)} is out of range ${self.items.length}.`);
        return self.items.splice(i, 1)[0];
      },
      concat: (self, args) => {
        const out = self.items.slice();
        for (const v of args) {
          if (!(v instanceof ASVector) || !vm.isType(v, self.klass)) vm.throwError('TypeError', 1034, `Type Coercion failed: cannot convert ${vm.describe(v)} to ${self.klass.name.replace('::', '.')}.`);
          out.push(...v.items);
        }
        return like(self, out);
      },
      slice: (self, [a, b]) => like(self, self.items.slice(a === undefined ? 0 : num(a), b === undefined ? 16777215 : num(b))),
      splice: (self, [start, count, ...more]) => {
        const at = Math.trunc(num(start));
        const from = at < 0 ? Math.max(0, self.items.length + at) : Math.min(at, self.items.length);
        const n = count === undefined ? self.items.length : Math.min(Math.max(Math.trunc(num(count)), 0), self.items.length - from);
        if (self.fixed && n !== more.length) fixedError();
        if (more.length > n) vm.charge(more.length - n);
        return like(self, self.items.splice(from, n, ...more.map((v) => convert(self, v))));
      },
      reverse: (self) => { self.items.reverse(); return self; },
      // 探す値も、要素の型に合わせてから比べる（Vector.<int> の indexOf("7") は 7 を探す）。
      indexOf: (self, [v, from]) => self.items.indexOf(convert(self, v), from === undefined ? 0 : num(from)),
      lastIndexOf: (self, [v, from]) => self.items.lastIndexOf(convert(self, v), from === undefined ? 0x7fffffff : num(from)),
      join: (self, [sep]) => self.items.map((v) => vm.toStr(v)).join(sep === undefined ? ',' : vm.toStr(sep)),
      toString: (self) => self.items.map((v) => vm.toStr(v)).join(','),
      toLocaleString: (self) => self.items.map((v) => vm.toStr(v)).join(','),
      // sort(比較関数) / sort(フラグ)。並べ替えの手順は Array と同じ。
      sort: (self, [how]) => {
        const flags = typeof how === 'number' ? how : 0;
        const cmp = how instanceof ASFunction ? (a, b) => num(vm.call(how, null, [a, b])) : vm.sorting.comparer(flags);
        vm.sorting.quicksort(self.items, flags & 2 ? (a, b) => -cmp(a, b) : cmp);
        return self;
      },
      forEach: (self, [fn, thisArg]) => { each(self, fn, thisArg, () => {}); },
      map: (self, [fn, thisArg]) => { const out = []; each(self, fn, thisArg, (r) => out.push(convert(self, r))); return like(self, out); },
      filter: (self, [fn, thisArg]) => { const out = []; each(self, fn, thisArg, (r, v) => { if (vm.toBoolean(r)) out.push(v); }); return like(self, out); },
      some: (self, [fn, thisArg]) => { callback(fn); return self.items.slice().some((v, i) => vm.toBoolean(vm.call(fn, thisArg ?? null, [v, i, self]))); },
      every: (self, [fn, thisArg]) => { callback(fn); return self.items.slice().every((v, i) => vm.toBoolean(vm.call(fn, thisArg ?? null, [v, i, self]))); },
    },
  });

  /** Vector.<T> のクラス（applytype）。同じ T には同じクラスを返す。params[0] が null なら Vector.<*>。 */
  const applied = new Map();
  vm.applyType = (base, params) => {
    if (base !== c.Vector) vm.throwError('TypeError', 1127, 'Type application attempted on a non-parameterized type.');
    const type = params[0] instanceof ASClass ? params[0] : null;
    let klass = applied.get(type);
    if (klass) return klass;
    klass = new ASClass(vm, { name: `__AS3__.vec::Vector.<${type ? type.name : '*'}>`, superClass: c.Vector, final: true, dynamic: true });
    const numeric = type === c.int || type === c.uint || type === c.Number;
    klass.vector = {
      type, numeric,
      // 要素への代入は、要素の型に合わせる（合わなければ TypeError）。
      // Vector.<*> でも、undefined は null になる（実機で確認）。
      convert: type ? (v) => vm.coerceTo(type, v) : (v) => (v === undefined ? null : v),
      initial: numeric ? 0 : null, // new Vector.<T>(n) や length を伸ばしたときの要素（Vector.<Boolean> でも null）
      empty: numeric ? 0 : undefined, // 空の Vector からの pop / shift
    };
    klass.constructorFn = c.Vector.constructorFn;
    // Vector.<T>(値): 配列やほかの Vector から作る。同じ型の Vector なら、そのものを返す。
    klass.callAsFunction = ([v]) => {
      if (v instanceof ASVector && v.klass === klass) return v;
      if (!(v instanceof ASArray) && !(v instanceof ASVector)) return vm.coerceTo(klass, v);
      return new ASVector(klass, Array.from(v.items, klass.vector.convert));
    };
    applied.set(type, klass);
    return klass;
  };
}
