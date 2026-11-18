// 正規表現 (RegExp) と、それを使う String のメソッド。
//
// パターンはここで解析し、後戻りつきの照合もここで行う（SWF から来たパターンを、ホストの RegExp には渡さない）。
// 照合の 1 手ごとに実行時間の上限を消費するので、後戻りが爆発するパターンでも、上限でスクリプトが止まるだけで済む。
// 文法は実機（PCRE を JavaScript 互換の設定で使っている）に合わせる: $ は末尾の改行の手前にも合う、[] は何にも合わない、
// まだ合っていない括弧への後方参照は空文字列に合う、など。
import { ASArray, ASFunction, ASObject, AVM2LimitError, publicKey } from './object.js';

const MAX_PATTERN = 20000; // パターンの長さの上限
const MAX_NESTING = 100; // 括弧の入れ子の上限
const MAX_REPEAT = 65535; // {n,m} の上限
const MAX_TEXT = 1 << 24; // 置換の結果の長さの上限
const MAX_MATCH_STEPS = 2e6; // 1 回の照合の手数の上限。超えたら「合わない」として打ち切る（実機の PCRE にも同様の上限がある）

class PatternError extends Error {}

// 文字の種類は Unicode の分類で決まる（実機で確認: \w は é や「あ」に、\d は全角の数字に、\s は全角の空白に合う）。
// ここで使うホストの正規表現は、どれも固定のパターンを 1 文字に当てるだけ。
const unicode = (pattern) => (c) => c >= 128 && pattern.test(String.fromCharCode(c));
const isLetter = unicode(/\p{L}/u), isNumber = unicode(/\p{N}/u), isDecimal = unicode(/\p{Nd}/u), isSeparator = unicode(/\p{Z}/u);
const isUpper = unicode(/\p{Lu}/u), isLower = unicode(/\p{Ll}/u);
const isDigit = (c) => (c >= 48 && c <= 57) || isDecimal(c);
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || isLetter(c);
const isWord = (c) => (c >= 48 && c <= 57) || isAlpha(c) || c === 95 || isNumber(c);
const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13 || isSeparator(c); // 垂直タブ (11) は含まない
const CLASSES = { d: isDigit, w: isWord, s: isSpace };
const POSIX = {
  alpha: isAlpha, digit: isDigit, alnum: (c) => isWord(c) && c !== 95, word: isWord, space: (c) => isSpace(c) || c === 11,
  upper: (c) => (c >= 65 && c <= 90) || isUpper(c), lower: (c) => (c >= 97 && c <= 122) || isLower(c),
  xdigit: (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102),
  punct: (c) => c > 32 && c < 127 && !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)), blank: (c) => c === 32 || c === 9, cntrl: (c) => c < 32 || c === 127,
  print: (c) => c >= 32 && c < 127, graph: (c) => c > 32 && c < 127, ascii: (c) => c < 128,
};
const ESCAPES = { n: 10, r: 13, t: 9, f: 12, v: 11, e: 27, a: 7 };

/**
 * パターンを木にする。{ node, groups（括弧の数）, names（名前 → 番号）} を返す。文法の誤りは PatternError。
 * initial は { i, m, s, x }。パターンの中の (?i) などで切り替わるので、各要素がそのときの設定を持つ。
 */
