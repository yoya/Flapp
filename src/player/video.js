// ビデオの絵を作る。フレームを順に復号して、描画側が使える画像（RGBA）にする。
//
// 画像は { type: 'bitmap', width, height, rgba, version } の形で、ビットマップの塗りと同じように描かれる
// （version は、絵が変わるたびに進む）。
import { scanMP3 } from '../audio/decode.js';
import { H263Decoder, VideoError, readPictureHeader, toRGBA } from '../video/h263.js';
import { ScreenVideoDecoder } from '../video/screen.js';

// 1 回の更新で復号する量の上限（巻き戻しや飛び越しで、一度に大量に復号しないため）。フレーム数と、画素数の合計の両方で抑える。
const MAX_CATCH_UP = 32;
const MAX_CATCH_UP_PIXELS = 1 << 23;

/** このコーデックを、ここで復号できるか。 */
export const decodable = (codec) => codec === 'h263' || codec === 'screen';

/**
 * 番号の付いたフレーム列から、指定の番号のフレームの絵を作る。
 * 差分フレームは前のフレームが要るので、必要なら手前のキーフレームから順に復号する。
 */
class FrameSequence {
  /**
   * @param {string} codec 'h263' | 'screen'
   * @param {(n: number) => Uint8Array | undefined} packet  n 番のフレームのビデオパケット（無ければ undefined）
   * @param {(target: number) => number} keyBefore  target 以下で、そこから復号を始められるフレームの番号
   * @param {(message: string) => void} warn
   */
  constructor(codec, packet, keyBefore, warn) {
    this.codec = codec;
    this.packet = packet;
    this.keyBefore = keyBefore;
    this.warn = warn;
    this.decoder = null;
    this.decoded = -1; // 復号し終えたフレームの番号
    this.image = null;
    this.failed = false;
  }

  /**
   * フレーム target を表示するための画像を返す（まだ何も復号できていなければ null）。
   * 一度に進める量には上限があり（少なくとも 1 フレームは進む）、追いつくまでは途中の絵が返る。
   */
  show(target) {
    if (this.failed || target === this.decoded) return this.image;
    if (!this.decoder || target < this.decoded) {
      this.decoder = this.codec === 'h263' ? new H263Decoder() : new ScreenVideoDecoder();
      this.decoded = this.keyBefore(target) - 1;
    }
    let pixels = MAX_CATCH_UP_PIXELS;
    for (let budget = MAX_CATCH_UP; this.decoded < target && budget > 0 && pixels > 0; budget--) {
      const data = this.packet(++this.decoded);
      if (!data) continue; // このフレーム番号のデータは無い（前の絵のまま）
      try {
        const picture = this.decoder.decode(data);
        pixels -= picture.width * picture.height;
        const rgba = this.codec === 'h263' ? toRGBA(picture) : picture.rgba;
        if (this.image?.width === picture.width && this.image.height === picture.height) Object.assign(this.image, { rgba, version: this.image.version + 1 });
        else this.image = { type: 'bitmap', width: picture.width, height: picture.height, rgba, version: 0 };
      } catch (e) {
        if (!(e instanceof VideoError)) throw e;
        this.warn(`video frame ${this.decoded}: ${e.message}`);
        this.failed = true; // 壊れたストリームは、そこで止める（前の絵は残す）
        break;
      }
    }
    return this.image;
  }
}

