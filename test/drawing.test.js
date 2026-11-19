// スクリプトの描画 API（player/drawing.js）。グラデーションの塗りと、塗りを閉じる辺の線の規則は、実機の画面（test/as/gradient*.as、
// test/as3/gradient*.as、test/as/drawclose.as）で確かめた。画面の比較は手作業なので、規則をここで固定する。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Drawing, gradientStyle } from '../src/player/drawing.js';

const RED = { r: 255, g: 0, b: 0, a: 255 }, GREEN = { r: 0, g: 255, b: 0, a: 255 }, BLUE = { r: 0, g: 0, b: 255, a: 255 };
const M = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const make = (over = {}) => gradientStyle({ type: 'linear', colors: [RED, GREEN, BLUE], ratios: [0, 128, 255], matrix: M, ...over });

test('gradientStyle: 実機が塗らない引数は null', () => {
  assert.equal(make({ type: 'bogus' }), null);
  assert.equal(make({ type: 'LINEAR' }), null); // 大文字と小文字を区別する
  assert.equal(make({ ratios: [0, 128] }), null); // 色と ratios の数が合わない
  assert.equal(make({ ratios: [0, 300, 255] }), null); // 0〜255 の外
  assert.equal(make({ ratios: [-5, 128, 255] }), null);
  assert.equal(make({ ratios: [0, NaN, 255] }), null);
});

test('gradientStyle: 色が無ければ黒、ratios が逆向きなら最初の色の単色', () => {
  assert.deepEqual(make({ colors: [], ratios: [] }), { type: 'solid', color: { r: 0, g: 0, b: 0, a: 255 } });
  assert.deepEqual(make({ ratios: [255, 128, 0] }), { type: 'solid', color: RED });
});

test('gradientStyle: 色は 15 まで、焦点は放射だけで -1〜1 に収める', () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ r: i, g: 0, b: 0, a: 255 }));
  assert.equal(make({ colors: many, ratios: many.map((_, i) => i * 16) }).stops.length, 15);
  assert.equal(make({ type: 'radial', focal: 2 }).focal, 1);
  assert.equal(make({ type: 'radial', focal: -0.5 }).focal, -0.5);
  assert.equal(make({ focal: 0.8 }).focal, 0);
  const style = make({ spread: 'reflect', linearRGB: true });
  assert.deepEqual([style.type, style.spread, style.linearRGB, style.matrix], ['linear', 'reflect', true, M]);
});

const triangle = (d, close) => {
  d.moveTo(200, 200);
  d.lineTo(1800, 200);
  d.lineTo(1000, 1800);
  close?.();
};
const strokes = (d) => d.paths().filter((op) => op.kind === 'stroke').map((op) => op.path.map((c) => c.join(' ')).join(' '));
const line = (width = 80, color = RED) => ({ width, color });

test('塗りを閉じる辺にも、線を引いていれば線を引く', () => {
  for (const close of [(d) => d.endFill(), () => {}]) { // endFill しなくても、描き終わりで閉じる
    const d = new Drawing();
    d.lineStyle(80, RED);
    d.beginFill(GREEN);
    triangle(d, () => close(d));
    assert.deepEqual(strokes(d), ['M 200 200 L 1800 200 L 1000 1800 L 200 200']);
  }
});

test('線を引いていなければ、閉じる辺に線は無い。閉じる時点の線スタイルが使われる', () => {
  const none = new Drawing();
  none.beginFill(GREEN);
  triangle(none, () => none.endFill());
  assert.deepEqual(strokes(none), []);

  const late = new Drawing(); // 塗りを始めた後に線を引き始めた
  late.beginFill(GREEN);
  late.moveTo(200, 200);
  late.lineTo(1800, 200);
  late.lineStyle(80, RED);
  late.lineTo(1000, 1800);
  assert.deepEqual(strokes(late), ['M 1800 200 L 1000 1800 L 200 200']);

  const off = new Drawing(); // 閉じる前に線を止めた
  off.lineStyle(80, RED);
  off.beginFill(GREEN);
  off.moveTo(200, 200);
  off.lineTo(1800, 200);
  off.lineStyle(undefined);
  off.lineTo(1000, 1800);
  off.endFill();
  assert.deepEqual(strokes(off), ['M 200 200 L 1800 200']);
});

test('moveTo と次の beginFill でも、部分パスを閉じる。塗りのない線は閉じない', () => {
  const d = new Drawing();
  d.lineStyle(80, RED);
  d.beginFill(GREEN);
  d.moveTo(0, 0);
  d.lineTo(100, 0);
  d.lineTo(0, 100);
  d.moveTo(500, 500); // 1 つ目の部分パスを閉じる
  d.lineTo(600, 500);
  d.lineTo(500, 600);
  d.beginFill(BLUE); // 2 つ目を閉じる
  assert.deepEqual(strokes(d), ['M 0 0 L 100 0 L 0 100 L 0 0', 'M 500 500 L 600 500 L 500 600 L 500 500']);

  const open = new Drawing();
  open.lineStyle(80, RED);
  open.moveTo(0, 0);
  open.lineTo(100, 0);
  open.lineTo(0, 100);
  assert.deepEqual(strokes(open), ['M 0 0 L 100 0 L 0 100']);
});

test('paths() は、描き終わりの閉じる辺で状態を変えない（続けて描ける）', () => {
  const d = new Drawing();
  d.lineStyle(80, RED);
  d.beginFill(GREEN);
  triangle(d);
  assert.deepEqual(strokes(d), ['M 200 200 L 1800 200 L 1000 1800 L 200 200']);
  d.lineTo(1000, 2400);
  assert.deepEqual(strokes(d), ['M 200 200 L 1800 200 L 1000 1800 L 1000 2400 L 200 200']);
});

test('beginStyle: グラデーションの塗りが図形の塗りになる', () => {
  const d = new Drawing();
  d.beginStyle(make());
  triangle(d, () => d.endFill());
  const [fill] = d.paths();
  assert.deepEqual([fill.kind, fill.style.type, fill.style.stops.length], ['fill', 'linear', 3]);
  const none = new Drawing();
  none.beginStyle(null);
  triangle(none, () => none.endFill());
  assert.deepEqual(none.paths(), []);
});

test('lineOptions: 端・角・拡大縮小の名前（実機の画面で確かめた）', async () => {
  const { lineOptions } = await import('../src/player/drawing.js');
  assert.deepEqual(lineOptions({}), { startCap: 'round', endCap: 'round', join: 'round', pixelHinting: false, noHScale: false, noVScale: false });
  const l = lineOptions({ caps: 'none', joints: 'miter', miterLimit: 1000, scaleMode: 'none', pixelHinting: true });
  assert.deepEqual([l.startCap, l.endCap, l.join, l.miterLimit, l.noHScale, l.noVScale, l.pixelHinting], ['butt', 'butt', 'miter', 255, true, true, true]);
  assert.equal(lineOptions({ caps: 'square', joints: 'bevel' }).startCap, 'square');
  assert.equal(lineOptions({ caps: 'bogus', joints: 'bogus' }).join, 'round'); // 知らない名前は丸
  const v = lineOptions({ scaleMode: 'vertical' }), h = lineOptions({ scaleMode: 'horizontal' });
  assert.deepEqual([v.noHScale, v.noVScale, h.noHScale, h.noVScale], [false, true, true, false]);
});