function parse(source, initial) {
  if (source.length > MAX_PATTERN) throw new PatternError();
  let flags = { ...initial };
  let pos = 0;
  let groups = 0;
  let depth = 0;
  const names = new Map();
  const refs = []; // 後方参照（番号や名前の確認は、全体を読み終えてから）
  const fail = () => { throw new PatternError(); };
  const eat = (text) => (source.startsWith(text, pos) ? ((pos += text.length), true) : false);
  // x フラグ: 空白と、# から行末までを読み飛ばす。
  const skip = () => {
    if (!flags.x) return;
    for (;;) {
      if (/\s/.test(source[pos] ?? '')) pos++;
      else if (source[pos] === '#') while (pos < source.length && source[pos] !== '\n') pos++;
      else return;
    }
  };
  const hex = (digits) => {
    const text = source.substr(pos, digits);
    if (text.length < digits || !/^[0-9a-fA-F]+$/.test(text)) return undefined;
    pos += digits;
    return parseInt(text, 16);
  };
  // \ の次の文字 e から、1 文字を表すエスケープの文字コードを得る。
  const escapedChar = (e) => {
    if (e in ESCAPES) return ESCAPES[e];
    if (e === '0') { const m = /^[0-7]{0,2}/.exec(source.slice(pos, pos + 2))[0]; pos += m.length; return parseInt(`0${m}`, 8); }
    if (e === 'x') return hex(2) ?? 0;
    if (e === 'u') return hex(4) ?? 117;
    if (e === 'c') return pos < source.length ? source.charCodeAt(pos++) & 31 : fail();
    return e.charCodeAt(0);
  };
  const classNode = (e) => ({ t: 'set', single: true, ic: false, negate: e !== e.toLowerCase(), items: [CLASSES[e.toLowerCase()]] });
  const set = () => {
    const negate = eat('^');
    const items = [];
    for (;;) {
      if (pos >= source.length) fail();
      if (source[pos] === ']') { pos++; break; } // [] は何にも合わず、[^] は何にでも合う
      // 範囲の端、または文字の集まり（\d や [:alpha:]）をひとつ読む。
      const member = () => {
        const ch = source[pos++];
        if (ch === '[' && source[pos] === ':') {
          const end = source.indexOf(':]', pos);
          const test = end < 0 ? undefined : POSIX[source.slice(pos + 1, end)];
          if (!test) fail();
          pos = end + 2;
          return test;
        }
        if (ch !== '\\') return ch.charCodeAt(0);
        if (pos >= source.length) fail();
        const e = source[pos++];
        if (CLASSES[e.toLowerCase()]) { const test = CLASSES[e.toLowerCase()]; return e === e.toLowerCase() ? test : (c) => !test(c); }
        return e === 'b' ? 8 : escapedChar(e);
      };
      const low = member();
      if (typeof low === 'function' || source[pos] !== '-' || source[pos + 1] === ']' || pos + 1 >= source.length) { items.push(low); continue; }
      pos++;
      const high = member();
      if (typeof high === 'function') items.push(low, 45, high);
      else if (high < low) fail();
      else items.push([low, high]);
    }
    return { t: 'set', single: true, ic: flags.i, negate, items };
  };
  const group = () => {
    if (++depth > MAX_NESTING) fail();
    const outer = { ...flags };
    let node;
    const options = /^\?([imsx]*)(?:-([imsx]*))?([:)])/.exec(source.slice(pos, pos + 12));
    if (eat('?#')) {
      // (?#...) は注釈
      const end = source.indexOf(')', pos);
      if (end < 0) fail();
      pos = end + 1;
      depth--;
      return { t: 'seq', items: [] };
    }
    if (options && (options[1] || options[2] !== undefined)) {
      // (?i) や (?s-i) は、囲んでいる括弧の終わりまで設定を切り替える。(?i:...) は、その括弧の中だけ。
      pos += options[0].length;
      for (const f of options[1]) flags[f] = true;
      for (const f of options[2] ?? '') flags[f] = false;
      if (options[3] === ')') {
        depth--;
        return { t: 'seq', items: [] };
      }
      node = { t: 'group', index: null, body: alternation() };
    } else if (eat('?')) {
      if (eat(':')) node = { t: 'group', index: null, body: alternation() };
      else if (eat('=')) node = { t: 'look', behind: false, negate: false, body: alternation() };
      else if (eat('!')) node = { t: 'look', behind: false, negate: true, body: alternation() };
      else if (eat('<=')) node = { t: 'look', behind: true, negate: false, body: alternation() };
      else if (eat('<!')) node = { t: 'look', behind: true, negate: true, body: alternation() };
      else if (eat('>')) node = { t: 'atomic', body: alternation() };
      else if (eat('P<') || eat('<')) {
        const end = source.indexOf('>', pos);
        const name = end < 0 ? '' : source.slice(pos, end);
        if (!/^[A-Za-z_]\w*$/.test(name) || names.has(name)) fail();
        pos = end + 1;
        const index = ++groups;
        names.set(name, index);
        node = { t: 'group', index, body: alternation() };
      } else fail();
    } else {
      const index = ++groups; // 番号は、開き括弧の順
      node = { t: 'group', index, body: alternation() };
    }
    if (!eat(')')) fail();
    depth--;
    flags = outer;
    return node;
  };
  const atom = () => {
    const ch = source[pos++];
    switch (ch) {
      case '(': return group();
      case '[': return set();
      case '.': return { t: 'any', single: true, dotall: flags.s };
      case '^': return { t: 'bol', multiline: flags.m };
      case '$': return { t: 'eol', multiline: flags.m };
      case '*': case '+': case '?': return fail(); // 繰り返すものが無い
      case '\\': {
        if (pos >= source.length) fail();
        const e = source[pos++];
        if (CLASSES[e.toLowerCase()]) return classNode(e);
        if (e === 'b' || e === 'B') return { t: 'word', negate: e === 'B' };
        if (e === 'A') return { t: 'start' };
        if (e === 'z') return { t: 'end' };
        if (e === 'Z') return { t: 'eol', multiline: false };
        if (e >= '1' && e <= '9') {
          const more = /^\d?/.exec(source.slice(pos, pos + 1))[0];
          pos += more.length;
          const node = { t: 'ref', ic: flags.i, index: Number(e + more) };
          refs.push(node);
          return node;
        }
        if (e === 'k') {
          const m = /^(?:<(\w+)>|\{(\w+)\}|'(\w+)')/.exec(source.slice(pos, pos + 64));
          if (!m) fail();
          pos += m[0].length;
          const node = { t: 'ref', ic: flags.i, name: m[1] ?? m[2] ?? m[3] };
          refs.push(node);
          return node;
        }
        return { t: 'char', single: true, ic: flags.i, code: escapedChar(e) };
      }
      default: return { t: 'char', single: true, ic: flags.i, code: ch.charCodeAt(0) };
    }
  };
  const quantified = (body) => {
    skip();
    let min, max;
    const braces = source[pos] === '{' ? /^\{(\d+)(?:(,)(\d*))?\}/.exec(source.slice(pos, pos + 16)) : null;
    if (eat('*')) [min, max] = [0, Infinity];
    else if (eat('+')) [min, max] = [1, Infinity];
    else if (eat('?')) [min, max] = [0, 1];
    else if (braces) {
      pos += braces[0].length;
      min = Number(braces[1]);
      max = !braces[2] ? min : braces[3] === '' ? Infinity : Number(braces[3]);
      if (min > MAX_REPEAT || (max !== Infinity && (max > MAX_REPEAT || max < min))) fail();
    } else return body;
    const node = { t: 'rep', body, min, max, lazy: eat('?') };
    return !node.lazy && eat('+') ? { t: 'atomic', body: node } : node; // X*+ は、後戻りしない X*
  };
  function sequence() {
    const items = [];
    for (;;) {
      skip();
      if (pos >= source.length || source[pos] === '|' || source[pos] === ')') break;
      items.push(quantified(atom()));
    }
    return items.length === 1 ? items[0] : { t: 'seq', items };
  }
  function alternation() {
    const alts = [sequence()];
    while (eat('|')) alts.push(sequence());
    return alts.length === 1 ? alts[0] : { t: 'alt', alts };
  }
  const node = alternation();
  if (pos < source.length) fail(); // 対応の取れない閉じ括弧
  for (const ref of refs) {
    if (ref.name !== undefined) ref.index = names.get(ref.name) ?? fail();
    if (ref.index > groups) fail();
  }
  return { node, groups, names };
}

