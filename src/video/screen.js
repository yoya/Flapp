// Screen Video（バージョン 1 と 2）の復号。仕様: docs/swf-file-format-spec-v19.pdf 14 章「Screen Video bitstream format」
// 「Screen Video V2 bitstream format」と、付録 C（バージョン 2 の既定のパレット）。
// 画面を格子状のブロックに分け、変わったブロックだけを zlib で圧縮した画素として送る形式。
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

// バージョン 2 の、15/7 ビットの混成の色で使う既定のパレット（仕様書の付録 C）。値は 0x00rrggbb。
const DEFAULT_PALETTE = [
  0x000000, 0x333333, 0x666666, 0x999999, 0xcccccc, 0xffffff, 0x330000, 0x660000, 0x990000, 0xcc0000, 0xff0000, 0x003300,
  0x006600, 0x009900, 0x00cc00, 0x00ff00, 0x000033, 0x000066, 0x000099, 0x0000cc, 0x0000ff, 0x333300, 0x666600, 0x999900,
  0xcccc00, 0xffff00, 0x003333, 0x006666, 0x009999, 0x00cccc, 0x00ffff, 0x330033, 0x660066, 0x990099, 0xcc00cc, 0xff00ff,
  0xffff33, 0xffff66, 0xffff99, 0xffffcc, 0xff33ff, 0xff66ff, 0xff99ff, 0xffccff, 0x33ffff, 0x66ffff, 0x99ffff, 0xccffff,
  0xcccc33, 0xcccc66, 0xcccc99, 0xccccff, 0xcc33cc, 0xcc66cc, 0xcc99cc, 0xccffcc, 0x33cccc, 0x66cccc, 0x99cccc, 0xffcccc,
  0x999933, 0x999966, 0x9999cc, 0x9999ff, 0x993399, 0x996699, 0x99cc99, 0x99ff99, 0x339999, 0x669999, 0xcc9999, 0xff9999,
  0x666633, 0x666699, 0x6666cc, 0x6666ff, 0x663366, 0x669966, 0x66cc66, 0x66ff66, 0x336666, 0x996666, 0xcc6666, 0xff6666,
  0x333366, 0x333399, 0x3333cc, 0x3333ff, 0x336633, 0x339933, 0x33cc33, 0x33ff33, 0x663333, 0x993333, 0xcc3333, 0xff3333,
  0x003366, 0x336600, 0x660033, 0x006633, 0x330066, 0x663300, 0x336699, 0x669933, 0x993366, 0x339966, 0x663399, 0x996633,
  0x6699cc, 0x99cc66, 0xcc6699, 0x66cc99, 0x9966cc, 0xcc9966, 0x99ccff, 0xccff99, 0xff99cc, 0x99ffcc, 0xcc99ff, 0xffcc99,
  0x111111, 0x222222, 0x444444, 0x555555, 0xaaaaaa, 0xbbbbbb, 0xdddddd, 0xeeeeee,
];

/**
 * Screen Video バージョン 2 の復号器。バージョン 1 との違い:
 * - 画素は、24 ビットの BGR か、15/7 ビットの混成（1 バイトならパレットの番号、2 バイトなら 15 ビットの色）。
 * - ブロックの一部の行だけを送れる（HasDiffBlocks）。送られなかった行は、キーフレームのときの絵に戻る
 *   （差分は、直前のフレームではなくキーフレームのブロックに対するもの）。
 * - 「zlib の priming」（形式の最下位ビット）: 圧縮のとき、同じ位置の「キーブロック」の（展開後の）データが直前にあったものとして
 *   圧縮してある。展開するときも、そのデータを辞書として与える。このブロックには zlib のヘッダが無い。
 *   キーブロックは、その位置に最後に送られた、priming も行の範囲の指定も無いブロック（FLV のキーフレームでなくてもよい）。
 * - IFrameImage の印の付いたパケットには、ブロックの列がもう 1 つ続く。同じ規則で、続けて処理する。
 * priming などの中身は仕様書に書かれていないので、ffmpeg が作ったデータと、機能ごとに作ったデータを実機で再生して
 * （FLV を NetStream で再生）、画面と突き合わせて確かめた。仕様書の説明と違うところ:
 * - 形式の下から 2 番目のビット（ZlibPrimeCompressCurrent）が立っていても、位置（IMAGEPRIMEPOSITION）の 2 バイトは無い。
 *   このビットは復号のしかたを変えないが、立っているブロックはキーブロックにならない。
 * - 末尾の adler32 は確かめられない。
 * ストリームの中のパレット（HasPaletteInfo）は、どんな形で送っても実機が落ちるので、未対応として VideoError にする。
 * なお、24 ビットの色のブロックに priming を使うと実機は落ちる。ここでは、15/7 ビットの色と同じに復号する。
 */
