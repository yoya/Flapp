// ビデオの復号を外した版。FLV は読めない（NetStream.play は、見つからない扱いになる）。
export const VIDEO_CODECS = {};
export function parseFLV() {
  throw Object.assign(new Error('video is not included in this build'), { name: 'VideoError' });
}
