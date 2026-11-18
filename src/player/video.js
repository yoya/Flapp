// ビデオの絵を作る。フレームを順に復号して、描画側が使える画像（RGBA）にする。
//
// 画像は { type: 'bitmap', width, height, rgba, version } の形で、ビットマップの塗りと同じように描かれる
// （version は、絵が変わるたびに進む）。
import { scanMP3 } from '../audio/decode.js';
import { H263Decoder, VideoError, readPictureHeader, toRGBA } from '../video/h263.js';
import { ScreenVideo2Decoder, ScreenVideoDecoder } from '../video/screen.js';
import { VP6Decoder } from '../video/vp6.js';

// 1 回の更新で復号する量の上限（巻き戻しや飛び越しで、一度に大量に復号しないため）。フレーム数と、画素数の合計の両方で抑える。
const MAX_CATCH_UP = 32;
const MAX_CATCH_UP_PIXELS = 1 << 23;

/**
 * SWF に埋め込まれたビデオとして、このコーデックを復号できるか。
 * Screen Video v2 は、復号器はあるが、埋め込みでは使えない（実機も、埋め込みの v2 は何も表示しない。FLV でだけ映る）。
 */
export const decodable = (codec) => codec === 'h263' || codec === 'screen' || codec === 'vp6' || codec === 'vp6a';

const DECODERS = {
  h263: () => new H263Decoder(),
  screen: () => new ScreenVideoDecoder(),
  screen2: () => new ScreenVideo2Decoder(),
  vp6: () => new VP6Decoder(),
  vp6a: () => new VP6Decoder(true),
};

// VP6 の絵（YUV と、あればアルファ）を、表示する大きさに切り取って RGBA にする。色の扱いは、実機の画面に合わせてある:
// - 輝度は 16〜235、色差は 16〜240 に収めてから RGB にする。
// - アルファ付きの色は、アルファを掛けた値で入っている。アルファより明るい色は、アルファまでに抑えられる。
//   ここでは掛ける前の色に戻す（戻した値が 255 を超えるぶんは 255 に丸まるので、抑えたのと同じ結果になる）。
function vp6Image(picture, width, height) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  // 符号化された大きさより広い枠には、何も映らない（実機は、枠を黒く塗る）。
  if (width > picture.width || height > picture.height) {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    return rgba;
  }
  const { stride, y, cb, cr, alpha } = picture;
  for (let py = 0, i = 0; py < height; py++) {
    for (let px = 0; px < width; px++, i += 4) {
      const luma = 1.164 * (Math.min(Math.max(y[py * stride + px], 16), 235) - 16);
      const c = (py >> 1) * (stride >> 1) + (px >> 1);
      const u = Math.min(Math.max(cb[c], 16), 240) - 128, v = Math.min(Math.max(cr[c], 16), 240) - 128;
      const a = alpha ? alpha[py * stride + px] : 255;
      const scale = a === 255 ? 1 : a ? 255 / a : 0; // 透明な画素の色は 0 にしておく
      rgba[i] = Math.max(luma + 1.596 * v, 0) * scale;
      rgba[i + 1] = Math.max(luma - 0.392 * u - 0.813 * v, 0) * scale;
      rgba[i + 2] = Math.max(luma + 2.017 * u, 0) * scale;
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

/**
 * 番号の付いたフレーム列から、指定の番号のフレームの絵を作る。
 * 差分フレームは前のフレームが要るので、必要なら手前のキーフレームから順に復号する。
 */
class FrameSequence {
  /**
   * @param {string} codec 'h263' | 'screen' | 'screen2' | 'vp6' | 'vp6a'
   * @param {(n: number) => Uint8Array | undefined} packet  n 番のフレームのビデオパケット（無ければ undefined）
   * @param {(target: number) => number} keyBefore  target 以下で、そこから復号を始められるフレームの番号
   * @param {(message: string) => void} warn
   * @param {{ width: number, height: number } | null} [box]  VP6 の埋め込みビデオ: 絵を切り取る大きさ。
   *   無ければ（FLV）、パケットの先頭の 1 バイトが、右と下から削る画素数
   */
  constructor(codec, packet, keyBefore, warn, box = null) {
    this.codec = codec;
    this.box = box;
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
      this.decoder = DECODERS[this.codec]();
      this.decoded = this.keyBefore(target) - 1;
    }
    let pixels = MAX_CATCH_UP_PIXELS;
    for (let budget = MAX_CATCH_UP; this.decoded < target && budget > 0 && pixels > 0; budget--) {
      const data = this.packet(++this.decoded);
      if (!data) continue; // このフレーム番号のデータは無い（前の絵のまま）
      try {
        let picture, rgba;
        if (this.codec === 'vp6' || this.codec === 'vp6a') {
          const coded = this.decoder.decode(this.box ? data : data.subarray(1));
          pixels -= coded.width * coded.height;
          picture = this.box ?? { width: coded.width - (data[0] >> 4), height: coded.height - (data[0] & 15) };
          rgba = vp6Image(coded, picture.width, picture.height);
        } else {
          picture = this.decoder.decode(data);
          pixels -= picture.width * picture.height;
          rgba = this.codec === 'h263' ? toRGBA(picture) : picture.rgba;
        }
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

/**
 * SWF に埋め込まれたビデオ（DefineVideoStream と VideoFrame）のフレーム列。
 * @param {{ width: number, height: number }} size  DefineVideoStream の幅と高さ
 */
export function embeddedSequence(codec, frames, warn, size) {
  // Screen Video のフレームは、先頭に FLV のビデオタグと同じ 1 バイト（フレームの種類とコーデック）が付いている。
  // 仕様書の表には無いが、実機はこの 1 バイトが無いと何も表示しない（実機で確認）。
  const packet = codec === 'screen' ? (n) => frames.get(n)?.subarray(1) : (n) => frames.get(n);
  // H.263 は、ピクチャの見出しでキーフレームかどうかが分かる。VP6 は、先頭のバイトの最上位ビットが 0 ならキーフレーム
  // （アルファ付きは、色のデータの長さ 3 バイトの後）。Screen Video は先頭から復号する。
  const isKey = (data) => {
    if (codec === 'vp6') return data.length > 0 && !(data[0] & 0x80);
    if (codec === 'vp6a') return data.length > 3 && !(data[3] & 0x80);
    return readPictureHeader(data).type === 0;
  };
  const keyBefore = (target) => {
    if (codec === 'screen') return 0;
    for (let n = target; n > 0; n--) {
      try {
        if (frames.has(n) && isKey(frames.get(n))) return n;
      } catch (e) {
        if (!(e instanceof VideoError)) throw e;
      }
    }
    return 0;
  };
  // VP6 のデータには、FLV のような先頭の 1 バイトは無い。絵は、DefineVideoStream の大きさに切り取られる（どちらも実機で確認）。
  const box = codec === 'vp6' || codec === 'vp6a' ? { width: size.width, height: size.height } : null;
  return new FrameSequence(codec, packet, keyBefore, warn, box);
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
    if (decodable(codec) || codec === 'screen2') {
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
