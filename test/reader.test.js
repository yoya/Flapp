import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reader, SWFError } from '../src/swf/reader.js';
import { matrix } from '../tools/mkfixtures.js';

const reader = (...bytes) => new Reader(Uint8Array.from(bytes));

test('整数はリトルエンディアン', () => {
  const r = reader(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0xff, 0xfe, 0xff, 0xff, 0xff, 0xff, 0x80);
  assert.equal(r.u8(), 0x01);
  assert.equal(r.u16(), 0x0302);
  assert.equal(r.u32(), 0x07060504);
  assert.equal(r.s8(), -1);
  assert.equal(r.s16(), -2);
  assert.equal(r.s32(), -0x7f000001);
  assert.equal(r.remaining, 0);
});

test('固定小数', () => {
  assert.equal(reader(0x00, 0x80, 0x07, 0x00).fixed(), 7.5); // 仕様 1 章の例
  assert.equal(reader(0x00, 0x80, 0xff, 0xff).fixed(), -0.5);
  assert.equal(reader(0x80, 0x0c).fixed8(), 12.5);
});

test('EncodedU32', () => {
  assert.equal(reader(0x7f).encodedU32(), 127);
  assert.equal(reader(0x80, 0x01).encodedU32(), 128);
  assert.equal(reader(0xff, 0xff, 0xff, 0xff, 0x0f).encodedU32(), 0xffffffff);
  const r = reader(0x81, 0x80, 0x80, 0x80, 0x80, 0x55); // 5 バイト目の継続ビットは見ない
  assert.equal(r.encodedU32(), 1);
  assert.equal(r.u8(), 0x55);
});

test('ビット値は上位ビットから読み、バイト境界をまたぐ', () => {
  const r = reader(0b10110011, 0b01010101, 0xff);
  assert.equal(r.ub(3), 0b101);
  assert.equal(r.ub(7), 0b1001101);
  assert.equal(r.sb(4), 0b0101);
  assert.equal(r.sb(2), 0b01);
  assert.equal(r.sb(3), -1);
  assert.equal(r.ub(0), 0);
});

test('32 ビット幅のビット値', () => {
  assert.equal(reader(0xff, 0xff, 0xff, 0xff).ub(32), 0xffffffff);
  assert.equal(reader(0xff, 0xff, 0xff, 0xff).sb(32), -1);
  assert.equal(reader(0x80, 0x00, 0x00, 0x00).sb(32), -(2 ** 31));
  assert.equal(reader(0x00, 0x01, 0x80, 0x00).fb(32), 1.5);
});

test('ビット値の後の整数は次のバイト境界から読む', () => {
  const r = reader(0b10000000, 0x34, 0x12);
  assert.equal(r.ub(1), 1);
  assert.equal(r.remaining, 2);
  assert.equal(r.u16(), 0x1234);
});

test('RECT', () => {
  // 240x160 px (4800x3200 twips)、Nbits=14
  const r = reader(0x70, 0x00, 0x09, 0x60, 0x00, 0x00, 0x64, 0x00, 0xaa);
  assert.deepEqual(r.rect(), { xmin: 0, xmax: 4800, ymin: 0, ymax: 3200 });
  assert.equal(r.u8(), 0xaa);
  // 負の座標
  assert.deepEqual(reader(0b00011_111, 0b001_110_01, 0b0_0000000).rect(), { xmin: -1, xmax: 1, ymin: -2, ymax: 2 });
});

test('部分ビューはその範囲の中だけを読む', () => {
  const whole = Uint8Array.from([0xaa, 0x01, 0x02, 0xbb]);
  const r = new Reader(whole.subarray(1, 3));
  assert.equal(r.u16(), 0x0201);
  assert.throws(() => r.u8(), SWFError);
});

test('範囲外の読み取りは SWFError', () => {
  assert.throws(() => reader(0x01).u16(), SWFError);
  assert.throws(() => reader(0x01).ub(9), SWFError);
  assert.throws(() => reader(0x01).ub(33), SWFError);
  assert.throws(() => reader(0x01).bytesView(2), SWFError);
  assert.throws(() => reader(0x01).bytesView(-1), SWFError);
  assert.throws(() => reader(0xf8).rect(), SWFError); // Nbits=31 だがデータが無い
  const r = reader(0x01, 0x02);
  r.ub(1);
  assert.throws(() => r.u16(), SWFError); // 揃えると 1 バイトしか残らない
});

test('STRING', () => {
  const r = reader(0x61, 0x62, 0x00, 0xe3, 0x81, 0x82, 0x00, 0x7f);
  assert.equal(r.string(), 'ab');
  assert.equal(r.string(), 'あ');
  assert.equal(r.u8(), 0x7f);
  assert.throws(() => reader(0x61, 0x62).string(), SWFError); // 終端が無い
});

test('RGB / RGBA', () => {
  const r = reader(1, 2, 3, 4, 5, 6, 7);
  assert.deepEqual(r.rgb(), { r: 1, g: 2, b: 3, a: 255 });
  assert.deepEqual(r.rgba(), { r: 4, g: 5, b: 6, a: 7 });
});

test('MATRIX', () => {
  // 何も持たない行列（平行移動 0 ビット）
  assert.deepEqual(reader(0x00).matrix(), { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  // 拡大 0.5 / 2、回転 0.25 / -0.25、移動 (1200, -1700)
  const r = new Reader(Uint8Array.from([...matrix({ a: 0.5, d: 2, b: 0.25, c: -0.25, tx: 1200, ty: -1700 }), 0xaa]));
  assert.deepEqual(r.matrix(), { a: 0.5, b: 0.25, c: -0.25, d: 2, tx: 1200, ty: -1700 });
  assert.equal(r.u8(), 0xaa); // 行列の後はバイト境界に揃う
});

test('CXFORM', () => {
  // HasAdd=1, HasMult=1, Nbits=9: 乗算 (128, 0, -256)、加算 (0, 64, -255)。アルファは既定値のまま
  const bits = '1' + '1' + '1001' +
    '010000000' + '000000000' + '100000000' +
    '000000000' + '001000000' + '100000001';
  const bytes = (bits + '0000000').match(/.{8}/g).map((b) => parseInt(b, 2));
  assert.deepEqual(new Reader(Uint8Array.from(bytes)).cxform(false), {
    rm: 128, gm: 0, bm: -256, am: 256, ra: 0, ga: 64, ba: -255, aa: 0,
  });
  // アルファつき: HasAdd=0, HasMult=1, Nbits=10: (256, 256, 256, 128)
  const alpha = '0' + '1' + '1010' + '0100000000'.repeat(3) + '0010000000';
  const abytes = (alpha + '0000000').match(/.{8}/g).map((b) => parseInt(b, 2));
  assert.deepEqual(new Reader(Uint8Array.from(abytes)).cxform(true), {
    rm: 256, gm: 256, bm: 256, am: 128, ra: 0, ga: 0, ba: 0, aa: 0,
  });
});
