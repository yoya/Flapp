// 読み込みと通信、実行環境にかかわるクラス: URLLoader、Loader、LoaderInfo、SharedObject、ApplicationDomain、
// Capabilities、ExternalInterface、Mouse、Keyboard など。
//
// プレイヤーは自分では通信しない。要求は movie.request で記録する。URLLoader と sendToURL は、ホストが Movie.load の
// network オプションで読み込みの関数を渡していれば、それに任せる。渡していなければ、スクリプトには失敗（ioError）を伝える。
// Loader も同じく、ホストに読み込みを任せて、画像（JPEG / PNG / GIF）と SWF を表示する。AS3 の SWF は、そのクラスをこのムービーの
// 仮想機械に足して動かす（子のアプリケーションドメインと同じく、同じ名前のクラスは読み込んだ側のものが使われる）。
// AS1 / AS2 の SWF は、表示はするが、スクリプトは動かない。
// SharedObject は、ホストが storage オプションを渡していれば、そこへ保存して読む。渡していなければ、再生している間だけ値を持つ。
// Capabilities は固定の値を返す（再生している端末の情報は渡さない）。
import { EMPTY_SHARED, decodeShared, encodeShared } from '../player/sharedstore.js';
import { LegacyText } from '../swf/legacy.js';
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
  // 実機の URL の扱い（実機の画面から求めた規則）: 空白・制御文字・非 ASCII・{ } | \\ ^ ` < > " のどれかを含む URL は、全体を作り直す。
  // 非 ASCII の文字は、システムの文字コード（movie.encoding）のバイトにして %XX にする（表せない文字は ?）。そのうえで、% を含む
  // 安全でない文字を %XX にする（すでに %XX の形になっていても、% を %25 にする）。含まない URL は、そのまま。
  let systemText;
  const escapeUrl = (url) => {
    if (!/[^\x21-\x7e]|[{}|\\^`<>"]/.test(url)) return url;
    systemText ??= new LegacyText(movie.encoding);
    const bytes = systemText.encode(url);
    let out = '';
    for (const ch of bytes) out += ch.charCodeAt(0) >= 0x80 ? `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}` : ch;
    return out.replace(/[^\x21-\x7e]|[%{}|\\^`<>"]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  };
  // URLRequest を、ホストの読み込みの関数に渡す形にする。data は、ByteArray ならその中身、ほかは文字列にして送る。
  // 実機で確認した規則:
  //   GET のときは、data を URL の後ろに付ける（URL に ? があれば、区切りなしにそのまま続ける）。
  //   POST で送る本文が空（data が無いか、空の文字列・URLVariables）のときは、GET で送る。Content-Type は、data があれば付く。
  //   Content-Type は、requestHeaders に Content-Type があればそれ、無ければ contentType、さらに無ければ application/x-www-form-urlencoded。
  const hostRequest = (request) => {
    let method = String(request.method ?? 'GET').toUpperCase();
    const data = request.data;
    let url = request.url ?? '';
    let body = null;
    const headers = {};
    for (const [name, value] of vm.requestHeaders(request)) headers[name] = value;
    const typeHeader = Object.keys(headers).find((name) => name.toLowerCase() === 'content-type');
    let contentType = null;
    if (data !== undefined && data !== null) {
      if (method === 'GET') url += `${url.includes('?') ? '' : '?'}${str(data)}`;
      else {
        body = data instanceof ASObject && data.bytes ? data.bytes.data.slice(0, data.bytes.length) : new TextEncoder().encode(str(data));
        contentType = request.contentType ?? 'application/x-www-form-urlencoded';
        if (!body.length) body = null;
      }
    }
    if (method === 'POST' && !body) method = 'GET';
    if (typeHeader) { contentType = headers[typeHeader]; delete headers[typeHeader]; }
    return { url: escapeUrl(url), method, data: body, contentType, headers: Object.keys(headers).length ? headers : undefined };
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
      // 読み込みはホストに任せる。読めたら open、progress、complete を、読めなければ open と ioError を伝える。
      load: (self, [request]) => {
        const url = requestOf(request, 'request').url ?? '';
        movie.request({ kind: 'load', url, target: '', method: request.method ?? 'GET' });
        self.loading = (self.loading ?? 0) + 1;
        const id = self.loading;
        movie.load(hostRequest(request), display.later, (bytes) => {
          if (self.loading !== id) return; // 待っている間に、別の読み込みや close があった
          display.dispatch(self, vm.construct(c.Event, ['open']));
          if (!bytes) {
            if (!self.listeners?.get('ioError')?.length) movie.warn(`unhandled ioError: ${url}`);
            display.dispatch(self, vm.construct(c.IOErrorEvent, ['ioError', false, false, `Error #2032: Stream Error. URL: ${url}`, 2032]));
            return;
          }
          const format = str(vm.getProperty(self, vm.keyName('dataFormat')));
          let value;
          if (format === 'binary') {
            value = vm.construct(c.ByteArray, []);
            Object.assign(value.bytes, { data: bytes.slice(), length: bytes.length, position: 0, view: null });
          } else {
            vm.charge(bytes.length);
            const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '');
            value = format === 'variables' ? vm.construct(c.URLVariables, [text]) : text;
          }
          vm.setProperty(self, vm.keyName('data'), value);
          vm.setProperty(self, vm.keyName('bytesLoaded'), bytes.length);
          vm.setProperty(self, vm.keyName('bytesTotal'), bytes.length);
          display.dispatch(self, vm.construct(c.ProgressEvent, ['progress', false, false, bytes.length, bytes.length]));
          display.dispatch(self, vm.construct(c.Event, ['complete']));
        });
      },
      close: (self) => { self.loading = (self.loading ?? 0) + 1; },
    },
  });
  // 送るだけで、応答は受け取らない。
  vm.defineGlobal('flash.net::sendToURL', vm.native((_, [request]) => {
    requestOf(request, 'request');
    vm.simpleOnly(request);
    movie.request({ kind: 'sendToURL', url: requestOf(request, 'request').url ?? '', target: '', method: request.method ?? 'GET' });
    movie.load(hostRequest(request), display.later, () => {});
  }, 'sendToURL'));
  // SharedObject: 名前ごとに 1 つ。data に入れた値は、再生している間だけ残る。storage があれば、flush() と saveShared() で書き、
  // 最初に getLocal したときに読む（player/sharedstore.js）。localPath は区別しない（SWF ごとの区別はホストが付ける）。
  const shared = new Map();
  const plain = (v) => v instanceof ASObject && v.klass === c.Object;
  const adapter = {
    kind: (v) => {
      if (v === undefined) return 'undefined';
      if (v === null) return 'null';
      if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return typeof v;
      if (v instanceof ASArray) return v.klass === c.Array ? 'array' : 'skip';
      if (v instanceof ASObject && v.klass === c.Date) return 'date';
      return plain(v) ? 'object' : 'skip'; // 独自のクラスのインスタンス、関数、表示オブジェクトなどは保存しない
    },
    time: (d) => d.time,
    items: (a) => Array.from(a.items), // 穴は undefined になる
    entries: (o) => vm.enumerate(o).map((k) => [String(k), o.values.get(publicKey(String(k)))]),
  };
  const builder = {
    undefined: () => undefined,
    date: (t) => Object.assign(new ASObject(c.Date), { time: t }),
    array: (items) => new ASArray(vm, items),
    object: (entries) => { const o = new ASObject(c.Object); for (const [k, v] of entries) vm.setProperty(o, vm.keyName(k), v); return o; },
  };
  const save = (name, obj) => {
    const text = encodeShared(obj.data, adapter);
    return text !== null && movie.storage.save(name, text === EMPTY_SHARED ? null : text) === true;
  };
  vm.saveShared = () => { if (movie.storage) for (const [name, obj] of shared) save(name, obj); };
  const nameOf = (self) => { for (const [name, obj] of shared) if (obj === self) return name; return undefined; };
  c.SharedObject = vm.defineClass({
    name: 'flash.net::SharedObject', base: c.EventDispatcher,
    getters: { data: (self) => self.data, size: () => 0, objectEncoding: () => 3, client: (self) => self },
    setters: { objectEncoding: () => {}, client: () => {} },
    methods: {
      flush: (self) => (!movie.storage || save(nameOf(self), self) ? 'flushed' : 'pending'), // 入りきらなければ保存できない（容量を増やす確認はしない）
      clear: (self) => { self.data = new ASObject(c.Object); if (movie.storage) movie.storage.save(nameOf(self), null); },
      close: () => {}, setProperty: (self, [name, value]) => { vm.setProperty(self.data, vm.keyName(str(name)), value); },
    },
    staticMethods: {
      getLocal: (_, [name]) => {
        const key = str(name);
        if (name === null || name === undefined || /[ ~%&\\;:"',<>?#]/.test(key)) vm.throwError('Error', 2134, 'Cannot create SharedObject.');
        if (!shared.has(key)) {
          if (shared.size >= MAX_SHARED) vm.throwError('Error', 2134, 'Cannot create SharedObject.');
          const saved = movie.storage ? decodeShared(movie.storage.load(key), builder) : undefined;
          shared.set(key, Object.assign(new ASObject(c.SharedObject), { data: plain(saved) ? saved : new ASObject(c.Object) }));
        }
        return shared.get(key);
      },
    },
    staticValues: { defaultObjectEncoding: 3 },
  });

  // --- LoaderInfo と Loader ---
  const stageSize = (axis) => (axis === 'x' ? movie.frameSize.xmax - movie.frameSize.xmin : movie.frameSize.ymax - movie.frameSize.ymin) / 20;
  // { root: メインのムービーの情報か, loader: Loader のオブジェクト, done: 読み込んだ中身の情報がそろったか,
  //   url, size, contentType, content, width, height, swf: { version, frameRate, actionScriptVersion }（SWF のとき） }
  const info = (self) => self.info;
  // メインのムービーの読み込みは、最初のフレームの処理が終わったところで「済んだ」ことになる。それまで（文書クラスの
  // コンストラクタの中など）は、大きさやフレームレートなどを読むと誤りになる（実機で確認）。
  let loaded = false;
  const ready = (self, value) => {
    if (info(self).root ? !loaded : !info(self).done) vm.throwError('Error', 2099, 'The loading object is not sufficiently loaded to provide this information.');
    return value;
  };
  // SWF でなければ読めない情報（画像を読み込んだときの swfVersion など）。
  const swfOnly = (self, pick) => {
    ready(self, null);
    if (info(self).root) return pick({ version: movie.version, frameRate: movie.frameRate, actionScriptVersion: 3 });
    if (!info(self).swf) vm.throwError('Error', 2098, 'The loading object is not a .swf file, you cannot request SWF properties from it.');
    return pick(info(self).swf);
  };
  c.LoaderInfo = vm.defineClass({
    name: 'flash.display::LoaderInfo', base: c.EventDispatcher,
    getters: {
      url: (self) => (info(self).root ? movie.url ?? '' : info(self).url ?? null), loaderURL: () => movie.url ?? '',
      bytesLoaded: (self) => (info(self).root ? movie.fileLength : info(self).size ?? 0), bytesTotal: (self) => (info(self).root ? movie.fileLength : info(self).size ?? 0),
      width: (self) => ready(self, info(self).root ? stageSize('x') : info(self).width), height: (self) => ready(self, info(self).root ? stageSize('y') : info(self).height),
      frameRate: (self) => swfOnly(self, (swf) => swf.frameRate), swfVersion: (self) => swfOnly(self, (swf) => swf.version),
      actionScriptVersion: (self) => swfOnly(self, (swf) => swf.actionScriptVersion),
      // parameters（SWF に渡された引数）は空で、読むたびに別のオブジェクトになる。
      content: (self) => (info(self).root ? (movie.root ? display.wrap(movie.root) : null) : info(self).content ?? null), loader: (self) => info(self).loader ?? null,
      parameters: () => new ASObject(c.Object),
      contentType: (self) => (info(self).root ? (loaded ? 'application/x-shockwave-flash' : null) : info(self).contentType ?? null),
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
  const contentInfo = (self) => (self.contentInfo ??= loaderInfo({ root: false, loader: self }));
  const ioError = (target, url, id, text) => {
    if (!target.listeners?.get('ioError')?.length) movie.warn(`unhandled ioError: ${url}`);
    display.dispatch(target, vm.construct(c.IOErrorEvent, ['ioError', false, false, `Error #${id}: ${text}`, id]));
  };
  // 読み込んだ中身を取り除く。
  const unloadContent = (self, notify) => {
    const content = self.content;
    if (!content) return;
    self.content = null;
    if (content.display?.parent === self.display) vm.callProperty(self, vm.keyName('removeChild'), [content]);
    const inf = info(contentInfo(self));
    Object.assign(inf, { done: false, content: null, url: null, size: 0, contentType: null, swf: null, width: 0, height: 0 });
    if (notify) display.dispatch(contentInfo(self), vm.construct(c.Event, ['unload']));
  };
  let warnedAVM1 = false;
  // 読み込んだバイト列（読めなければ null）を、中身にして Loader の子にする。
  const receive = (self, id, url, bytes) => {
    if (self.loadId !== id) return; // 待っている間に、別の読み込みや close があった
    const target = contentInfo(self);
    if (!bytes) return ioError(target, url, 2035, `URL Not Found. URL: ${url}`);
    movie.loadContent(bytes, display.later, (content) => {
      if (self.loadId !== id) return;
      if (!content) return ioError(target, url, 2124, `Loaded file is an unknown type. URL: ${url}`);
      const inf = info(target);
      Object.assign(inf, { url, size: content.size });
      display.dispatch(target, vm.construct(c.Event, ['open']));
      display.dispatch(target, vm.construct(c.ProgressEvent, ['progress', false, false, content.size, content.size]));
      let obj;
      if (content.bitmap) {
        const { width, height, encoded } = content.bitmap;
        Object.assign(inf, { width, height, contentType: encoded.type, swf: null });
        obj = display.loadedBitmap(content.bitmap);
      } else {
        const lib = content.library;
        const { frameSize } = lib;
        Object.assign(inf, {
          width: (frameSize.xmax - frameSize.xmin) / 20, height: (frameSize.ymax - frameSize.ymin) / 20, contentType: 'application/x-shockwave-flash',
          swf: { version: lib.version, frameRate: lib.frameRate, actionScriptVersion: lib.isAS3 ? 3 : 2 },
        });
        // ルートは、文書クラス（無ければ MovieClip）のオブジェクトとして作る。AS1 / AS2 の SWF は、スクリプトを動かさずに表示だけする。
        let klass = c.MovieClip;
        if (lib.isAS3) {
          movie.addLinked(lib, content.character);
          const name = lib.symbolClasses.get(0);
          klass = (name && vm.classByName(name)) || c.MovieClip;
        } else if (!warnedAVM1) {
          warnedAVM1 = true;
          movie.warn(`${url}: the scripts of an ActionScript 1/2 movie loaded by Loader do not run`);
        }
        display.nextCharacter = content.character;
        display.nextLoadedInfo = target;
        obj = vm.construct(klass, []);
        display.nextCharacter = null;
        display.nextLoadedInfo = null;
      }
      obj.display.loadedInfo = target;
      self.content = obj;
      Object.assign(inf, { content: obj, done: true });
      vm.callProperty(self, vm.keyName('addChild'), [obj]);
      display.dispatch(target, vm.construct(c.Event, ['init']));
      display.dispatch(target, vm.construct(c.Event, ['complete']));
    });
  };
  c.Loader = vm.defineClass({
    name: 'flash.display::Loader', base: c.DisplayObjectContainer,
    getters: { content: (self) => self.content ?? null, contentLoaderInfo: (self) => contentInfo(self) },
    methods: {
      // load(URLRequest): 画像か SWF を読み込む。読み込みはホストに任せる（Movie.load の network）。
      load: (self, [request]) => {
        const url = requestOf(request, 'request').url ?? '';
        movie.request({ kind: 'load', url, target: '', method: request.method ?? 'GET' });
        unloadContent(self, false);
        const id = (self.loadId = (self.loadId ?? 0) + 1);
        movie.load(hostRequest(request), display.later, (bytes) => receive(self, id, url, bytes));
      },
      // loadBytes(ByteArray): バイト列の画像か SWF を、次のフレームで読み込む。
      loadBytes: (self, [bytes]) => {
        if (!(bytes instanceof ASObject) || !bytes.bytes) vm.throwError('TypeError', 2007, 'Parameter bytes must be non-null.');
        const data = bytes.bytes.data.slice(0, bytes.bytes.length);
        unloadContent(self, false);
        const id = (self.loadId = (self.loadId ?? 0) + 1);
        display.later(() => receive(self, id, '', data));
      },
      unload: (self) => unloadContent(self, true),
      unloadAndStop: (self) => unloadContent(self, true),
      close: (self) => { self.loadId = (self.loadId ?? 0) + 1; },
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