export class ScreenVideo2Decoder {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.rgba = null;
    this.keys = []; // ブロックごとの、キーフレームのときの展開後のデータ（priming の辞書）
    this.keyPixels = []; // ブロックごとの、キーフレームのときの絵（RGBA。行の範囲だけが送られたときの土台）
  }

  /**
   * @param {Uint8Array} bytes SCREENV2VIDEOPACKET
   * @returns {{ width: number, height: number, rgba: Uint8ClampedArray }} rgba は次の decode で書き換わる
   */
  decode(bytes) {
    if (bytes.length < 5) throw new VideoError('screen video packet is too short');
    const blockWidth = ((bytes[0] >> 4) + 1) * 16, width = ((bytes[0] & 15) << 8) | bytes[1];
    const blockHeight = ((bytes[2] >> 4) + 1) * 16, height = ((bytes[2] & 15) << 8) | bytes[3];
    if (width < 1 || height < 1 || width * height > MAX_VIDEO_PIXELS) throw new VideoError(`video frame size ${width}x${height} is out of range`);
    if (bytes[4] & 1) throw new VideoError('screen video v2: a palette in the stream is not supported');
    if (width !== this.width || height !== this.height || blockWidth !== this.blockWidth || blockHeight !== this.blockHeight) {
      Object.assign(this, { width, height, blockWidth, blockHeight, keys: [], keyPixels: [] });
      this.rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 3; i < this.rgba.length; i += 4) this.rgba[i] = 255;
    }
    let pos = 5;
    for (let list = bytes[4] & 2 ? 2 : 1; list > 0; list--) {
      let index = 0;
      for (let bottom = 0; bottom < height; bottom += blockHeight) {
        const h = Math.min(blockHeight, height - bottom);
        for (let left = 0; left < width; left += blockWidth, index++) {
          const w = Math.min(blockWidth, width - left);
          if (pos + 2 > bytes.length) throw new VideoError('screen video packet is truncated');
          const size = (bytes[pos] << 8) | bytes[pos + 1];
          pos += 2;
          if (size === 0) continue; // 前のフレームから変わっていない
          if (pos + size > bytes.length) throw new VideoError('screen video packet is truncated');
          const end = pos + size;
          // IMAGEFORMAT: 色の深さ、行の範囲の指定があるか、priming の種類
          const format = bytes[pos++];
          const depth = (format >> 3) & 3;
          if (format >> 5 || (depth !== 0 && depth !== 2)) throw new VideoError('screen video v2: unknown block format');
          let firstRow = 0, rows = h;
          if (format & 4) {
            if (pos + 2 > end) throw new VideoError('screen video packet is truncated');
            [firstRow, rows] = [bytes[pos], bytes[pos + 1]];
            pos += 2;
            if (firstRow + rows > h) throw new VideoError('screen video v2: rows are outside the block');
          }
          const limit = w * h * 3;
          let pixels;
          if (rows === 0) pixels = new Uint8Array(0); // 行が 1 つも無い: キーフレームのときの絵に戻るだけ（データは付かない）
          else if (format & 1) {
            if (!this.keys[index]) throw new VideoError('screen video v2: a primed block without a key block');
            pixels = inflateSync(bytes.subarray(pos, end), 0, limit, this.keys[index]);
          } else {
            pixels = end - pos > 2 ? inflateSync(bytes.subarray(pos, end), 2, limit) : null; // 先頭 2 バイトは zlib のヘッダ
            if (pixels && !(format & 6)) this.keys[index] = pixels.slice();
          }
          pos = end;
          if (!pixels) throw new VideoError('screen video block cannot be decompressed');
          // 行の範囲だけが送られたブロックは、キーフレームのときの絵に戻してから、その行を書く。
          const rowsOf = (y0) => this.rgba.subarray((y0 * width + left) * 4, (y0 * width + left + w) * 4);
          if (format & 4 && this.keyPixels[index]) {
            for (let row = 0; row < h; row++) rowsOf(height - 1 - (bottom + row)).set(this.keyPixels[index].subarray(row * w * 4, (row + 1) * w * 4));
          }
          // ブロックの中の画素は、下の行から順に入っている。行の範囲の指定も、下から数える。
          let at = 0;
          for (let row = firstRow; row < firstRow + rows; row++) {
            const y = height - 1 - (bottom + row);
            for (let x = 0; x < w; x++) {
              const to = (y * width + left + x) * 4;
              if (at >= pixels.length) throw new VideoError('screen video block is too short');
              if (depth === 0) {
                // 24 ビット: B, G, R
                this.rgba[to] = pixels[at + 2];
                this.rgba[to + 1] = pixels[at + 1];
                this.rgba[to + 2] = pixels[at];
                at += 3;
              } else if (pixels[at] & 0x80) {
                // 15 ビットの色（各 5 ビット）。8 ビットへは、3 ビット左に寄せるだけ（下位は 0 のまま。実機の画面で確認。
                // ffmpeg は上位ビットを下位に写すので、最大で 7 だけ明るくなる）。
                const color = ((pixels[at] & 0x7f) << 8) | pixels[at + 1];
                const wide = (v) => v << 3;
                this.rgba[to] = wide((color >> 10) & 31);
                this.rgba[to + 1] = wide((color >> 5) & 31);
                this.rgba[to + 2] = wide(color & 31);
                at += 2;
              } else {
                const color = DEFAULT_PALETTE[pixels[at++]];
                this.rgba[to] = color >> 16;
                this.rgba[to + 1] = (color >> 8) & 0xff;
                this.rgba[to + 2] = color & 0xff;
              }
            }
          }
          if (!(format & 7)) {
            // キーブロック（全体が、priming の印なしで送られた）: 絵を控えておく。
            const copy = new Uint8ClampedArray(w * h * 4);
            for (let row = 0; row < h; row++) copy.set(rowsOf(height - 1 - (bottom + row)), row * w * 4);
            this.keyPixels[index] = copy;
          }
        }
      }
    }
    return { width, height, rgba: this.rgba };
  }
}
