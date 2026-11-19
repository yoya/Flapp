import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFilters, boxBlur } from '../src/render/filters.js';

const near = (actual, expected) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 0.01, `[${i}] ${v} ≈ ${expected[i]}`));
// w x h の透明な画像に、指定の画素だけ色を置く
const image = (w, h, dots) => {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (const [x, y, ...color] of dots) rgba.set(color, (y * w + x) * 4);
  return rgba;
};
const at = (rgba, w, x, y) => [...rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

test('箱形ぼかし', () => {
  let buf = Float32Array.of(0, 0, 255, 0, 0);
  boxBlur(buf, 5, 1, 1, 3, 1, 1);
  near(buf, [0, 85, 85, 85, 0]);

  // 幅 2 は中心 1 画素と左右の半画素ずつ
  buf = Float32Array.of(0, 0, 255, 0, 0);
  boxBlur(buf, 5, 1, 1, 2, 1, 1);
  near(buf, [0, 63.75, 127.5, 63.75, 0]);

  // 2 回かけると三角形の分布になる。範囲外は透明として扱うので端は減る
  buf = Float32Array.of(0, 0, 90, 0, 0);
  boxBlur(buf, 5, 1, 1, 3, 1, 2);
  near(buf, [10, 20, 30, 20, 10]);
  buf = Float32Array.of(90, 0, 0);
  boxBlur(buf, 3, 1, 1, 3, 1, 1);
  near(buf, [30, 30, 0]);

  // 縦方向、2 チャンネル
  buf = Float32Array.of(0, 9, 30, 9, 0, 9);
  boxBlur(buf, 1, 3, 2, 1, 3, 1);
  near(buf, [10, 6, 10, 9, 10, 6]);

  // 幅 1 以下は何もしない
  buf = Float32Array.of(1, 2, 3);
  boxBlur(buf, 3, 1, 1, 1, 0, 5);
  near(buf, [1, 2, 3]);
});

test('ぼかしフィルタは色とアルファを一緒に広げる', () => {
  const src = image(3, 1, [[1, 0, 255, 0, 0, 255]]);
  const { rgba, unsupported } = applyFilters(src, 3, 1, [{ type: 'blur', blurX: 3, blurY: 1, passes: 1 }], 1);
  assert.deepEqual(unsupported, []);
  for (let x = 0; x < 3; x++) assert.deepEqual(at(rgba, 3, x, 0), [255, 0, 0, 85]);
});

test('影: ずらして色を付け、元の絵の下に置く', () => {
  const src = image(4, 3, [[1, 1, 255, 255, 255, 255]]);
  const shadow = { type: 'dropShadow', color: { r: 0, g: 0, b: 0, a: 255 }, blurX: 1, blurY: 1, angle: 0, distance: 1, strength: 1, inner: false, knockout: false, compositeSource: true, passes: 1 };
  let out = applyFilters(src, 4, 3, [shadow], 1).rgba;
  assert.deepEqual(at(out, 4, 1, 1), [255, 255, 255, 255]); // 元の絵
  assert.deepEqual(at(out, 4, 2, 1), [0, 0, 0, 255]); // 右へ 1 画素ずれた影
  assert.deepEqual(at(out, 4, 0, 1), [0, 0, 0, 0]);

  // 倍率 2 では距離も 2 倍
  out = applyFilters(src, 4, 3, [shadow], 2).rgba;
  assert.deepEqual(at(out, 4, 3, 1), [0, 0, 0, 255]);
  // 角度 90 度は下向き
  out = applyFilters(src, 4, 3, [{ ...shadow, angle: Math.PI / 2 }], 1).rgba;
  assert.deepEqual(at(out, 4, 1, 2), [0, 0, 0, 255]);
  // 元の絵を描かない
  out = applyFilters(src, 4, 3, [{ ...shadow, compositeSource: false }], 1).rgba;
  assert.deepEqual(at(out, 4, 1, 1), [0, 0, 0, 0]);
  assert.deepEqual(at(out, 4, 2, 1), [0, 0, 0, 255]);
  // 色のアルファと強さ
  out = applyFilters(src, 4, 3, [{ ...shadow, color: { r: 255, g: 0, b: 0, a: 128 }, strength: 0.5 }], 1).rgba;
  assert.deepEqual(at(out, 4, 2, 1), [255, 0, 0, 64]);
});

test('光彩: ノックアウトと内側', () => {
  const src = image(3, 1, [[1, 0, 0, 255, 0, 255]]);
  const glow = { type: 'glow', color: { r: 255, g: 0, b: 0, a: 255 }, blurX: 3, blurY: 1, strength: 3, inner: false, knockout: false, compositeSource: true, passes: 1 };
  let out = applyFilters(src, 3, 1, [glow], 1).rgba;
  assert.deepEqual([at(out, 3, 0, 0), at(out, 3, 1, 0), at(out, 3, 2, 0)], [[255, 0, 0, 255], [0, 255, 0, 255], [255, 0, 0, 255]]);
  out = applyFilters(src, 3, 1, [{ ...glow, knockout: true }], 1).rgba;
  assert.deepEqual(at(out, 3, 1, 0), [0, 0, 0, 0]); // 元の絵の部分は抜ける

  // 内側の光彩は絵の中にだけ出て、絵の上に重なる
  out = applyFilters(src, 3, 1, [{ ...glow, inner: true, strength: 0.75 }], 1).rgba;
  assert.deepEqual(at(out, 3, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(out, 3, 1, 0), [128, 128, 0, 255]); // 外側 2 画素ぶん (2/3) × 0.75 = 0.5 の赤が緑に重なる
});

test('色行列と畳み込み、未対応フィルタ', () => {
  const src = image(1, 1, [[0, 0, 200, 100, 50, 255]]);
  // 赤 ← 緑、緑 ← 青、青 ← 赤、アルファ半分
  const swap = [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0.5, 0];
  let result = applyFilters(src, 1, 1, [{ type: 'colorMatrix', matrix: swap }], 1);
  assert.deepEqual(at(result.rgba, 1, 0, 0), [100, 50, 200, 128]);
  // 加算項と上限
  const add = [1, 0, 0, 0, 100, 0, 1, 0, 0, -200, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  result = applyFilters(src, 1, 1, [{ type: 'colorMatrix', matrix: add }], 1);
  assert.deepEqual(at(result.rgba, 1, 0, 0), [255, 0, 50, 255]);

  // 畳み込み: 3 × 1 の行列で、左右の画素の差を取る。範囲の外は defaultColor（clamp なし）か端の画素（clamp）。
  const row = image(3, 1, [[0, 0, 10, 20, 30, 255], [1, 0, 50, 60, 70, 255], [2, 0, 90, 100, 110, 255]]);
  const conv = { type: 'convolution', matrixX: 3, matrixY: 1, matrix: [-1, 0, 1], divisor: 1, bias: 0, defaultColor: { r: 0, g: 0, b: 0, a: 255 }, clamp: false, preserveAlpha: true };
  result = applyFilters(row, 3, 1, [conv], 1);
  assert.deepEqual(at(result.rgba, 3, 0, 0), [50, 60, 70, 255]);
  assert.deepEqual(at(result.rgba, 3, 1, 0), [80, 80, 80, 255]);
  assert.deepEqual(at(result.rgba, 3, 2, 0), [0, 0, 0, 255]); // 0 - 90 は 0 で止まる
  result = applyFilters(row, 3, 1, [{ ...conv, clamp: true, divisor: 2, bias: 10 }], 1);
  assert.deepEqual(at(result.rgba, 3, 0, 0), [30, 30, 30, 255]);

  result = applyFilters(src, 1, 1, [{ type: 'shader' }], 1);
  assert.deepEqual(result.unsupported, ['shader']);
  assert.deepEqual(at(result.rgba, 1, 0, 0), [200, 100, 50, 255]); // 絵はそのまま
});
