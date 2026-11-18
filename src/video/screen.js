// Screen Video（バージョン 1）の復号。仕様: docs/swf-file-format-spec-v19.pdf 14 章「Screen Video bitstream format」。
// 画面を格子状のブロックに分け、変わったブロックだけを zlib で圧縮した BGR の画素として送る形式。
import { inflateSync } from '../swf/inflate.js';
import { MAX_VIDEO_PIXELS, VideoError } from './h263.js';

/** Screen Video のストリーム 1 本ぶんの復号器。フレームを順に decode に渡す。 */
export class ScreenVideoDecoder {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.rgba = null; // 今の絵（上から下、RGBA）。送られてこなかったブロックは前のまま
  }

  /**
   * @param {Uint8Array} bytes SCREENVIDEOPACKET
   * @returns {{ width: number, height: number, rgba: Uint8ClampedArray }} rgba は次の decode で書き換わる
   */
  decode(bytes) {
    if (bytes.length < 4) throw new VideoError('screen video packet is too short');
    const blockWidth = ((bytes[0] >> 4) + 1) * 16, width = ((bytes[0] & 15) << 8) | bytes[1];
    const blockHeight = ((bytes[2] >> 4) + 1) * 16, height = ((bytes[2] & 15) << 8) | bytes[3];
    if (width < 1 || height < 1 || width * height > MAX_VIDEO_PIXELS) throw new VideoError(`video frame size ${width}x${height} is out of range`);
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 3; i < this.rgba.length; i += 4) this.rgba[i] = 255;
    }
    let pos = 4;
    // ブロックは左下から右上へ、行ごとに並ぶ。右端と上端のブロックは、画像に収まるぶんだけの大きさになる。
    for (let bottom = 0; bottom < height; bottom += blockHeight) {
      const h = Math.min(blockHeight, height - bottom);
      for (let left = 0; left < width; left += blockWidth) {
        const w = Math.min(blockWidth, width - left);
        if (pos + 2 > bytes.length) throw new VideoError('screen video packet is truncated');
        const size = (bytes[pos] << 8) | bytes[pos + 1];
        pos += 2;
        if (size === 0) continue; // 前のフレームから変わっていない
        if (pos + size > bytes.length) throw new VideoError('screen video packet is truncated');
        const pixels = size > 2 ? inflateSync(bytes.subarray(pos, pos + size), 2, w * h * 3) : null; // 先頭 2 バイトは zlib のヘッダ
        pos += size;
        if (!pixels || pixels.length < w * h * 3) throw new VideoError('screen video block cannot be decompressed');
        // ブロックの中も、下の行から順に入っている。
        for (let row = 0; row < h; row++) {
          const y = height - 1 - (bottom + row);
          for (let x = 0; x < w; x++) {
            const from = (row * w + x) * 3, to = (y * width + left + x) * 4;
            this.rgba[to] = pixels[from + 2];
            this.rgba[to + 1] = pixels[from + 1];
            this.rgba[to + 2] = pixels[from];
          }
        }
      }
    }
    return { width, height, rgba: this.rgba };
  }
}
