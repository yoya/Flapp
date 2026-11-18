// Date。時刻は 1970-01-01 UTC からのミリ秒を数値のまま持つ。年月日などの計算は JS の Date に任せる（時差はホストの設定）。
import { ASObject } from './object.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');
const FIELDS = ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds'];
// 設定できる項目と、いっしょに渡せる引数の数（setHours(時, 分, 秒, ミリ秒) など）。
const SETTERS = [['FullYear', 3], ['Month', 2], ['Date', 1], ['Hours', 4], ['Minutes', 3], ['Seconds', 2], ['Milliseconds', 1]];

const YEAR_FROM = 70; // 日付の文字列で、これ以上の 2 桁の数は年として読む

const zone = (d) => {
  const offset = -d.getTimezoneOffset();
  return `GMT${offset < 0 ? '-' : '+'}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`;
};
const clock = (d) => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
const clock12 = (d) => `${two(d.getHours() % 12 || 12)}:${two(d.getMinutes())}:${two(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
const day = (d) => `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
// 書式は実機の出力に合わせてある。
const FORMATS = {
  toString: (d) => `${day(d)} ${clock(d)} ${zone(d)} ${d.getFullYear()}`,
  toDateString: (d) => `${day(d)} ${d.getFullYear()}`,
  toTimeString: (d) => `${clock(d)} ${zone(d)}`,
  toLocaleString: (d) => `${day(d)} ${d.getFullYear()} ${clock12(d)}`,
  toLocaleDateString: (d) => `${day(d)} ${d.getFullYear()}`,
  toLocaleTimeString: (d) => clock12(d),
  toUTCString: (d) => `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} ${d.getUTCFullYear()} UTC`,
};

/**
 * 日付の文字列を読む。読めなければ NaN。受け付ける形は実機の Date.parse に合わせる:
 * 曜日（無視）、月の名前、"月/日/年"、"時:分:秒"、AM / PM、GMT±hhmm や UTC、4 桁の年、日。
 */
function parseDate(text) {
  let year, month, date, hours = 0, minutes = 0, seconds = 0, offset;
  let clocked = false;
  let timed = false; // 直前の語が時刻だったか（AM / PM は時刻の直後にだけ書ける）
  for (const token of text.trim().split(/[\s,]+/).filter(Boolean)) {
    const afterTime = timed;
    timed = false;
    let m;
    if ((m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(token))) {
      if (clocked) return NaN; // 時刻は 1 つだけ
      clocked = true;
      [hours, minutes, seconds] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
      timed = true;
    } else if ((m = /^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/.exec(token))) {
      // 4 桁で始まれば 年/月/日、そうでなければ 月/日/年
      if (m[1].length > 2) [year, month, date] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
      else [month, date, year] = [Number(m[1]) - 1, Number(m[2]), Number(m[3])];
    } else if (token === 'UTC') offset = 0;
    else if (token === 'GMT') continue; // 時差の付かない GMT は無視される（地方時として読む）
    else if ((m = /^(?:GMT|UTC)?([+-])(\d{2})(\d{2})?$/.exec(token))) offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
    else if (token === 'AM' || token === 'PM') {
      if (!afterTime || hours > 12) return NaN;
      if (token === 'PM' && hours < 12) hours += 12;
      if (token === 'AM' && hours === 12) hours = 0;
    } else if (/^\d+$/.test(token)) {
      // 3 桁以上か、70 以上の数は年（2 桁なら 1900 年代）。それ以外は日で、2 つ目の日があれば読めない。
      const n = Number(token);
      if (token.length > 2 || n >= YEAR_FROM) {
        if (year !== undefined) return NaN;
        year = n;
      } else if (date === undefined) date = n;
      else return NaN;
    } else if (MONTHS.includes(token)) month = MONTHS.indexOf(token); // 月と曜日の名前は、この 3 文字の形だけ
    else if (!DAYS.includes(token)) return NaN;
  }
  if (year === undefined || month === undefined || date === undefined) return NaN;
  if (offset === undefined) return new Date(year, month, date, hours, minutes, seconds).getTime();
  return Date.UTC(year, month, date, hours, minutes, seconds) - offset * 60000;
}

