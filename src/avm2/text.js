// flash.text: TextField、TextFormat と、その定数のクラス。
//
// 文字列や書式の状態は、プレイヤーのテキストフィールド（player/movie.js の TextField）が持つ。
// 書式はフィールド全体で 1 つ（範囲ごとの書式や HTML の書式タグは反映しない）。
// 文字の寸法（textWidth など）は概算で、端末のフォントで決まる実機の値とは一致しない。
import { plainText } from '../swf/text.js';
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
    for (const [name, initial] of FORMAT) obj.values.set(publicKey(name), (name === 'font' ? format.font || null : format[name]) ?? initial); // フォントの指定が無ければ既定のフォント
    obj.values.set(publicKey('tabStops'), new ASArray(vm, []));
    obj.values.set(publicKey('display'), 'block');
    return obj;
  };
  // TextFormat の null でない項目を、プレイヤー側の書式に写す。
  const applyFormat = (format, obj) => {
    if (!(obj instanceof ASObject) || obj.klass !== c.TextFormat) vm.throwError('TypeError', 2007, 'Parameter format must be non-null.');
    for (const [name, initial] of FORMAT) {
      const v = value(obj, name);
      if (v === null || v === undefined) continue;
      format[name] = typeof initial === 'string' ? str(v) : typeof initial === 'boolean' ? bool(v) : name === 'color' ? vm.toUint32(v) & 0xffffff : num(v);
    }
  };

  // --- 文字の寸法（概算）と、自動の大きさ合わせ ---
  const lines = (f) => f.text.split('\r');
  const textWidth = (f) => Math.round(Math.max(0, ...lines(f).map((line) => line.length)) * f.format.size * 0.5);
  const textHeight = (f) => (f.text ? Math.round(lines(f).length * f.format.size * 1.15) : 0);
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

  // --- htmlText: 読むと、今の文字列と書式を実機と同じ形の HTML にしたものが返る ---
  const html = (f) => {
    if (!f.text) return '';
    const t = f.format;
    const color = `#${(t.color & 0xffffff).toString(16).toUpperCase().padStart(6, '0')}`;
    const wrap = (body) => {
      let out = body;
      if (t.underline) out = `<U>${out}</U>`;
      if (t.italic) out = `<I>${out}</I>`;
      if (t.bold) out = `<B>${out}</B>`;
      if (t.url) out = `<A HREF="${t.url}" TARGET="${t.target}">${out}</A>`;
      return out;
    };
    // 余白や字下げ、行間があれば、段落を TEXTFORMAT で包む。
    const layout = [['LEFTMARGIN', t.leftMargin], ['RIGHTMARGIN', t.rightMargin], ['INDENT', t.indent], ['LEADING', t.leading], ['BLOCKINDENT', t.blockIndent]]
      .filter(([, v]) => v).map(([name, v]) => ` ${name}="${str(v)}"`).join('');
    return lines(f).map((line) => `${layout ? `<TEXTFORMAT${layout}>` : ''}<P ALIGN="${t.align.toUpperCase()}"><FONT FACE="${t.font || 'Times Roman'}" SIZE="${str(t.size)}" COLOR="${color}" LETTERSPACING="${str(t.letterSpacing ?? 0)}" KERNING="${t.kerning ? 1 : 0}">`
      + `${wrap(line.replace(/[&<>"']/g, (ch) => ESCAPED[ch]))}</FONT></P>${layout ? '</TEXTFORMAT>' : ''}`).join('');
  };

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
    htmlText: [(self) => html(F(self)), (self, v) => {
      if (v === null || v === undefined) vm.throwError('TypeError', 2007, 'Parameter text must be non-null.');
      F(self).htmlText = str(v);
      // 複数行でないフィールドでは、<br> や段落の切れ目は改行にならない（実機で確認）。
      const text = plainText(str(v));
      setText(F(self), F(self).multiline ? text : text.replace(/\r/g, ''));
    }],
    length: [(self) => F(self).text.length, null],
    // 文字色は、今の文字とこれから入る文字の両方に付く。
    textColor: [(self) => F(self).newFormat.color, (self, v) => { F(self).newFormat.color = F(self).format.color = vm.toUint32(v) & 0xffffff; F(self).changed(); }],
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
    defaultTextFormat: [(self) => formatObject(F(self).newFormat), (self, v) => { applyFormat(F(self).newFormat, v); }],
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
      appendText: (self, [v]) => { const f = F(self); const format = f.format; setText(f, f.text + str(v)); f.format = format; },
      // 範囲は文字列の長さに収める。始まりが負か、終わりが始まりより前なら、何もしない（実機で確認）。
      replaceText: (self, [begin, end, v]) => {
        const f = F(self);
        const a = Math.min(vm.toInt32(begin), f.text.length), b = Math.min(vm.toInt32(end), f.text.length);
        if (a >= 0 && b >= a) setText(f, f.text.slice(0, a) + str(v) + f.text.slice(b));
      },
      replaceSelectedText: (self, [v]) => { const f = F(self); const [a, b] = f.selection ?? [0, 0]; setText(f, f.text.slice(0, a) + str(v) + f.text.slice(b)); f.selection = [a + str(v).length, a + str(v).length]; },
      setSelection: (self, [begin, end]) => { const f = F(self); const clamp = (v) => Math.min(Math.max(vm.toInt32(v), 0), f.text.length); f.selection = [clamp(begin), clamp(end)].sort((x, y) => x - y); },
      // 書式はフィールド全体で 1 つなので、範囲の指定は確かめるだけ。
      getTextFormat: (self, [begin = -1, end = -1]) => {
        const f = F(self);
        if (vm.toInt32(begin) !== -1) index(f, begin, 'beginIndex');
        if (vm.toInt32(end) !== -1) index(f, end, 'endIndex');
        if (!f.text) return vm.construct(c.TextFormat, []); // 文字が無ければ、どの項目も null
        return formatObject(f.format);
      },
      setTextFormat: (self, [format, begin = -1, end = -1]) => {
        const f = F(self);
        if (vm.toInt32(begin) !== -1) index(f, begin, 'beginIndex');
        if (vm.toInt32(end) !== -1) index(f, end, 'endIndex');
        applyFormat(f.format, format);
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
