import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lzmaDecode } from '../src/swf/lzma.js';
import { parseSWF } from '../src/swf/parse.js';
import { SWFError } from '../src/swf/reader.js';
import { fixtures, swf, tag, u16, u32 } from '../tools/mkfixtures.js';

const zws = new Uint8Array(readFileSync(new URL('fixtures/zws-hello.swf', import.meta.url)));
const summary = (tags) => tags.map((t) => [t.offset, t.name, t.length]);
const setLength = (bytes, length) => {
  const copy = bytes.slice();
  new DataView(copy.buffer).setUint32(4, length, true);
  return copy;
};

test('無圧縮 SWF のヘッダとタグ列', async () => {
  const s = await parseSWF(fixtures['trace-hello']);
  assert.equal(s.signature, 'FWS');
  assert.equal(s.version, 8);
  assert.equal(s.fileLength, 49);
  assert.deepEqual(s.frameSize, { xmin: 0, xmax: 4800, ymin: 0, ymax: 3200 });
  assert.equal(s.frameRate, 12);
  assert.equal(s.frameCount, 1);
  assert.deepEqual(summary(s.tags), [
    [20, 'SetBackgroundColor', 3],
    [25, 'DoAction', 18],
    [45, 'ShowFrame', 0],
    [47, 'End', 0],
  ]);
  assert.deepEqual([...s.tags[0].body], [0x33, 0x66, 0x99]);
  assert.deepEqual(s.warnings, []);
});

test('ArrayBuffer も受け付ける', async () => {
  const s = await parseSWF(fixtures['trace-hello'].slice().buffer);
  assert.equal(s.tags.length, 4);
});

test('zlib 圧縮 (CWS)', async () => {
  const s = await parseSWF(fixtures['cws-hello']);
  assert.equal(s.signature, 'CWS');
  assert.deepEqual(summary(s.tags), [
    [20, 'SetBackgroundColor', 3],
    [25, 'DoAction', 16],
    [43, 'ShowFrame', 0],
    [45, 'End', 0],
  ]);
  assert.deepEqual(s.warnings, []);
});

test('LZMA 圧縮 (ZWS) は無圧縮版と同じ内容になる', async () => {
  const a = await parseSWF(zws);
  const b = await parseSWF(fixtures['lzma-src']);
  assert.equal(a.signature, 'ZWS');
  assert.equal(a.version, 13);
  assert.deepEqual(a.warnings, []);
  assert.deepEqual(summary(a.tags), summary(b.tags));
  assert.equal(a.tags[1].length, 4102); // 長いタグヘッダ
  a.tags.forEach((t, i) => assert.deepEqual(t.body, b.tags[i].body));
});

test('DefineSprite の中のタグ列', async () => {
  const s = await parseSWF(fixtures['sprite-hello']);
  const sprite = s.tags[1];
  assert.equal(sprite.name, 'DefineSprite');
  assert.equal(sprite.spriteId, 1);
  assert.equal(sprite.frameCount, 1);
  assert.deepEqual(summary(sprite.tags), [
    [31, 'DoAction', 19],
    [52, 'ShowFrame', 0],
    [54, 'End', 0],
  ]);
  assert.deepEqual(summary(s.tags.slice(2)), [
    [56, 'PlaceObject2', 5],
    [63, 'ShowFrame', 0],
    [65, 'End', 0],
  ]);
  assert.deepEqual(s.warnings, []);
});

test('未知のタグ番号は name が null', async () => {
  const s = await parseSWF(swf({ version: 8, tags: [tag(700, [1, 2]), tag(0)] }));
  assert.deepEqual(summary(s.tags), [[20, null, 2], [24, 'End', 0]]);
  assert.equal(s.tags[0].code, 700);
});

test('ヘッダが不正なら SWFError', async () => {
  const good = fixtures['trace-hello'];
  const patched = (i, v) => { const c = good.slice(); c[i] = v; return c; };
  await assert.rejects(parseSWF(good.subarray(0, 7)), SWFError);
  await assert.rejects(parseSWF(patched(0, 0x58)), SWFError); // XWS
  await assert.rejects(parseSWF(patched(2, 0x58)), SWFError); // FWX
  await assert.rejects(parseSWF(setLength(good, 7)), SWFError);
  await assert.rejects(parseSWF(setLength(good, 9)), SWFError); // RECT が読めない
  await assert.rejects(parseSWF(good, { maxLength: 48 }), /exceeds the limit/);
});

