// AVM1 の組み込みオブジェクトと大域関数。
import { installMovieClip } from './clip.js';
import { installDate } from './date.js';
import { installFilters } from './filters.js';
import { installStage } from './stage.js';
import { installTextField } from './textfield.js';
import { installNet } from './net.js';
import { installXML } from './xml.js';
import { installSound } from './sound.js';
import { installVideo } from './video.js';
import { numberToString, toBool, toInt32, toNumber, toStr } from './convert.js';
import { AVMArray, AVMFunction, AVMObject, DONT_DELETE, DONT_ENUM, MAX_ARRAY_LENGTH, READ_ONLY } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;

/** プロトタイプなどにネイティブのメソッドをまとめて定義する。 */
export function defineMethods(vm, obj, methods) {
  for (const [name, fn] of Object.entries(methods)) obj.define(name, vm.native(fn), HIDDEN);
}

// クラス（コンストラクタ関数とプロトタイプ）を作って _global に置く。
export function defineClass(vm, name, proto, call, construct) {
  const ctor = vm.native(call, construct);
  ctor.define('prototype', proto, HIDDEN);
  proto.define('constructor', ctor, HIDDEN);
  vm.global.define(name, ctor, DONT_ENUM);
  return ctor;
}

// String / Number / Boolean のラッパーオブジェクト。
function wrapper(vm, proto, value) {
  const obj = new AVMObject(vm, proto);
  obj.primitive = value;
  if (typeof value === 'string') obj.define('length', value.length, HIDDEN | READ_ONLY);
  return obj;
}

const items = (v) => (v instanceof AVMArray ? v.items : []);
const clampIndex = (i, length) => (i < 0 ? Math.max(0, length + i) : Math.min(i, length));

