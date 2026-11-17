// SWF のヘッダとタグ列の切り出し（仕様 2 章）。タグの中身は解釈せず、バイト列のビューとして返す。
import { lzmaDecode } from './lzma.js';
import { Reader, SWFError } from './reader.js';
import { tagNames } from './tagnames.js';

const TAG_END = 0;
const TAG_DEFINE_SPRITE = 39;

/**
 * @param {Uint8Array | ArrayBuffer} input
 * @param {{ maxLength?: number }} [options] maxLength: 受け付ける FileLength（展開後サイズ）の上限
 * @returns タグ列が途中で壊れていても読めた範囲を返し、問題は warnings に積む。
 *          ヘッダが読めない、または展開できない場合は SWFError を投げる。
 */
export async function parseSWF(input, { maxLength = 256 * 1024 * 1024 } = {}) {
  const file = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (file.length < 8) throw new SWFError('file is shorter than the 8-byte header');
  const compression = { 0x46: 'none', 0x43: 'zlib', 0x5a: 'lzma' }[file[0]];
  if (!compression || file[1] !== 0x57 || file[2] !== 0x53) throw new SWFError('not a SWF file (bad signature)');

  const head = new Reader(file);
  const signature = String.fromCharCode(...head.bytesView(3));
  const version = head.u8();
  const fileLength = head.u32();
  if (fileLength < 8) throw new SWFError(`FileLength ${fileLength} is smaller than the header`);
  if (fileLength > maxLength) throw new SWFError(`FileLength ${fileLength} exceeds the limit ${maxLength}`);

  const warnings = [];
  const bodyLength = fileLength - 8; // 先頭 8 バイトを除いた、展開後の長さ
  let body;
  if (compression === 'none') {
    body = file.subarray(8, fileLength);
  } else if (compression === 'zlib') {
    body = await inflate(file.subarray(8), bodyLength, warnings);
  } else {
    // ZWS: 圧縮データ長 (UI32)、LZMA プロパティ 5 バイト、LZMA データ。
    if (file.length < 17) throw new SWFError('ZWS header is truncated');
    const compressedLength = head.u32();
    const props = head.bytesView(5);
    if (compressedLength > head.remaining) {
      warnings.push(`ZWS compressed length ${compressedLength} exceeds the file (${head.remaining} bytes left)`);
    }
    body = lzmaDecode(props, head.bytesView(Math.min(compressedLength, head.remaining)), bodyLength);
  }
  if (body.length < bodyLength) {
    warnings.push(`data is ${bodyLength - body.length} bytes shorter than FileLength`);
  }

  const r = new Reader(body);
  const frameSize = r.rect();
  const frameRate = r.u16() / 256;
  const frameCount = r.u16();
  const tags = readTags(r, 8, warnings, false);
  return { signature, version, fileLength, frameSize, frameRate, frameCount, tags, warnings };
}

// zlib 展開。宣言された長さを超えた分は捨てる（展開爆弾への備え）。
async function inflate(data, limit, warnings) {
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  // 書き込み側の失敗は読み取り側のエラーとして現れるので、ここでは握りつぶす。
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});

  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > limit) {
        chunks.push(value.subarray(0, limit - total));
        total = limit;
        warnings.push('decompressed data exceeds FileLength; the rest is ignored');
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } catch (e) {
    throw new SWFError(`zlib: ${e.message}`);
  }

  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

// r の現在位置から End タグまで読む。base は r の先頭が（展開後の）ファイルの何バイト目かを表す。
function readTags(r, base, warnings, inSprite) {
  const tags = [];
  for (;;) {
    const offset = base + r.pos;
    if (r.remaining < 2) {
      warnings.push(`End tag is missing (data ends at offset ${offset})`);
      break;
    }
    const codeAndLength = r.u16();
    const code = codeAndLength >> 6;
    let length = codeAndLength & 0x3f;
    if (length === 0x3f) {
      if (r.remaining < 4) {
        warnings.push(`tag header at offset ${offset} is truncated`);
        break;
      }
      length = r.u32();
    }
    if (length > r.remaining) {
      warnings.push(`tag ${code} at offset ${offset} has length ${length} but only ${r.remaining} bytes remain`);
      break;
    }
    const bodyOffset = base + r.pos;
    const body = r.bytesView(length);
    const tag = { code, name: tagNames[code] ?? null, offset, length, body };

    if (code === TAG_DEFINE_SPRITE) {
      // スプライトの中にスプライト定義は置けない（仕様 13 章）。入れ子は展開しないので再帰は 1 段で止まる。
      if (inSprite) {
        warnings.push(`DefineSprite inside a sprite at offset ${offset} is not expanded`);
      } else if (length < 4) {
        warnings.push(`DefineSprite at offset ${offset} is too short`);
      } else {
        const sr = new Reader(body);
        tag.spriteId = sr.u16();
        tag.frameCount = sr.u16();
        tag.tags = readTags(sr, bodyOffset, warnings, true);
      }
    }

    tags.push(tag);
    if (code === TAG_END) {
      if (r.remaining > 0) warnings.push(`${r.remaining} bytes follow the End tag at offset ${offset}`);
      break;
    }
  }
  return tags;
}
