// FLV ファイルの分解。仕様: docs/video_file_format_spec_v10.pdf「The FLV File Format」。
// 入力は信用しない。長さはファイルの残りで確かめ、タグの数とスクリプトデータの入れ子には上限を設ける。
import { VideoError } from './h263.js';

const MAX_TAGS = 1 << 20;
const MAX_DEPTH = 16; // スクリプトデータの入れ子
export const VIDEO_CODECS = { 2: 'h263', 3: 'screen', 4: 'vp6', 5: 'vp6a', 6: 'screen2', 7: 'avc' };
const AUDIO_FORMATS = { 0: 'pcm-native', 1: 'adpcm', 2: 'mp3', 3: 'pcm', 4: 'nellymoser16k', 5: 'nellymoser8k', 6: 'nellymoser', 10: 'aac', 11: 'speex' };
const RATES = [5512, 11025, 22050, 44100];

/**
 * スクリプトデータの値（AMF0）をひとつ読む。オブジェクトは、プロトタイプの無い素のオブジェクトにする。
 * @returns {[value, 次の位置]}
 */
function readValue(view, pos, depth) {
  if (depth > MAX_DEPTH) throw new VideoError('FLV script data is nested too deeply');
  const need = (n) => { if (pos + n > view.byteLength) throw new VideoError('FLV script data is truncated'); };
  const string = (lengthBytes) => {
    need(lengthBytes);
    const length = lengthBytes === 2 ? view.getUint16(pos) : view.getUint32(pos);
    pos += lengthBytes;
    need(length);
    const text = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + pos, length));
    pos += length;
    return text;
  };
  // 名前と値の組を、終わりの印（空の名前 + 種類 9）まで読む。
  const properties = () => {
    const out = Object.create(null);
    for (;;) {
      if (pos + 3 > view.byteLength) return out; // 終わりの印が無いまま尽きた
      const name = string(2);
      need(1);
      if (name === '' && view.getUint8(pos) === 9) { pos++; return out; }
      [out[name], pos] = readValue(view, pos, depth + 1);
    }
  };
  need(1);
  const type = view.getUint8(pos++);
  switch (type) {
    case 0: need(8); pos += 8; return [view.getFloat64(pos - 8), pos];
    case 1: need(1); return [view.getUint8(pos++) !== 0, pos];
    case 2: return [string(2), pos];
    case 3: return [properties(), pos];
    case 5: case 6: return [null, pos];
    case 8: need(4); pos += 4; return [properties(), pos]; // ECMA 配列（要素数は目安なので使わない）
    case 10: {
      need(4);
      const count = view.getUint32(pos);
      pos += 4;
      if (count > view.byteLength - pos) throw new VideoError('FLV script data is truncated');
      const list = [];
      for (let i = 0; i < count; i++) { let v; [v, pos] = readValue(view, pos, depth + 1); list.push(v); }
      return [list, pos];
    }
    case 11: need(10); pos += 10; return [view.getFloat64(pos - 10), pos]; // 日付（ミリ秒）と時差
    case 12: return [string(4), pos];
    default: throw new VideoError(`FLV script data type ${type} is not supported`);
  }
}

/**
 * @param {Uint8Array | ArrayBuffer} input
 * @returns {{ video: object[], audio: object[], metadata: object | null, duration: number }}
 *   video: { time（ミリ秒）, key, codec, data, packetType?, compositionTime? }  data は VIDEODATA の中身（H263VIDEOPACKET など）
 *   audio: { time, format, rate, bits16, stereo, data, packetType? }
 *   metadata: onMetaData の値（無ければ null）。duration は、最後のタグの時刻（ミリ秒）
 */
export function parseFLV(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 9 || bytes[0] !== 0x46 || bytes[1] !== 0x4c || bytes[2] !== 0x56) throw new VideoError('not an FLV file');
  let pos = view.getUint32(5); // 本体の始まり
  if (pos < 9) throw new VideoError('FLV header is invalid');
  const out = { video: [], audio: [], metadata: null, duration: 0 };
  let count = 0;
  pos += 4; // PreviousTagSize0
  while (pos + 11 <= bytes.length) {
    if (++count > MAX_TAGS) throw new VideoError('FLV file has too many tags');
    const type = bytes[pos];
    const size = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    const time = ((bytes[pos + 7] << 24) | (bytes[pos + 4] << 16) | (bytes[pos + 5] << 8) | bytes[pos + 6]) >>> 0;
    const start = pos + 11;
    if (start + size > bytes.length) break; // 途中で切れたファイルは、読めたところまで
    const data = bytes.subarray(start, start + size);
    if (type === 9 && size >= 1) {
      const codec = VIDEO_CODECS[data[0] & 15] ?? `codec ${data[0] & 15}`;
      const frameType = data[0] >> 4;
      if (frameType !== 5) { // 5 は、映像ではなく制御用のフレーム
        const tag = { time, key: frameType === 1 || frameType === 4, codec, data: data.subarray(1) };
        if (codec === 'avc' && size >= 5) {
          tag.packetType = data[1];
          tag.compositionTime = ((data[2] << 16) | (data[3] << 8) | data[4]) << 8 >> 8;
          tag.data = data.subarray(5);
        }
        out.video.push(tag);
      }
    } else if (type === 8 && size >= 1) {
      const format = AUDIO_FORMATS[data[0] >> 4] ?? `format ${data[0] >> 4}`;
      const tag = { time, format, rate: RATES[(data[0] >> 2) & 3], bits16: (data[0] & 2) !== 0, stereo: (data[0] & 1) !== 0, data: data.subarray(1) };
      if (format === 'aac' && size >= 2) {
        tag.packetType = data[1];
        tag.data = data.subarray(2);
      }
      out.audio.push(tag);
    } else if (type === 18) {
      try {
        const [name, next] = readValue(new DataView(data.buffer, data.byteOffset, data.byteLength), 0, 0);
        if (name === 'onMetaData') [out.metadata] = readValue(new DataView(data.buffer, data.byteOffset, data.byteLength), next, 0);
      } catch (e) {
        if (!(e instanceof VideoError)) throw e; // 壊れたスクリプトデータは無視する
      }
    }
    out.duration = Math.max(out.duration, time);
    pos = start + size + 4; // 後ろの PreviousTagSize
  }
  return out;
}
