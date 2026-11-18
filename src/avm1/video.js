// ビデオの再生にかかわるクラス（ActionScript 1 / 2）: NetConnection、NetStream と、ステージに置かれた Video オブジェクト。
//
// NetStream.play(url) は、FLV ファイルを再生する。プレイヤーは自分ではファイルを取りに行かず、ホストが Movie.load の
// media オプションで渡した関数に URL を渡して、返ってきたバイト列だけを再生する（オプションが無ければ、見つからない扱い）。
// サーバとの接続（RTMP）には対応していない。再生そのものは player/video.js の FlvPlayback が受け持つ。
// 値や通知の順序は、実機の trace（test/as/netstream.as）に合わせてある。
import { parseFLV } from '../video/flv.js';
import { FlvPlayback } from '../player/video.js';
import { MAGIC } from './clip.js';
import { toBool, toInt32, toNumber, toStr } from './convert.js';
import { defineClass, defineMethods } from './globals.js';
import { AVMArray, AVMFunction, AVMObject, DONT_DELETE, DONT_ENUM, NONE } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const MAX_DEPTH = 16; // メタデータの入れ子

// Video オブジェクト固有のプロパティ。get / set は表示オブジェクト v（player/movie.js の VideoObject）に対する操作。
const PROPS = {
  // 映っている絵の大きさ（何も映っていなければ 0）。読み取り専用。オブジェクトの大きさは _width / _height。
  width: { get: (v) => v.image()?.width ?? 0 },
  height: { get: (v) => v.image()?.height ?? 0 },
  smoothing: { get: (v) => v.smoothing, set: (v, value, vm) => { v.smoothing = toBool(vm, value); } },
  deblocking: { get: (v) => v.deblocking ?? 0, set: (v, value, vm) => { v.deblocking = toInt32(vm, value); } },
};
// クリップと共通のプロパティ（位置や変形）は、クリップと同じ実装を使う。
for (const name of ['_x', '_y', '_xscale', '_yscale', '_rotation', '_alpha', '_visible', '_width', '_height', '_name', '_parent', '_target', '_url']) PROPS[name] = MAGIC[name];
const LOWER = Object.fromEntries(Object.entries(PROPS).map(([name, prop]) => [name.toLowerCase(), prop]));

/** スクリプトから見た、ステージ上の Video オブジェクト。 */
export class VideoScriptObject extends AVMObject {
  /** @param {import('../player/movie.js').VideoObject} video */
  constructor(vm, video) {
    super(vm, vm.videoProto);
    this.video = video;
    this.isVideo = true;
  }

  #prop(name) {
    return this.vm.caseInsensitive ? LOWER[name.toLowerCase()] : Object.hasOwn(PROPS, name) ? PROPS[name] : undefined;
  }

  // 表示リストから外されたものは、もう何も持っていないように見える。
  ownGet(name, receiver) {
    if (this.video.removed) return NONE;
    const v = super.ownGet(name, receiver);
    if (v !== NONE) return v;
    const prop = this.#prop(name);
    return prop ? prop.get(this.video, this.vm) : NONE;
  }

  ownSet(name, value, receiver) {
    if (super.ownSet(name, value, receiver)) return true;
    const prop = this.#prop(name);
    if (!prop) return false;
    if (!prop.set) return true; // 読み取り専用
    if (name[0] === '_' && !prop.raw) {
      // クリップと共通の数値のプロパティ。数値にならない代入は無視する。
      const n = value === undefined || value === null ? NaN : toNumber(this.vm, value);
      if (!Number.isNaN(n)) prop.set(this.video, n, this.vm);
    } else if (prop.raw) {
      prop.set(this.video, undefined, this.vm, value);
    } else {
      prop.set(this.video, value, this.vm);
    }
    return true;
  }

  ownHas(name) {
    return !this.video.removed && (super.ownHas(name) || this.#prop(name) !== undefined);
  }

  /** "_level0.vid" 形式のパス。 */
  targetPath() {
    return this.video.removed ? '' : this.video.dotPath();
  }
}

