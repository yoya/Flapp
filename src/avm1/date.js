// Date。時刻は 1970-01-01 UTC からのミリ秒を数値のまま持つ（実機は new Date(1.9).getTime() が 1.9 になる）。
// 年月日などの計算は JS の Date に任せる。実機と違う所だけ自前で扱う。
import { toNumber } from './convert.js';
import { AVMObject } from './object.js';
import { defineClass, defineMethods } from './globals.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

// 実機の書式: "Thu Jan 1 09:00:00 GMT+0900 1970"
function format(t) {
  if (Number.isNaN(t)) return 'Invalid Date';
  const d = new Date(t);
  const offset = -d.getTimezoneOffset();
  const zone = `${offset < 0 ? '-' : '+'}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`;
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} GMT${zone} ${d.getFullYear()}`;
}

export function installDate(vm) {
  const proto = new AVMObject(vm, vm.objectProto);
  const time = (self) => (self instanceof AVMObject && typeof self.time === 'number' ? self.time : NaN);
  // 引数の数値。undefined などの数値にならない値は 0 として扱う（実機で確認）。
  const int = (v) => { const n = toNumber(vm, v); return Number.isNaN(n) ? 0 : n; };
  const getter = (name) => (_, self) => {
    const t = time(self);
    return Number.isNaN(t) ? NaN : new Date(t)[name]();
  };
  // JS の同名の setter をそのまま使う。渡された引数の数だけ渡す（省略された部分は変えない）。
  const setter = (name, count) => (_, self, args) => {
    if (!(self instanceof AVMObject)) return undefined;
    const d = new Date(time(self));
    d[name](...args.slice(0, count).map(int));
    self.time = d.getTime();
    return self.time;
  };
  // 月だけを変えるとき、日がその月に無ければ月末に寄せる（1 月 31 日で setMonth(1) は 2 月 29 日。実機で確認）。
  const setMonth = (utc) => (_, self, args) => {
    if (!(self instanceof AVMObject)) return undefined;
    const d = new Date(time(self));
    const [get, set, year] = utc ? ['getUTCDate', 'setUTCMonth', 'getUTCFullYear'] : ['getDate', 'setMonth', 'getFullYear'];
    if (args.length >= 2) d[set](int(args[0]), int(args[1]));
    else {
      const day = d[get]();
      d[utc ? 'setUTCDate' : 'setDate'](1);
      d[set](int(args[0]));
      const last = new Date(Date.UTC(d[year](), d[utc ? 'getUTCMonth' : 'getMonth']() + 1, 0)).getUTCDate();
      d[utc ? 'setUTCDate' : 'setDate'](Math.min(day, last));
    }
    self.time = d.getTime();
    return self.time;
  };
  const methods = {
    getTime: (_, self) => time(self),
    valueOf: (_, self) => time(self),
    setTime: (_, self, [v]) => {
      if (self instanceof AVMObject) self.time = toNumber(vm, v);
      return time(self);
    },
    getYear: (_, self) => { const t = time(self); return Number.isNaN(t) ? NaN : new Date(t).getFullYear() - 1900; },
    // setYear: 0〜99 は 1900 年代
    setYear: (_, self, [v]) => {
      if (!(self instanceof AVMObject)) return undefined;
      const y = int(v);
      const d = new Date(time(self));
      d.setFullYear(y >= 0 && y <= 99 ? 1900 + y : y);
      self.time = d.getTime();
      return self.time;
    },
    setMonth: setMonth(false),
    setUTCMonth: setMonth(true),
    toString: (_, self) => format(time(self)),
  };
  for (const name of ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds']) {
    methods[`get${name}`] = getter(`get${name}`);
    methods[`getUTC${name}`] = getter(`getUTC${name}`);
  }
  methods.getTimezoneOffset = getter('getTimezoneOffset');
  for (const [name, count] of [['FullYear', 3], ['Date', 1], ['Hours', 4], ['Minutes', 3], ['Seconds', 2], ['Milliseconds', 1]]) {
    methods[`set${name}`] = setter(`set${name}`, count);
    methods[`setUTC${name}`] = setter(`setUTC${name}`, count);
  }
  defineMethods(vm, proto, methods);

  const create = (args, to) => {
    const obj = new AVMObject(vm, to);
    if (args.length === 0 || args[0] === undefined) obj.time = Date.now(); // new Date(undefined) も現在時刻
    else if (args.length === 1) obj.time = toNumber(vm, args[0]);
    else {
      const n = args.map(int);
      obj.time = new Date(n[0], n[1], n[2] ?? 1, n[3] ?? 0, n[4] ?? 0, n[5] ?? 0, n[6] ?? 0).getTime();
    }
    return obj;
  };
  const ctor = defineClass(vm, 'Date', proto, () => format(Date.now()), (_, args, to) => create(args, to));
  defineMethods(vm, ctor, {
    // 年と月が無ければ undefined（実機で確認）
    UTC: (_, __, args) => {
      if (args.length < 2) return undefined;
      const n = args.map(int);
      return Date.UTC(n[0], n[1], n[2] ?? 1, n[3] ?? 0, n[4] ?? 0, n[5] ?? 0, n[6] ?? 0);
    },
  });
}
