// ビデオ関連のタグ (仕様 14 章)。
import { Reader, SWFError } from './reader.js';

/** CodecID の番号 → 名前。 */
export const VIDEO_CODECS = { 2: 'h263', 3: 'screen', 4: 'vp6', 5: 'vp6a', 6: 'screen2' };

/**
 * DefineVideoStream。
 * @returns {{ id: number, numFrames: number, width: number, height: number, deblocking: number, smoothing: boolean, codec: string }}
 */
export function parseDefineVideoStream(tag) {
  if (tag.code !== 60) throw new SWFError(`tag ${tag.code} is not a DefineVideoStream`);
  const r = new Reader(tag.body);
  const video = { id: r.u16(), numFrames: r.u16(), width: r.u16(), height: r.u16() };
  const flags = r.u8();
  video.deblocking = (flags >> 1) & 7;
  video.smoothing = (flags & 1) !== 0;
  const codec = r.u8();
  video.codec = VIDEO_CODECS[codec] ?? `unknown-${codec}`;
  return video;
}

/**
 * VideoFrame。
 * @returns {{ streamId: number, frameNum: number, data: Uint8Array }} data は、コーデックごとのビデオパケット
 */
export function parseVideoFrame(tag) {
  if (tag.code !== 61) throw new SWFError(`tag ${tag.code} is not a VideoFrame`);
  const r = new Reader(tag.body);
  return { streamId: r.u16(), frameNum: r.u16(), data: r.bytesView(r.remaining) };
}
