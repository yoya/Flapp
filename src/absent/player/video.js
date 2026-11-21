// ビデオの復号を外した版。どのコーデックも復号できない扱いにする（埋め込みのビデオは映らず、FLV は見つからない扱い）。
export const decodable = () => false;
export const embeddedSequence = () => null;
export class FlvPlayback {
  constructor() { throw Object.assign(new Error('video is not included in this build'), { name: 'VideoError' }); }
}
// VP6 の復号器も読み込まない（ビデオを映さないので、ホストが渡した読み込みの関数は呼ばない）。
export const vp6Source = () => Object.assign(() => null, { ready: async () => {} });
