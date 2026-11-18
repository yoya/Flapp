// 音声の復号。PCM と ADPCM は自前で復号する。MP3 はフレームの見出しだけを読み、復号は再生側（ブラウザ）に任せる。

/** ビット単位の読み出し（上位ビットから）。範囲外は 0 として読む。 */
class Bits {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0; // ビット位置
  }

  get left() {
    return this.bytes.length * 8 - this.pos;
  }

  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) v = (v << 1) | (((this.bytes[this.pos >> 3] ?? 0) >> (7 - (this.pos & 7))) & 1);
    return v;
  }

  readSigned(n) {
    const v = this.read(n);
    return v & (1 << (n - 1)) ? v - (1 << n) : v;
  }
}

// ADPCM の表（仕様 11 章）。
const STEP_SIZES = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411,
  1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
  10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_TABLES = {
  2: [-1, 2],
  3: [-1, -1, 2, 4],
  4: [-1, -1, -1, -1, 2, 4, 6, 8],
  5: [-1, -1, -1, -1, -1, -1, -1, -1, 1, 2, 4, 6, 8, 10, 13, 16],
};

/**
 * SWF の ADPCM を 16 ビットの PCM にする。
 * @param {Uint8Array} data  ADPCMSOUNDDATA（先頭 2 ビットが符号の幅 - 2）
 * @param {number} channels  1 か 2
 * @param {number} sampleCount  復号するサンプル数（チャンネルあたり）の上限
 * @returns {Int16Array[]} チャンネルごとのサンプル
 */
export function decodeADPCM(data, channels, sampleCount) {
  const bits = new Bits(data);
  const size = bits.read(2) + 2; // 1 サンプルの符号のビット数（2〜5）
  const table = INDEX_TABLES[size];
  const out = Array.from({ length: channels }, () => new Int16Array(sampleCount));
  const sample = new Array(channels).fill(0);
  const index = new Array(channels).fill(0);
  let n = 0;
  // 4096 サンプルごとに、チャンネルごとの初期値（16 ビットのサンプルと 6 ビットの表の位置）が入る。
  while (n < sampleCount && bits.left >= 22 * channels) {
    for (let c = 0; c < channels; c++) {
      sample[c] = bits.readSigned(16);
      index[c] = Math.min(bits.read(6), 88);
      out[c][n] = sample[c];
    }
    n++;
    for (let k = 1; k < 4096 && n < sampleCount && bits.left >= size * channels; k++, n++) {
      for (let c = 0; c < channels; c++) {
        const code = bits.read(size);
        const step = STEP_SIZES[index[c]];
        // 差分 = (符号の大きさ + 1/2) × 刻み幅 / 2^(幅 - 2) を、ビットごとの足し算で求める。
        let diff = step >> (size - 1);
        for (let b = size - 2, s = step; b >= 0; b--, s >>= 1) if (code & (1 << b)) diff += s;
        sample[c] += code & (1 << (size - 1)) ? -diff : diff;
        sample[c] = Math.max(-32768, Math.min(32767, sample[c]));
        index[c] = Math.max(0, Math.min(88, index[c] + table[code & ((1 << (size - 1)) - 1)]));
        out[c][n] = sample[c];
      }
    }
  }
  return out.map((ch) => ch.subarray(0, n));
}

/**
 * PCM（8 ビットは符号なし、16 ビットはリトルエンディアン）を 16 ビットにそろえる。
 * @returns {Int16Array[]} チャンネルごとのサンプル
 */
export function decodePCM(data, channels, bits) {
  const frame = channels * (bits / 8);
  const count = Math.floor(data.length / frame);
  const out = Array.from({ length: channels }, () => new Int16Array(count));
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < channels; c++) {
      const p = i * frame + c * (bits / 8);
      out[c][i] = bits === 8 ? (data[p] - 128) << 8 : ((data[p] | (data[p + 1] << 8)) << 16) >> 16;
    }
  }
  return out;
}

/**
 * サウンド（parseDefineSound の結果など { format, rate, bits, channels, sampleCount, data }）を PCM にする。
 * 自前で復号できない形式（MP3 など）は null。
 * @returns {{ rate: number, channels: Int16Array[] } | null}
 */
export function decodeSound(sound) {
  if (sound.format === 'adpcm') return { rate: sound.rate, channels: decodeADPCM(sound.data, sound.channels, sound.sampleCount) };
  if (sound.format === 'pcm' || sound.format === 'pcm-native') return { rate: sound.rate, channels: decodePCM(sound.data, sound.channels, sound.bits) };
  return null;
}

// MPEG オーディオのフレーム見出し（Layer III）。
const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2 / 2.5
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * MP3 のフレームを数えて、長さを求める。
 * @param {Uint8Array} data  MP3 のフレーム列
 * @returns {{ frames: number, samples: number, rate: number, channels: number }} 読めたフレームの数、サンプル数、周波数
 */
export function scanMP3(data) {
  let frames = 0, samples = 0, rate = 0, channels = 0;
  let p = 0;
  while (p + 4 <= data.length) {
    const h = (data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3];
    const version = (h >>> 19) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
    const layer = (h >>> 17) & 3; // 1: Layer III
    const bitrate = BITRATES[version === 3 ? 1 : 2][(h >>> 12) & 15];
    const sampleRate = SAMPLE_RATES[version]?.[(h >>> 10) & 3];
    if ((h >>> 21) !== 0x7ff || layer !== 1 || !bitrate || !sampleRate) {
      p++; // 同期が取れるまで 1 バイトずつ進める
      continue;
    }
    const perFrame = version === 3 ? 1152 : 576;
    const size = Math.floor(((perFrame / 8) * bitrate * 1000) / sampleRate) + ((h >>> 9) & 1);
    frames++;
    samples += perFrame;
    rate = sampleRate;
    channels = ((h >>> 6) & 3) === 3 ? 1 : 2;
    p += size;
  }
  return { frames, samples, rate, channels };
}