/**
 * program を、文字列 s の位置 from 以降で照合する。合えば、各括弧の開始・終了位置の配列（0 番が全体）を返す。
 * @param step 照合の 1 手ごとに呼ぶ（実行時間の上限の消費）
 */
function search(program, s, from, charge) {
  const n = s.length;
  let budget = MAX_MATCH_STEPS;
  const step = (count) => {
    charge(count);
    budget -= count;
    if (budget < 0) throw new RangeError('regexp match limit');
  };
  const caps = new Array(program.groups * 2 + 2).fill(-1);
  const fold = (code) => { const t = String.fromCharCode(code).toLowerCase(); return t.length === 1 ? t.charCodeAt(0) : code; };
  const inSet = (node, code) => node.items.some((item) => (typeof item === 'number' ? item === code : typeof item === 'function' ? item(code) : code >= item[0] && code <= item[1]));
  // 1 文字に合う要素（文字、.、文字の集まり）が、位置 i の文字に合うか。
  const single = (node, i) => {
    if (i >= n) return false;
    const code = s.charCodeAt(i);
    if (node.t === 'any') return node.dotall || code !== 10;
    if (node.t === 'char') return code === node.code || (node.ic && fold(code) === fold(node.code));
    if (inSet(node, code)) return !node.negate;
    if (node.ic) {
      const text = s[i];
      const lower = text.toLowerCase(), upper = text.toUpperCase();
      if ((lower.length === 1 && lower !== text && inSet(node, lower.charCodeAt(0))) || (upper.length === 1 && upper !== text && inSet(node, upper.charCodeAt(0)))) return !node.negate;
    }
    return node.negate;
  };
  const wordAt = (i) => i >= 0 && i < n && isWord(s.charCodeAt(i));
  // node を位置 i で照合し、合ったら続き k(終わりの位置) を呼ぶ。全体が合えば true。
  const m = (node, i, k) => {
    step(1);
    switch (node.t) {
      case 'char': case 'any': case 'set': return single(node, i) && k(i + 1);
      case 'seq': {
        const next = (index, at) => (index === node.items.length ? k(at) : m(node.items[index], at, (j) => next(index + 1, j)));
        return next(0, i);
      }
      case 'alt': return node.alts.some((alt) => m(alt, i, k));
      case 'group': {
        if (node.index === null) return m(node.body, i, k);
        const g = node.index * 2;
        return m(node.body, i, (j) => {
          const a = caps[g], b = caps[g + 1];
          caps[g] = i;
          caps[g + 1] = j;
          if (k(j)) return true;
          caps[g] = a;
          caps[g + 1] = b;
          return false;
        });
      }
      case 'rep': {
        const { body, min, max, lazy } = node;
        if (body.single) {
          // 1 文字の繰り返しは、合うだけ進んでから、続きが合うところまで戻る（再帰しない）。
          let count = 0;
          while (count < max && single(body, i + count)) count++;
          step(count);
          if (count < min) return false;
          if (lazy) { for (let c = min; c <= count; c++) if (k(i + c)) return true; return false; }
          for (let c = count; c >= min; c--) if (k(i + c)) return true;
          return false;
        }
        const loop = (at, count) => {
          step(1);
          // 何も消費しない繰り返しは、最小回数を満たした後は続けない（無限に回らないように）。
          const more = () => count < max && m(body, at, (j) => (j !== at || count < min) && loop(j, count + 1));
          return lazy ? (count >= min && k(at)) || more() : more() || (count >= min && k(at));
        };
        return loop(i, 0);
      }
      case 'atomic': {
        const saved = caps.slice();
        let end = -1;
        if (m(node.body, i, (j) => { end = j; return true; }) && k(end)) return true;
        for (let x = 0; x < caps.length; x++) caps[x] = saved[x];
        return false;
      }
      case 'look': {
        const saved = caps.slice();
        let found = false;
        if (!node.behind) found = m(node.body, i, () => true);
        else for (let start = i; start >= 0 && !found; start--) found = m(node.body, start, (j) => j === i);
        if (found === node.negate) { for (let x = 0; x < caps.length; x++) caps[x] = saved[x]; return false; }
        if (node.negate) for (let x = 0; x < caps.length; x++) caps[x] = saved[x];
        if (k(i)) return true;
        for (let x = 0; x < caps.length; x++) caps[x] = saved[x];
        return false;
      }
      case 'ref': {
        const a = caps[node.index * 2], b = caps[node.index * 2 + 1];
        if (a < 0) return k(i); // まだ合っていない括弧への参照は、空文字列に合う
        const length = b - a;
        if (i + length > n) return false;
        step(length);
        for (let x = 0; x < length; x++) {
          const p = s.charCodeAt(a + x), q = s.charCodeAt(i + x);
          if (p !== q && !(node.ic && fold(p) === fold(q))) return false;
        }
        return k(i + length);
      }
      case 'bol': return (i === 0 || (node.multiline && s.charCodeAt(i - 1) === 10)) && k(i);
      // $ は、末尾と、末尾の改行の手前に合う（m フラグがあれば、どの改行の手前にも）。
      case 'eol': return (i === n || (s.charCodeAt(i) === 10 && (i === n - 1 || node.multiline))) && k(i);
      case 'start': return i === 0 && k(i);
      case 'end': return i === n && k(i);
      case 'word': return (wordAt(i - 1) !== wordAt(i)) !== node.negate && k(i);
      default: return false;
    }
  };
  try {
    for (let i = from; i <= n; i++) {
      caps.fill(-1);
      if (m(program.node, i, (j) => { caps[0] = i; caps[1] = j; return true; })) return caps;
    }
  } catch (e) {
    // 手数の上限を超えるか、再帰が深くなりすぎたら、合わなかったことにする（照合器は自分の状態にしか触れないので、ここで打ち切ってよい）。
    if (!(e instanceof RangeError)) throw e;
  }
  return null;
}

