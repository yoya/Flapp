// flash.media: Sound、SoundChannel、SoundTransform、SoundMixer。鳴らす処理は player/sound.js の SoundMixer が受け持つ。
//
// 鳴らせるのは、SWF に埋め込まれてクラスに結び付けられたサウンドと、Sound.load で読み込んだ MP3。
// 読み込みはホストに任せる（Movie.load の network）。読めなければ、失敗（ioError）を伝える。
import { ASObject } from './object.js';
import { loadedMP3 } from '../player/sound.js';

/**
 * @param {import('./vm.js').AVM2} vm
 * @param {import('../player/movie.js').Movie} movie
 * @returns 表示オブジェクトの soundTransform プロパティの読み書き
 */
export function installMedia(vm, movie) {
  const c = vm.classes;
  const num = (v) => vm.toNumber(v);
  const { display } = vm;

  // --- SoundTransform: 音量と、左右それぞれの入力を左右の出力へどれだけ送るか ---
  const T = (self) => self.transform;
  const transform = (values) => { const obj = vm.construct(c.SoundTransform, []); Object.assign(obj.transform, values); return obj; };
  // 実際にかける倍率（player/sound.js の形）。
  const gain = (t) => ({ ll: t.volume * t.ll, lr: t.volume * t.lr, rl: t.volume * t.rl, rr: t.volume * t.rr });
  const channel = (name) => [(self) => T(self)[name], (self, v) => { T(self)[name] = num(v); }];
  const fields = { volume: channel('volume'), leftToLeft: channel('ll'), leftToRight: channel('lr'), rightToLeft: channel('rl'), rightToRight: channel('rr') };
  const need = (v, name) => { if (!(v instanceof ASObject) || !v.transform) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`); return v.transform; };
  // 鳴っている音やミキサーに設定した値は、1/100 刻みに切り捨てて持たれる（実機で確認）。
  const kept = (t) => Object.fromEntries(Object.entries(t).map(([name, v]) => [name, Math.trunc(v * 100) / 100]));
  c.SoundTransform = vm.defineClass({
    name: 'flash.media::SoundTransform', final: true,
    allocate: (klass) => Object.assign(new ASObject(klass), { transform: { volume: 1, ll: 1, lr: 0, rl: 0, rr: 1 } }),
    construct: (self, [volume = 1, pan = 0]) => {
      T(self).volume = num(volume);
      Object.assign(T(self), { ll: Math.sqrt(1 - num(pan)), rr: Math.sqrt(1 + num(pan)), lr: 0, rl: 0 });
    },
    getters: {
      ...Object.fromEntries(Object.entries(fields).map(([name, [get]]) => [name, get])),
      // パン: 左右が混ざっていれば 0。そうでなければ、左の倍率から求める。
      pan: (self) => (T(self).lr !== 0 || T(self).rl !== 0 ? 0 : 1 - T(self).ll * T(self).ll),
    },
    setters: {
      ...Object.fromEntries(Object.entries(fields).map(([name, [, set]]) => [name, set])),
      pan: (self, v) => { Object.assign(T(self), { ll: Math.sqrt(1 - num(v)), rr: Math.sqrt(1 + num(v)), lr: 0, rl: 0 }); },
    },
  });

  // --- SoundChannel: 鳴っている 1 本の音 ---
  const S = (self) => self.channel;
  // 再生位置（ミリ秒）。止めた後や鳴り終わった後は、そのときの位置のまま。
  const position = (ch) => {
    if (ch.stoppedAt !== undefined) return ch.stoppedAt;
    if (!ch.entry) return 0;
    return Math.min(movie.now() - ch.entry.startedAt, ch.entry.seconds * 1000) + ch.offset;
  };
  c.SoundChannel = vm.defineClass({
    name: 'flash.media::SoundChannel', base: c.EventDispatcher, final: true,
    allocate: (klass) => Object.assign(new ASObject(klass), { channel: { entry: null, offset: 0, stoppedAt: undefined, transform: { volume: 1, ll: 1, lr: 0, rl: 0, rr: 1 } } }),
    getters: {
      position: (self) => position(S(self)),
      soundTransform: (self) => transform(S(self).transform),
      leftPeak: () => 0, rightPeak: () => 0,
    },
    setters: {
      soundTransform: (self, v) => {
        S(self).transform = kept(need(v, 'sndTransform'));
        if (S(self).entry) movie.sounds.setGain(S(self).entry, gain(S(self).transform));
      },
    },
    methods: {
      stop: (self) => {
        const ch = S(self);
        if (ch.stoppedAt !== undefined) return;
        ch.stoppedAt = position(ch);
        if (ch.entry) movie.sounds.stop((p) => p === ch.entry);
      },
    },
  });

  // SoundChannel の音を鳴らし始める。鳴り終わると、その SoundChannel に soundComplete が届く。
  const startChannel = (sound, ch) => {
    const state = S(ch);
    state.entry = movie.sounds.start(sound, { inPoint: (state.offset / 1000) * 44100, loops: state.loops }, null, () => {
      state.stoppedAt = position(state);
      display.send(ch, c.Event, ['soundComplete']);
    }, gain(state.transform));
  };

  // --- Sound ---
  let linked = null; // クラス名 → キャラクタ ID
  c.Sound = vm.defineClass({
    name: 'flash.media::Sound', base: c.EventDispatcher,
    // クラス（か、その継承元）に結び付けられたサウンドがあれば、それを鳴らせる。
    allocate: (klass) => {
      linked ??= new Map([...movie.symbolClasses].map(([id, name]) => [name.replace(/\.(?=[^.]*$)/, '::'), id]));
      let sound;
      for (let k = klass; k && !sound; k = k.superClass) sound = movie.dictionary.get(linked.get(k.name));
      return Object.assign(new ASObject(klass), { sound: sound?.type === 'sound' ? sound : null, url: null, loading: false, waiting: [] });
    },
    construct: (self, [stream]) => { if (stream !== undefined && stream !== null) vm.callProperty(self, { name: 'load', keys: ['p:|load'] }, [stream]); },
    getters: {
      length: (self) => (self.sound ? (self.sound.sampleCount / self.sound.rate) * 1000 : 0),
      bytesLoaded: (self) => self.bytes ?? self.sound?.data?.length ?? 0, bytesTotal: (self) => self.bytes ?? self.sound?.data?.length ?? 0,
      url: (self) => self.url, isBuffering: () => false, id3: () => new ASObject(c.Object),
    },
    methods: {
      // play(開始位置（ミリ秒）, 繰り返し回数, 音量): 鳴り終わると、返した SoundChannel に soundComplete が届く。
      // 読み込みの途中なら、読めたところで鳴らし始める（load の直後に play を呼ぶ書き方ができる）。
      play: (self, [startTime = 0, loops = 0, sndTransform = null]) => {
        if (!self.sound && !self.loading) vm.throwError('ArgumentError', 2068, 'Invalid sound.');
        const ch = vm.construct(c.SoundChannel, []);
        const state = S(ch);
        if (sndTransform !== null && sndTransform !== undefined) state.transform = kept(need(sndTransform, 'sndTransform'));
        state.offset = Math.max(0, num(startTime));
        state.loops = Math.max(1, vm.toInt32(loops));
        if (!self.sound) {
          if (self.waiting.length < 64) self.waiting.push(ch);
          return ch;
        }
        if (state.offset >= (self.sound.sampleCount / self.sound.rate) * 1000) return null; // 長さを超える位置からは鳴らせない
        startChannel(self.sound, ch);
        return ch;
      },
      // load(URLRequest): MP3 を読み込む。読めたら open、progress、complete を、読めなければ ioError を伝える。
      load: (self, [request]) => {
        if (!(request instanceof ASObject) || request.klass !== c.URLRequest) vm.throwError('TypeError', 2007, 'Parameter stream must be non-null.');
        const url = request.url ?? '';
        movie.request({ kind: 'loadSound', url, target: '', method: request.method ?? 'GET' });
        self.loading = true;
        movie.load({ url, method: 'GET', data: null, contentType: null }, display.later, (bytes) => {
          self.loading = false;
          const sound = bytes && loadedMP3(bytes);
          if (!sound) {
            self.waiting = [];
            display.dispatch(self, vm.construct(c.IOErrorEvent, ['ioError', false, false, `Error #2032: Stream Error. URL: ${url}`, 2032]));
            return;
          }
          Object.assign(self, { sound, url, bytes: bytes.length });
          display.dispatch(self, vm.construct(c.Event, ['open']));
          display.dispatch(self, vm.construct(c.ProgressEvent, ['progress', false, false, bytes.length, bytes.length]));
          // 読み込みを待っていた play を鳴らす（その間に止められたものは鳴らさない）。
          for (const ch of self.waiting.splice(0)) {
            if (S(ch).stoppedAt === undefined && S(ch).offset < (sound.sampleCount / sound.rate) * 1000) startChannel(sound, ch);
          }
          display.dispatch(self, vm.construct(c.Event, ['complete']));
        });
      },
      close: () => {},
    },
  });

  // --- SoundMixer: 全体の音量と、全部の音の停止 ---
  let master = { volume: 1, ll: 1, lr: 0, rl: 0, rr: 1 };
  const mixer = vm.defineClass({
    name: 'flash.media::SoundMixer', final: true,
    staticMethods: {
      stopAll: () => { movie.sounds.stop(); },
      areSoundsInaccessible: () => false,
      computeSpectrum: () => {},
    },
    staticValues: { bufferTime: 5 },
  });
  mixer.staticTraits.set('p:|soundTransform', {
    kind: 'accessor', key: 'p:|soundTransform', name: 'soundTransform',
    get: vm.native(() => transform(master)),
    set: vm.native((_, [v]) => { master = kept(need(v, 'sndTransform')); movie.sounds.setVolume(null, gain(master)); }),
  });
  vm.defineClass({ name: 'flash.media::ID3Info', dynamic: true });

  return {
    /** SoundTransform を、ミキサーにかける倍率にする（NetStream の音量用）。 */
    gainOf: (v) => gain(kept(need(v, 'sndTransform'))),
    // スプライトごとの音量（その中のタイムラインが鳴らす音にかかる）。
    getSoundTransform: (self) => transform(self.display.soundTransform ?? { volume: 1, ll: 1, lr: 0, rl: 0, rr: 1 }),
    setSoundTransform: (self, v) => {
      self.display.soundTransform = kept(need(v, 'sndTransform'));
      movie.sounds.setVolume(self.display, gain(self.display.soundTransform));
    },
  };
}
