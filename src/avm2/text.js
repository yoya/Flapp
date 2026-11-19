// flash.text: TextField、TextFormat と、その定数のクラス。
//
// 文字列や書式の状態は、プレイヤーのテキストフィールド（player/movie.js の TextField）が持つ。
// 書式は文字ごとに持つ（player/richtext.js）。範囲ごとの書式と HTML の書式は、実機の読み書きに合わせてある。
// 文字の寸法（textWidth など）は概算で、端末のフォントで決まる実機の値とは一致しない。
import { mergeFormat } from '../player/richtext.js';
import { ASArray, ASObject, publicKey } from './object.js';

// TextFormat の項目。[名前, getTextFormat が返す既定値]
const FORMAT = [
  ['font', 'Times Roman'], ['size', 12], ['color', 0], ['bold', false], ['italic', false], ['underline', false], ['url', ''], ['target', ''],
  ['align', 'left'], ['leftMargin', 0], ['rightMargin', 0], ['indent', 0], ['leading', 0], ['bullet', false], ['blockIndent', 0],
  ['kerning', false], ['letterSpacing', 0],
];
const ESCAPED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/**
 * @param {import('./vm.js').AVM2} vm
 * @param {import('../player/movie.js').Movie} movie
 */
export function installText(vm, movie) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const num = (v) => vm.toNumber(v);
  const bool = (v) => vm.toBoolean(v);
  const F = (self) => self.display; // プレイヤー側のテキストフィールド
  const oneOf = (v, allowed, name) => {
    const s = str(v);
    if (!allowed.includes(s)) vm.throwError('ArgumentError', 2008, `Parameter ${name} must be one of the accepted values.`);
    return s;
  };
  const constants = (name, values) => vm.defineClass({ name: `flash.text::${name}`, final: true, staticValues: values });
  constants('TextFieldType', { DYNAMIC: 'dynamic', INPUT: 'input' });
  constants('TextFieldAutoSize', { NONE: 'none', LEFT: 'left', CENTER: 'center', RIGHT: 'right' });
  constants('TextFormatAlign', { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFY: 'justify', START: 'start', END: 'end' });
  constants('AntiAliasType', { NORMAL: 'normal', ADVANCED: 'advanced' });
  constants('GridFitType', { NONE: 'none', PIXEL: 'pixel', SUBPIXEL: 'subpixel' });
  constants('FontStyle', { REGULAR: 'regular', BOLD: 'bold', ITALIC: 'italic', BOLD_ITALIC: 'boldItalic' });
  constants('FontType', { EMBEDDED: 'embedded', EMBEDDED_CFF: 'embeddedCFF', DEVICE: 'device' });
  vm.defineClass({ name: 'flash.text::Font', staticMethods: { enumerateFonts: () => new ASArray(vm, []), registerFont: () => {} } });

  // --- TextFormat: どの項目も、指定しなければ null（「変えない」の意味） ---
  const value = (obj, name) => obj.values.get(publicKey(name));
  c.TextFormat = vm.defineClass({
    name: 'flash.text::TextFormat',
    slots: { ...Object.fromEntries(FORMAT.map(([name]) => [name, null])), tabStops: null, display: null },
    construct: (self, args) => {
      ['font', 'size', 'color', 'bold', 'italic', 'underline', 'url', 'target', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading'].forEach((name, i) => {
        if (args[i] !== undefined && args[i] !== null) self.values.set(publicKey(name), name === 'font' || name === 'url' || name === 'target' || name === 'align' ? str(args[i]) : args[i]);
      });
    },
  });
  // プレイヤー側の書式 { font, size, ... } を TextFormat にする。
  const formatObject = (format) => {
    const obj = vm.construct(c.TextFormat, []);
    for (const [name, initial] of FORMAT) {
      const v = format[name];
      obj.values.set(publicKey(name), v === null ? null : name === 'font' ? v || initial : v ?? initial); // フォントの指定が無ければ既定のフォント
    }
    obj.values.set(publicKey('tabStops'), format.tabStops === null ? null : new ASArray(vm, [...(format.tabStops ?? [])]));
    obj.values.set(publicKey('display'), 'block');
    return obj;
  };
  // 項目がすべて null の TextFormat（空の範囲を読んだとき。display だけ "block"。実機で確認）。
  const emptyFormatObject = () => {
    const obj = vm.construct(c.TextFormat, []);
    obj.values.set(publicKey('display'), 'block');
    return obj;
  };
  // TextFormat の null でない項目を、プレイヤー側の書式の一部（{ 項目: 値 }）にする。
  const partialOf = (obj) => {
    if (!(obj instanceof ASObject) || obj.klass !== c.TextFormat) vm.throwError('TypeError', 2007, 'Parameter format must be non-null.');
    const out = {};
    for (const [name, initial] of FORMAT) {
      const v = value(obj, name);
      if (v === null || v === undefined) continue;
      out[name] = typeof initial === 'string' ? str(v) : typeof initial === 'boolean' ? bool(v) : name === 'color' ? vm.toUint32(v) & 0xffffff : num(v);
    }
    const stops = value(obj, 'tabStops');
    if (stops instanceof ASArray) out.tabStops = stops.items.map((x) => num(x));
    const display = value(obj, 'display');
    if (display !== null && display !== undefined) out.display = str(display);
    return out;
  };
  const applyFormat = (format, obj) => { Object.assign(format, partialOf(obj)); };

  // --- 文字の寸法（概算）と、自動の大きさ合わせ ---
  const lines = (f) => f.text.split('\r');
  const textWidth = (f) => f.approxWidth();
  const textHeight = (f) => f.approxHeight();
  // autoSize が none 以外なら、枠を文字に合わせる（左右 2 px ずつの余白つき）。right は右端、center は中央を保つ。
  const fit = (f) => {
    f.changed();
    if (f.autoSize === 'none') return;
    const width = (textWidth(f) + 4) * 20;
    const old = f.box.xmax - f.box.xmin;
    if (!f.wordWrap) {
      if (f.autoSize === 'right') f.box.xmin = f.box.xmax - width;
      else if (f.autoSize === 'center') f.box.xmin += Math.round((old - width) / 2);
      f.box.xmax = f.box.xmin + width;
    }
    f.box.ymax = f.box.ymin + (textHeight(f) + 4) * 20;
  };
  // 改行は CR で持つ。LF は CR に、CR LF は CR 2 つになる（実機で確認）。
  const setText = (f, text) => { f.setText(text.replace(/\n/g, '\r'), false); fit(f); };

  const flag = (name) => [(self) => F(self)[name], (self, v) => { F(self)[name] = bool(v); F(self).changed(); }];
  const color = (name) => [(self) => F(self)[name], (self, v) => { F(self)[name] = vm.toUint32(v) & 0xffffff; F(self).changed(); }];
  // 値を覚えておくだけの項目（見た目には反映しない）。
  const stored = (name, initial, convert) => [(self) => F(self)[name] ?? initial, (self, v) => { F(self)[name] = convert(v); }];
  const fixed = (v) => [() => v, null];
  const index = (f, v, name) => {
    const i = vm.toInt32(v);
    if (i < 0 || i > f.text.length) vm.throwError('RangeError', 2006, `The supplied index is out of bounds. (${name})`);
    return i;
  };
  const lineAt = (f, v) => {
    const i = vm.toInt32(v);
    const list = lines(f);
    if (i < 0 || i >= list.length) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
    return [list, i];
  };
  const props = {
    text: [(self) => F(self).text, (self, v) => {
      if (v === null || v === undefined) vm.throwError('TypeError', 2007, 'Parameter text must be non-null.');
      F(self).htmlText = null;
      setText(F(self), str(v));
    }],
    // 読むと、今の文字列と書式を実機と同じ形の HTML にしたものが返る。書くと、タグを書式として読む（複数行でないフィールドでは、<br> や
    // 段落の切れ目は改行にならない。実機で確認）。
    htmlText: [(self) => F(self).toHtml(), (self, v) => {
      if (v === null || v === undefined) vm.throwError('TypeError', 2007, 'Parameter text must be non-null.');
      F(self).setHtml(str(v), true);
      fit(F(self));
    }],
    length: [(self) => F(self).text.length, null],
    // 文字色は、今の文字とこれから入る文字の両方に付く。
    textColor: [(self) => F(self).newFormat.color, (self, v) => { const color = vm.toUint32(v) & 0xffffff; F(self).newFormat = { ...F(self).newFormat, color }; F(self).setFormat({ color }, 0, F(self).text.length); F(self).format = { ...F(self).format, color }; F(self).changed(); }],
    type: [(self) => F(self).type, (self, v) => { F(self).type = oneOf(v, ['dynamic', 'input'], 'type'); }],
    autoSize: [(self) => F(self).autoSize, (self, v) => { F(self).autoSize = oneOf(v, ['none', 'left', 'center', 'right'], 'autoSize'); fit(F(self)); }],
    multiline: flag('multiline'), wordWrap: flag('wordWrap'), selectable: flag('selectable'), border: flag('border'), background: flag('background'),
    embedFonts: flag('embedFonts'), displayAsPassword: flag('password'), borderColor: color('borderColor'), backgroundColor: color('backgroundColor'),
    maxChars: [(self) => F(self).maxChars ?? 0, (self, v) => { F(self).maxChars = vm.toInt32(v) || null; }],
    restrict: [(self) => F(self).restrict, (self, v) => { F(self).restrict = v === null || v === undefined ? null : str(v); }],
    condenseWhite: stored('condenseWhite', false, bool), mouseWheelEnabled: stored('mouseWheelEnabled', false, bool),
    alwaysShowSelection: stored('alwaysShowSelection', false, bool), useRichTextClipboard: stored('useRichTextClipboard', false, bool),
    // 知らない値を代入しても、誤りにはならない（無視する）。
    antiAliasType: [(self) => F(self).antiAliasType ?? 'normal', (self, v) => { if (['normal', 'advanced'].includes(str(v))) F(self).antiAliasType = str(v); }],
    gridFitType: [(self) => F(self).gridFitType ?? 'pixel', (self, v) => { if (['none', 'pixel', 'subpixel'].includes(str(v))) F(self).gridFitType = str(v); }],
    sharpness: stored('sharpness', 0, num), thickness: stored('thickness', 0, num), styleSheet: stored('styleSheet', null, (v) => v ?? null),
    scrollH: stored('scrollH', 0, (v) => vm.toInt32(v)), scrollV: stored('scrollV', 1, (v) => Math.max(1, vm.toInt32(v))),
    maxScrollH: fixed(0), maxScrollV: fixed(1), bottomScrollV: fixed(1),
    selectionBeginIndex: [(self) => F(self).selection?.[0] ?? 0, null], selectionEndIndex: [(self) => F(self).selection?.[1] ?? 0, null],
    caretIndex: [(self) => F(self).selection?.[1] ?? 0, null],
    selectedText: [(self) => { const f = F(self); const [a, b] = f.selection ?? [0, 0]; return f.text.slice(a, b); }, null],
    numLines: [(self) => lines(F(self)).length, null],
    textWidth: [(self) => textWidth(F(self)), null], textHeight: [(self) => textHeight(F(self)), null],
    // 幅と高さは枠の大きさ。代入は、拡大率ではなく枠を変える。代入した値がそのまま枠の大きさになるので、
    // 拡大されているフィールドでは、読める幅は代入した値に拡大率を掛けたものになる（実機で確認）。
    width: [(self) => { const b = F(self).boundsInParent(); return (b.xmax - b.xmin) / 20; }, (self, v) => {
      const f = F(self);
      if (num(v) >= 0) { f.box.xmax = f.box.xmin + Math.round(num(v) * 20); f.changed(); }
    }],
    height: [(self) => { const b = F(self).boundsInParent(); return (b.ymax - b.ymin) / 20; }, (self, v) => {
      const f = F(self);
      if (num(v) >= 0) { f.box.ymax = f.box.ymin + Math.round(num(v) * 20); f.changed(); }
    }],
    // 代入した書式の null でない項目が、これから入る文字の書式に重なる（実機で確認）。
    defaultTextFormat: [(self) => formatObject(F(self).newFormat), (self, v) => { F(self).newFormat = mergeFormat(F(self).newFormat, partialOf(v)); }],
  };
  c.TextField = vm.defineClass({
    name: 'flash.text::TextField', base: c.InteractiveObject,
    // new TextField(): 幅も高さも 100 px の、空のフィールド。
    allocate: (klass) => {
      vm.charge(16);
      const obj = new ASObject(klass);
      movie.newTextField(obj);
      return obj;
    },
    getters: Object.fromEntries(Object.entries(props).map(([name, [get]]) => [name, get])),
    setters: Object.fromEntries(Object.entries(props).filter(([, [, set]]) => set).map(([name, [, set]]) => [name, set])),
    methods: {
      // 足した文字は、最後の文字の書式になり、これから入る文字の書式もそれになる（実機で確認）。
      appendText: (self, [v]) => {
        const f = F(self), last = f.text.length ? f.formatAt(f.text.length - 1) : null;
        f.replace(f.text.length, f.text.length, str(v));
        if (last) f.newFormat = { ...last };
        fit(f);
      },
      // 範囲は文字列の長さに収める。始まりが負か、終わりが始まりより前なら、何もしない（実機で確認）。
      // 入る文字の書式は、置き換える範囲の最後の文字のもの（f.replace）。
      replaceText: (self, [begin, end, v]) => {
        const f = F(self);
        const a = Math.min(vm.toInt32(begin), f.text.length), b = Math.min(vm.toInt32(end), f.text.length);
        if (a >= 0 && b >= a) { f.replace(a, b, str(v)); fit(f); }
      },
      replaceSelectedText: (self, [v]) => {
        const f = F(self), [a, b] = f.selection ?? [0, 0];
        f.replace(a, b, str(v));
        f.selection = [a + str(v).length, a + str(v).length];
        fit(f);
      },
      setSelection: (self, [begin, end]) => { const f = F(self); const clamp = (v) => Math.min(Math.max(vm.toInt32(v), 0), f.text.length); f.selection = [clamp(begin), clamp(end)].sort((x, y) => x - y); },
      // 範囲（begin〜end。end は含まない）の書式。範囲の中で違う項目は null。begin だけなら、その 1 文字。
      // begin が文字の数以上、end が文字の数より後ろなら RangeError #2006。end が begin 以下なら、項目がすべて null（実機で確認）。
      getTextFormat: (self, [begin = -1, end = -1]) => {
        const f = F(self), len = f.text.length;
        let a = vm.toInt32(begin), b = vm.toInt32(end);
        if (a === -1 && b === -1) { a = 0; b = len; if (!len) return vm.construct(c.TextFormat, []); } // 文字が無ければ、どの項目も null
        else {
          if (a < 0 || a >= len) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
          if (b === -1) b = a + 1;
          if (b > len) vm.throwError('RangeError', 2006, 'The supplied index is out of bounds.');
        }
        return b <= a ? emptyFormatObject() : formatObject(f.getFormat(a, b));
      },
      // 範囲を省くと、全体に重なる（これから入る文字の書式 defaultTextFormat は変わらない。実機で確認）。
      setTextFormat: (self, [format, begin = -1, end = -1]) => {
        const f = F(self), len = f.text.length;
        const partial = partialOf(format);
        let a = vm.toInt32(begin), b = vm.toInt32(end);
        if (a === -1 && b === -1) {
          a = 0; b = len;
        } else {
          index(f, a, 'beginIndex');
          if (b === -1) b = Math.min(a + 1, len); else index(f, b, 'endIndex');
        }
        f.setFormat(partial, a, b);
        if (!len) f.format = mergeFormat(f.format, partial);
        fit(f);
      },
      getLineText: (self, [i]) => { const [list, at] = lineAt(F(self), i); return list[at] + (at < list.length - 1 ? '\r' : ''); },
      getLineLength: (self, [i]) => { const [list, at] = lineAt(F(self), i); return list[at].length + (at < list.length - 1 ? 1 : 0); },
      getLineOffset: (self, [i]) => { const [list, at] = lineAt(F(self), i); return list.slice(0, at).reduce((n, line) => n + line.length + 1, 0); },
      getLineIndexOfChar: (self, [i]) => { const f = F(self); return f.text.slice(0, index(f, i, 'charIndex')).split('\r').length - 1; },
      getCharIndexAtPoint: () => -1,
      getLineIndexAtPoint: () => -1,
      // 寸法は概算（textWidth と同じ、1 文字 = 文字の大きさの半分、行の高さ = 1.15 倍）。
      getLineMetrics: (self, [i]) => {
        const f = F(self), [list, at] = lineAt(f, i), size = f.format.size;
        return vm.construct(c.TextLineMetrics, [2, Math.round(list[at].length * size * 0.5), Math.round(size * 1.15), Math.round(size * 0.9), Math.round(size * 0.25), f.format.leading ?? 0]);
      },
      getCharBoundaries: (self, [i]) => {
        const f = F(self), n = vm.toInt32(i);
        if (n < 0 || n >= f.text.length) return null;
        const row = f.text.slice(0, n).split('\r').length - 1, col = n - f.text.slice(0, n).lastIndexOf('\r') - 1, size = f.format.size;
        return vm.construct(c.Rectangle, [2 + col * size * 0.5, 2 + row * size * 1.15, size * 0.5, size * 1.15]);
      },
      // 段落は CR で区切られる。長さは、区切りの CR を含む。
      getFirstCharInParagraph: (self, [i]) => { const f = F(self); return f.text.lastIndexOf('\r', index(f, i, 'charIndex') - 1) + 1; },
      getParagraphLength: (self, [i]) => {
        const f = F(self), start = f.text.lastIndexOf('\r', index(f, i, 'charIndex') - 1) + 1, end = f.text.indexOf('\r', start);
        return end < 0 ? f.text.length - start : end - start + 1;
      },
      getImageReference: () => null,
      getRawText: (self) => F(self).text,
    },
  });
  c.StaticText = vm.defineClass({ name: 'flash.text::StaticText', base: c.DisplayObject });
}
