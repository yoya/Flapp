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
  // 読み込みを始める（実際には読まず、次のフレームで失敗を伝える）。
  const startLoad = (self, url, method) => {
    if (!(self instanceof AVMObject) || url === undefined) return false;
    self.define('loaded', false, HIDDEN);
    self.bytesLoaded = 0;
    vm.request({ kind: 'loadVariables', url: toStr(vm, url), target: '', method });
    vm.later(() => callMethod(self, 'onData', [undefined]));
    return true;
  };
  defineMethods(vm, loadVarsProto, {
    load: (_, self, [url]) => startLoad(self, url, ''),
    // 送信もしない。応答を受け取る側（target）には、読み込みの失敗を伝える。
    send: (_, self, [url, , method]) => {
      if (url === undefined) return false;
      vm.request({ kind: 'getURL', url: toStr(vm, url), target: '', method: method === undefined ? 'POST' : toStr(vm, method) });
      return true;
    },
    sendAndLoad: (_, self, [url, target, method]) => startLoad(target, url, method === undefined ? 'POST' : toStr(vm, method)),
    getBytesLoaded: (_, self) => self?.bytesLoaded,
    getBytesTotal: () => undefined,
    // "a=1&b=2" の形にする。新しいプロパティが先（for..in と同じ順）。
    toString: (_, self) => (self instanceof AVMObject ? self.ownKeys().map((key) => `${escape(key)}=${escape(self.get(key))}`).join('&') : ''),
    decode: (_, self, [text]) => {
      if (!(self instanceof AVMObject)) return;
      for (const pair of toStr(vm, text).split('&')) {
        if (pair === '') continue;
        const at = pair.indexOf('=');
        self.set(unescape(at < 0 ? pair : pair.slice(0, at)), at < 0 ? '' : unescape(pair.slice(at + 1)));
      }
    },
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
    // 読み込みは行わない。対象のクリップは空になり、リスナーに onLoadError(対象, "URLNotFound") が届く。
    loadClip: (_, self, [url, target]) => {
      const object = clipOf(target);
      if (!object || !(self instanceof AVMObject)) return false;
      vm.request({ kind: 'loadMovie', url: toStr(vm, url), target: object.targetPath(), method: '' });
      vm.later(() => {
        object.clip.unload();
        for (const listener of (self.loadListeners ?? []).slice()) callMethod(listener, 'onLoadError', [object, 'URLNotFound']);
      });
      return true;
    },
    unloadClip: (_, self, [target]) => {
      const object = clipOf(target);
      object?.clip.unload();
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
