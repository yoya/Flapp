// 標準のクラスのうち、定数を並べただけのもの、プロパティを持つだけのもの、動作のない代用（この環境では使えない機能）。
// プレイヤーの動きに結び付くクラス（表示オブジェクトやイベント）は flash.js にある。
// 値と既定値は、playerglobal の API の一覧と、実機の trace（test/as3/apiprobe1.as）に合わせた。
import { ASArray, ASClass, ASObject, publicKey } from './object.js';

export function installStdlib(vm) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const num = (v) => vm.toNumber(v);
  const bool = (v) => vm.toBoolean(v);
  const set = (self, key, v) => { self.values.set(publicKey(key), v); };
  const get = (self, key) => self.values.get(publicKey(key));

  // 定数だけのクラス。
  const constants = (name, values) => vm.defineClass({ name, final: true, staticValues: values });
  constants('flash.display::StageScaleMode', { EXACT_FIT: 'exactFit', NO_BORDER: 'noBorder', NO_SCALE: 'noScale', SHOW_ALL: 'showAll' });
  constants('flash.display::StageAlign', { BOTTOM: 'B', BOTTOM_LEFT: 'BL', BOTTOM_RIGHT: 'BR', LEFT: 'L', RIGHT: 'R', TOP: 'T', TOP_LEFT: 'TL', TOP_RIGHT: 'TR' });
  constants('flash.display::StageQuality', { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', BEST: 'best', HIGH_8X8: '8x8', HIGH_8X8_LINEAR: '8x8linear', HIGH_16X16: '16x16', HIGH_16X16_LINEAR: '16x16linear' });
  constants('flash.display::StageDisplayState', { NORMAL: 'normal', FULL_SCREEN: 'fullScreen', FULL_SCREEN_INTERACTIVE: 'fullScreenInteractive' });
  constants('flash.display::BlendMode', {
    ADD: 'add', ALPHA: 'alpha', DARKEN: 'darken', DIFFERENCE: 'difference', ERASE: 'erase', HARDLIGHT: 'hardlight', INVERT: 'invert', LAYER: 'layer',
    LIGHTEN: 'lighten', MULTIPLY: 'multiply', NORMAL: 'normal', OVERLAY: 'overlay', SCREEN: 'screen', SHADER: 'shader', SUBTRACT: 'subtract',
  });
  constants('flash.events::EventPhase', { CAPTURING_PHASE: 1, AT_TARGET: 2, BUBBLING_PHASE: 3 });
  constants('flash.filters::BitmapFilterQuality', { LOW: 1, MEDIUM: 2, HIGH: 3 });
  constants('flash.filters::BitmapFilterType', { INNER: 'inner', OUTER: 'outer', FULL: 'full' });
  constants('flash.net::SharedObjectFlushStatus', { FLUSHED: 'flushed', PENDING: 'pending' });
  constants('flash.net::ObjectEncoding', { AMF0: 0, AMF3: 3, DEFAULT: 3 });
  constants('flash.system::IMEConversionMode', {
    ALPHANUMERIC_FULL: 'ALPHANUMERIC_FULL', ALPHANUMERIC_HALF: 'ALPHANUMERIC_HALF', CHINESE: 'CHINESE', JAPANESE_HIRAGANA: 'JAPANESE_HIRAGANA',
    JAPANESE_KATAKANA_FULL: 'JAPANESE_KATAKANA_FULL', JAPANESE_KATAKANA_HALF: 'JAPANESE_KATAKANA_HALF', KOREAN: 'KOREAN', UNKNOWN: 'UNKNOWN',
  });
  constants('flash.desktop::ClipboardFormats', { TEXT_FORMAT: 'air:text', HTML_FORMAT: 'air:html', RICH_TEXT_FORMAT: 'air:rtf', URL_FORMAT: 'air:url', BITMAP_FORMAT: 'air:bitmap', FILE_LIST_FORMAT: 'air:file list' });
  constants('flash.desktop::ClipboardTransferMode', { CLONE_ONLY: 'cloneOnly', CLONE_PREFERRED: 'clonePreferred', ORIGINAL_ONLY: 'originalOnly', ORIGINAL_PREFERRED: 'originalPreferred' });

  // インターフェース（型として使うだけ）。DisplayObject などに付くのは、それぞれのクラスを作るところ。
  for (const name of ['flash.utils::IExternalizable', 'flash.display::IGraphicsData', 'flash.display::IGraphicsFill', 'flash.display::IGraphicsStroke', 'flash.display::IGraphicsPath']) {
    vm.defineClass({ name, base: null, isInterface: true });
  }

  // プロパティを持つだけのクラス。fields は [名前, 既定値, 変換] の並びで、コンストラクタの引数の順。
  const plain = (name, fields, { base = c.Object, methods = {}, staticValues = {}, staticMethods = {}, interfaces = [] } = {}) => vm.defineClass({
    name, base, methods, staticValues, staticMethods, interfaces,
    slots: Object.fromEntries(fields.map(([key, initial]) => [key, initial])),
    construct: (self, args) => { fields.forEach(([key, initial, convert], i) => set(self, key, args[i] === undefined ? initial : convert(args[i]))); },
  });
  c.TextLineMetrics = plain('flash.text::TextLineMetrics', [['x', 0, num], ['width', 0, num], ['height', 0, num], ['ascent', 0, num], ['descent', 0, num], ['leading', 0, num]]);
  plain('flash.media::SoundLoaderContext', [['bufferTime', 1000, num], ['checkPolicyFile', false, bool]]);
  plain('flash.net::Responder', [['result', null, (v) => v], ['status', null, (v) => v]]);
  plain('flash.accessibility::AccessibilityProperties', [['name', '', str], ['description', '', str], ['shortcut', '', str], ['silent', false, bool], ['forceSimple', false, bool], ['noAutoLabeling', false, bool]]);
  vm.defineClass({ name: 'flash.accessibility::Accessibility', final: true, staticValues: { active: false }, staticMethods: { updateProperties: () => {} } });
  plain('flash.display::GraphicsSolidFill', [['color', 0, (v) => vm.toUint32(v)], ['alpha', 1, num]]);
  plain('flash.display::GraphicsEndFill', []);

  // コンテキストメニュー。表示はしない（ブラウザの環境では、右クリックのメニューにはつながらない）が、スクリプトが組み立てられる。
  const builtIn = (self) => get(self, 'builtInItems');
  c.ContextMenuBuiltInItems = vm.defineClass({
    name: 'flash.ui::ContextMenuBuiltInItems',
    slots: { forwardAndBack: true, loop: true, play: true, print: true, quality: true, rewind: true, save: true, zoom: true },
    construct: () => {},
  });
  c.ContextMenuItem = vm.defineClass({
    name: 'flash.ui::ContextMenuItem', base: c.EventDispatcher,
    slots: { caption: '', separatorBefore: false, enabled: true, visible: true },
    construct: (self, [caption, separatorBefore = false, enabled = true, visible = true]) => {
      set(self, 'caption', str(caption));
      set(self, 'separatorBefore', bool(separatorBefore));
      set(self, 'enabled', bool(enabled));
      set(self, 'visible', bool(visible));
    },
  });
  c.ContextMenu = vm.defineClass({
    name: 'flash.ui::ContextMenu', base: c.EventDispatcher,
    slots: { builtInItems: null, customItems: null, link: null, clipboardMenu: false, clipboardItems: null },
    construct: (self) => {
      set(self, 'builtInItems', vm.construct(c.ContextMenuBuiltInItems, []));
      set(self, 'customItems', new ASArray(vm, []));
    },
    methods: {
      hideBuiltInItems: (self) => { for (const k of ['forwardAndBack', 'loop', 'play', 'print', 'quality', 'rewind', 'save', 'zoom']) set(builtIn(self), k, false); },
      clone: (self) => {
        const copy = vm.construct(c.ContextMenu, []);
        for (const k of ['forwardAndBack', 'loop', 'play', 'print', 'quality', 'rewind', 'save', 'zoom']) set(get(copy, 'builtInItems'), k, get(builtIn(self), k));
        set(copy, 'customItems', new ASArray(vm, [...get(self, 'customItems').items]));
        return copy;
      },
    },
    staticValues: { isSupported: true },
  });

  // --- StyleSheet（CSS の読み込みと、スタイルの出し入れ。TextField.styleSheet へのつながりは無い）---
  const camel = (name) => name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  const copyObject = (src) => { const out = new ASObject(c.Object); if (src instanceof ASObject) for (const key of vm.enumerate(src)) out.values.set(publicKey(String(key)), src.values.get(publicKey(String(key)))); return out; };
  c.StyleSheet = vm.defineClass({
    name: 'flash.text::StyleSheet', base: c.EventDispatcher,
    allocate: (klass) => Object.assign(new ASObject(klass), { styles: new Map() }),
    construct: () => {},
    getters: { styleNames: (self) => new ASArray(vm, [...self.styles.keys()]) },
    methods: {
      setStyle: (self, [name, style]) => { if (self.styles.size < 10000) self.styles.set(str(name).toLowerCase() === str(name) ? str(name) : str(name), copyObject(style)); },
      getStyle: (self, [name]) => { const v = self.styles.get(str(name)); return v ? copyObject(v) : null; },
      clear: (self) => { self.styles.clear(); },
      // "selector { property: value; … }" の並び。プロパティ名の - は、続く文字を大文字にして camelCase にする。
      parseCSS: (self, [css]) => {
        const text = str(css).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          const style = new ASObject(c.Object);
          for (const decl of m[2].split(';')) {
            const at = decl.indexOf(':');
            if (at > 0) style.values.set(publicKey(camel(decl.slice(0, at).trim())), decl.slice(at + 1).trim());
          }
          for (const selector of m[1].split(',')) if (selector.trim() && self.styles.size < 10000) self.styles.set(selector.trim(), style);
        }
      },
    },
  });

  // --- LocalConnection（別の SWF とのやり取りは無いので、何も届かない）---
  const connections = new Set();
  c.LocalConnection = vm.defineClass({
    name: 'flash.net::LocalConnection', base: c.EventDispatcher,
    allocate: (klass) => Object.assign(new ASObject(klass), { name: null }),
    construct: () => {},
    getters: { client: (self) => (self.client === undefined ? self : self.client), domain: () => 'localhost', isPerUser: () => false },
    setters: { client: (self, v) => { self.client = v; }, isPerUser: () => {} },
    methods: {
      connect: (self, [name]) => {
        const key = str(name);
        if (name === null || name === undefined || key === '') vm.throwError('TypeError', 2007, 'Parameter connectionName must be non-null.');
        if (self.name !== null || connections.has(key)) vm.throwError('ArgumentError', 2082, 'Connect failed because the object is already connected.');
        connections.add(key);
        self.name = key;
      },
      close: (self) => { if (self.name === null) vm.throwError('ArgumentError', 2083, 'Close failed because the object is not connected.'); connections.delete(self.name); self.name = null; },
      send: () => {},
      allowDomain: () => {},
      allowInsecureDomain: () => {},
    },
    staticValues: { isSupported: true },
  });

  // --- 使えない機能の代用（印刷・URLStream・クリップボード・カメラ・マイク・ファイルの選択）---
  const inert = (name, { base = c.EventDispatcher, getters = {}, methods = {}, staticValues = {}, staticMethods = {} } = {}) => vm.defineClass({ name, base, construct: () => {}, getters, methods, staticValues, staticMethods });
  inert('flash.printing::PrintJob', { methods: { start: () => false, send: () => {}, addPage: () => {} }, staticValues: { isSupported: true } });
  inert('flash.net::URLStream', {
    getters: { connected: () => false, bytesAvailable: () => 0, endian: () => 'bigEndian', objectEncoding: () => 3 },
    methods: { load: () => {}, close: () => {} },
  });
  c.Clipboard = vm.defineClass({
    name: 'flash.desktop::Clipboard', final: true,
    allocate: (klass) => Object.assign(new ASObject(klass), { data: new Map() }),
    construct: () => {},
    getters: { formats: (self) => new ASArray(vm, [...self.data.keys()]) },
    methods: {
      hasFormat: (self, [format]) => self.data.has(str(format)),
      getData: (self, [format]) => self.data.get(str(format)) ?? null,
      setData: (self, [format, data]) => { self.data.set(str(format), data); return true; },
      clear: (self) => { self.data.clear(); },
      clearData: (self, [format]) => { self.data.delete(str(format)); },
    },
  });
  c.Clipboard.values.set(publicKey('generalClipboard'), vm.construct(c.Clipboard, []));
  c.Clipboard.staticTraits.set(publicKey('generalClipboard'), { kind: 'const', key: publicKey('generalClipboard'), name: 'generalClipboard', type: 0, value: c.Clipboard.values.get(publicKey('generalClipboard')) });
  inert('flash.media::Camera', { staticValues: { isSupported: true, names: new ASArray(vm, []) }, staticMethods: { getCamera: () => null } });
  inert('flash.media::Microphone', { staticValues: { isSupported: true, names: new ASArray(vm, []) }, staticMethods: { getMicrophone: () => null, getEnhancedMicrophone: () => null } });
  // FileReference: ファイルの選択はできないので、ファイルの情報を読むと、実機が「選択前」に出すのと同じ #2037 になる。
  const notSelected = () => vm.throwError('Error', 2037, 'Functions called in incorrect sequence, or earlier call was unsuccessful.');
  const fileInfo = Object.fromEntries(['name', 'size', 'type', 'creationDate', 'modificationDate', 'creator', 'data'].map((k) => [k, notSelected]));
  inert('flash.net::FileReference', { getters: fileInfo, methods: { browse: () => false, cancel: () => {}, load: notSelected, save: notSelected, upload: notSelected, download: () => false } });
  plain('flash.net::FileFilter', [['description', '', str], ['extension', '', str], ['macType', null, (v) => (v === null ? null : str(v))]]);

  // IBitmapDrawable: DisplayObject と BitmapData（とその派生）が実装している型。
  const drawable = vm.defineClass({ name: 'flash.display::IBitmapDrawable', base: null, isInterface: true });
  for (const klass of vm.nativeGlobal.values.values()) {
    if (klass instanceof ASClass && (klass.isSubclassOf(c.DisplayObject) || klass === c.BitmapData)) klass.interfaces.add(drawable);
  }

  // --- Vector3D ---
  const v3 = (self) => ({ x: num(get(self, 'x')), y: num(get(self, 'y')), z: num(get(self, 'z')), w: num(get(self, 'w')) });
  const make = (x = 0, y = 0, z = 0, w = 0) => vm.construct(c.Vector3D, [x, y, z, w]);
  const arg = (v, name) => {
    if (v === null || v === undefined) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`);
    return v3(v);
  };
  c.Vector3D = plain('flash.geom::Vector3D', [['x', 0, num], ['y', 0, num], ['z', 0, num], ['w', 0, num]], {
    methods: {
      add: (self, [o]) => { const a = v3(self), b = arg(o, 'a'); return make(a.x + b.x, a.y + b.y, a.z + b.z, 0); },
      subtract: (self, [o]) => { const a = v3(self), b = arg(o, 'a'); return make(a.x - b.x, a.y - b.y, a.z - b.z, 0); },
      clone: (self) => { const a = v3(self); return make(a.x, a.y, a.z, a.w); },
      crossProduct: (self, [o]) => { const a = v3(self), b = arg(o, 'a'); return make(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x, 1); },
      dotProduct: (self, [o]) => { const a = v3(self), b = arg(o, 'a'); return a.x * b.x + a.y * b.y + a.z * b.z; },
      normalize: (self) => {
        const a = v3(self), length = Math.hypot(a.x, a.y, a.z);
        if (length !== 0) { set(self, 'x', a.x / length); set(self, 'y', a.y / length); set(self, 'z', a.z / length); }
        return length;
      },
      scaleBy: (self, [k]) => { const a = v3(self), n = num(k); set(self, 'x', a.x * n); set(self, 'y', a.y * n); set(self, 'z', a.z * n); },
      negate: (self) => { const a = v3(self); set(self, 'x', -a.x); set(self, 'y', -a.y); set(self, 'z', -a.z); },
      incrementBy: (self, [o]) => { const a = v3(self), b = arg(o, 'a'); set(self, 'x', a.x + b.x); set(self, 'y', a.y + b.y); set(self, 'z', a.z + b.z); },
      decrementBy: (self, [o]) => { const a = v3(self), b = arg(o, 'a'); set(self, 'x', a.x - b.x); set(self, 'y', a.y - b.y); set(self, 'z', a.z - b.z); },
      equals: (self, [o, all]) => { const a = v3(self), b = arg(o, 'toCompare'); return a.x === b.x && a.y === b.y && a.z === b.z && (!bool(all) || a.w === b.w); },
      nearEquals: (self, [o, tolerance, all]) => {
        const a = v3(self), b = arg(o, 'toCompare'), t = num(tolerance);
        return Math.abs(a.x - b.x) < t && Math.abs(a.y - b.y) < t && Math.abs(a.z - b.z) < t && (!bool(all) || Math.abs(a.w - b.w) < t);
      },
      project: (self) => { const a = v3(self); if (a.w !== 0) { set(self, 'x', a.x / a.w); set(self, 'y', a.y / a.w); set(self, 'z', a.z / a.w); } },
      toString: (self) => { const a = v3(self); return `Vector3D(${str(a.x)}, ${str(a.y)}, ${str(a.z)})`; },
    },
    staticMethods: {
      angleBetween: (_, [p, q]) => { const a = arg(p, 'a'), b = arg(q, 'b'); return Math.acos((a.x * b.x + a.y * b.y + a.z * b.z) / (Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) * Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z))); },
      distance: (_, [p, q]) => { const a = arg(p, 'pt1'), b = arg(q, 'pt2'); return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2); },
    },
  });
  for (const [key, value] of [['length', (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)], ['lengthSquared', (a) => a.x * a.x + a.y * a.y + a.z * a.z]]) {
    c.Vector3D.instanceTraits.set(publicKey(key), { kind: 'accessor', key: publicKey(key), name: key, get: vm.native((self) => value(v3(self))), set: null });
  }
  for (const [key, x, y, z] of [['X_AXIS', 1, 0, 0], ['Y_AXIS', 0, 1, 0], ['Z_AXIS', 0, 0, 1]]) {
    const v = make(x, y, z, 0);
    c.Vector3D.values.set(publicKey(key), v);
    c.Vector3D.staticTraits.set(publicKey(key), { kind: 'const', key: publicKey(key), name: key, type: 0, value: v });
  }

  // IME と SecurityDomain は、値を持つだけ。
  vm.defineClass({
    name: 'flash.system::IME', final: true, base: c.EventDispatcher,
    staticValues: { isSupported: true, enabled: false, conversionMode: 'UNKNOWN' },
    staticMethods: { setCompositionString: () => {}, doConversion: () => {}, compositionSelectionChanged: () => {} },
  });
  vm.defineClass({ name: 'flash.system::SecurityDomain', final: true, staticValues: { currentDomain: new ASObject(c.Object) } });
}
