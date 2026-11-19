// サウンド関連のタグ (仕様 11 章)。
import { Reader, SWFError } from './reader.js';

/** SoundFormat の番号 → 名前。 */
export const SOUND_FORMATS = { 0: 'pcm-native', 1: 'adpcm', 2: 'mp3', 3: 'pcm', 4: 'nellymoser16k', 5: 'nellymoser8k', 6: 'nellymoser', 11: 'speex' };
const RATES = [5512, 11025, 22050, 44100];

// 形式を表す 1 バイト: SoundFormat UB[4], SoundRate UB[2], SoundSize UB[1], SoundType UB[1]
function formatByte(b) {
  return { format: SOUND_FORMATS[b >> 4] ?? `unknown-${b >> 4}`, rate: RATES[(b >> 2) & 3], bits: b & 2 ? 16 : 8, channels: b & 1 ? 2 : 1 };
}

/**
 * DefineSound。
 * @returns {{ id: number, format: string, rate: number, bits: number, channels: number, sampleCount: number,
 *             seekSamples: number, data: Uint8Array }}
 *   data は符号化されたままの音声。MP3 では先頭の SeekSamples（再生開始時に読み飛ばすサンプル数）を除いた MP3 フレーム列。
 */
export function parseDefineSound(tag) {
  if (tag.code !== 14) throw new SWFError(`tag ${tag.code} is not a DefineSound`);
  const r = new Reader(tag.body);
  const sound = { id: r.u16(), ...formatByte(r.u8()), sampleCount: r.u32(), seekSamples: 0 };
  if (sound.format === 'mp3' && r.remaining >= 2) sound.seekSamples = r.s16();
  sound.data = r.bytesView(r.remaining);
  return sound;
}

/**
 * SOUNDINFO。鳴らし方の指定。
 * @returns {{ stop: boolean, noMultiple: boolean, inPoint?: number, outPoint?: number, loops: number,
 *             envelope?: Array<{ position: number, left: number, right: number }> }}
 *   inPoint / outPoint / position は 44100 Hz 換算のサンプル位置。left / right は 0〜32768。
 */
export function parseSoundInfo(r) {
  const flags = r.u8();
  const info = { stop: (flags & 0x20) !== 0, noMultiple: (flags & 0x10) !== 0, loops: 1 };
  if (flags & 0x01) info.inPoint = r.u32();
  if (flags & 0x02) info.outPoint = r.u32();
  if (flags & 0x04) info.loops = r.u16();
  if (flags & 0x08) {
    info.envelope = [];
    for (let n = r.u8(); n > 0; n--) info.envelope.push({ position: r.u32(), left: r.u16(), right: r.u16() });
  }
  return info;
}

/** StartSound (15)。 */
/** StartSound (15) / StartSound2 (89)。StartSound2 は、音を ID ではなく AS3 のクラス名で指す。 */
export function parseStartSound(tag) {
  if (tag.code !== 15 && tag.code !== 89) throw new SWFError(`tag ${tag.code} is not a StartSound`);
  const r = new Reader(tag.body);
  if (tag.code === 89) return { className: r.string(), info: parseSoundInfo(r) };
  return { soundId: r.u16(), info: parseSoundInfo(r) };
}

/** DefineButtonSound (17)。ボタンの状態遷移ごとの音。無い遷移は含まない。 */
export function parseDefineButtonSound(tag) {
  if (tag.code !== 17) throw new SWFError(`tag ${tag.code} is not a DefineButtonSound`);
  const r = new Reader(tag.body);
  const out = { buttonId: r.u16(), sounds: {} };
  // 順に: マウスが離れた / 乗った / 押した / 離した
  for (const event of ['rollOut', 'rollOver', 'press', 'release']) {
    const soundId = r.u16();
    if (soundId !== 0) out.sounds[event] = { soundId, info: parseSoundInfo(r) };
  }
  return out;
}

/**
 * SoundStreamHead (18) / SoundStreamHead2 (45)。タイムラインに沿って流れる音（ストリーム）の形式。
 * samplesPerFrame は 1 フレームぶんのサンプル数、latencySeek は MP3 の最初に読み飛ばすサンプル数。
 */
export function parseSoundStreamHead(tag) {
  if (tag.code !== 18 && tag.code !== 45) throw new SWFError(`tag ${tag.code} is not a SoundStreamHead`);
  const r = new Reader(tag.body);
  r.u8(); // 再生側の推奨形式（使わない）
  const head = { ...formatByte(r.u8()), samplesPerFrame: r.u16(), latencySeek: 0 };
  if (head.format === 'mp3' && r.remaining >= 2) head.latencySeek = r.s16();
  return head;
}

/**
 * SoundStreamBlock (19)。1 フレームぶんの音声データ。
 * MP3 では先頭に、このブロックのサンプル数と SeekSamples が付く。それ以外の形式のサンプル数は samplesPerFrame。
 */
export function parseSoundStreamBlock(tag, head) {
  if (tag.code !== 19) throw new SWFError(`tag ${tag.code} is not a SoundStreamBlock`);
  if (head.format !== 'mp3' || tag.body.length < 4) return { sampleCount: head.samplesPerFrame, seekSamples: 0, data: tag.body };
  const r = new Reader(tag.body);
  return { sampleCount: r.u16(), seekSamples: r.s16(), data: r.bytesView(r.remaining) };
}
