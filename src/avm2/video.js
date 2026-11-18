// ビデオの再生にかかわるクラス: NetConnection、NetStream、Video と、NetStatusEvent / AsyncErrorEvent。
//
// NetStream.play(url) は、FLV ファイルを再生する。プレイヤーは自分ではファイルを取りに行かず、ホストが Movie.load の
// media オプションで渡した関数に URL を渡して、返ってきたバイト列だけを再生する（オプションが無ければ、見つからない扱い）。
// サーバとの接続（RTMP）には対応していない。
import { parseFLV } from '../video/flv.js';
import { FlvPlayback } from '../player/video.js';
import { ASArray, ASFunction, ASObject, publicKey } from './object.js';

const MAX_DEPTH = 16; // メタデータの入れ子

/**
 * @param {import('./vm.js').AVM2} vm
 * @param {import('../player/movie.js').Movie} movie
 * @param {(self: ASObject, v: any) => object} soundGain  SoundTransform を、ミキサーにかける倍率にする
 */
export function installVideo(vm, movie, soundGain) {
  const c = vm.classes;
  const str = (v) => vm.toStr(v);
  const num = (v) => vm.toNumber(v);
  const { display } = vm;
  const name = (text) => vm.keyName(text);

  // スクリプトデータ（素の JS の値）を、スクリプトから見える値にする。
  const toAS = (value, depth = 0) => {
    if (value === null || value === undefined || typeof value !== 'object') return value ?? null;
    if (depth > MAX_DEPTH) return null;
    if (Array.isArray(value)) return new ASArray(vm, value.map((v) => toAS(v, depth + 1)));
    const obj = new ASObject(c.Object);
    for (const key of Object.keys(value)) {
      vm.charge(1);
      obj.values.set(publicKey(key), toAS(value[key], depth + 1));
    }
    return obj;
  };
  const status = (target, code, level = 'status') => {
    const info = new ASObject(c.Object);
    info.values.set(publicKey('code'), code);
    info.values.set(publicKey('level'), level);
    if (!target.listeners?.get('netStatus')?.length && level === 'error') movie.warn(`unhandled netStatus: ${code}`);
    display.dispatch(target, vm.construct(c.NetStatusEvent, ['netStatus', false, false, info]));
  };

  // --- NetConnection ---
  c.NetConnection = vm.defineClass({
    name: 'flash.net::NetConnection', base: c.EventDispatcher,
    getters: { connected: (self) => self.connected ?? false, uri: (self) => self.uri ?? null, client: (self) => self.client ?? self, objectEncoding: () => 3, proxyType: () => 'none' },
    setters: { client: (self, v) => { self.client = v; }, objectEncoding: () => {}, proxyType: () => {} },
    methods: {
      // connect(null) は、ファイルを再生するための（サーバの無い）接続。それ以外の接続先は、記録して失敗を伝える。
      connect: (self, [command]) => {
        if (command === null || command === undefined) {
          self.connected = true;
          self.uri = null;
          status(self, 'NetConnection.Connect.Success'); // connect の中で、その場で届く（実機で確認）
          return;
        }
        movie.request({ kind: 'connect', url: str(command), target: '', method: '' });
        display.later(() => status(self, 'NetConnection.Connect.Failed', 'error'));
      },
      close: (self) => { self.connected = false; },
      addHeader: () => {}, call: () => {},
    },
    staticValues: { defaultObjectEncoding: 3 },
  });

  // --- NetStream ---
  const streams = new Set(); // 再生中の NetStream
  const S = (self) => self.stream;
  // client の name という関数を、args で呼ぶ。無ければ、asyncError を伝える。
  const callback = (self, method, args) => {
    const client = S(self).client ?? self;
    const fn = client instanceof ASObject && vm.hasProperty(client, name(method)) ? vm.getProperty(client, name(method)) : undefined;
    if (fn instanceof ASFunction) { vm.call(fn, client, args); return; }
    const text = `Error #2095: flash.net.NetStream was unable to invoke callback ${method}.`;
    if (!self.listeners?.get('asyncError')?.length) movie.warn(`unhandled asyncError: ${method}`);
    display.dispatch(self, vm.construct(c.AsyncErrorEvent, ['asyncError', false, false, text, vm.construct(c.Error, [text, 2095])]));
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
      movie.warn(`video: ${url}: ${e.message}`);
    }
    if (!flv) {
      status(self, 'NetStream.Play.StreamNotFound', 'error');
      return;
    }
    s.bytes = bytes.byteLength;
    s.playback = new FlvPlayback(movie, flv);
    s.playback.setGain(s.gain);
    s.playback.play(0);
    streams.add(self);
    status(self, 'NetStream.Play.Start');
    if (flv.metadata) callback(self, 'onMetaData', [toAS(flv.metadata)]);
    status(self, 'NetStream.Buffer.Full');
  };
  /** フレームごとに呼ばれる。終わりまで再生した NetStream に、終わったことを伝える。 */
  display.runStreams = () => {
    for (const self of [...streams]) {
      if (!S(self).playback?.finished()) continue;
      streams.delete(self);
      vm.run(() => {
        // 実機では、この後に Buffer.Full や Buffer.Empty がもう一度届くことがある（届くかどうかは、そのときどきで変わる）。
        for (const code of ['Buffer.Flush', 'Play.Stop', 'Buffer.Empty']) status(self, `NetStream.${code}`);
      }, (text) => movie.warn(`uncaught error: ${text}`));
    }
  };
  c.NetStream = vm.defineClass({
    name: 'flash.net::NetStream', base: c.EventDispatcher,
    allocate: (klass) => Object.assign(new ASObject(klass), { stream: { url: null, playback: null, client: null, bytes: 0, gain: null, transform: null, bufferTime: 0 } }),
    construct: (self, [connection]) => {
      if (!(connection instanceof ASObject) || connection.klass !== c.NetConnection) vm.throwError('TypeError', 2007, 'Parameter connection must be non-null.');
      if (!connection.connected) vm.throwError('ArgumentError', 2126, 'NetConnection object must be connected.');
    },
    getters: {
      time: (self) => (S(self).playback ? S(self).playback.time / 1000 : 0),
      bytesLoaded: (self) => S(self).bytes, bytesTotal: (self) => S(self).bytes,
      bufferLength: (self) => (S(self).playback ? Math.max(0, (S(self).playback.duration - S(self).playback.time) / 1000) : 0),
      bufferTime: (self) => S(self).bufferTime, currentFPS: () => 0, liveDelay: () => 0, objectEncoding: () => 3,
      client: (self) => S(self).client ?? self,
      soundTransform: (self) => S(self).transform ?? vm.construct(c.SoundTransform, []),
      checkPolicyFile: () => false,
    },
    setters: {
      bufferTime: (self, v) => { S(self).bufferTime = num(v); },
      client: (self, v) => { if (v === null || v === undefined) vm.throwError('TypeError', 2004, 'One of the parameters is invalid.'); S(self).client = v; },
      soundTransform: (self, v) => { S(self).gain = soundGain(v); S(self).transform = v; S(self).playback?.setGain(S(self).gain); },
      checkPolicyFile: () => {},
    },
    methods: {
      // play(url): ホストが渡した media 関数からファイルをもらって再生する。play(null) や play(false) は停止。
      play: (self, [url]) => {
        const s = S(self);
        s.playback?.close();
        s.playback = null;
        streams.delete(self);
        if (url === null || url === undefined || url === false) { s.url = null; return; }
        s.url = str(url);
        movie.request({ kind: 'play', url: s.url, target: '', method: '' });
        const found = movie.media ? movie.media(s.url) : null;
        // その場で値が返れば次のフレームで、Promise なら解決した後のフレームで、再生を始める（スクリプトは、フレームの処理の中でだけ動かす）。
        if (found && typeof found.then === 'function') found.then((bytes) => display.later(() => begin(self, s.url, bytes)), () => display.later(() => begin(self, s.url, null)));
        else display.later(() => begin(self, s.url, found));
      },
      pause: (self) => { S(self).playback?.pause(); },
      resume: (self) => { const p = S(self).playback; if (p && !p.playing && !p.ended) { p.resume(); streams.add(self); } },
      togglePause: (self) => { const p = S(self).playback; if (p?.playing) p.pause(); else if (p && !p.ended) { p.resume(); streams.add(self); } },
      seek: (self, [offset]) => {
        const p = S(self).playback;
        if (!p) return;
        p.seek(num(offset) * 1000);
        display.later(() => status(self, 'NetStream.Seek.Notify'));
      },
      close: (self) => { const s = S(self); s.playback?.close(); s.playback = null; s.url = null; streams.delete(self); },
      dispose: (self) => { const s = S(self); s.playback?.close(); s.playback = null; s.url = null; streams.delete(self); },
      receiveAudio: () => {}, receiveVideo: () => {}, receiveVideoFPS: () => {}, publish: () => {}, send: () => {}, attachAudio: () => {}, attachCamera: () => {},
    },
  });

  // --- Video ---
  const D = (self) => self.display;
  c.Video = vm.defineClass({
    name: 'flash.media::Video', base: c.DisplayObject,
    // new Video(幅, 高さ): 既定は 320×240。
    allocate: (klass, [width = 320, height = 240]) => {
      vm.charge(16);
      const obj = new ASObject(klass);
      movie.newVideo(obj, Math.max(0, vm.toInt32(width)), Math.max(0, vm.toInt32(height)));
      return obj;
    },
    getters: {
      videoWidth: (self) => D(self).image()?.width ?? 0, videoHeight: (self) => D(self).image()?.height ?? 0,
      smoothing: (self) => D(self).smoothing, deblocking: (self) => D(self).deblocking ?? 0,
    },
    setters: { smoothing: (self, v) => { D(self).smoothing = vm.toBoolean(v); }, deblocking: (self, v) => { D(self).deblocking = vm.toInt32(v); } },
    methods: {
      attachNetStream: (self, [stream]) => {
        if (stream === null || stream === undefined) { D(self).source = null; return; }
        if (!(stream instanceof ASObject) || !stream.stream) vm.throwError('TypeError', 1034, `Type Coercion failed: cannot convert ${vm.className(stream)} to flash.net.NetStream.`);
        D(self).source = { image: () => stream.stream.playback?.image() ?? null };
      },
      attachCamera: () => {},
      clear: (self) => { D(self).clear(); },
    },
  });
}