export function installGlobals(vm) {
  const g = vm.global;
  const str = (v) => toStr(vm, v);
  const num = (v) => toNumber(vm, v);

  // --- Object ---
  defineMethods(vm, vm.objectProto, {
    toString: () => '[object Object]',
    toLocaleString: (_, self) => str(self),
    valueOf: (_, self) => self,
    hasOwnProperty: (_, self, [name]) => self instanceof AVMObject && self.ownHas(str(name)),
    isPrototypeOf: (_, self, [o]) => {
      for (let p = o instanceof AVMObject ? o.proto : null, i = 0; p && i < 256; p = p.proto, i++) if (p === self) return true;
      return false;
    },
    isPropertyEnumerable: (_, self, [name]) => self instanceof AVMObject && self.ownKeys().includes(str(name)),
    // watch: 代入のたびに fn(名前, 古い値, 新しい値, user) を呼び、その返り値を代入する。関数が無ければ false。
    watch: (_, self, [name, fn, user]) => {
      if (!(self instanceof AVMObject) || !(fn instanceof AVMFunction)) return false;
      (self.watches ??= new Map()).set(self.key(str(name)), { fn, user });
      return true;
    },
    unwatch: (_, self, [name]) => self instanceof AVMObject && !!self.watches?.delete(self.key(str(name))),
    addProperty: (_, self, [name, getter, setter]) => {
      if (!(self instanceof AVMObject) || !(getter instanceof AVMFunction) || str(name) === '') return false;
      self.defineAccessor(str(name), getter, setter instanceof AVMFunction ? setter : null);
      return true;
    },
  });
  const objectCtor = defineClass(vm, 'Object', vm.objectProto,
    (_, self, [v]) => (v instanceof AVMObject ? v : new AVMObject(vm, vm.objectProto)),
    (_, [v], proto) => (v instanceof AVMObject ? v : new AVMObject(vm, proto)));
  // attachMovie で作るクリップに割り当てるクラスの登録。
  vm.registeredClasses = new Map();
  defineMethods(vm, objectCtor, {
    registerClass: (_, __, [name, ctor]) => {
      if (ctor instanceof AVMFunction) vm.registeredClasses.set(str(name), ctor);
      else vm.registeredClasses.delete(str(name));
      return true;
    },
  });

  // --- Function ---
  defineMethods(vm, vm.functionProto, {
    call: (_, self, [thisArg, ...args]) => vm.call(self, thisArg, args),
    apply: (_, self, [thisArg, args]) => vm.call(self, thisArg, items(args).slice()),
  });
  defineClass(vm, 'Function', vm.functionProto, () => undefined);

  // --- Array ---
  const newArray = (args) => {
    if (args.length === 1 && typeof args[0] === 'number') {
      const a = new AVMArray(vm);
      a.setLength(args[0]);
      return a;
    }
    return new AVMArray(vm, args.slice());
  };
  const arrayCtor = defineClass(vm, 'Array', vm.arrayProto, (_, __, args) => newArray(args), (_, args) => newArray(args));
  for (const [name, value] of Object.entries({ CASEINSENSITIVE: 1, DESCENDING: 2, UNIQUESORT: 4, RETURNINDEXEDARRAY: 8, NUMERIC: 16 })) {
    arrayCtor.define(name, value, HIDDEN | READ_ONLY);
  }
  // 空き要素も undefined として文字列にする（map は空きを飛ばすので添字で回す）。
  const join = (self, sep) => {
    const list = items(self);
    const parts = [];
    for (let i = 0; i < list.length; i++) parts.push(str(list[i]));
    return parts.join(sep);
  };
  const grow = (self, extra) => {
    if (items(self).length + extra > MAX_ARRAY_LENGTH) return false;
    vm.charge(extra);
    return true;
  };
  // 並べ替えの比較関数。flags は Array.NUMERIC などの和。
  const comparator = (flags) => {
    const sign = flags & 2 ? -1 : 1;
    if (flags & 16) return (a, b) => sign * (num(a) - num(b) || 0);
    const key = flags & 1 ? (v) => str(v).toLowerCase() : str;
    return (a, b) => {
      const x = key(a);
      const y = key(b);
      return sign * (x < y ? -1 : x > y ? 1 : 0);
    };
  };
  defineMethods(vm, vm.arrayProto, {
    toString: (_, self) => join(self, ','),
    join: (_, self, [sep]) => join(self, sep === undefined ? ',' : str(sep)),
    push: (_, self, args) => {
      if (self instanceof AVMArray && grow(self, args.length)) {
        self.reordered();
        self.items.push(...args);
      }
      return items(self).length;
    },
    pop: (_, self) => { self.reordered?.(); return items(self).pop(); },
    shift: (_, self) => { self.reordered?.(); return items(self).shift(); },
    unshift: (_, self, args) => {
      if (self instanceof AVMArray && grow(self, args.length)) {
        self.reordered();
        self.items.unshift(...args);
      }
      return items(self).length;
    },
    reverse: (_, self) => {
      self.reordered?.();
      items(self).reverse();
      return self;
    },
    concat: (_, self, args) => {
      const out = items(self).slice();
      for (const a of args) {
        if (a instanceof AVMArray) out.push(...a.items);
        else out.push(a);
      }
      if (out.length > MAX_ARRAY_LENGTH) return new AVMArray(vm);
      return new AVMArray(vm, out);
    },
    slice: (_, self, [start, end]) => {
      const list = items(self);
      const from = clampIndex(start === undefined ? 0 : toInt32(vm, start), list.length);
      const to = clampIndex(end === undefined ? list.length : toInt32(vm, end), list.length);
      return new AVMArray(vm, list.slice(from, to));
    },
    splice: (_, self, [start, count, ...insert]) => {
      if (!(self instanceof AVMArray) || start === undefined || !grow(self, insert.length)) return undefined;
      const from = clampIndex(toInt32(vm, start), self.items.length);
      const n = count === undefined ? self.items.length - from : Math.max(0, toInt32(vm, count));
      self.reordered();
      return new AVMArray(vm, self.items.splice(from, n, ...insert));
    },
    sort: (_, self, [a, b]) => {
      if (!(self instanceof AVMArray)) return undefined;
      const flags = typeof a === 'number' ? a : typeof b === 'number' ? b : 0;
      const compare = a instanceof AVMFunction
        ? (x, y) => (flags & 2 ? -1 : 1) * (num(vm.call(a, undefined, [x, y])) || 0)
        : comparator(flags);
      if (flags & 8) {
        // RETURNINDEXEDARRAY: 元の配列は変えず、並べ替えた添字を返す
        const order = self.items.map((_v, i) => i).sort((i, j) => compare(self.items[i], self.items[j]));
        return new AVMArray(vm, order);
      }
      self.items.sort(compare);
      return self;
    },
    sortOn: (_, self, [field, flagsArg]) => {
      if (!(self instanceof AVMArray)) return undefined;
      const fields = field instanceof AVMArray ? field.items.map(str) : [str(field)];
      const flags = flagsArg instanceof AVMArray ? flagsArg.items.map((f) => toInt32(vm, f)) : fields.map(() => toInt32(vm, flagsArg ?? 0));
      const compares = fields.map((_f, i) => comparator(flags[i] ?? 0));
      const member = (o, f) => (o instanceof AVMObject ? o.get(f) : undefined);
      self.items.sort((x, y) => {
        for (let i = 0; i < fields.length; i++) {
          const c = compares[i](member(x, fields[i]), member(y, fields[i]));
          if (c) return c;
        }
        return 0;
      });
      return self;
    },
  });

  // --- String ---
  vm.stringProto = new AVMObject(vm, vm.objectProto);
  const self$ = (self) => str(self); // this を文字列にする
  defineMethods(vm, vm.stringProto, {
    toString: (_, self) => self$(self),
    valueOf: (_, self) => self$(self),
    charAt: (_, self, [i]) => self$(self).charAt(toInt32(vm, i)),
    charCodeAt: (_, self, [i]) => self$(self).charCodeAt(toInt32(vm, i)),
    concat: (_, self, args) => self$(self) + args.map(str).join(''),
    indexOf: (_, self, [s, from]) => self$(self).indexOf(str(s), from === undefined ? 0 : toInt32(vm, from)),
    lastIndexOf: (_, self, [s, from]) => self$(self).lastIndexOf(str(s), from === undefined ? Infinity : toInt32(vm, from)),
    slice: (_, self, [start, end]) => self$(self).slice(toInt32(vm, start), end === undefined ? undefined : toInt32(vm, end)),
    substring: (_, self, [start, end]) => self$(self).substring(toInt32(vm, start), end === undefined ? undefined : toInt32(vm, end)),
    substr: (_, self, [start, length]) => {
      const s = self$(self);
      const from = clampIndex(toInt32(vm, start), s.length);
      return length === undefined ? s.slice(from) : s.slice(from, from + Math.max(0, toInt32(vm, length)));
    },
    split: (_, self, [sep, limit]) => {
      const s = self$(self);
      const parts = sep === undefined ? [s] : s.split(str(sep));
      return new AVMArray(vm, limit === undefined ? parts : parts.slice(0, Math.max(0, toInt32(vm, limit))));
    },
    toLowerCase: (_, self) => self$(self).toLowerCase(),
    toUpperCase: (_, self) => self$(self).toUpperCase(),
  });
  const stringCtor = defineClass(vm, 'String', vm.stringProto,
    (_, __, args) => (args.length ? str(args[0]) : ''),
    (_, args, proto) => wrapper(vm, proto, args.length ? str(args[0]) : ''));
  defineMethods(vm, stringCtor, {
    fromCharCode: (_, __, codes) => String.fromCharCode(...codes.slice(0, 65536).map((c) => toInt32(vm, c) & 0xffff)),
  });

  // --- Number ---
  vm.numberProto = new AVMObject(vm, vm.objectProto);
  defineMethods(vm, vm.numberProto, {
    toString: (_, self, [radix]) => {
      const n = num(self);
      const r = radix === undefined ? 10 : toInt32(vm, radix);
      return r >= 2 && r <= 36 && r !== 10 ? Math.trunc(n).toString(r) : numberToString(n);
    },
    valueOf: (_, self) => num(self),
  });
  const numberCtor = defineClass(vm, 'Number', vm.numberProto,
    (_, __, args) => (args.length ? num(args[0]) : 0),
    (_, args, proto) => wrapper(vm, proto, args.length ? num(args[0]) : 0));
  for (const [name, value] of Object.entries({
    MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: Number.MIN_VALUE, NaN, NEGATIVE_INFINITY: -Infinity, POSITIVE_INFINITY: Infinity,
  })) numberCtor.define(name, value, HIDDEN | READ_ONLY);

  // --- Boolean ---
  vm.booleanProto = new AVMObject(vm, vm.objectProto);
  defineMethods(vm, vm.booleanProto, {
    toString: (_, self) => (toBool(vm, self instanceof AVMObject ? self.primitive : self) ? 'true' : 'false'),
    valueOf: (_, self) => toBool(vm, self instanceof AVMObject ? self.primitive : self),
  });
  defineClass(vm, 'Boolean', vm.booleanProto,
    (_, __, [v]) => toBool(vm, v),
    (_, [v], proto) => wrapper(vm, proto, toBool(vm, v)));

  // --- Math ---
  const math = new AVMObject(vm, vm.objectProto);
  for (const name of ['E', 'LN2', 'LOG2E', 'LN10', 'LOG10E', 'PI', 'SQRT1_2', 'SQRT2']) math.define(name, Math[name], HIDDEN | READ_ONLY);
  const unary = ['abs', 'sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'floor', 'ceil', 'atan', 'asin', 'acos'];
  defineMethods(vm, math, {
    ...Object.fromEntries(unary.map((name) => [name, (_, __, [x]) => Math[name](num(x))])),
    round: (_, __, [x]) => Math.floor(num(x) + 0.5),
    atan2: (_, __, [y, x]) => Math.atan2(num(y), num(x)),
    pow: (_, __, [x, y]) => Math.pow(num(x), num(y)),
    min: (_, __, [a, b]) => (a === undefined ? Infinity : b === undefined ? NaN : Math.min(num(a), num(b))),
    max: (_, __, [a, b]) => (a === undefined ? -Infinity : b === undefined ? NaN : Math.max(num(a), num(b))),
    random: () => vm.random(),
  });
  g.define('Math', math, DONT_ENUM);

  installDate(vm);

  // --- Error ---
  const errorProto = new AVMObject(vm, vm.objectProto);
  errorProto.define('message', 'Error', DONT_ENUM);
  errorProto.define('name', 'Error', DONT_ENUM);
  defineMethods(vm, errorProto, { toString: (_, self) => str(self instanceof AVMObject ? self.get('message') : self) });
  const newError = (args, proto) => {
    const obj = new AVMObject(vm, proto);
    if (args.length) obj.set('message', str(args[0]));
    return obj;
  };
  defineClass(vm, 'Error', errorProto, (_, __, args) => newError(args, errorProto), (_, args, proto) => newError(args, proto));

  // setInterval(関数, ミリ秒, 引数...) または setInterval(オブジェクト, "メソッド名", ミリ秒, 引数...)。
  const MAX_TIMERS = 1000;
  const addTimer = (args, once) => {
    const byMethod = !(args[0] instanceof AVMFunction);
    if (byMethod && !(args[0] instanceof AVMObject)) return undefined;
    const interval = num(args[byMethod ? 2 : 1]);
    if (Number.isNaN(interval) || vm.timers.size >= MAX_TIMERS) return undefined;
    const id = vm.nextTimer++;
    vm.timers.set(id, {
      id, once, interval: Math.max(1, interval), next: vm.now() + Math.max(1, interval),
      fn: byMethod ? null : args[0], object: byMethod ? args[0] : null, method: byMethod ? str(args[1]) : null,
      args: args.slice(byMethod ? 3 : 2),
    });
    return id;
  };

  // --- Mouse と Key ---
  // どちらも登録したリスナーへイベントを配る。イベントはプレイヤー (player/movie.js) が vm.broadcast で起こす。
  for (const name of ['Mouse', 'Key', 'Stage']) {
    const object = new AVMObject(vm, vm.objectProto);
    const list = vm.listeners[name];
    defineMethods(vm, object, {
      addListener: (_, __, [listener]) => {
        if (!(listener instanceof AVMObject)) return false;
        if (!list.includes(listener) && list.length < 1000) list.push(listener);
        return true;
      },
      removeListener: (_, __, [listener]) => {
        const at = list.indexOf(listener);
        if (at >= 0) list.splice(at, 1);
        return at >= 0;
      },
    });
    g.define(name, object, DONT_ENUM);
  }
  // hide / show は、呼ぶ前にカーソルが見えていたかを 1 / 0 で返す（実機で確認）。
  const cursor = (visible) => () => {
    const before = vm.mouseVisible ? 1 : 0;
    vm.mouseVisible = visible;
    return before;
  };
  defineMethods(vm, g.get('Mouse'), { hide: cursor(false), show: cursor(true) });
  defineMethods(vm, g.get('Key'), {
    getCode: () => vm.key.code,
    getAscii: () => vm.key.ascii,
    isDown: (_, __, [code]) => vm.key.down.has(toInt32(vm, code)),
    isToggled: () => false,
  });
  const KEYS = {
    BACKSPACE: 8, CAPSLOCK: 20, CONTROL: 17, DELETEKEY: 46, DOWN: 40, END: 35, ENTER: 13, ESCAPE: 27, HOME: 36, INSERT: 45,
    LEFT: 37, PGDN: 34, PGUP: 33, RIGHT: 39, SHIFT: 16, SPACE: 32, TAB: 9, UP: 38,
  };
  for (const [name, code] of Object.entries(KEYS)) g.get('Key').define(name, code, HIDDEN);

  // --- 大域関数と定数 ---
  g.define('NaN', NaN, DONT_ENUM);
  g.define('Infinity', Infinity, DONT_ENUM);
  defineMethods(vm, g, {
    isNaN: (_, __, [v]) => Number.isNaN(num(v)),
    isFinite: (_, __, [v]) => Number.isFinite(num(v)),
    parseInt: (_, __, [s, radix]) => {
      const text = str(s).replace(/^[\t\n\r ]+/, '');
      const r = radix === undefined ? undefined : toInt32(vm, radix);
      // 0x 始まりは 16 進。基数の指定が無く 0 始まりで 8 進の数字だけなら 8 進として読む。
      if (r === undefined && /^[+-]?0[0-7]+$/.test(text)) return parseInt(text, 8);
      return parseInt(text, r);
    },
    parseFloat: (_, __, [s]) => parseFloat(str(s)),
    escape: (_, __, [s]) => encodeURIComponent(str(s)).replace(/[!'()*~._-]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    unescape: (_, __, [s]) => {
      try {
        return decodeURIComponent(str(s));
      } catch {
        return str(s);
      }
    },
    getTimer: () => Math.floor(vm.now()),
    setInterval: (_, __, args) => addTimer(args, false),
    setTimeout: (_, __, args) => addTimer(args, true),
    clearInterval: (_, __, [id]) => { vm.timers.delete(toInt32(vm, id)); },
    clearTimeout: (_, __, [id]) => { vm.timers.delete(toInt32(vm, id)); },
    updateAfterEvent: () => undefined,
    // プロパティの属性を変える。props は null（全部）、"a,b" の文字列、または配列。
    ASSetPropFlags: (_, __, [obj, props, set, clear]) => {
      if (!(obj instanceof AVMObject)) return undefined;
      const names = props === null || props === undefined ? null
        : (props instanceof AVMArray ? props.items.map(str) : str(props).split(',')).map((n) => obj.key(n));
      obj.setFlags(names, toInt32(vm, set ?? 0) & 7, toInt32(vm, clear ?? 0) & 7);
      return undefined;
    },
  });

  installMovieClip(vm);
  installFilters(vm);
  installStage(vm);
  installTextField(vm);
  installNet(vm);
  installXML(vm);
  installSound(vm);
  installVideo(vm);
}
