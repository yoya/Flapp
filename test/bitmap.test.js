import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';
import { parseBitmap } from '../src/swf/bitmap.js';
import { parseSWF } from '../src/swf/parse.js';
import { SWFError } from '../src/swf/reader.js';
import { DefineBitsLossless, End, ShowFrame, fixtures, swf, tag, u16, u32 } from '../tools/mkfixtures.js';

const photo = new Uint8Array(readFileSync(new URL('../tools/assets/photo.jpg', import.meta.url)));
const bitmapsOf = async (name) => {
  const tags = (await parseSWF(fixtures[name])).tags;
  const tables = tags.find((t) => t.code === 8)?.body;
  const out = {};
  for (const t of tags) {
    if ([6, 20, 21, 35, 36, 90].includes(t.code)) {
      const b = await parseBitmap(t, tables);
      out[b.id] = b;
    }
  }
  return out;
};
const pixel = (b, x, y) => [...b.rgba.subarray((y * b.width + x) * 4, (y * b.width + x) * 4 + 4)];

test('可逆ビットマップの各形式', async () => {
  const b = await bitmapsOf('bitmap-lossless');
  assert.deepEqual([b[1].width, b[1].height], [13, 9]);
  // 24 ビット
  assert.deepEqual(pixel(b[1], 5, 0), [100, 0, 255, 255]);
  assert.deepEqual(pixel(b[1], 12, 8), [240, 224, 0, 255]);
  // カラーテーブル（13 画素の行は 16 バイトに詰められている）
  assert.deepEqual(pixel(b[2], 1, 0), [220, 0, 0, 255]);
  assert.deepEqual(pixel(b[2], 0, 1), [0, 140, 0, 255]);
  assert.deepEqual(pixel(b[2], 12, 8), [255, 255, 255, 255]);
  // 15 ビット（5 ビットの値を 8 ビットへ広げる）
  assert.deepEqual(pixel(b[3], 5, 0), [82, 255, 41, 255]);
  // アルファつき 32 ビット（乗算済みで入っている色を戻す）
  assert.deepEqual(pixel(b[4], 0, 0), [0, 0, 0, 0]);
  const p = pixel(b[4], 5, 3);
  assert.equal(p[3], 105);
  assert.equal(p[0], 255);
  assert.ok(Math.abs(p[1] - 84) <= 1 && p[2] === 0);
  // アルファつきカラーテーブル
  assert.deepEqual(pixel(b[5], 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(b[5], 1, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(b[5], 3, 0), [255, 255, 0, 64]);
});

test('JPEG は 1 本のストリームに正規化する', async () => {
  const b = await bitmapsOf('bitmap-jpeg');
  // 余分なヘッダ (FF D9 FF D8) つきの JPEG2 も、JPEGTables と分かれた DefineBits も、元の JPEG に戻る
  assert.deepEqual(b[1].encoded, { bytes: photo, type: 'image/jpeg' });
  // 表が先に来るので並びは変わるが、長さと符号化データは同じ
  assert.equal(b[2].encoded.bytes.length, photo.length);
  assert.deepEqual([...b[2].encoded.bytes.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xc4]); // SOI の直後がハフマン表
  assert.deepEqual(b[2].encoded.bytes.subarray(-200), photo.subarray(-200));
  assert.deepEqual([b[1].width, b[1].height], [48, 32]);
  // JPEG3 のアルファは 1 画素 1 バイト
  assert.equal(b[3].alpha.length, 48 * 32);
  assert.deepEqual([b[3].alpha[0], b[3].alpha[47], b[3].alpha[48]], [0, 255, 0]);
  // JPEG2 に入った PNG
  assert.equal(b[4].encoded.type, 'image/png');
  assert.deepEqual([b[4].width, b[4].height, b[4].alpha], [48, 32, undefined]);
});

test('不正なビットマップは SWFError', async () => {
  const lossless = (fields) => {
    const t = DefineBitsLossless({ id: 1, format: 5, width: 2, height: 2, pixel: () => [1, 2, 3], ...fields });
    return { code: 20, body: Uint8Array.from(t.slice(6)) };
  };
  await assert.rejects(parseBitmap(lossless({ width: 0 })), /bitmap size 0x2/);
  await assert.rejects(parseBitmap(lossless({ width: 2 }), undefined, 3), /pixel budget/);
  const badFormat = lossless({});
  badFormat.body[2] = 9;
  await assert.rejects(parseBitmap(badFormat), /unknown bitmap format 9/);
  const badZlib = lossless({});
  badZlib.body[7] = 0xff;
  await assert.rejects(parseBitmap(badZlib), /zlib/);

  const jpeg = (bytes) => ({ code: 21, body: Uint8Array.from([...u16(1), ...bytes]) });
  await assert.rejects(parseBitmap(jpeg([1, 2, 3, 4])), /JPEG data is corrupted/);
  await assert.rejects(parseBitmap(jpeg([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 1, 2])), /JPEG data is truncated/);
  await assert.rejects(parseBitmap(jpeg([0xff, 0xd8, 0xff, 0xd9])), /JPEG data has no image/);
  await assert.rejects(parseBitmap({ code: 9, body: new Uint8Array(4) }), SWFError);
});

test('画素データが足りない部分は 0 として読む', async () => {
  // 2x2 と宣言して 1 画素分しか入れない
  const { deflateSync } = await import('node:zlib');
  const body = Uint8Array.from([...u16(1), 5, ...u16(2), ...u16(2), ...deflateSync(Uint8Array.of(0xff, 9, 8, 7))]);
  const b = await parseBitmap({ code: 20, body });
  assert.deepEqual([...b.rgba], [9, 8, 7, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
});

test('全ビットマップの画素数の合計に上限がある', async () => {
  const bytes = swf({
    version: 8,
    tags: [
      DefineBitsLossless({ id: 1, format: 5, width: 10, height: 10, pixel: () => [1, 2, 3] }),
      DefineBitsLossless({ id: 2, format: 5, width: 10, height: 10, pixel: () => [1, 2, 3] }),
      tag(20, [...u16(3), 5, ...u16(1), ...u16(1), 1, 2, 3], true), // zlib として読めない
      ShowFrame(), End(),
    ],
  });
  const movie = await Movie.load(bytes, { maxBitmapPixels: 150 });
  assert.equal(movie.dictionary.get(1).rgba.length, 400);
  assert.equal(movie.dictionary.get(2).rgba, undefined);
  assert.equal(movie.warnings.length, 2);
  assert.match(movie.warnings[0], /DefineBitsLossless.*pixel budget/);
  assert.match(movie.warnings[1], /DefineBitsLossless.*zlib/);
});

test('perlinNoise と pixelDissolve: 値は実機と同じではないが、範囲・成分の選び方・繰り返しの性質を満たす', async () => {
  const { bitmapOps } = await import('../src/player/bitmapops.js');
  const ops = bitmapOps();
  const b = ops.create(32, 32, true);
  ops.perlinNoise(b, 16, 16, 2, 7, true, true, 1 | 8, false, null);
  const px = (x, y) => [...b.rgba.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
  const values = new Set();
  for (let i = 0; i < b.rgba.length; i += 4) { values.add(b.rgba[i]); assert.equal(b.rgba[i + 1], 0); assert.equal(b.rgba[i + 2], 0); }
  assert.ok(values.size > 20); // なめらかに変わる
  assert.ok(Math.abs(px(0, 5)[0] - px(31, 5)[0]) < 40); // stitch: 左右の端がつながる
  const c = ops.create(32, 32, false);
  ops.perlinNoise(c, 16, 16, 1, 7, false, false, 7, true, null);
  for (let i = 0; i < c.rgba.length; i += 4) assert.ok(c.rgba[i] === c.rgba[i + 1] && c.rgba[i + 1] === c.rgba[i + 2] && c.rgba[i + 3] === 255); // 灰色
  // pixelDissolve: 数だけ写す（同じビットマップなら色で埋める）。
  const d = ops.create(8, 8, true), s = ops.create(8, 8, true);
  ops.fill(s, ops.whole(s), 0xffff0000);
  const nextSeed = ops.pixelDissolve(d, s, { x: 0, y: 0, width: 8, height: 8 }, { x: 0, y: 0 }, 1, 20, 0);
  let red = 0;
  for (let i = 0; i < d.rgba.length; i += 4) if (d.rgba[i + 3] === 255) red++;
  assert.ok(red > 10 && red <= 20);
  assert.notEqual(nextSeed, 1);
});
