// 読み込みと通信、実行環境にかかわるクラス: URLLoader、Loader、LoaderInfo、SharedObject、ApplicationDomain、
// Capabilities、ExternalInterface、Mouse、Keyboard など。
//
// 外部への通信や読み込みは一切しない。要求は movie.request で記録し、スクリプトには失敗（ioError）を伝える。
// SharedObject は、このムービーを再生している間だけ値を持つ（保存はしない）。
// Capabilities は固定の値を返す（再生している端末の情報は渡さない）。
import { ASArray, ASClass, ASObject, publicKey } from './object.js';

const MAX_SHARED = 100; // SharedObject の名前の数の上限

/**
 * @param {import('./vm.js').AVM2} vm
 * @param {import('../player/movie.js').Movie} movie
 */
export function installNet(vm, movie) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const { display } = vm;
  const constants = (name, values) => vm.defineClass({ name, final: true, staticValues: values });
  const accessor = (klass, name, get, set = null) => klass.staticTraits.set(publicKey(name), {
    kind: 'accessor', key: publicKey(name), name, get: vm.native(() => get()), set: set ? vm.native((_, [v]) => set(v)) : null,
  });
  const requestOf = (v, name) => {
    if (!(v instanceof ASObject) || v.klass !== c.URLRequest) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`);
    return v;
  };
  // 読み込みの失敗を、次のフレームの後で target に伝える。誰も聞いていなければ警告を残す（実機は、エラーの窓を出す）。
  // opened が真なら、先に open を伝える（実機の URLLoader は、ファイルが無くても open を出す）。
  // 実機のデバッガ版は、この失敗の通知の途中で落ちるので、ここの順序や内容は実機と照合できていない。
  const fail = (target, url, opened = false) => display.later(() => {
    if (opened) display.dispatch(target, vm.construct(c.Event, ['open']));
    if (!target.listeners?.get('ioError')?.length) movie.warn(`unhandled ioError: ${url}`);
    display.dispatch(target, vm.construct(c.IOErrorEvent, ['ioError', false, false, `Error #2032: Stream Error. URL: ${url}`, 2032]));
  });

  // --- flash.net ---
  constants('flash.net::URLRequestMethod', { GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE', HEAD: 'HEAD', OPTIONS: 'OPTIONS' });
  constants('flash.net::URLLoaderDataFormat', { TEXT: 'text', BINARY: 'binary', VARIABLES: 'variables' });
  vm.defineClass({
    name: 'flash.net::URLRequestHeader', final: true, slots: { name: '', value: '' },
    construct: (self, [name = '', value = '']) => { self.values.set(publicKey('name'), str(name)); self.values.set(publicKey('value'), str(value)); },
  });
  // URLVariables: "a=1&b=2" の形の文字列と、プロパティの相互変換。
  const decode = (self, source) => {
    for (const pair of str(source).split('&')) {
      if (!pair) continue;
      const at = pair.indexOf('=');
      if (at < 0) vm.throwError('Error', 2101, 'The String passed to URLVariables.decode() must be a URL-encoded query string containing name/value pairs.');
      const read = (text) => { try { return decodeURIComponent(text.replace(/\+/g, ' ')); } catch { return text; } };
      const key = publicKey(read(pair.slice(0, at)));
      const value = read(pair.slice(at + 1));
      const old = self.values.get(key);
      // 同じ名前が 2 回以上あれば、値は配列になる。
      if (old === undefined) { vm.charge(1); self.values.set(key, value); } else if (old instanceof ASArray) old.items.push(value); else self.values.set(key, new ASArray(vm, [old, value]));
    }
  };
  c.URLVariables = vm.defineClass({
    name: 'flash.net::URLVariables', dynamic: true,
    construct: (self, [source]) => { if (source !== undefined && source !== null) decode(self, source); },
    methods: {
      decode: (self, [source]) => { decode(self, source); },
      toString: (self) => vm.enumerate(self).map((key) => {
        const v = vm.getProperty(self, vm.keyName(key));
        return (v instanceof ASArray ? v.items : [v]).map((item) => `${encodeURIComponent(String(key))}=${encodeURIComponent(str(item))}`).join('&');
      }).join('&'),
    },
  });
  c.URLLoader = vm.defineClass({
    name: 'flash.net::URLLoader', base: c.EventDispatcher,
    slots: { data: undefined, dataFormat: 'text', bytesLoaded: 0, bytesTotal: 0 },
    construct: (self, [request]) => { if (request !== undefined && request !== null) vm.callProperty(self, vm.keyName('load'), [request]); },
    methods: {
      load: (self, [request]) => {
        const url = requestOf(request, 'request').url ?? '';
        movie.request({ kind: 'load', url, target: '', method: request.method ?? 'GET' });
        fail(self, url, true);
      },
      close: () => {},
    },
  });
  vm.defineGlobal('flash.net::sendToURL', vm.native((_, [request]) => {
    movie.request({ kind: 'sendToURL', url: requestOf(request, 'request').url ?? '', target: '', method: request.method ?? 'GET' });
  }, 'sendToURL'));
  // SharedObject: 名前ごとに 1 つ。data に入れた値は、再生している間だけ残る。
  const shared = new Map();
  c.SharedObject = vm.defineClass({
    name: 'flash.net::SharedObject', base: c.EventDispatcher,
    getters: { data: (self) => self.data, size: () => 0, objectEncoding: () => 3, client: (self) => self },
    setters: { objectEncoding: () => {}, client: () => {} },
    methods: {
      flush: () => 'flushed',
      clear: (self) => { self.data = new ASObject(c.Object); },
      close: () => {}, setProperty: (self, [name, value]) => { vm.setProperty(self.data, vm.keyName(str(name)), value); },
    },
    staticMethods: {
      getLocal: (_, [name]) => {
        const key = str(name);
        if (name === null || name === undefined || /[ ~%&\\;:"',<>?#]/.test(key)) vm.throwError('Error', 2134, 'Cannot create SharedObject.');
        if (!shared.has(key)) {
          if (shared.size >= MAX_SHARED) vm.throwError('Error', 2134, 'Cannot create SharedObject.');
          shared.set(key, Object.assign(new ASObject(c.SharedObject), { data: new ASObject(c.Object) }));
        }
        return shared.get(key);
      },
    },
    staticValues: { defaultObjectEncoding: 3 },
  });

  // --- LoaderInfo と Loader ---
  const stageSize = (axis) => (axis === 'x' ? movie.frameSize.xmax - movie.frameSize.xmin : movie.frameSize.ymax - movie.frameSize.ymin) / 20;
  const info = (self) => self.info; // { root: メインのムービーの情報か, loader: Loader のオブジェクト }
  // メインのムービーの読み込みは、最初のフレームの処理が終わったところで「済んだ」ことになる。それまで（文書クラスの
  // コンストラクタの中など）は、大きさやフレームレートなどを読むと誤りになる（実機で確認）。
  let loaded = false;
  const ready = (self, value) => {
    if (!info(self).root || !loaded) vm.throwError('Error', 2099, 'The loading object is not sufficiently loaded to provide this information.');
    return value;
  };
  c.LoaderInfo = vm.defineClass({
    name: 'flash.display::LoaderInfo', base: c.EventDispatcher,
    getters: {
      url: (self) => (info(self).root ? movie.url ?? '' : null), loaderURL: () => movie.url ?? '',
      bytesLoaded: (self) => (info(self).root ? movie.fileLength : 0), bytesTotal: (self) => (info(self).root ? movie.fileLength : 0),
      width: (self) => ready(self, stageSize('x')), height: (self) => ready(self, stageSize('y')),
      frameRate: (self) => ready(self, movie.frameRate), swfVersion: (self) => ready(self, movie.version), actionScriptVersion: (self) => ready(self, 3),
      // parameters（SWF に渡された引数）は空で、読むたびに別のオブジェクトになる。
      content: (self) => (info(self).root && movie.root ? display.wrap(movie.root) : null), loader: (self) => info(self).loader ?? null,
      parameters: () => new ASObject(c.Object), contentType: (self) => (info(self).root && loaded ? 'application/x-shockwave-flash' : null),
      sameDomain: (self) => ready(self, true), childAllowsParent: (self) => ready(self, true), parentAllowsChild: (self) => ready(self, true),
      applicationDomain: () => new ASObject(c.ApplicationDomain), sharedEvents: (self) => (info(self).shared ??= new ASObject(c.EventDispatcher)),
    },
  });
  const loaderInfo = (values) => Object.assign(new ASObject(c.LoaderInfo), { info: values });
  let rootInfo = null;
  let stageInfo = null;
  /** 表示オブジェクトの loaderInfo。メインのムービーに属するものは、どれも同じオブジェクトを返す（ステージのものは別）。 */
  display.loaderInfo = (stage) => (stage ? (stageInfo ??= loaderInfo({ root: true })) : (rootInfo ??= loaderInfo({ root: true })));
  /** 最初のフレームの処理が終わったら呼ばれる。メインのムービーの loaderInfo に、init、progress、complete を順に届ける。 */
  display.loaded = () => {
    loaded = true;
    if (!rootInfo) return;
    display.send(rootInfo, c.Event, ['init']);
    display.send(rootInfo, c.ProgressEvent, ['progress', false, false, movie.fileLength, movie.fileLength]);
    display.send(rootInfo, c.Event, ['complete']);
  };
  c.Loader = vm.defineClass({
    name: 'flash.display::Loader', base: c.DisplayObjectContainer,
    getters: { content: () => null, contentLoaderInfo: (self) => (self.contentInfo ??= loaderInfo({ root: false, loader: self })) },
    methods: {
      load: (self, [request]) => {
        const url = requestOf(request, 'request').url ?? '';
        movie.request({ kind: 'load', url, target: '', method: request.method ?? 'GET' });
        fail(vm.getProperty(self, vm.keyName('contentLoaderInfo')), url);
      },
      // 入れ子のムービーの再生には対応していない。
      loadBytes: (self) => {
        movie.warn('Loader.loadBytes is not supported');
        fail(vm.getProperty(self, vm.keyName('contentLoaderInfo')), '');
      },
      unload: () => {}, unloadAndStop: () => {}, close: () => {},
    },
  });

  // --- flash.system ---
  // ApplicationDomain は 1 つだけだが、currentDomain を読むたびに別のオブジェクトが返る（実機で確認）。
  c.ApplicationDomain = vm.defineClass({
    name: 'flash.system::ApplicationDomain', final: true,
    getters: { parentDomain: () => null },
    methods: {
      getDefinition: (_, [name]) => {
        const found = vm.classByName(str(name).replace('::', '.'));
        if (!found) vm.throwError('ReferenceError', 1065, `Variable ${str(name)} is not defined.`);
        return found;
      },
      hasDefinition: (_, [name]) => vm.classByName(str(name).replace('::', '.')) instanceof ASClass,
    },
  });
  accessor(c.ApplicationDomain, 'currentDomain', () => new ASObject(c.ApplicationDomain));
  vm.defineClass({ name: 'flash.system::LoaderContext', slots: { checkPolicyFile: false, applicationDomain: null, securityDomain: null } });
  constants('flash.system::Capabilities', {
    version: 'MAC 35,0,0,60', os: 'Mac OS', manufacturer: 'Flapp', playerType: 'StandAlone', language: 'en', isDebugger: false,
    screenResolutionX: 1920, screenResolutionY: 1080, screenDPI: 72, pixelAspectRatio: 1, screenColor: 'color',
    hasAudio: true, hasMP3: true, hasAudioEncoder: false, hasVideoEncoder: false, hasEmbeddedVideo: true, hasStreamingAudio: true, hasStreamingVideo: true,
    hasAccessibility: false, hasPrinting: false, hasScreenBroadcast: false, hasScreenPlayback: false, hasIME: false, hasTLS: false,
    avHardwareDisable: true, localFileReadDisable: true, cpuArchitecture: 'x86', supports32BitProcesses: false, supports64BitProcesses: true,
    touchscreenType: 'none', serverString: '',
  });
  vm.defineClass({
    name: 'flash.system::System', final: true,
    staticMethods: { gc: () => {}, setClipboard: () => {}, pause: () => {}, resume: () => {}, exit: () => {} },
    staticValues: { useCodePage: false, totalMemory: 0, freeMemory: 0, privateMemory: 0 },
  });
  vm.defineGlobal('flash.system::fscommand', vm.native((_, [command, args]) => {
    movie.request({ kind: 'fscommand', url: `FSCommand:${str(command)}`, target: args === undefined ? '' : str(args), method: '' });
  }, 'fscommand'));
  vm.defineClass({
    name: 'flash.external::ExternalInterface', final: true,
    staticMethods: { call: () => null, addCallback: () => {} },
    staticValues: { available: false, objectID: null, marshallExceptions: false },
  });

  // --- flash.ui ---
  const mouse = vm.defineClass({ name: 'flash.ui::Mouse', final: true, staticMethods: { hide: () => {}, show: () => {} }, staticValues: { supportsCursor: true, supportsNativeCursor: false } });
  let cursor = 'auto';
  accessor(mouse, 'cursor', () => cursor, (v) => { cursor = str(v); });
  constants('flash.ui::MouseCursor', { AUTO: 'auto', ARROW: 'arrow', BUTTON: 'button', HAND: 'hand', IBEAM: 'ibeam' });
  const keys = {
    BACKSPACE: 8, TAB: 9, ENTER: 13, COMMAND: 15, SHIFT: 16, CONTROL: 17, ALTERNATE: 18, CAPS_LOCK: 20, NUMPAD: 21, ESCAPE: 27, SPACE: 32,
    PAGE_UP: 33, PAGE_DOWN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, INSERT: 45, DELETE: 46,
    NUMPAD_MULTIPLY: 106, NUMPAD_ADD: 107, NUMPAD_ENTER: 108, NUMPAD_SUBTRACT: 109, NUMPAD_DECIMAL: 110, NUMPAD_DIVIDE: 111,
    SEMICOLON: 186, EQUAL: 187, COMMA: 188, MINUS: 189, PERIOD: 190, SLASH: 191, BACKQUOTE: 192, LEFTBRACKET: 219, BACKSLASH: 220, RIGHTBRACKET: 221, QUOTE: 222,
    capsLock: false, numLock: false, hasVirtualKeyboard: false, physicalKeyboardType: 'alphanumeric',
  };
  for (let i = 0; i < 26; i++) keys[String.fromCharCode(65 + i)] = 65 + i;
  for (let i = 0; i < 10; i++) { keys[`NUMBER_${i}`] = 48 + i; keys[`NUMPAD_${i}`] = 96 + i; }
  for (let i = 1; i <= 15; i++) keys[`F${i}`] = 111 + i;
  vm.defineClass({ name: 'flash.ui::Keyboard', final: true, staticValues: keys, staticMethods: { isAccessible: () => false } });
  constants('flash.ui::KeyLocation', { STANDARD: 0, LEFT: 1, RIGHT: 2, NUM_PAD: 3 });
}
