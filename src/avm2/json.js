// JSON。解析も文字列化も自前で行う（深さと結果の長さに上限を設ける）。
import { ASArray, ASFunction, ASObject, ASVector, AVM2LimitError, PUBLIC, publicKey } from './object.js';

const MAX_DEPTH = 500; // 入れ子の深さの上限
const MAX_TEXT = 1 << 24; // 文字列化の結果の長さの上限
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const QUOTED = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

export function installJSON(vm) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const name = (key) => vm.keyName(key);

  const parse = (text) => {
    let pos = 0;
    const fail = () => vm.throwError('SyntaxError', 1132, 'Invalid JSON parse input.');
    const space = () => { while (pos < text.length && ' \t\n\r'.includes(text[pos])) pos++; };
    const string = () => {
      let out = '';
      for (pos++; ; pos++) {
        const ch = text[pos];
        if (ch === undefined || ch < ' ') return fail();
        if (ch === '"') { pos++; return out; }
        if (ch !== '\\') { out += ch; continue; }
        const e = text[++pos];
        if (e === 'u') {
          const hex = text.substr(pos + 1, 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail();
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 4;
        } else if (e in ESCAPES) out += ESCAPES[e];
        else return fail();
      }
    };
    const value = (depth) => {
      vm.step(1);
      if (depth > MAX_DEPTH) return fail();
      space();
      const ch = text[pos];
      if (ch === '"') return string();
      if (ch === '{') {
        const obj = new ASObject(c.Object);
        pos++;
        space();
        if (text[pos] === '}') { pos++; return obj; }
        for (;;) {
          space();
          if (text[pos] !== '"') return fail();
          const key = string();
          space();
          if (text[pos++] !== ':') return fail();
          vm.charge(1);
          obj.values.set(publicKey(key), value(depth + 1));
          space();
          if (text[pos] === '}') { pos++; return obj; }
          if (text[pos++] !== ',') return fail();
        }
      }
      if (ch === '[') {
        const items = [];
        pos++;
        space();
        if (text[pos] === ']') { pos++; return new ASArray(vm, items); }
        for (;;) {
          items.push(value(depth + 1));
          space();
          if (text[pos] === ']') { pos++; return new ASArray(vm, items); }
          if (text[pos++] !== ',') return fail();
        }
      }
      for (const [word, v] of [['true', true], ['false', false], ['null', null]]) {
        if (text.startsWith(word, pos)) { pos += word.length; return v; }
      }
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(pos, pos + 400)); // 先頭の 0 は許される（"01" は 1。実機で確認）
      if (!m) return fail();
      pos += m[0].length;
      return Number(m[0]);
    };
    const result = value(0);
    space();
    if (pos < text.length) fail();
    return result;
  };
  // reviver: 末端から順に (名前, 値) で呼び、返った値に置き換える（undefined なら、その項目を消す）。
  const revive = (holder, key, fn, depth) => {
    const v = vm.getProperty(holder, name(key));
    if (v instanceof ASObject && depth < MAX_DEPTH) {
      for (const k of vm.enumerate(v)) {
        const next = revive(v, k, fn, depth + 1);
        if (next === undefined) vm.deleteProperty(v, name(k));
        else vm.setProperty(v, name(k), next);
      }
    }
    return vm.call(fn, holder, [typeof key === 'number' ? String(key) : key, v]);
  };

  const quote = (s) => `"${s.replace(/["\\\u0000-\u001f]/g, (ch) => QUOTED[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
  // 文字列化する項目の名前。クラスのインスタンスは、公開の変数と読み取りのできるアクセサ、それに動的なプロパティ。
  const keysOf = (obj) => {
    const keys = [];
    for (const trait of obj.klass?.instanceTraits.values() ?? []) {
      if (trait.key.startsWith(`${PUBLIC}|`) && (trait.kind === 'slot' || trait.kind === 'const' || (trait.kind === 'accessor' && trait.get))) keys.push(trait.name);
    }
    return [...keys, ...vm.enumerate(obj).filter((k) => !(k instanceof ASObject))];
  };
  const stringify = (root, replacer, gap) => {
    const allowed = replacer instanceof ASArray ? new Set(replacer.items.filter((k) => typeof k === 'string' || typeof k === 'number').map(str)) : null;
    const fn = replacer instanceof ASFunction ? replacer : null;
    const stack = new Set();
    let length = 0;
    const emit = (text) => { length += text.length; if (length > MAX_TEXT) throw new AVM2LimitError('string is too long'); return text; };
    // holder[key] の値 v を文字列にする。出力しない値（undefined や関数）は undefined を返す。
    const write = (holder, key, v, indent) => {
      vm.step(1);
      if (v instanceof ASObject && !(v instanceof ASFunction)) {
        const toJSON = vm.hasProperty(v, name('toJSON')) ? vm.getProperty(v, name('toJSON')) : undefined;
        if (toJSON instanceof ASFunction) v = vm.call(toJSON, v, [String(key)]);
      }
      if (fn) v = vm.call(fn, holder, [String(key), v]);
      if (v === null) return emit('null');
      if (typeof v === 'boolean') return emit(String(v));
      if (typeof v === 'number') return emit(Number.isFinite(v) ? str(v) : 'null');
      if (typeof v === 'string') return emit(quote(v));
      if (!(v instanceof ASObject) || v instanceof ASFunction) return undefined;
      if (stack.has(v)) vm.throwError('TypeError', 1129, 'Cyclic structure cannot be converted to JSON string.');
      if (stack.size > MAX_DEPTH) vm.throwError('Error', 1023, 'Stack overflow occurred.');
      stack.add(v);
      const inner = indent + gap;
      const list = v instanceof ASArray || v instanceof ASVector;
      const parts = [];
      if (list) for (let i = 0; i < v.items.length; i++) parts.push(write(v, i, v.items[i], inner) ?? emit('null'));
      else {
        for (const k of keysOf(v)) {
          if (allowed && !allowed.has(String(k))) continue;
          const text = write(v, k, vm.getProperty(v, name(k)), inner);
          if (text !== undefined) parts.push(emit(`${quote(String(k))}:${gap ? ' ' : ''}`) + text);
        }
      }
      stack.delete(v);
      length += (parts.length + 1) * (inner.length + 2); // 区切りと字下げのぶん
      emit('');
      const [open, close] = list ? '[]' : '{}';
      if (!parts.length) return open + close;
      return gap ? `${open}\n${inner}${parts.join(`,\n${inner}`)}\n${indent}${close}` : open + parts.join(',') + close;
    };
    const holder = new ASObject(c.Object);
    holder.values.set(publicKey(''), root);
    return write(holder, '', root, '') ?? 'null'; // 出力できない値（undefined や関数）は "null"
  };

  vm.defineClass({
    name: 'JSON', final: true,
    staticMethods: {
      parse: (_, [text, reviver]) => {
        if (text === null || text === undefined) vm.throwError('SyntaxError', 1132, 'Invalid JSON parse input.');
        const result = parse(str(text));
        if (!(reviver instanceof ASFunction)) return result;
        const holder = new ASObject(c.Object);
        holder.values.set(publicKey(''), result);
        return revive(holder, '', reviver, 0);
      },
      stringify: (_, [value, replacer, space]) => {
        if (replacer !== undefined && replacer !== null && !(replacer instanceof ASFunction) && !(replacer instanceof ASArray)) {
          vm.throwError('TypeError', 1131, 'Replacer argument to JSON stringifier must be an array or a two parameter function.');
        }
        const gap = typeof space === 'number' ? ' '.repeat(Math.min(Math.max(Math.trunc(space), 0), 10)) : typeof space === 'string' ? space.slice(0, 10) : '';
        return stringify(value, replacer, gap);
      },
    },
  });
}
