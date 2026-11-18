// 鳴っている音の管理。
//
// 実際に音を出すのは「出力」（Movie.load の audio オプション。ブラウザでは audio/webaudio.js）で、ここは DOM に依らない。
// 出力が無くても、どの音がいつまで鳴っているかはここで追う（スクリプトから見える再生位置や、鳴り終わりの通知のため）。
//
// 出力のインターフェース:
//   prepare(sounds): Promise          再生前の準備（復号など）。sounds はこのムービーの全サウンド
//   play(sound, options): handle      鳴らし始める。options = { offset, inPoint, outPoint, loops, envelope, volume }
//                                       offset / inPoint / outPoint は秒（outPoint が無ければ最後まで）。envelope は
//                                       [{ time: 秒, left, right }]（0〜1）。volume は { ll, lr, rl, rr }（0〜1 を基準とする倍率）
//   stop(handle)                      止める
//   setVolume(handle, volume)         音量を変える
import { scanMP3 } from '../audio/decode.js';

const UNITY = { ll: 1, lr: 0, rl: 0, rr: 1 };

/** サウンドの長さ（秒）。 */
export function soundSeconds(sound) {
  return sound.sampleCount / sound.rate;
}

export class SoundMixer {
  /** @param {{ now: () => number }} movie  @param {object | null} output */
  constructor(movie, output = null) {
    this.movie = movie;
    this.output = output;
    this.playing = []; // { sound, owner, handle, startedAt, seconds, stream, onComplete }
    this.volumes = new Map(); // クリップ（null は全体）→ { ll, lr, rl, rr }。Sound オブジェクトが設定する
  }

