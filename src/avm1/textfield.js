// スクリプトから見たテキストフィールドと、TextField / TextFormat クラス。
// 表示リスト上の実体は player/movie.js の TextField。
import { MAGIC } from './clip.js';
import { toBool, toInt32, toNumber, toStr } from './convert.js';
import { defineClass, defineMethods } from './globals.js';
import { AVMFunction, AVMObject, DONT_ENUM, NONE } from './object.js';
import { cssPatch, mergeFormat, parseCSS } from '../player/richtext.js';

const DEPTH_OFFSET = 16384; // スクリプトの深度 0 は、表示リストの深度 16384
// TextFormat のプロパティ（コンストラクタの引数の順）と、それ以外。
const FORMAT_ARGS = ['font', 'size', 'color', 'bold', 'italic', 'underline', 'url', 'target', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading'];
const FORMAT_KEYS = [...FORMAT_ARGS, 'bullet', 'blockIndent', 'letterSpacing', 'kerning'];

// フィールド固有のプロパティ。get / set は表示オブジェクト f（player/movie.js の TextField）に対する操作。
const flag = (name) => ({ get: (f) => f[name], set: (f, v, vm) => { f[name] = toBool(vm, v); f.changed(); } });
const color = (name) => ({ get: (f) => f[name], set: (f, v, vm) => { f[name] = toInt32(vm, v) & 0xffffff; f.changed(); } });
const fixed = (value) => ({ get: () => value });
const PROPS = {
  // 読むときに、連動する変数の値を反映する。数値や undefined も文字列にして入れる（undefined は "undefined"）。
  text: {
    get: (f) => { f.pull(); return f.text; },
    set: (f, v, vm) => {
      const s = v === undefined ? 'undefined' : v === null ? 'null' : toStr(vm, v);
      if (f.sheet) { f.setHtml(s, true); return; } // スタイルシートがあれば、text も HTML として読む（実機で確認）
      f.htmlText = null;
      f.setText(s, true);
    },
  },
  // TextField.StyleSheet。付けると、内容を HTML として読み直し、スタイルを当てる（player/movie.js の setStyleSheet）。
  styleSheet: {
    get: (f) => f.styleSheetObject,
    set: (f, v) => {
      f.styleSheetObject?.cssFields.delete(f);
      f.styleSheetObject = v?.css instanceof Map ? v : undefined;
      f.styleSheetObject?.cssFields.add(f);
      f.setStyleSheet(f.styleSheetObject ? { get: (selector) => { const style = v.css.get(selector); return style ? Object.fromEntries(style) : null; } } : null);
    },
  },
  // html が偽なら text と同じ。真なら、読むと今の文字列と書式を実機と同じ形の HTML にしたもの、書くとタグを書式として読む。
  htmlText: {
    get: (f) => { f.pull(); return f.sheet ? f.htmlText ?? '' : f.html ? f.toHtml() : f.text; }, // スタイルシートがあれば、入れた HTML そのもの
    set: (f, v, vm) => {
      const s = toStr(vm, v);
      if (f.html || f.sheet) f.setHtml(s, true);
      else f.setText(s, true);
    },
  },
  length: { get: (f) => { f.pull(); return f.text.length; } },
  html: flag('html'),
  multiline: flag('multiline'),
  wordWrap: flag('wordWrap'),
  selectable: flag('selectable'),
  border: flag('border'),
  background: flag('background'),
  password: flag('password'),
  embedFonts: flag('embedFonts'),
  condenseWhite: { get: (f) => f.condenseWhite ?? false, set: (f, v, vm) => { f.condenseWhite = toBool(vm, v); } },
  mouseWheelEnabled: { get: (f) => f.mouseWheelEnabled ?? true, set: (f, v, vm) => { f.mouseWheelEnabled = toBool(vm, v); } },
  borderColor: color('borderColor'),
  backgroundColor: color('backgroundColor'),
  // 文字色は、今の文字とこれから入る文字の両方に付く。
  textColor: {
    get: (f) => f.newFormat.color,
    set: (f, v, vm) => { const color = toInt32(vm, v) & 0xffffff; f.newFormat = { ...f.newFormat, color }; f.setFormat({ color }, 0, f.text.length); f.format = { ...f.format, color }; f.changed(); },
  },
  // 大文字小文字は区別しない。知らない値は無視する。
  type: {
    get: (f) => f.type,
    set: (f, v, vm) => { const s = toStr(vm, v).toLowerCase(); if (s === 'dynamic' || s === 'input') f.type = s; },
  },
  // true は "left"、知らない値と false は "none"。
  autoSize: {
    get: (f) => f.autoSize,
    set: (f, v, vm) => {
      const s = v === true ? 'left' : typeof v === 'string' ? v.toLowerCase() : '';
      f.autoSize = ['left', 'center', 'right'].includes(s) ? s : 'none';
    },
  },
  // 0 は「制限なし」で、読むと null。
  maxChars: { get: (f) => f.maxChars, set: (f, v, vm) => { const n = toInt32(vm, v); f.maxChars = n === 0 ? null : n; } },
  restrict: { get: (f) => f.restrict, set: (f, v, vm) => { f.restrict = v === undefined || v === null ? null : toStr(vm, v); } },
  variable: { get: (f) => f.variable, set: (f, v, vm) => { f.bind(v === undefined || v === null ? null : toStr(vm, v)); } },
  // 文字の寸法は概算（端末のフォントの寸法は実機と同じにならない）。
  textWidth: { get: (f) => f.approxWidth() },
  textHeight: { get: (f) => Math.floor(f.approxHeight()) }, // AS2 は整数に切り捨てる（実機で確認: 22.5 → 22、46.5 → 46）
  // スクロールは、フィールドの配置（概算）から決まる。代入は範囲に収める。変わると onScroller が呼ばれる。
  scroll: { get: (f) => { f.scrollInfo(); return f.scrollV; }, set: (f, v, vm) => { f.setScroll(toInt32(vm, v), undefined); } },
  maxscroll: { get: (f) => f.scrollInfo().maxV },
  bottomScroll: { get: (f) => f.scrollInfo().bottom },
  hscroll: { get: (f) => { f.scrollInfo(); return f.scrollH; }, set: (f, v, vm) => { f.setScroll(undefined, toInt32(vm, v)); } },
  maxhscroll: { get: (f) => f.scrollInfo().maxH },
  // 幅と高さの代入は、拡大率ではなく枠の大きさを変える。
  _width: {
    get: (f) => { const b = f.boundsInParent(); return (b.xmax - b.xmin) / 20; },
    set: (f, v, vm) => { const n = toNumber(vm, v); if (n >= 0) { f.box.xmax = f.box.xmin + Math.round((n * 20 * 100) / (MAGIC._xscale.get(f) || 100)); f.changed(); } },
  },
  _height: {
    get: (f) => { const b = f.boundsInParent(); return (b.ymax - b.ymin) / 20; },
    set: (f, v, vm) => { const n = toNumber(vm, v); if (n >= 0) { f.box.ymax = f.box.ymin + Math.round((n * 20 * 100) / (MAGIC._yscale.get(f) || 100)); f.changed(); } },
  },
};
// クリップと共通のプロパティ（位置や変形）は、クリップと同じ実装を使う。
for (const name of ['_x', '_y', '_xscale', '_yscale', '_rotation', '_alpha', '_visible', '_name', '_parent', '_target', '_url']) PROPS[name] = MAGIC[name];
const LOWER = Object.fromEntries(Object.entries(PROPS).map(([name, prop]) => [name.toLowerCase(), prop]));

export class TextFieldObject extends AVMObject {
  /** @param {import('../player/movie.js').TextField} field */
  constructor(vm, field) {
    super(vm, vm.textFieldProto);
    this.field = field;
    this.isTextField = true;
  }

  #prop(name) {
    return this.vm.caseInsensitive ? LOWER[name.toLowerCase()] : Object.hasOwn(PROPS, name) ? PROPS[name] : undefined;
  }

  // 表示リストから外されたフィールドは、もう何も持っていないように見える。
  ownGet(name, receiver) {
    if (this.field.removed) return NONE;
    const v = super.ownGet(name, receiver);
    if (v !== NONE) return v;
    const prop = this.#prop(name);
    return prop ? prop.get(this.field, this.vm) : NONE;
  }

  ownSet(name, value, receiver) {
    if (super.ownSet(name, value, receiver)) return true;
    const prop = this.#prop(name);
    if (!prop) return false;
    if (!prop.set) return true; // 読み取り専用
    if (name[0] === '_' && !prop.raw && name !== '_width' && name !== '_height') {
      // クリップと共通の数値のプロパティ。数値にならない代入は無視する。
      const n = value === undefined || value === null ? NaN : toNumber(this.vm, value);
      if (!Number.isNaN(n)) prop.set(this.field, n, this.vm);
    } else if (prop.raw) {
      prop.set(this.field, undefined, this.vm, value);
    } else {
      prop.set(this.field, value, this.vm);
    }
    return true;
  }

  ownHas(name) {
    return !this.field.removed && (super.ownHas(name) || this.#prop(name) !== undefined);
  }

  /** "_level0.tf" 形式のパス。 */
  targetPath() {
    return this.field.removed ? '' : this.field.dotPath();
  }
}

export function installTextField(vm) {
  // --- TextFormat ---
  const formatProto = new AVMObject(vm, vm.objectProto);
  // 指定の無い項目は null。
  const newFormat = (values, proto = formatProto) => {
    const obj = new AVMObject(vm, proto);
    for (const key of [...FORMAT_KEYS, 'tabStops']) obj.define(key, values[key] ?? null);
    return obj;
  };
  defineClass(vm, 'TextFormat', formatProto, () => undefined,
    (_, args, proto) => newFormat(Object.fromEntries(FORMAT_ARGS.map((key, i) => [key, args[i]])), proto));

  // --- TextField ---
  const proto = new AVMObject(vm, vm.objectProto);
  vm.textFieldProto = proto;
  const fieldOf = (self) => (self?.isTextField && !self.field.removed ? self.field : null);
  // フィールドの書式を TextFormat にする。tabStops は空の配列。
  const formatObject = (format) => {
    const obj = newFormat(format);
    obj.set('tabStops', format.tabStops === null ? null : vm.global.get('Array') instanceof AVMFunction ? vm.construct(vm.global.get('Array'), []) : null);
    obj.define('display', 'block');
    return obj;
  };
  // TextFormat の null でない項目を、書式の一部（{ 項目: 値 }）にする。
  const partialOf = (obj) => {
    const out = {};
    if (!(obj instanceof AVMObject)) return out;
    for (const key of FORMAT_KEYS) {
      const v = obj.get(key);
      if (v === undefined || v === null) continue;
      if (['bold', 'italic', 'underline', 'bullet', 'kerning'].includes(key)) out[key] = toBool(vm, v);
      else if (['font', 'url', 'target', 'align'].includes(key)) out[key] = toStr(vm, v);
      else if (key === 'color') out[key] = toInt32(vm, v) & 0xffffff;
      else if (!Number.isNaN(toNumber(vm, v))) out[key] = toNumber(vm, v);
    }
    const stops = obj.get('tabStops');
    if (stops && stops.items) out.tabStops = stops.items.map((x) => toNumber(vm, x));
    return out;
  };
  const applyFormat = (format, obj) => Object.assign(format, partialOf(obj));
  // 項目がすべて null の TextFormat（範囲が空か、文字が無いとき。display だけ "block"。実機で確認）。
  const emptyFormatObject = () => { const obj = newFormat({}); obj.set('display', 'block'); return obj; };
  // 範囲（begin〜end。end は含まない）を、文字の数に収める。AS2 は範囲の誤りでも例外にならない（実機で確認）。
  const rangeOf = (f, args) => {
    const len = f.text.length;
    const n = (v) => (v === undefined ? undefined : toInt32(vm, v));
    let [a, b] = [n(args[0]), n(args[1])];
    if (a === undefined) return [0, len];
    if (b === undefined) b = a + 1;
    return [Math.max(0, a), Math.min(b, len)];
  };
  defineMethods(vm, proto, {
    getDepth: (_, self) => (fieldOf(self) ? fieldOf(self).depth - DEPTH_OFFSET : undefined),
    removeTextField: (_, self) => { fieldOf(self)?.parent.removeDynamicChild(fieldOf(self)); },
    // getTextFormat()、getTextFormat(位置)、getTextFormat(始まり, 終わり)。範囲の中で違う項目は null。範囲が空なら、項目がすべて null。
    getTextFormat: (_, self, args) => {
      const f = fieldOf(self);
      if (!f) return undefined;
      const [a, b] = rangeOf(f, args);
      return b <= a || a >= f.text.length ? emptyFormatObject() : formatObject(f.getFormat(a, b));
    },
    getNewTextFormat: (_, self) => (fieldOf(self) ? formatObject(fieldOf(self).newFormat) : undefined),
    // setTextFormat(書式)、setTextFormat(位置, 書式)、setTextFormat(始まり, 終わり, 書式)。
    setTextFormat: (_, self, args) => {
      const f = fieldOf(self);
      if (!f || f.sheet) return; // スタイルシートのあるフィールドでは何もしない（実機で確認）
      const [a, b] = rangeOf(f, args.slice(0, -1));
      f.setFormat(partialOf(args[args.length - 1]), a, b);
      if (!f.text.length) f.format = mergeFormat(f.format, partialOf(args[args.length - 1]));
    },
    setNewTextFormat: (_, self, [format]) => { if (fieldOf(self)) fieldOf(self).newFormat = mergeFormat(fieldOf(self).newFormat, partialOf(format)); },
    // 範囲は文字の数に収める。入る文字の書式は、置き換える範囲の最後の文字のもの（実機で確認）。
    replaceText: (_, self, [begin, end, text]) => {
      const f = fieldOf(self);
      if (!f) return;
      const len = f.text.length;
      const a = Math.max(0, Math.min(toInt32(vm, begin), len)), b = Math.max(a, Math.min(toInt32(vm, end), len));
      f.replace(a, b, toStr(vm, text));
    },
    // 文字の入力は未対応なので、リスナーは登録を受け付けるだけ。
    addListener: () => true,
    removeListener: () => false,
  });
  const fieldClass = defineClass(vm, 'TextField', proto, () => undefined, (_, __, to) => new AVMObject(vm, to));

  // --- TextField.StyleSheet（self.css は セレクタ → Map（プロパティ → 値）。AS2 はセレクタの大文字と小文字を区別する。実機で確認） ---
  const sheetProto = new AVMObject(vm, vm.objectProto);
  const css = (self) => (self?.css instanceof Map ? self.css : null);
  const changed = (self) => { for (const f of self.cssFields) f.reapplySheet(); };
  const styleObject = (style) => { const o = new AVMObject(vm, vm.objectProto); for (const [k, v] of style) o.set(k, v); return o; };
  defineMethods(vm, sheetProto, {
    // 書き間違いがあれば、何も足さずに false（実機で確認）。
    parseCSS: (_, self, [text]) => {
      const found = css(self) && parseCSS(toStr(vm, text), { lowerCase: false });
      if (!found) return false;
      for (const [k, v] of found) if (self.css.size < 10000 || self.css.has(k)) self.css.set(k, v);
      changed(self);
      return true;
    },
    getStyle: (_, self, [name]) => { const style = css(self)?.get(toStr(vm, name)); return style ? styleObject(style) : null; },
    setStyle: (_, self, [name, style]) => {
      if (!css(self)) return;
      const key = toStr(vm, name);
      if (!(style instanceof AVMObject)) self.css.delete(key);
      else if (self.css.size < 10000 || self.css.has(key)) self.css.set(key, new Map(style.ownKeys().map((k) => [k, toStr(vm, style.get(k))])));
      changed(self);
    },
    getStyleNames: (_, self) => vm.construct(vm.global.get('Array'), [...(css(self)?.keys() ?? [])]),
    clear: (_, self) => { if (css(self)) { self.css.clear(); changed(self); } },
    // スタイルのオブジェクトを TextFormat にする。
    transform: (_, self, [style]) => {
      if (!(style instanceof AVMObject)) return null;
      const patch = cssPatch(Object.fromEntries(style.ownKeys().map((k) => [k, toStr(vm, style.get(k))])));
      return newFormat(patch);
    },
    // CSS のファイルを読む（ホストの network.load）。読めたら parseCSS して、onLoad(読めたか)。
    load: (_, self, [url]) => {
      if (!css(self) || url === undefined) return false;
      vm.loadText({ url: toStr(vm, url), method: '' }, (text) => {
        const ok = text !== undefined && self.get('parseCSS') instanceof AVMFunction && vm.call(self.get('parseCSS'), self, [text]);
        const onLoad = self.get('onLoad');
        if (onLoad instanceof AVMFunction) vm.call(onLoad, self, [!!ok]);
      });
      return true;
    },
    onLoad: () => undefined,
  });
  const sheetClass = vm.native(() => undefined, () => Object.assign(new AVMObject(vm, sheetProto), { css: new Map(), cssFields: new Set() }));
  sheetClass.define('prototype', sheetProto, DONT_ENUM);
  sheetProto.define('constructor', sheetClass, DONT_ENUM);
  fieldClass.define('StyleSheet', sheetClass, DONT_ENUM);
}