test('タグ列が壊れていても読めた範囲を返す', async () => {
  // 長さが残りを超えるタグ
  let s = await parseSWF(swf({ version: 8, tags: [tag(1), [...u16((9 << 6) | 0x3f), ...u32(1000), 1, 2, 3]] }));
  assert.deepEqual(summary(s.tags), [[20, 'ShowFrame', 0]]);
  assert.match(s.warnings[0], /tag 9 at offset 22 has length 1000 but only 3 bytes remain/);

  // 長さ 0xFFFFFFFF（符号付きなら負）
  s = await parseSWF(swf({ version: 8, tags: [[...u16((9 << 6) | 0x3f), 0xff, 0xff, 0xff, 0xff]] }));
  assert.deepEqual(s.tags, []);
  assert.match(s.warnings[0], /length 4294967295/);

  // End が無い
  s = await parseSWF(swf({ version: 8, tags: [tag(1)] }));
  assert.equal(s.tags.length, 1);
  assert.match(s.warnings[0], /End tag is missing/);

  // 長いタグヘッダの途中で切れている
  s = await parseSWF(swf({ version: 8, tags: [[...u16((9 << 6) | 0x3f), 1, 2]] }));
  assert.match(s.warnings[0], /truncated/);

  // End の後ろにデータがある
  s = await parseSWF(swf({ version: 8, tags: [tag(0), tag(1)] }));
  assert.equal(s.tags.length, 1);
  assert.match(s.warnings[0], /2 bytes follow the End tag/);

  // ファイルが FileLength より短い
  s = await parseSWF(fixtures['trace-hello'].subarray(0, 30));
  assert.deepEqual(summary(s.tags), [[20, 'SetBackgroundColor', 3]]);
  assert.match(s.warnings[0], /19 bytes shorter than FileLength/);
});

test('スプライト内の DefineSprite は展開しない', async () => {
  const inner = tag(39, [...u16(2), ...u16(1), ...tag(0)]);
  const s = await parseSWF(swf({ version: 8, tags: [tag(39, [...u16(1), ...u16(1), ...inner, ...tag(0)]), tag(0)] }));
  assert.equal(s.tags[0].tags[0].name, 'DefineSprite');
  assert.equal(s.tags[0].tags[0].tags, undefined);
  assert.match(s.warnings[0], /not expanded/);

  const short = await parseSWF(swf({ version: 8, tags: [tag(39, [1, 0]), tag(0)] }));
  assert.equal(short.tags[0].tags, undefined);
  assert.match(short.warnings[0], /too short/);
});

test('展開結果は FileLength を超えない', async () => {
  // 展開後 28 バイトと偽る: RECT 8 + 4 + SetBackgroundColor 5 + 残り 3 バイト
  for (const bytes of [fixtures['cws-hello'], zws]) {
    const s = await parseSWF(setLength(bytes, 28));
    assert.deepEqual(summary(s.tags), [[20, 'SetBackgroundColor', 3]]);
    assert.ok(s.warnings.length > 0);
  }
});

test('壊れた圧縮データは SWFError', async () => {
  const cws = fixtures['cws-hello'];
  await assert.rejects(parseSWF(cws.subarray(0, 12)), SWFError);
  const badZlib = cws.slice();
  badZlib[8] = 0xff; // zlib ヘッダを壊す
  await assert.rejects(parseSWF(badZlib), SWFError);

  await assert.rejects(parseSWF(zws.subarray(0, 16)), SWFError);
  await assert.rejects(parseSWF(zws.subarray(0, 600)), /LZMA: unexpected end of data/);
  const badProps = zws.slice();
  badProps[12] = 225;
  await assert.rejects(parseSWF(badProps), /LZMA: invalid properties/);
  const badFirst = zws.slice();
  badFirst[17] = 1;
  await assert.rejects(parseSWF(badFirst), /LZMA: bad first byte/);
});

test('lzmaDecode は終端マーカーで止まる', () => {
  // 出力長を実際より大きく指定しても、マーカーまでの内容だけを返す
  const out = lzmaDecode(zws.subarray(12, 17), zws.subarray(17), 5000);
  assert.deepEqual(out, fixtures['lzma-src'].subarray(8));
});

test('zlib: 末尾の検査（Adler-32）だけが誤っていても、展開した中身は読める', async () => {
  const good = await parseSWF(readFileSync(new URL('fixtures/cws-hello.swf', import.meta.url)));
  const bad = Uint8Array.from(readFileSync(new URL('fixtures/cws-hello.swf', import.meta.url)));
  bad[bad.length - 1] ^= 0xff; // Adler-32 の最後の 1 バイト
  const movie = await parseSWF(bad);
  assert.equal(movie.tags.length, good.tags.length);
  assert.equal(movie.frameCount, good.frameCount);
});

test('zlib: 圧縮データそのものが壊れていれば、これまでどおり SWFError', async () => {
  const bad = Uint8Array.from(readFileSync(new URL('fixtures/cws-hello.swf', import.meta.url)));
  bad.fill(0xff, 10); // deflate のブロックの種類が無効になる
  await assert.rejects(parseSWF(bad), SWFError);
});