  // owner（音を鳴らしたクリップ）にかかる音量。全体の音量と、そのクリップから上の各クリップの音量の積。
  // gain は、その音だけにかかる倍率（AS3 の SoundChannel の音量）。
  #volume(owner, gain = null) {
    const all = this.volumes.get(null) ?? UNITY;
    let v = gain ? { ll: gain.ll * all.ll + gain.lr * all.rl, lr: gain.ll * all.lr + gain.lr * all.rr, rl: gain.rl * all.ll + gain.rr * all.rl, rr: gain.rl * all.lr + gain.rr * all.rr } : all;
    for (let clip = owner; clip; clip = clip.parent) {
      const w = this.volumes.get(clip);
      if (w) v = { ll: v.ll * w.ll + v.lr * w.rl, lr: v.ll * w.lr + v.lr * w.rr, rl: v.rl * w.ll + v.rr * w.rl, rr: v.rl * w.lr + v.rr * w.rr };
    }
    return v;
  }

  /**
   * イベント音を鳴らす（StartSound、ボタンの音、Sound.start）。
   * @param {object} sound  parseDefineSound の結果
   * @param {object} info   parseSoundInfo の結果（位置は 44100 Hz 換算のサンプル数）
   * @param {object | null} owner  音を鳴らしたクリップ
   * @param {(() => void) | null} onComplete  鳴り終わったときに呼ぶ
   * @param {object | null} gain  この音だけにかける倍率 { ll, lr, rl, rr }
   * @returns {object | null} 鳴らし始めた音（鳴らさなかったら null）
   */
  start(sound, info, owner = null, onComplete = null, gain = null) {
    if (info.stop) {
      this.stop((p) => p.sound === sound);
      return null;
    }
    if (info.noMultiple && this.playing.some((p) => p.sound === sound)) return null;
    const total = soundSeconds(sound);
    const inPoint = Math.min((info.inPoint ?? 0) / 44100, total);
    const outPoint = info.outPoint === undefined ? total : Math.max(inPoint, Math.min(info.outPoint / 44100, total));
    const loops = Math.max(1, info.loops ?? 1);
    const envelope = info.envelope?.map((e) => ({ time: e.position / 44100, left: e.left / 32768, right: e.right / 32768 }));
    const entry = {
      sound, owner, onComplete, gain, stream: false, startedAt: this.movie.now(), seconds: (outPoint - inPoint) * loops, inPoint,
      handle: this.output?.play(sound, { offset: 0, inPoint, outPoint, loops, envelope, volume: this.#volume(owner, gain) }) ?? null,
    };
    if (this.playing.length < 64) this.playing.push(entry); // 同時に鳴らす数の上限
    else this.output?.stop(entry.handle);
    return entry;
  }

  /** 条件に合う音を止める（鳴り終わりの通知はしない）。 */
  stop(match = () => true) {
    for (const p of this.playing.filter(match)) this.output?.stop(p.handle);
    this.playing = this.playing.filter((p) => !match(p));
  }

  /**
   * タイムラインに沿って流れる音（ストリーム）を、クリップの今のフレームに合わせる。フレームごとに呼ぶ。
   * クリップが再生中で、そのフレームに音のデータがあれば鳴らし続ける。前のフレームからの続きでなければ、その位置から鳴らし直す。
   */
  syncStream(clip) {
    const stream = clip.frames.stream;
    if (!stream) return;
    const current = this.playing.find((p) => p.stream && p.owner === clip);
    const offset = clip.playing && !clip.removed ? stream.offsets.get(clip.currentFrame) : undefined;
    if (offset === undefined) {
      if (current) this.stop((p) => p === current);
      return;
    }
    if (current && current.nextFrame === clip.currentFrame) {
      current.nextFrame = clip.currentFrame + 1;
      return;
    }
    if (current) this.stop((p) => p === current);
    const seconds = offset / stream.sound.rate;
    this.playing.push({
      sound: stream.sound, owner: clip, onComplete: null, stream: true, nextFrame: clip.currentFrame + 1,
      startedAt: this.movie.now() - seconds * 1000, seconds: soundSeconds(stream.sound), inPoint: 0,
      handle: this.output?.play(stream.sound, { offset: seconds, inPoint: 0, outPoint: undefined, loops: 1, volume: this.#volume(clip) }) ?? null,
    });
  }

  /**
   * 音の出力が（利用者の操作で）有効になったときに呼ぶ。流れの途中の音は、有効になる前に鳴らし始めた位置からずれているので、
   * 止めて、今の位置から鳴らし直させる（タイムラインのストリーム音は次のフレームで、FLV の音声はその場で）。
   */
  resync() {
    const restart = this.playing.filter((p) => p.restart);
    this.stop((p) => p.stream || p.restart);
    for (const p of restart) p.restart();
  }

  /** 鳴り終わった音を片付け、鳴り終わりを通知する。フレームごとに呼ぶ。 */
  update() {
    const now = this.movie.now();
    const done = this.playing.filter((p) => !p.stream && now - p.startedAt >= p.seconds * 1000);
    if (!done.length) return;
    this.playing = this.playing.filter((p) => !done.includes(p));
    for (const p of done) p.onComplete?.();
  }

  /** クリップ（null は全体）の音量を設定し、鳴っている音に反映する。 */
  setVolume(clip, volume) {
    this.volumes.set(clip, volume);
    for (const p of this.playing) this.output?.setVolume?.(p.handle, this.#volume(p.owner, p.gain));
  }

  /** 鳴っている音 entry だけにかける倍率を変える。 */
  setGain(entry, gain) {
    entry.gain = gain;
    if (this.playing.includes(entry)) this.output?.setVolume?.(entry.handle, this.#volume(entry.owner, gain));
  }

  getVolume(clip) {
    return this.volumes.get(clip) ?? UNITY;
  }
}

/**
 * タイムライン上のストリーム音（SoundStreamHead と各フレームの SoundStreamBlock）を、1 本のサウンドにまとめる。
 * @param {object} head  parseSoundStreamHead の結果
 * @param {Array<{ frame: number, sampleCount: number, seekSamples: number, data: Uint8Array }>} blocks
 * @returns {{ sound: object, offsets: Map<number, number> }} offsets はフレーム番号 → そのフレームの先頭のサンプル位置
 */
export function buildStream(head, blocks) {
  const offsets = new Map();
  const size = blocks.reduce((n, b) => n + b.data.length, 0);
  const data = new Uint8Array(size);
  let at = 0, samples = 0;
  for (const block of blocks) {
    offsets.set(block.frame, samples);
    data.set(block.data, at);
    at += block.data.length;
    samples += block.sampleCount;
  }
  const sound = { id: -1, format: head.format, rate: head.rate, bits: head.bits, channels: head.channels, sampleCount: samples, seekSamples: head.latencySeek, data };
  // ADPCM のストリームは、ブロックごとに独立した ADPCM データ。まとめて復号できないので、ブロックの境界を残す。
  if (head.format === 'adpcm') sound.blocks = blocks.map((b) => ({ data: b.data, sampleCount: b.sampleCount }));
  if (head.format === 'mp3') sound.sampleCount = Math.max(samples, scanMP3(data).samples);
  return { sound, offsets };
}
