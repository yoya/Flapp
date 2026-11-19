// LoadVars、MovieClipLoader、SharedObject。
//
// このプレイヤーは外部のファイルやネットワークを読みに行かない。読み込みの要求は記録するだけで（vm.request）、
// スクリプトには「読み込みに失敗した」と伝える。実機で存在しないファイルを指定したときと同じ流れになる。
import { toStr } from './convert.js';
import { defineClass, defineMethods } from './globals.js';
import { AVMFunction, AVMObject, DONT_DELETE, DONT_ENUM } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;

export function installNet(vm) {
  const g = vm.global;
  const escape = (v) => toStr(vm, vm.call(g.get('escape'), undefined, [toStr(vm, v)]));
  const unescape = (s) => toStr(vm, vm.call(g.get('unescape'), undefined, [s.replace(/\+/g, ' ')]));
  const callMethod = (obj, name, args) => {
    const fn = obj.get(name);
    if (fn instanceof AVMFunction) vm.invoke(fn, obj, args);
  };

  // --- LoadVars ---
  const loadVarsProto = new AVMObject(vm, vm.objectProto);
  loadVarsProto.define('contentType', 'application/x-www-form-urlencoded', HIDDEN);
  // "a=1&b=2" の形の文字列を、obj の変数（プロパティ）に入れる。loadVariables で読んだデータにも使う。
  vm.decodeVariables = (obj, text) => {
    for (const pair of text.split('&')) {
      if (pair === '') continue;
      const at = pair.indexOf('=');
      obj.set(unescape(at < 0 ? pair : pair.slice(0, at)), at < 0 ? '' : unescape(pair.slice(at + 1)));
    }
  };
  // loadVariables で読んだデータを、クリップの変数に入れて、onData を呼ぶ。
  vm.loadedVariables = (clip, text) => {
    vm.decodeVariables(clip, text);
    callMethod(clip, 'onData', []);
  };
  // getURL / loadVariables にメソッド（GET / POST）を指定したときに送る、クリップの変数（"a=1&b=2" の形）。
  // 関数と、子のクリップなどの表示オブジェクトは送らない。
  vm.clipVariables = (clip) => clip.ownKeys().filter((key) => {
    const v = clip.get(key);
    return !(v instanceof AVMFunction) && !(v instanceof AVMObject && (v.isMovieClip || v.isTextField || v.isVideo));
  }).map((key) => `${escape(key)}=${escape(clip.get(key))}`).join('&');
  // "a=1&b=2" の形にする。新しいプロパティが先（for..in と同じ順）。
  const encodeVariables = (obj) => obj.ownKeys().map((key) => `${escape(key)}=${escape(obj.get(key))}`).join('&');
  // 読み込みを始める。読み込みはホストに任せる（ホストが読まなければ、次のフレームで失敗を伝える）。
  // sender があれば、その中身を本文として送る（sendAndLoad）。結果は self の onData に渡る。
  const startLoad = (self, url, method, sender = null) => {
    if (!(self instanceof AVMObject) || url === undefined) return false;
    self.define('loaded', false, HIDDEN);
    self.bytesLoaded = 0;
    const body = sender instanceof AVMObject ? encodeVariables(sender) : '';
    const contentType = sender instanceof AVMObject ? toStr(vm, sender.get('contentType')) : undefined;
    self.bytesTotal = undefined;
    vm.loadText({ url: toStr(vm, url), method, body, contentType }, (text, size) => {
      if (text !== undefined) self.bytesLoaded = self.bytesTotal = size;
      callMethod(self, 'onData', [text]);
    });
    return true;
  };
  defineMethods(vm, loadVarsProto, {
    load: (_, self, [url]) => startLoad(self, url, ''),
    // send: 中身を付けて、その URL へ移動する（移動はホストに任せる）。
    send: (_, self, [url, target, method]) => {
      if (url === undefined) return false;
      const req = { kind: 'getURL', url: toStr(vm, url), target: '', method: method === undefined ? 'POST' : toStr(vm, method) };
      vm.request(req);
      vm.navigate({ ...req, target: target === undefined ? '' : toStr(vm, target), data: self instanceof AVMObject ? encodeVariables(self) : '' });
      return true;
    },
    sendAndLoad: (_, self, [url, target, method]) => startLoad(target, url, method === undefined ? 'POST' : toStr(vm, method), self),
    getBytesLoaded: (_, self) => self?.bytesLoaded,
    getBytesTotal: (_, self) => self?.bytesTotal,
    toString: (_, self) => (self instanceof AVMObject ? encodeVariables(self) : ''),
    decode: (_, self, [text]) => { if (self instanceof AVMObject) vm.decodeVariables(self, toStr(vm, text)); },
    // 既定の onData: 中身があれば解釈して onLoad(true)、無ければ onLoad(false)。
    onData: (_, self, [text]) => {
      if (!(self instanceof AVMObject)) return;
      if (text === undefined) return callMethod(self, 'onLoad', [false]);
      callMethod(self, 'decode', [text]);
      self.define('loaded', true, HIDDEN);
      return callMethod(self, 'onLoad', [true]);
    },
    onLoad: () => undefined,
  });
  defineClass(vm, 'LoadVars', loadVarsProto, () => undefined);

  // --- ムービーと画像の読み込み（loadMovie、loadMovieNum、MovieClipLoader） ---
  // 中身を入れ替えたクリップ（読み込み、unloadMovie）は、スクリプトが付けた変数とメソッドを失う（実機で確認）。
  const clearVariables = (object) => {
    object.props.clear();
    object.proto = vm.movieClipProto;
  };
  /** unloadMovie: 中身を取り除いて、変数も消す。途中の読み込みは取り消す。 */
  vm.unloadClip = (object) => {
    object.clip.loadToken = null;
    clearVariables(object);
    object.clip.unload();
  };
  // 対象ごとの、いちばん新しい読み込みの印。読み込みの途中で、同じ対象に別の読み込みや unloadMovie があれば、前の読み込みは捨てる。
  const levelTokens = new Map();
  const tokenOf = (into) => (into.clip ? into.clip.clip.loadToken : levelTokens.get(into.level));
  const setToken = (into, token) => {
    if (into.clip) into.clip.clip.loadToken = token;
    else levelTokens.set(into.level, token);
  };
  /**
   * into（{ clip: MovieClipObject } か { level: 番号 }）に、url の画像か SWF を読み込む。読み込みはホストに任せる。
   * method が "GET" / "POST" なら、sender（クリップ）の変数を一緒に送る。url が空なら、中身を取り除く（unloadMovie と同じ）。
   * notify(名前, 引数) は、MovieClipLoader のリスナーへの通知（onLoadStart / onLoadProgress / onLoadComplete / onLoadInit / onLoadError）。
   */
  vm.loadMovie = (into, url, method, sender, notify = () => {}) => {
    const movie = (into.clip ?? sender)?.clip?.movie ?? vm.currentTarget?.clip?.movie;
    if (!movie) return false;
    const target = into.clip ? into.clip.targetPath() : `_level${into.level}`;
    const how = method === 'GET' || method === 'POST' ? method : '';
    vm.request({ kind: 'loadMovie', url, target, method: how });
    if (url === '') {
      setToken(into, null);
      if (into.clip) vm.unloadClip(into.clip);
      else movie.setLevel(into.level, null);
      return true;
    }
    const token = {};
    setToken(into, token);
    const sent = how && sender ? vm.clipVariables(sender) : '';
    const address = how === 'GET' && sent ? `${url}${url.includes('?') ? '&' : '?'}${sent}` : url;
    if (into.clip) into.clip.clip.loadInfo = { loaded: 0, total: 0 };
    const later = (fn) => vm.later(fn);
    // 読めなかったとき: 対象のクリップは空になり、onLoadError(対象, "URLNotFound") が届く（実機で、無いファイルを指定したときと同じ）。
    const fail = () => {
      if (!into.clip) return;
      into.clip.clip.unload();
      notify('onLoadError', [into.clip, 'URLNotFound']);
    };
    const data = how === 'POST' ? new TextEncoder().encode(sent) : null;
    vm.load({ url: address, method: how || 'GET', data, contentType: data ? 'application/x-www-form-urlencoded' : null }, (bytes) => {
      // 後から別の読み込みや unloadMovie があった読み込みは、中身を差し替えない（失敗の通知だけは届く。実機で確認）。
      if (tokenOf(into) !== token) {
        if (!bytes && into.clip) notify('onLoadError', [into.clip, 'URLNotFound']);
        return;
      }
      if (!bytes) return fail();
      movie.loadContent(bytes, later, (content) => {
        if (tokenOf(into) !== token || into.clip?.clip.removed) return;
        setToken(into, null);
        if (content?.library?.isAS3) movie.warn(`${url}: an ActionScript 3 movie cannot be loaded into an ActionScript 1/2 movie`);
        if (!content || content.library?.isAS3) return fail();
        const version = content.library?.version;
        if (version && (version >= 6) !== (vm.version >= 6) || version && (version >= 7) !== (vm.version >= 7)) {
          movie.warn(`${url}: the loaded movie is SWF ${version}; its scripts run with the rules of SWF ${vm.version}`);
        }
        const object = into.clip ?? null;
        if (object) {
          notify('onLoadStart', [object]);
          notify('onLoadProgress', [object, content.size, content.size]);
          notify('onLoadProgress', [object, content.size, content.size]);
          if (object.clip.removed) return;
        }
        const clip = object ? object.clip : movie.setLevel(into.level, content);
        // onLoadComplete の時点で、SWF のフレーム数は見えるが、1 フレーム目はまだ実行されていない（実機で確認）。
        if (object && !content.bitmap) {
          clearVariables(object);
          clip.replaceContent(content);
        }
        if (object) notify('onLoadComplete', [object, 0]);
        if (object && content.bitmap && !clip.removed) {
          // スクリプトが付けた変数とメソッドは消える（位置や変形は残る）。実機で確認。
          clearVariables(object);
          clip.replaceContent(content);
        }
        clip.loadInfo = { loaded: content.size, total: content.size };
        if (object) clip.loadInit = () => notify('onLoadInit', [object]);
      });
    });
    return true;
  };

  // --- MovieClipLoader ---
  const loaderProto = new AVMObject(vm, vm.objectProto);
  const clipOf = (target) => {
    const object = target instanceof AVMObject ? target : typeof target === 'string' && vm.currentTarget
      ? vm.resolvePath({ target: vm.currentTarget, scopes: [{ object: vm.currentTarget }], thisValue: vm.currentTarget }, target) : undefined;
    return object?.isMovieClip && !object.clip.removed ? object : undefined;
  };
  defineMethods(vm, loaderProto, {
    addListener: (_, self, [listener]) => {
      if (!(self instanceof AVMObject) || !(listener instanceof AVMObject)) return false;
      self.loadListeners ??= [];
      if (!self.loadListeners.includes(listener)) self.loadListeners.push(listener);
      return true;
    },
    removeListener: (_, self, [listener]) => {
      const at = self?.loadListeners?.indexOf(listener) ?? -1;
      if (at >= 0) self.loadListeners.splice(at, 1);
      return at >= 0;
    },
    // loadClip(URL, 対象): 対象（クリップか、レベルの番号）に画像か SWF を読み込み、経過をリスナーに伝える。
    // 読めなければ、対象のクリップは空になり、リスナーに onLoadError(対象, "URLNotFound") が届く。
    loadClip: (_, self, [url, target]) => {
      if (!(self instanceof AVMObject)) return false;
      const notify = (name, args) => { for (const listener of (self.loadListeners ?? []).slice()) callMethod(listener, name, args); };
      if (typeof target === 'number') return Number.isInteger(target) && target >= 0 ? vm.loadMovie({ level: target }, toStr(vm, url), '', null, notify) : false;
      const object = clipOf(target);
      if (!object) return false;
      return vm.loadMovie({ clip: object }, toStr(vm, url), '', null, notify);
    },
    unloadClip: (_, self, [target]) => {
      if (typeof target === 'number') {
        const movie = vm.currentTarget?.clip?.movie;
        if (Number.isInteger(target) && target >= 0 && movie) movie.setLevel(target, null);
        return !!movie;
      }
      const object = clipOf(target);
      if (object) vm.unloadClip(object);
      return !!object;
    },
    getProgress: (_, self, [target]) => {
      const object = clipOf(target);
      if (!object) return undefined;
      const out = new AVMObject(vm, vm.objectProto);
      out.define('bytesLoaded', object.get('getBytesLoaded') instanceof AVMFunction ? vm.call(object.get('getBytesLoaded'), object, []) : 0);
      out.define('bytesTotal', object.get('getBytesTotal') instanceof AVMFunction ? vm.call(object.get('getBytesTotal'), object, []) : 0);
      return out;
    },
  });
  defineClass(vm, 'MovieClipLoader', loaderProto, () => undefined);

  // --- SharedObject ---
  // 保存先を持たない。同じ名前なら再生中は同じオブジェクトを返すが、再生をやり直すと消える。
  const sharedProto = new AVMObject(vm, vm.objectProto);
  const shared = new Map(); // 名前 → SharedObject
  defineMethods(vm, sharedProto, {
    flush: () => true,
    clear: (_, self) => { if (self instanceof AVMObject) self.set('data', new AVMObject(vm, vm.objectProto)); },
    // 中身が空なら 0。そうでなければ、保存したときのおおよそのバイト数。
    getSize: (_, self) => {
      const data = self instanceof AVMObject ? self.get('data') : undefined;
      const keys = data instanceof AVMObject ? data.ownKeys() : [];
      return keys.reduce((n, key) => n + key.length + toStr(vm, data.get(key)).length + 8, keys.length ? 16 : 0);
    },
  });
  const sharedCtor = defineClass(vm, 'SharedObject', sharedProto, () => undefined);
  defineMethods(vm, sharedCtor, {
    // 名前に使えない文字（空白や記号）があれば null。
    getLocal: (_, __, [name]) => {
      const key = toStr(vm, name);
      if (/[ ~%&\;:"',<>?#]/.test(key)) return null;
      if (!shared.has(key) && shared.size < 1000) {
        const obj = new AVMObject(vm, sharedProto);
        obj.define('data', new AVMObject(vm, vm.objectProto));
        shared.set(key, obj);
      }
      return shared.get(key) ?? null;
    },
  });
}
