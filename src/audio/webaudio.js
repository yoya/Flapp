// Web Audio による音の出力（ブラウザ用）。player/sound.js の SoundMixer から呼ばれる。
//
//   const audio = new WebAudioOutput();
//   const movie = await Movie.load(bytes, { audio });
//   canvas.addEventListener('pointerdown', () => audio.resume()); // ブラウザは利用者の操作があるまで音を出さない
import { decodeADPCM, decodeSound } from './decode.js';

export class WebAudioOutput {
  #buffers = new Map(); // サウンド → AudioBuffer、または復号中の Promise

  /** @param {AudioContext} [context] */
  constructor(context = new AudioContext()) {
    this.context = context;
    // 出力の手前に計測用のノードを挟む（音が出ているかを level() で確かめられる）。
    this.analyser = context.createAnalyser();
    this.analyser.connect(context.destination);
  }

  /** 利用者の操作を受けて、音を出せる状態にする。 */
  resume() {
    return this.context.state === 'suspended' ? this.context.resume() : Promise.resolve();
  }

  /** いま出ている音の大きさ（0〜1 の実効値）。 */
  level() {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
  }

  /** 再生前に、全サウンドを復号しておく。 */
  async prepare(sounds) {
    await Promise.all(sounds.map((sound) => this.#buffer(sound)));
  }

  // サウンドを AudioBuffer にする。PCM と ADPCM はその場で、MP3 と AAC（FLV の音声）はブラウザの復号（非同期）で。
  #buffer(sound) {
    if (this.#buffers.has(sound)) return this.#buffers.get(sound);
    let result;
    if (sound.format === 'mp3' || sound.format === 'aac') {
      // decodeAudioData は渡したバッファを使い切るので、写しを渡す。
      result = this.context.decodeAudioData(sound.data.slice().buffer).then((buffer) => {
        this.#buffers.set(sound, buffer);
        return buffer;
      }, () => {
        this.#buffers.set(sound, null);
        return null;
      });
    } else {
      // ストリームの ADPCM は、フレームごとのブロックが独立したデータなので、1 つずつ復号してつなぐ。
      const pcm = sound.blocks
        ? { rate: sound.rate, channels: this.#joinBlocks(sound) }
        : decodeSound(sound);
      result = pcm && pcm.channels[0].length ? this.#toBuffer(pcm) : null;
    }
    this.#buffers.set(sound, result);
    return result;
  }

  #joinBlocks(sound) {
    const parts = sound.blocks.map((b) => decodeADPCM(b.data, sound.channels, b.sampleCount));
    return Array.from({ length: sound.channels }, (_, c) => {
      const out = new Int16Array(parts.reduce((n, p) => n + p[c].length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p[c], at);
        at += p[c].length;
      }
      return out;
    });
  }

  #toBuffer({ rate, channels }) {
    const buffer = this.context.createBuffer(channels.length, channels[0].length, rate);
    channels.forEach((samples, c) => {
      const out = buffer.getChannelData(c);
      for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
    });
    return buffer;
  }

  /**
   * 鳴らし始める。
   * @param {object} sound
   * @param {{ offset: number, inPoint: number, outPoint?: number, loops: number,
   *           envelope?: Array<{ time: number, left: number, right: number }>, volume: { ll, lr, rl, rr } }} options
   * @returns {object} stop / setVolume に渡す handle
   */
  play(sound, options) {
    const handle = { stopped: false, source: null, gains: null, volume: options.volume };
    // 音を出せない状態（利用者の操作を待っている間）に予約すると、出せるようになった瞬間にまとめて鳴ってしまう。鳴らさずに捨てる。
    if (this.context.state !== 'running') return handle;
    const start = (buffer) => {
      if (!buffer || handle.stopped) return;
      const ctx = this.context;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // MP3 の先頭の読み飛ばし（SeekSamples）ぶんだけ、位置を後ろへずらす。
      const skip = sound.format === 'mp3' ? Math.max(0, sound.seekSamples) / sound.rate : 0;
      const inPoint = Math.min(options.inPoint + skip, buffer.duration);
      const outPoint = Math.min((options.outPoint ?? buffer.duration - skip) + skip, buffer.duration);
      const span = Math.max(0, outPoint - inPoint);
      if (span <= 0) return;
      // モノラルは左右に同じ音を出す。左右それぞれに音量の変化（エンベロープ）を掛け、その後で Sound の変換（左右の混ぜ方）を掛ける。
      const stereo = ctx.createGain();
      stereo.channelCount = 2;
      stereo.channelCountMode = 'explicit';
      stereo.channelInterpretation = 'speakers';
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      const envelope = [ctx.createGain(), ctx.createGain()];
      const now = ctx.currentTime;
      (options.envelope ?? []).forEach((point, i) => {
        const at = now + Math.max(0, point.time - options.offset);
        for (const [gain, value] of [[envelope[0], point.left], [envelope[1], point.right]]) {
          if (i === 0) gain.gain.setValueAtTime(value, now);
          gain.gain.linearRampToValueAtTime(value, at);
        }
      });
      // ll: 左 → 左、lr: 左 → 右、rl: 右 → 左、rr: 右 → 右
      const gains = { ll: ctx.createGain(), lr: ctx.createGain(), rl: ctx.createGain(), rr: ctx.createGain() };
      source.connect(stereo).connect(splitter);
      splitter.connect(envelope[0], 0);
      splitter.connect(envelope[1], 1);
      envelope[0].connect(gains.ll).connect(merger, 0, 0);
      envelope[0].connect(gains.lr).connect(merger, 0, 1);
      envelope[1].connect(gains.rl).connect(merger, 0, 0);
      envelope[1].connect(gains.rr).connect(merger, 0, 1);
      merger.connect(this.analyser);
      handle.source = source;
      handle.gains = gains;
      handle.output = merger;
      this.setVolume(handle, handle.volume);
      const loops = Math.max(1, options.loops);
      const offset = Math.min(options.offset, span * loops);
      if (loops > 1) {
        source.loop = true;
        source.loopStart = inPoint;
        source.loopEnd = outPoint;
      }
      source.start(0, inPoint + (offset % span), span * loops - offset);
      source.onended = () => handle.output.disconnect();
    };
    const buffer = this.#buffer(sound);
    if (buffer instanceof Promise) buffer.then(start); // MP3 の復号が済んでから鳴らす
    else start(buffer);
    return handle;
  }

  stop(handle) {
    if (!handle || handle.stopped) return;
    handle.stopped = true;
    try {
      handle.source?.stop();
    } catch {
      // まだ始まっていない
    }
    handle.output?.disconnect();
  }

  setVolume(handle, volume) {
    if (!handle) return;
    handle.volume = volume;
    if (handle.gains) for (const key of ['ll', 'lr', 'rl', 'rr']) handle.gains[key].gain.value = volume[key];
  }
}