export function installVideo(vm) {
  // onStatus に渡す情報オブジェクト。
  const info = (code, level) => {
    const obj = new AVMObject(vm, vm.objectProto);
    obj.define('code', code);
    obj.define('level', level);
    return obj;
  };
  // ホストの側（フレームの処理）から、obj の name というハンドラを呼ぶ。
  const callMethod = (obj, name, args) => {
    const fn = obj.get(name);
    if (fn instanceof AVMFunction) vm.invoke(fn, obj, args);
  };
  // スクリプトデータ（素の JS の値）を、スクリプトから見える値にする。
  const toAVM = (value, depth = 0) => {
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (depth > MAX_DEPTH) return undefined;
    if (Array.isArray(value)) return new AVMArray(vm, value.map((v) => toAVM(v, depth + 1)));
    const obj = new AVMObject(vm, vm.objectProto);
    for (const key of Object.keys(value)) obj.set(key, toAVM(value[key], depth + 1));
    return obj;
  };

  // --- NetConnection ---
  const connectionProto = new AVMObject(vm, vm.objectProto);
  defineMethods(vm, connectionProto, {
    // connect(null) は、ファイルを再生するための（サーバの無い）接続。onStatus は、connect の中でその場で呼ばれる。
    // それ以外の接続先は、記録して失敗を伝える。
    connect: (_, self, [command]) => {
      if (!(self instanceof AVMObject)) return undefined;
      if (command === null || command === undefined) {
        self.netConnection = { connected: true, uri: null };
        const fn = self.get('onStatus');
        if (fn instanceof AVMFunction) vm.call(fn, self, [info('NetConnection.Connect.Success', 'status')]);
        return true;
      }
      self.netConnection = { connected: false, uri: toStr(vm, command) };
      vm.request({ kind: 'connect', url: self.netConnection.uri, target: '', method: '' });
      vm.later(() => callMethod(self, 'onStatus', [info('NetConnection.Connect.Failed', 'error')]));
      return true;
    },
    close: (_, self) => { if (self?.netConnection) self.netConnection.connected = false; },
    call: () => undefined,
    addHeader: () => undefined,
  });
  connectionProto.defineAccessor('isConnected', vm.native((_, self) => self?.netConnection?.connected ?? false), null, HIDDEN);
  connectionProto.defineAccessor('uri', vm.native((_, self) => self?.netConnection?.uri), null, HIDDEN);
  defineClass(vm, 'NetConnection', connectionProto, () => undefined);

  // --- NetStream ---
  const streamProto = new AVMObject(vm, vm.objectProto);
  const streams = new Set(); // 再生中の NetStream
  const S = (self) => (self instanceof AVMObject ? self.netStream : undefined);
  // 再生をやめる。止めた時の時刻と絵は残る（close の後も time は進んだままで、Video には最後の絵が映っている）。
  const stop = (self) => {
    const s = S(self);
    if (s.playback) {
      s.lastTime = s.playback.time / 1000;
      s.lastImage = s.playback.image();
    }
    s.playback?.close();
    s.playback = null;
    s.url = null;
    streams.delete(self);
  };
  // 読み込めたファイルの再生を始める。読めなければ、見つからなかったことを伝える。
  const begin = (self, url, bytes) => {
    const s = S(self);
    if (s.url !== url) return; // 待っている間に、別のファイルの再生や close があった
    let flv = null;
    try {
      if (bytes) flv = parseFLV(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    } catch (e) {
      if (e.name !== 'VideoError') throw e;
      s.movie.warn(`video: ${url}: ${e.message}`);
    }
    if (!flv) {
      s.total = -1;
      callMethod(self, 'onStatus', [info('NetStream.Play.StreamNotFound', 'error')]);
      return;
    }
    s.bytes = s.total = bytes.byteLength;
    s.playback = new FlvPlayback(s.movie, flv);
    s.playback.play(0);
    streams.add(self);
    callMethod(self, 'onStatus', [info('NetStream.Play.Start', 'status')]);
    if (flv.metadata) callMethod(self, 'onMetaData', [toAVM(flv.metadata)]);
    callMethod(self, 'onStatus', [info('NetStream.Buffer.Full', 'status')]);
  };
  /** フレームごとに呼ばれる。終わりまで再生した NetStream に、終わったことを伝える。 */
  vm.runStreams = () => {
    for (const self of [...streams]) {
      if (!S(self).playback?.finished()) continue;
      streams.delete(self);
      for (const code of ['Buffer.Flush', 'Play.Stop', 'Buffer.Empty']) callMethod(self, 'onStatus', [info(`NetStream.${code}`, 'status')]);
    }
  };
  const number = (v) => { const n = toNumber(vm, v); return Number.isNaN(n) ? 0 : n; };
  defineMethods(vm, streamProto, {
    // play(url): ホストが渡した media 関数からファイルをもらって再生する。play(false) は停止。
    play: (_, self, [url]) => {
      const s = S(self);
      if (!s) return;
      stop(self);
      if (url === null || url === undefined || url === false) return;
      s.url = toStr(vm, url);
      vm.request({ kind: 'play', url: s.url, target: '', method: '' });
      const found = s.movie.media ? s.movie.media(s.url) : null;
      // その場で値が返れば次のフレームで、Promise なら解決した後のフレームで、再生を始める（スクリプトは、フレームの処理の中でだけ動かす）。
      if (found && typeof found.then === 'function') found.then((bytes) => vm.later(() => begin(self, s.url, bytes)), () => vm.later(() => begin(self, s.url, null)));
      else vm.later(() => begin(self, s.url, found));
    },
    // pause(): 一時停止と再開を切り替える。pause(true) は一時停止、pause(false) は再開。
    pause: (_, self, [flag]) => {
      const p = S(self)?.playback;
      if (!p) return;
      if (flag === undefined ? p.playing : toBool(vm, flag)) p.pause();
      else if (!p.ended) {
        p.resume();
        streams.add(self);
      }
    },
    // seek(秒): 指定より前でいちばん近いキーフレームへ移る。time が変わるのは、Seek.Notify が届いた後
    // （実機の NetStream.Seek.Complete と、範囲外のときの NetStream.Seek.InvalidTime は出さない）。
    seek: (_, self, [offset]) => {
      const p = S(self)?.playback;
      if (!p) return;
      const to = number(offset) * 1000;
      vm.later(() => {
        callMethod(self, 'onStatus', [info('NetStream.Seek.Notify', 'status')]);
        if (S(self).playback === p) p.seek(to);
      });
    },
    close: (_, self) => { if (S(self)) stop(self); },
    setBufferTime: (_, self, [seconds]) => { if (S(self)) S(self).bufferTime = number(seconds); },
    receiveAudio: () => undefined,
    receiveVideo: () => undefined,
    publish: () => undefined,
    send: () => undefined,
    attachAudio: () => undefined,
    attachVideo: () => undefined,
  });
  // 接続していない NetConnection から作った NetStream では、どれも undefined。
  const accessor = (name, get) => streamProto.defineAccessor(name, vm.native((_, self) => (S(self) ? get(S(self)) : undefined)), null, HIDDEN);
  accessor('time', (s) => (s.playback ? s.playback.time / 1000 : s.lastTime));
  accessor('bytesLoaded', (s) => s.bytes);
  accessor('bytesTotal', (s) => s.total); // 見つからなかったファイルでは -1
  accessor('bufferLength', (s) => (s.playback ? Math.max(0, (s.playback.duration - s.playback.time) / 1000) : 0));
  accessor('bufferTime', (s) => s.bufferTime);
  accessor('currentFps', () => 0);
  accessor('liveDelay', () => 0);
  defineClass(vm, 'NetStream', streamProto, () => undefined, (_, [connection], to) => {
    const obj = new AVMObject(vm, to);
    const movie = vm.currentTarget?.clip?.movie;
    if (movie && connection instanceof AVMObject && connection.netConnection?.connected) obj.netStream = { movie, url: null, playback: null, bytes: 0, total: 0, bufferTime: 0, lastTime: 0, lastImage: null };
    return obj;
  });

  // --- Video ---
  // Video オブジェクトはスクリプトからは作れず（new Video() は、ただのオブジェクトになる）、ステージに置いたものを名前で使う。
  vm.videoProto = new AVMObject(vm, vm.objectProto);
  const videoOf = (self) => (self?.isVideo && !self.video.removed ? self.video : null);
  defineMethods(vm, vm.videoProto, {
    // attachVideo(NetStream): その NetStream の絵を映す。ほかの値なら、映すのをやめる。
    attachVideo: (_, self, [source]) => {
      const video = videoOf(self);
      if (!video) return;
      const stream = S(source);
      video.source = stream ? { image: () => stream.playback?.image() ?? stream.lastImage } : null;
    },
    clear: (_, self) => { videoOf(self)?.clear(); },
  });
  defineClass(vm, 'Video', vm.videoProto, () => undefined);
}
