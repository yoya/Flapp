// ビットマップ定義タグの解釈（仕様 8 章）。
// 可逆形式 (DefineBitsLossless / 2) はここで RGBA に展開する。JPEG / PNG / GIF は復号器を持たないので、
// 正規化したバイト列と寸法だけを返し、復号は描画側（ブラウザ）に任せる。
import { inflate } from './inflate.js';
import { Reader, SWFError } from './reader.js';

// 1 枚あたりの既定の画素数の上限。実際のファイルには 9406x3131 の JPEG もあるので、寸法では縛らない。
const DEFAULT_PIXEL_BUDGET = 1 << 26;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const startsWith = (bytes, magic) => magic.every((v, i) => bytes[i] === v);

const GIF87_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];

/**
 * 読み込んだ画像ファイル（loadMovie / Loader）が JPEG / PNG / GIF なら、その寸法と、復号器に渡すバイト列を返す。どれでもなければ null。
 * 壊れた JPEG や、画素数の上限を超える画像は SWFError にする。
 * @returns {{ width: number, height: number, encoded: { bytes: Uint8Array, type: string } } | null}
 */
export function imageFile(bytes, pixelBudget = DEFAULT_PIXEL_BUDGET) {
  if (startsWith(bytes, PNG_MAGIC) || startsWith(bytes, GIF_MAGIC) || startsWith(bytes, GIF87_MAGIC)) {
    const png = bytes[0] === 0x89;
    if (bytes.length < 24) throw new SWFError('image data is truncated');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = png ? view.getUint32(16) : view.getUint16(6, true);
    const height = png ? view.getUint32(20) : view.getUint16(8, true);
    checkSize(width, height, pixelBudget);
    return { width, height, encoded: { bytes, type: png ? 'image/png' : 'image/gif' }, transparent: png ? pngHasAlpha(bytes) : gifHasAlpha(bytes) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const jpeg = normalizeJPEG([bytes]);
  checkSize(jpeg.width, jpeg.height, pixelBudget);
  return { width: jpeg.width, height: jpeg.height, encoded: { bytes: jpeg.bytes, type: 'image/jpeg' } };
}

// PNG にアルファがあるか: 色の種類がアルファ付き（4・6）か、tRNS（透明色）の塊がある。
function pngHasAlpha(bytes) {
  if (bytes[25] === 4 || bytes[25] === 6) return true;
  for (let p = 8; p + 8 <= bytes.length;) {
    const len = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    p += 12 + len;
  }
  return false;
}

// GIF にアルファがあるか: 透明色を指定する拡張（Graphic Control Extension の透明フラグ）がある。
function gifHasAlpha(bytes) {
  for (let i = 13; i + 3 < bytes.length; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4 && (bytes[i + 3] & 1)) return true;
  return false;
}

function checkSize(width, height, pixelBudget) {
  if (width < 1 || height < 1) throw new SWFError(`bitmap size ${width}x${height} is not supported`);
  if (width * height > pixelBudget) throw new SWFError(`bitmap ${width}x${height} exceeds the remaining pixel budget`);
}

/**
 * @param {{ code: number, body: Uint8Array }} tag  DefineBits (6) / JPEG2 (21) / JPEG3 (35) / JPEG4 (90) / Lossless (20) / Lossless2 (36)
 * @param {Uint8Array | undefined} jpegTables  JPEGTables タグの中身（DefineBits 用）
 * @param {number} [pixelBudget]  これを超える画素数のビットマップは展開せずに SWFError にする
 * @returns {Promise<{ id: number, width: number, height: number,
 *   rgba?: Uint8ClampedArray,                      可逆形式: 乗算済みでない RGBA
 *   encoded?: { bytes: Uint8Array, type: string }, JPEG / PNG / GIF
 *   alpha?: Uint8Array }>}                         JPEG3 / 4 のアルファ（1 画素 1 バイト）
 */
export async function parseBitmap(tag, jpegTables, pixelBudget = DEFAULT_PIXEL_BUDGET) {
  if (tag.code === 20 || tag.code === 36) return lossless(tag, pixelBudget);
  if (tag.code === 6 || tag.code === 21 || tag.code === 35 || tag.code === 90) return encoded(tag, jpegTables, pixelBudget);
  throw new SWFError(`tag ${tag.code} is not a bitmap`);
}

async function lossless(tag, pixelBudget) {
  const hasAlpha = tag.code === 36;
  const r = new Reader(tag.body);
  const id = r.u16();
  const format = r.u8();
  const width = r.u16();
  const height = r.u16();
  if (format !== 3 && format !== 5 && !(format === 4 && !hasAlpha)) throw new SWFError(`unknown bitmap format ${format}`);
  checkSize(width, height, pixelBudget);
  const tableSize = format === 3 ? r.u8() + 1 : 0;
  const entry = hasAlpha ? 4 : 3; // カラーテーブル 1 色のバイト数
  // 行は 32 ビット境界まで詰め物が入る。
  const rowBytes = format === 3 ? (width + 3) & ~3 : format === 4 ? (width * 2 + 3) & ~3 : width * 4;
  const pixels = tableSize * entry;
  const { bytes: data } = await inflate(r.bytesView(r.remaining), pixels + rowBytes * height);

  // データが足りない部分は 0 として読む（型付き配列への undefined の代入は 0 になる）。
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Lossless2 の色はアルファ乗算済みなので、乗算前に戻す。
  const put = (o, red, green, blue, a) => {
    if (hasAlpha && a < 255) {
      const k = a === 0 ? 0 : 255 / a;
      red *= k;
      green *= k;
      blue *= k;
    }
    rgba[o] = red;
    rgba[o + 1] = green;
    rgba[o + 2] = blue;
    rgba[o + 3] = a;
  };
  for (let y = 0; y < height; y++) {
    const row = pixels + y * rowBytes;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (format === 3) {
        const index = data[row + x];
        if (index < tableSize) {
          const c = index * entry;
          put(o, data[c], data[c + 1], data[c + 2], hasAlpha ? data[c + 3] : 255);
        } else {
          put(o, 0, 0, 0, hasAlpha ? 0 : 255); // 表の外を指す番号、またはデータ不足
        }
      } else if (format === 4) {
        const v = (data[row + x * 2] << 8) | data[row + x * 2 + 1];
        const c5 = (c) => (c << 3) | (c >> 2);
        put(o, c5((v >> 10) & 31), c5((v >> 5) & 31), c5(v & 31), 255);
      } else {
        const p = row + x * 4;
        put(o, data[p + 1], data[p + 2], data[p + 3], hasAlpha ? data[p] : 255);
      }
    }
  }
  return { id, width, height, rgba };
}

async function encoded(tag, jpegTables, pixelBudget) {
  const r = new Reader(tag.body);
  const id = r.u16();
  let image;
  let alphaData;
  if (tag.code === 35 || tag.code === 90) {
    const size = r.u32();
    if (tag.code === 90) r.u16(); // DeblockParam
    image = r.bytesView(Math.min(size, r.remaining));
    alphaData = r.bytesView(r.remaining);
  } else {
    image = r.bytesView(r.remaining);
  }

  if (startsWith(image, PNG_MAGIC) || startsWith(image, GIF_MAGIC)) {
    const png = image[0] === 0x89;
    if (image.length < 24) throw new SWFError('image data is truncated');
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const width = png ? view.getUint32(16) : view.getUint16(6, true);
    const height = png ? view.getUint32(20) : view.getUint16(8, true);
    checkSize(width, height, pixelBudget);
    return { id, width, height, encoded: { bytes: image, type: png ? 'image/png' : 'image/gif' } };
  }

  const { bytes, width, height } = normalizeJPEG(tag.code === 6 && jpegTables ? [jpegTables, image] : [image]);
  checkSize(width, height, pixelBudget);
  const bitmap = { id, width, height, encoded: { bytes, type: 'image/jpeg' } };
  if (alphaData?.length) bitmap.alpha = (await inflate(alphaData, width * height)).bytes;
  return bitmap;
}

// SWF 内の JPEG を、普通の復号器が読める 1 本のストリームにする。
//  - 古い SWF にある余分なヘッダ (FF D9 FF D8) を取り除く
//  - DefineBits では JPEGTables（量子化表・ハフマン表）と本体をつなぐ
// どちらも「SOS より前にある SOI / EOI を捨てる」ことで同じ処理になる。SOF から寸法も読む。
function normalizeJPEG(parts) {
  const out = [Uint8Array.of(0xff, 0xd8)];
  let width = 0;
  let height = 0;
  let sawScan = false;
  for (const part of parts) {
    let pos = 0;
    while (pos < part.length && !sawScan) {
      if (part[pos] !== 0xff || pos + 1 >= part.length) throw new SWFError('JPEG data is corrupted');
      const marker = part[pos + 1];
      if (marker === 0xff) {
        pos++; // 詰め物の FF
      } else if (marker === 0xd8 || marker === 0xd9) {
        pos += 2;
      } else if (marker === 0xda) {
        out.push(part.subarray(pos)); // SOS 以降は符号化データ。そのまま最後まで
        sawScan = true;
      } else {
        if (pos + 4 > part.length) throw new SWFError('JPEG data is truncated');
        const length = (part[pos + 2] << 8) | part[pos + 3];
        if (length < 2 || pos + 2 + length > part.length) throw new SWFError('JPEG data is truncated');
        // SOF0〜SOF15（DHT=C4, JPG=C8, DAC=CC を除く）: 精度 1 バイト、高さ、幅の順
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          if (length < 7) throw new SWFError('JPEG data is corrupted');
          height = (part[pos + 5] << 8) | part[pos + 6];
          width = (part[pos + 7] << 8) | part[pos + 8];
        }
        out.push(part.subarray(pos, pos + 2 + length));
        pos += 2 + length;
      }
    }
  }
  if (!sawScan || width === 0 || height === 0) throw new SWFError('JPEG data has no image');

  const bytes = new Uint8Array(out.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of out) {
    bytes.set(c, at);
    at += c.length;
  }
  return { bytes, width, height };
}