/** SWF に埋め込まれたビデオ（DefineVideoStream と VideoFrame）のフレーム列。 */
export function embeddedSequence(codec, frames, warn) {
  // Screen Video のフレームは、先頭に FLV のビデオタグと同じ 1 バイト（フレームの種類とコーデック）が付いている。
  // 仕様書の表には無いが、実機はこの 1 バイトが無いと何も表示しない（実機で確認）。
  const packet = codec === 'screen' ? (n) => frames.get(n)?.subarray(1) : (n) => frames.get(n);
  // H.263 は、ピクチャの見出しでキーフレームかどうかが分かる。Screen Video は先頭から復号する。
  const keyBefore = (target) => {
    if (codec !== 'h263') return 0;
    for (let n = target; n > 0; n--) {
      try {
        if (frames.has(n) && readPictureHeader(frames.get(n)).type === 0) return n;
      } catch (e) {
        if (!(e instanceof VideoError)) throw e;
      }
    }
    return 0;
  };
  return new FrameSequence(codec, packet, keyBefore, warn);
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

// FLV の AAC（設定のタグと、生のフレームのタグ）を、ブラウザが復号できる ADTS の形のサウンドにする。
function aacSound(tags, warn) {
  const config = tags.find((t) => t.packetType === 0)?.data;
  const frames = tags.filter((t) => t.packetType === 1);
  if (!config || config.length < 2 || !frames.length) return null;
  // AudioSpecificConfig: 種類 5 ビット、周波数の番号 4 ビット、チャンネルの構成 4 ビット
  const objectType = config[0] >> 3, rateIndex = ((config[0] & 7) << 1) | (config[1] >> 7), channels = (config[1] >> 3) & 15;
  if (!AAC_RATES[rateIndex] || channels < 1 || channels > 7) {
    warn('FLV audio: this AAC configuration is not supported (it will be silent)');
    return null;
  }
  const data = new Uint8Array(frames.reduce((n, t) => n + t.data.length + 7, 0));
  let at = 0;
  for (const { data: frame } of frames) {
    const length = frame.length + 7;
    // ADTS の見出し（7 バイト）: 同期語、プロファイル、周波数、チャンネル、フレームの長さ
    data.set([0xff, 0xf1, ((Math.min(Math.max(objectType, 1), 4) - 1) << 6) | (rateIndex << 2) | (channels >> 2),
      ((channels & 3) << 6) | (length >> 11), (length >> 3) & 0xff, ((length & 7) << 5) | 0x1f, 0xfc], at);
    data.set(frame, at + 7);
    at += length;
  }
  return { id: -1, format: 'aac', rate: AAC_RATES[rateIndex], bits: 16, channels: Math.min(channels, 2), sampleCount: frames.length * 1024, seekSamples: 0, data };
}

// FLV の音声タグを、1 本のサウンド（player/sound.js が鳴らせる形）にまとめる。鳴らせなければ null。
function flvSound(flv, warn) {
  const tags = flv.audio;
  if (!tags.length) return null;
  const { format, rate, bits16, stereo } = tags[0];
  if (format === 'aac') return aacSound(tags, warn);
  if (format !== 'mp3' && format !== 'pcm' && format !== 'pcm-native') {
    warn(`FLV audio format ${format} is not supported (it will be silent)`);
    return null;
  }
  const data = new Uint8Array(tags.reduce((n, t) => n + t.data.length, 0));
  let at = 0;
  for (const tag of tags) {
    data.set(tag.data, at);
    at += tag.data.length;
  }
  const channels = stereo ? 2 : 1;
  const sound = { id: -1, format, rate, bits: bits16 ? 16 : 8, channels, sampleCount: Math.floor(data.length / (channels * (bits16 ? 2 : 1))), seekSamples: 0, data };
  if (format === 'mp3') {
    const scan = scanMP3(data);
    Object.assign(sound, { sampleCount: scan.samples, rate: scan.rate || rate });
  }
  return sound.sampleCount > 0 ? sound : null;
}

/**
 * FLV の再生（NetStream の中身）。時刻は movie.now() で進む。映像は、今の時刻のフレームまでを順に復号する。
 * 音声は、ムービーのサウンドミキサーで鳴らす。
 */
export class FlvPlayback {
  /**
   * @param {{ now: () => number, sounds: object, warn: (message: string) => void }} movie
   * @param {object} flv  parseFLV の結果
   */
  constructor(movie, flv) {
    this.movie = movie;
    this.flv = flv;
    const warn = (message) => movie.warn(`video: ${message}`);
    const codec = flv.video[0]?.codec;
    this.sequence = null;
    this.external = null; // H.264: ホストのデコーダ（video/webcodecs.js を参照）
    this.fed = 0; // ホストのデコーダに入れ終えたフレームの数
    if (decodable(codec)) {
      const keyBefore = (target) => { for (let n = target; n > 0; n--) if (flv.video[n]?.key) return n; return 0; };
      this.sequence = new FrameSequence(codec, (n) => flv.video[n]?.data, keyBefore, warn);
    } else if (codec === 'avc') {
      // 設定（シーケンスヘッダ）を渡してデコーダを開く。絵になるフレームだけを、復号の順に並べておく。
      const header = flv.video.find((t) => t.packetType === 0);
      this.external = (header && movie.video?.open({ codec, description: header.data })) || null;
      this.frames = flv.video.filter((t) => t.packetType === 1);
      if (!this.external) warn('codec avc needs a decoder from the host (it will not be shown)');
    } else if (codec) warn(`codec ${codec} is not supported (it will not be shown)`);
    this.sound = flvSound(flv, warn);
    this.duration = flv.duration; // 再生は、最後のタグの時刻で終わる（メタデータの duration ではない。実機で確認）
    this.position = 0; // 止まっているときの位置（ミリ秒）
    this.startedAt = 0; // 再生中: 位置 0 にあたる movie.now() の値
    this.playing = false;
    this.ended = false;
    this.gain = null;
    this.entry = null;
  }

  /** 今の再生位置（ミリ秒）。 */
  get time() {
    return this.playing ? Math.min(Math.max(this.movie.now() - this.startedAt, 0), this.duration) : this.position;
  }

  #startAudio() {
    if (!this.sound) return;
    this.entry = this.movie.sounds.start(this.sound, { inPoint: (this.time / 1000) * 44100 }, null, null, this.gain);
    if (this.entry) this.entry.restart = () => { if (this.playing) this.#startAudio(); }; // 出力が後から有効になったら、今の位置から鳴らし直す
  }

  #stopAudio() {
    if (this.entry) this.movie.sounds.stop((p) => p === this.entry);
    this.entry = null;
  }

  /** 位置 from（ミリ秒）から再生する。 */
  play(from = 0) {
    this.#stopAudio();
    this.position = Math.min(Math.max(from, 0), this.duration);
    this.startedAt = this.movie.now() - this.position;
    this.playing = true;
    this.ended = false;
    this.#startAudio();
    if (this.external) {
      // ホストのデコーダには、今の位置より前でいちばん近いキーフレームから入れ直す。
      this.external.reset();
      this.fed = 0;
      this.frames.forEach((tag, n) => { if (tag.key && tag.time <= this.position) this.fed = n; });
    }
  }

  pause() {
    if (!this.playing) return;
    this.position = this.time;
    this.playing = false;
    this.#stopAudio();
  }

  resume() {
    if (!this.playing && !this.ended) this.play(this.position);
  }

  /** 位置を変える。実際の位置は、指定より前でいちばん近いキーフレームになる。 */
  seek(to) {
    const target = Math.min(Math.max(to, 0), this.duration);
    let at = 0;
    for (const tag of this.flv.video) if (tag.key && tag.time <= target) at = tag.time;
    const wasPlaying = this.playing;
    this.#stopAudio();
    this.playing = false;
    this.position = this.flv.video.length ? at : target;
    this.ended = false;
    if (wasPlaying) this.play(this.position);
  }

  /** 止めて、音も止める。 */
  close() {
    this.#stopAudio();
    this.playing = false;
    this.external?.close();
    this.external = null;
  }

  /** この音だけにかける倍率を変える。 */
  setGain(gain) {
    this.gain = gain;
    if (this.entry) this.movie.sounds.setGain(this.entry, gain);
  }

  /** 終わりまで来ていたら再生を止めて true を返す（フレームごとに呼ぶ。true は、終わった時の 1 回だけ）。 */
  finished() {
    if (!this.playing || this.movie.now() - this.startedAt < this.duration) return false;
    this.position = this.duration;
    this.playing = false;
    this.ended = true;
    this.entry = null; // 音は、鳴り終わるに任せる
    return true;
  }

  /** 今の時刻に表示する画像（無ければ null）。 */
  image() {
    if (this.external) {
      // 少し先（1 秒ぶん）までのフレームを、デコーダが受け取れるだけ入れる。絵は、復号が済んだものの中から時刻で選ぶ。
      const now = this.time;
      while (this.fed < this.frames.length && this.frames[this.fed].time <= now + 1000 && this.external.ready) {
        const tag = this.frames[this.fed++];
        this.external.push({ key: tag.key, time: tag.time + (tag.compositionTime ?? 0), data: tag.data });
      }
      return this.external.image(now);
    }
    if (!this.sequence) return null;
    const { video } = this.flv;
    const now = this.time;
    // 今の時刻以前で、いちばん後のフレーム。
    let low = 0, high = video.length - 1, index = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (video[mid].time <= now) { index = mid; low = mid + 1; } else high = mid - 1;
    }
    return index < 0 ? this.sequence.image : this.sequence.show(index);
  }
}
