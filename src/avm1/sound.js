// Sound オブジェクト。鳴らす処理は player/sound.js の SoundMixer が受け持つ。
import { toBool, toNumber, toStr } from './convert.js';
import { defineClass, defineMethods } from './globals.js';
import { loadedMP3 } from '../player/sound.js';
import { AVMFunction, AVMObject, DONT_DELETE, DONT_ENUM } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const CHANNELS = ['ll', 'lr', 'rl', 'rr'];

export function installSound(vm) {
  const proto = new AVMObject(vm, vm.objectProto);
  const state = (self) => (self instanceof AVMObject ? self.soundState : undefined);
  // 音量とパンの設定は、対象のクリップ（無ければ全体）ごとに 1 つ。同じ対象の Sound オブジェクトどうしで共有される。
  const settings = new Map(); // クリップ（null は全体）→ { volume, ll, lr, rl, rr }（％）
  const settingsOf = (st) => {
    const key = st.target?.clip ?? null;
    if (!settings.has(key)) settings.set(key, { volume: 100, ll: 100, lr: 0, rl: 0, rr: 100 });
    return settings.get(key);
  };
  // 設定を、実際にかける倍率（音量 × 変換）にして反映する。
  const apply = (st) => {
    const s = settingsOf(st);
    const k = s.volume / 100 / 100;
    st.movie.sounds.setVolume(st.target?.clip ?? null, { ll: s.ll * k, lr: s.lr * k, rl: s.rl * k, rr: s.rr * k });
  };
  const number = (v) => { const n = toNumber(vm, v); return Number.isNaN(n) ? 0 : n; };
  // この Sound オブジェクトが止められる音: 対象のクリップ（とその中）で鳴っている音。対象が無ければ全部。
  const mine = (st) => (p) => {
    if (!st.target) return true;
    for (let clip = p.owner; clip; clip = clip.parent) if (clip === st.target.clip) return true;
    return false;
  };

  defineMethods(vm, proto, {
    getVolume: (_, self) => (state(self) ? settingsOf(state(self)).volume : undefined),
    setVolume: (_, self, [v]) => { if (state(self)) { settingsOf(state(self)).volume = number(v); apply(state(self)); } },
    // パン: 正なら左を絞り、負なら右を絞る。読むときは左右の倍率から求める（実機で確認した式）。
    getPan: (_, self) => {
      if (!state(self)) return undefined;
      const s = settingsOf(state(self));
      return s.ll !== 100 ? 100 - Math.abs(s.ll) : Math.abs(s.rr) - 100;
    },
    setPan: (_, self, [v]) => {
      if (!state(self)) return;
      const pan = number(v);
      Object.assign(settingsOf(state(self)), { ll: pan > 0 ? 100 - pan : 100, rr: pan < 0 ? 100 + pan : 100, lr: 0, rl: 0 });
      apply(state(self));
    },
    getTransform: (_, self) => {
      if (!state(self)) return undefined;
      const out = new AVMObject(vm, vm.objectProto);
      for (const key of CHANNELS) out.define(key, settingsOf(state(self))[key]);
      return out;
    },
    // 指定された項目だけを変える。
    setTransform: (_, self, [t]) => {
      if (!state(self) || !(t instanceof AVMObject)) return;
      for (const key of CHANNELS) if (t.get(key) !== undefined) settingsOf(state(self))[key] = number(t.get(key));
      apply(state(self));
    },
    // attachSound: 書き出し名の付いたサウンドを割り当てる。
    attachSound: (_, self, [name]) => {
      const st = state(self);
      if (!st) return;
      const sound = st.movie.dictionary.get(st.movie.exports.get(toStr(vm, name)));
      st.sound = sound?.type === 'sound' ? sound : null;
      st.entry = null;
      st.finished = false;
    },
    // start(開始位置（秒）, 繰り返し回数)。鳴り終わると onSoundComplete が呼ばれる。
    start: (_, self, [offset, loops]) => {
      const st = state(self);
      if (st?.sound) play(self, st, Math.max(0, number(offset)), Math.max(1, Math.trunc(number(loops)) || 1));
    },
    // stop(): 対象で鳴っている音を全部止める。stop(名前): その書き出し名の音だけ止める。
    stop: (_, self, [name]) => {
      const st = state(self);
      if (!st) return;
      const only = name === undefined ? undefined : st.movie.dictionary.get(st.movie.exports.get(toStr(vm, name)));
      const match = mine(st);
      st.movie.sounds.stop((p) => match(p) && (name === undefined || p.sound === only));
    },
    // loadSound(URL, ストリーミングか): MP3 を読み込む。読み込みはホストに任せる（Movie.load の network）。
    // 読めたら onLoad(true)、読めなければ onLoad(false)。ストリーミングなら、読めたところで鳴らし始める（start は要らない）。
    // ホストがその場で返したときは、onLoad も loadSound の中で呼ぶ（実機で、ローカルのファイルを読んだときと同じ）。
    loadSound: (_, self, [url, streaming]) => {
      const st = state(self);
      if (!st) return;
      st.loaded = 0;
      st.total = undefined;
      const address = toStr(vm, url);
      vm.request({ kind: 'loadSound', url: address, target: '', method: '' });
      vm.load({ url: address, method: 'GET', data: null, contentType: null }, (bytes) => {
        const sound = bytes && loadedMP3(bytes);
        if (sound) {
          if (st.entry) st.movie.sounds.stop((p) => p === st.entry);
          Object.assign(st, { sound, loaded: bytes.length, total: bytes.length, entry: null, finished: false });
          if (toBool(vm, streaming)) play(self, st, 0, 1);
        }
        const fn = self.get('onLoad');
        if (fn instanceof AVMFunction) vm.call(fn, self, [!!sound]);
      }, { sync: true });
    },
    getBytesLoaded: (_, self) => state(self)?.loaded,
    getBytesTotal: (_, self) => state(self)?.total,
  });
  // 鳴らす（start と、ストリーミングの loadSound）。鳴り終わると onSoundComplete が呼ばれる。
  const play = (self, st, offset, loops) => {
    st.finished = false;
    st.offset = offset;
    st.entry = st.movie.sounds.start(st.sound, { inPoint: offset * 44100, loops }, st.target?.clip ?? st.movie.root, () => {
      st.finished = true;
      const fn = self.get('onSoundComplete');
      if (fn instanceof AVMFunction) vm.invoke(fn, self, []);
    });
  };
  // 長さと再生位置（ミリ秒）。サウンドが割り当てられていなければ undefined。
  const duration = (st) => Math.round((st.sound.sampleCount / st.sound.rate) * 1000);
  proto.defineAccessor('duration', vm.native((_, self) => (state(self)?.sound ? duration(state(self)) : undefined)), null, HIDDEN);
  proto.defineAccessor('position', vm.native((_, self) => {
    const st = state(self);
    if (!st?.sound) return undefined;
    if (st.finished) return duration(st);
    if (!st.entry || !st.movie.sounds.playing.includes(st.entry)) return 0;
    const elapsed = st.movie.now() - st.entry.startedAt + st.offset * 1000;
    return Math.max(0, Math.min(duration(st), Math.round(elapsed % duration(st))));
  }), null, HIDDEN);

  defineClass(vm, 'Sound', proto, () => undefined, (_, [target], to) => {
    const obj = new AVMObject(vm, to);
    const base = vm.currentTarget;
    const resolved = target instanceof AVMObject ? target
      : target !== undefined && base ? vm.resolvePath({ target: base, scopes: [{ object: base }], thisValue: base }, toStr(vm, target)) : undefined;
    const movie = base?.clip?.movie;
    if (movie) obj.soundState = { movie, target: resolved?.isMovieClip ? resolved : null, sound: null, entry: null, finished: false, offset: 0, loaded: undefined, total: undefined };
    return obj;
  });
}