export function installDate(vm) {
  const c = vm.classes;
  const num = (v) => vm.toNumber(v);
  // 時刻は整数のミリ秒で、±8.64e15 を超えると NaN（実機で確認）。
  const clip = (t) => (Math.abs(t) <= 8.64e15 ? Math.trunc(t) : NaN);
  const getter = (name) => (self) => (Number.isNaN(self.time) ? NaN : new Date(self.time)[name]());
  // JS の同名の setter をそのまま使う。渡された引数の数だけ渡す（省略された部分は変えない）。
  const setter = (name, count) => (self, args) => {
    const d = new Date(self.time);
    d[name](...args.slice(0, count).map(num));
    self.time = d.getTime();
    return self.time;
  };
  const methods = {
    getTime: (self) => self.time,
    valueOf: (self) => self.time,
    setTime: (self, [v]) => { self.time = clip(num(v)); return self.time; },
    getTimezoneOffset: getter('getTimezoneOffset'),
  };
  const getters = { time: (self) => self.time, timezoneOffset: getter('getTimezoneOffset') };
  const setters = { time: (self, v) => { self.time = clip(num(v)); } };
  const lower = (name) => name[0].toLowerCase() + name.slice(1);
  for (const name of FIELDS) {
    for (const utc of ['', 'UTC']) {
      methods[`get${utc}${name}`] = getter(`get${utc}${name}`);
      getters[`${lower(name)}${utc}`] = getter(`get${utc}${name}`); // d.fullYear、d.fullYearUTC
    }
  }
  for (const [name, count] of SETTERS) {
    for (const utc of ['', 'UTC']) {
      methods[`set${utc}${name}`] = setter(`set${utc}${name}`, count);
      const set = setter(`set${utc}${name}`, 1);
      setters[`${lower(name)}${utc}`] = (self, v) => { set(self, [v]); };
    }
  }
  for (const [name, format] of Object.entries(FORMATS)) methods[name] = (self) => (Number.isNaN(self.time) ? 'Invalid Date' : format(new Date(self.time)));

  c.Date = vm.defineClass({
    name: 'Date', final: true, dynamic: true,
    allocate: (klass) => Object.assign(new ASObject(klass), { time: NaN }),
    // new Date() は現在時刻、new Date(ミリ秒)、new Date("文字列")、new Date(年, 月, 日, 時, 分, 秒, ミリ秒)（地方時）。
    // 時刻は整数のミリ秒で持つ（小数部は捨てる。実機で確認）。
    construct: (self, args) => {
      if (args.length === 0) self.time = Date.now();
      else if (args.length === 1) self.time = typeof args[0] === 'string' ? parseDate(args[0]) : clip(num(args[0]));
      else {
        const n = args.map(num);
        self.time = new Date(n[0], n[1], n[2] ?? 1, n[3] ?? 0, n[4] ?? 0, n[5] ?? 0, n[6] ?? 0).getTime();
      }
    },
    callAsFunction: () => FORMATS.toString(new Date()), // Date() は、現在時刻の文字列
    methods, getters, setters,
    prototypeMethods: { toJSON: (self) => (Number.isNaN(self.time) ? 'Invalid Date' : FORMATS.toString(new Date(self.time))) }, // JSON では、文字列になる
    staticMethods: {
      UTC: (_, args) => { const n = args.map(num); return Date.UTC(n[0], n[1], n[2] ?? 1, n[3] ?? 0, n[4] ?? 0, n[5] ?? 0, n[6] ?? 0); },
      parse: (_, [text]) => parseDate(vm.toStr(text)),
    },
  });
}
