// スクリプトから見たテキストフィールドと、TextField / TextFormat クラス。
// 表示リスト上の実体は player/movie.js の TextField。
import { MAGIC } from './clip.js';
import { toBool, toInt32, toNumber, toStr } from './convert.js';
import { defineClass, defineMethods } from './globals.js';
import { AVMFunction, AVMObject, NONE } from './object.js';
import { plainText } from '../swf/text.js';

const DEPTH_OFFSET = 16384; // スクリプトの深度 0 は、表示リストの深度 16384
// TextFormat のプロパティ（コンストラクタの引数の順）と、それ以外。
const FORMAT_ARGS = ['font', 'size', 'color', 'bold', 'italic', 'underline', 'url', 'target', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading'];
const FORMAT_KEYS = [...FORMAT_ARGS, 'bullet'];

// フィールド固有のプロパティ。get / set は表示オブジェクト f（player/movie.js の TextField）に対する操作。
const flag = (name) => ({ get: (f) => f[name], set: (f, v, vm) => { f[name] = toBool(vm, v); f.changed(); } });
const color = (name) => ({ get: (f) => f[name], set: (f, v, vm) => { f[name] = toInt32(vm, v) & 0xffffff; f.changed(); } });
const fixed = (value) => ({ get: () => value });
const PROPS = {
  // 読むときに、連動する変数の値を反映する。数値や undefined も文字列にして入れる（undefined は "undefined"）。
  text: {
    get: (f) => { f.pull(); return f.text; },
    set: (f, v, vm) => { f.htmlText = null; f.setText(v === undefined ? 'undefined' : v === null ? 'null' : toStr(vm, v), true); },
  },
  // html が偽なら text と同じ。真なら、代入された HTML をそのまま返す（実機は整形し直した HTML を返す）。
  htmlText: {
    get: (f) => { f.pull(); return f.html && f.htmlText !== null ? f.htmlText : f.text; },
    set: (f, v, vm) => {
      const s = toStr(vm, v);
      f.htmlText = f.html ? s : null;
      f.setText(f.html ? plainText(s) : s, true);
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
    set: (f, v, vm) => { f.newFormat.color = f.format.color = toInt32(vm, v) & 0xffffff; f.changed(); },
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
  textWidth: { get: (f) => Math.round(Math.max(0, ...f.text.split('\r').map((line) => line.length)) * f.format.size * 0.5) },
  textHeight: { get: (f) => (f.text ? Math.round(f.text.split('\r').length * f.format.size * 1.15) : 0) },
  scroll: fixed(1), maxscroll: fixed(1), bottomScroll: fixed(1), hscroll: fixed(0), maxhscroll: fixed(0),
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
    obj.set('tabStops', vm.global.get('Array') instanceof AVMFunction ? vm.construct(vm.global.get('Array'), []) : null);
    return obj;
  };
  // TextFormat の null でない項目を、書式 format に反映する。
  const applyFormat = (format, obj) => {
    if (!(obj instanceof AVMObject)) return;
    for (const key of FORMAT_KEYS) {
      const v = obj.get(key);
      if (v === undefined || v === null) continue;
      if (['bold', 'italic', 'underline', 'bullet'].includes(key)) format[key] = toBool(vm, v);
      else if (['font', 'url', 'target', 'align'].includes(key)) format[key] = toStr(vm, v);
      else if (key === 'color') format[key] = toInt32(vm, v) & 0xffffff;
      else if (!Number.isNaN(toNumber(vm, v))) format[key] = toNumber(vm, v);
    }
  };
  defineMethods(vm, proto, {
    getDepth: (_, self) => (fieldOf(self) ? fieldOf(self).depth - DEPTH_OFFSET : undefined),
    removeTextField: (_, self) => { fieldOf(self)?.parent.removeDynamicChild(fieldOf(self)); },
    // 範囲の指定（開始位置、終了位置）は受け取るが、書式はフィールド全体で 1 つだけ持つ。
    getTextFormat: (_, self) => (fieldOf(self) ? formatObject(fieldOf(self).format) : undefined),
    getNewTextFormat: (_, self) => (fieldOf(self) ? formatObject(fieldOf(self).newFormat) : undefined),
    setTextFormat: (_, self, args) => {
      const field = fieldOf(self);
      if (!field) return;
      applyFormat(field.format, args[args.length - 1]);
      field.changed();
    },
    setNewTextFormat: (_, self, [format]) => { if (fieldOf(self)) applyFormat(fieldOf(self).newFormat, format); },
    // 文字の入力は未対応なので、リスナーは登録を受け付けるだけ。
    addListener: () => true,
    removeListener: () => false,
  });
  defineClass(vm, 'TextField', proto, () => undefined, (_, __, to) => new AVMObject(vm, to));
}