export function installRegExp(vm) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const step = (count) => vm.step(count);
  const isRegExp = (v) => v instanceof ASObject && !!v.regexp;
  const limit = (text) => { if (text.length > MAX_TEXT) throw new AVM2LimitError('string is too long'); return text; };

  /** 位置 from から探す。{ caps, text(番号) } か null。文法の誤りがあるパターンは、何にも合わない。 */
  const find = (re, s, from) => {
    const r = re.regexp;
    if (!r.program || from > s.length) return null;
    return search(r.program, s, Math.max(0, from), step);
  };
  const part = (s, caps, g) => (caps[g * 2] < 0 ? undefined : s.slice(caps[g * 2], caps[g * 2 + 1]));
  // exec の結果の配列: [全体, 括弧 1, ...]。index と input、名前つきの括弧の値を、プロパティとして持つ。
  const result = (re, s, caps) => {
    const out = new ASArray(vm, Array.from({ length: re.regexp.program.groups + 1 }, (_, g) => part(s, caps, g)));
    out.values.set(publicKey('index'), caps[0]);
    out.values.set(publicKey('input'), s);
    for (const [name, g] of re.regexp.program.names) out.values.set(publicKey(name), part(s, caps, g));
    return out;
  };
  const exec = (re, s) => {
    const r = re.regexp;
    const caps = find(re, s, r.global ? r.lastIndex : 0);
    if (r.global) r.lastIndex = caps ? caps[1] : 0; // 空の一致でも、位置は進めない（実機で確認）
    return caps ? result(re, s, caps) : null;
  };
  // s の中の、合うところを順に全部（重ならないように）。空の一致があったときは、
  // stopAtEmpty ならそこで打ち切り（match と split。実機で確認）、そうでなければ 1 文字進めて続ける（replace）。
  const all = (re, s, stopAtEmpty) => {
    const found = [];
    for (let at = 0; at <= s.length;) {
      const caps = find(re, s, at);
      if (!caps || (stopAtEmpty && caps[1] === caps[0])) break;
      found.push(caps);
      at = caps[1] === caps[0] ? caps[1] + 1 : caps[1];
      vm.charge(1);
    }
    return found;
  };

  c.RegExp = vm.defineClass({
    name: 'RegExp', dynamic: true,
    allocate: (klass) => Object.assign(new ASObject(klass), { regexp: { source: '', program: null, lastIndex: 0, global: false, ignoreCase: false, multiline: false, dotall: false, extended: false } }),
    construct: (self, [pattern, flags]) => {
      const r = self.regexp;
      if (isRegExp(pattern)) {
        Object.assign(r, pattern.regexp, { lastIndex: 0 });
        return;
      }
      r.source = pattern === undefined ? '' : str(pattern);
      const text = flags === undefined ? '' : str(flags);
      r.global = text.includes('g');
      r.ignoreCase = text.includes('i');
      r.multiline = text.includes('m');
      r.dotall = text.includes('s');
      r.extended = text.includes('x');
      vm.step(r.source.length);
      try {
        r.program = parse(r.source, { i: r.ignoreCase, m: r.multiline, s: r.dotall, x: r.extended });
      } catch (e) {
        if (!(e instanceof PatternError) && !(e instanceof RangeError)) throw e;
        r.program = null;
      }
    },
    callAsFunction: (args) => (isRegExp(args[0]) && args[1] === undefined ? args[0] : vm.construct(c.RegExp, args)),
    getters: {
      source: (self) => self.regexp.source, global: (self) => self.regexp.global, ignoreCase: (self) => self.regexp.ignoreCase,
      multiline: (self) => self.regexp.multiline, dotall: (self) => self.regexp.dotall, extended: (self) => self.regexp.extended,
      lastIndex: (self) => self.regexp.lastIndex,
    },
    setters: { lastIndex: (self, v) => { self.regexp.lastIndex = vm.toInt32(v); } },
    methods: {
      exec: (self, [s]) => exec(self, s === undefined ? '' : str(s)),
      test: (self, [s]) => exec(self, s === undefined ? '' : str(s)) !== null,
    },
    prototypeMethods: {
      toString: (self) => {
        const r = self.regexp;
        return `/${r.source}/${r.global ? 'g' : ''}${r.ignoreCase ? 'i' : ''}${r.multiline ? 'm' : ''}${r.dotall ? 's' : ''}${r.extended ? 'x' : ''}`;
      },
    },
  });

  // --- String のメソッドのうち、正規表現を受け取るもの ---
  const asRegExp = (pattern) => (isRegExp(pattern) ? pattern : vm.construct(c.RegExp, [pattern]));
  // 置換文字列の中の $ の記号を展開する: $$、$&、$`、$'、$1 ～ $99。
  const expand = (template, s, caps) => template.replace(/\$(\$|&|`|'|\d{1,2})/g, (whole, code) => {
    if (code === '$') return '$';
    if (code === '&') return s.slice(caps[0], caps[1]);
    if (code === '`') return s.slice(0, caps[0]);
    if (code === "'") return s.slice(caps[1]);
    const groups = caps.length / 2 - 1;
    // 2 桁の番号の括弧が無ければ、1 桁の番号と、それに続く数字として読む。
    const g = Number(code) <= groups ? Number(code) : Number(code[0]);
    if (g < 1 || g > groups) return whole;
    return (part(s, caps, g) ?? '') + (Number(code) <= groups ? '' : code.slice(1));
  });
  const methods = {
    match: (self, [pattern]) => {
      const re = asRegExp(pattern);
      if (!re.regexp.global) return exec(re, self);
      re.regexp.lastIndex = 0;
      return new ASArray(vm, all(re, self, true).map((caps) => self.slice(caps[0], caps[1])));
    },
    search: (self, [pattern]) => { const caps = find(asRegExp(pattern), self, 0); return caps ? caps[0] : -1; },
    replace: (self, [pattern, replacement]) => {
      vm.step(self.length >> 3);
      let matches;
      if (isRegExp(pattern)) {
        matches = pattern.regexp.global ? all(pattern, self, false) : [find(pattern, self, 0)].filter(Boolean);
        if (pattern.regexp.global) pattern.regexp.lastIndex = 0;
      } else {
        // 文字列のパターンは、そのままの文字列として、最初の 1 か所だけを置き換える。
        const at = self.indexOf(str(pattern));
        matches = at < 0 ? [] : [[at, at + str(pattern).length]];
      }
      let out = '';
      let last = 0;
      for (const caps of matches) {
        // 関数には (全体, 括弧 1, ..., 位置, 元の文字列) を渡す。合わなかった括弧は空文字列。$ の記号は、パターンが正規表現のときだけ展開する。
        const groups = Array.from({ length: caps.length / 2 }, (_, g) => part(self, caps, g) ?? '');
        const text = replacement instanceof ASFunction ? str(vm.call(replacement, null, [...groups, caps[0], self]))
          : isRegExp(pattern) ? expand(str(replacement), self, caps) : str(replacement);
        out = limit(out + self.slice(last, caps[0]) + text);
        last = caps[1];
      }
      return limit(out + self.slice(last));
    },
    split: (self, [separator, max]) => {
      const count = max === undefined ? 0xffffffff : vm.toUint32(max);
      vm.step(self.length >> 3);
      let parts;
      if (separator === undefined) parts = [self];
      else if (!isRegExp(separator)) parts = self.split(str(separator));
      else {
        parts = [];
        let last = 0;
        for (const caps of all(separator, self, true)) {
          parts.push(self.slice(last, caps[0]));
          for (let g = 1; g < caps.length / 2; g++) parts.push(part(self, caps, g));
          last = caps[1];
        }
        parts.push(self.slice(last));
      }
      return new ASArray(vm, parts.slice(0, count));
    },
  };
  for (const [name, impl] of Object.entries(methods)) {
    c.String.instanceTraits.set(publicKey(name), { kind: 'method', key: publicKey(name), name, fn: vm.native(impl, name) });
  }
}
