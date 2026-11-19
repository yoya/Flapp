// スクリプトから作るフィルタ（player/filterspec.js）。プロパティの範囲と読み戻しは、AS3 の実機の trace（test/as3/filters.as）で確かめた。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FILTER_CLASS, FILTER_SPECS, coerceProp } from '../src/player/filterspec.js';

const defaults = (name) => Object.fromEntries(Object.entries(FILTER_SPECS[name].props).map(([k, p]) => [k, Array.isArray(p.def) ? [...p.def] : p.def]));
const prop = (name, key) => FILTER_SPECS[name].props[key];

test('coerceProp: 範囲と刻みは実機と同じ', () => {
  assert.equal(coerceProp(prop('DropShadowFilter', 'angle'), 400), 40);
  assert.equal(coerceProp(prop('DropShadowFilter', 'angle'), -400), -40);
  assert.equal(coerceProp(prop('DropShadowFilter', 'angle'), 720), 0);
  assert.equal(coerceProp(prop('DropShadowFilter', 'angle'), 225), 225); // ±180 には収めない
  assert.equal(coerceProp(prop('DropShadowFilter', 'distance'), 40000), 40000); // 距離は制限なし
  assert.ok(Number.isNaN(coerceProp(prop('DropShadowFilter', 'distance'), NaN)));
  assert.equal(coerceProp(prop('BlurFilter', 'blurX'), 300), 255);
  assert.equal(coerceProp(prop('BlurFilter', 'blurX'), -1), 0);
  assert.ok(Number.isNaN(coerceProp(prop('BlurFilter', 'blurX'), NaN))); // ぼかし量の NaN はそのまま
  assert.equal(coerceProp(prop('BlurFilter', 'quality'), 99), 15);
  assert.equal(coerceProp(prop('BlurFilter', 'quality'), 255.5), 15);
  assert.equal(coerceProp(prop('BlurFilter', 'quality'), NaN), 0);
  assert.equal(coerceProp(prop('DropShadowFilter', 'strength'), 1.7), 1.69921875); // 1/256 刻み
  assert.equal(coerceProp(prop('DropShadowFilter', 'strength'), 999), 255);
  assert.equal(coerceProp(prop('DropShadowFilter', 'strength'), NaN), 0);
  assert.equal(coerceProp(prop('DropShadowFilter', 'alpha'), 0.5), 127 / 255); // 1/255 刻み（切り捨て）
  assert.equal(coerceProp(prop('DropShadowFilter', 'alpha'), -3), 0);
  assert.equal(coerceProp(prop('DropShadowFilter', 'color'), 0x1ffffff), 0xffffff);
  assert.equal(coerceProp(prop('BevelFilter', 'type'), 'outer'), 'outer');
  assert.equal(coerceProp(prop('BevelFilter', 'type'), 'bogus'), 'full'); // 知らない種類は full
  assert.equal(coerceProp(prop('BevelFilter', 'type'), 'FULL'), 'full');
});

test('toDesc: 既定値から、フィルタの形式（角度はラジアン、種類は inner / onTop）', () => {
  const drop = FILTER_SPECS.DropShadowFilter.toDesc(defaults('DropShadowFilter'));
  assert.deepEqual(drop, { type: 'dropShadow', color: { r: 0, g: 0, b: 0, a: 255 }, blurX: 4, blurY: 4, angle: Math.PI / 4, distance: 4, strength: 1, inner: false, knockout: false, compositeSource: true, passes: 1 });
  assert.equal(FILTER_SPECS.DropShadowFilter.toDesc({ ...defaults('DropShadowFilter'), hideObject: true }).compositeSource, false);
  const bevel = (type) => FILTER_SPECS.BevelFilter.toDesc({ ...defaults('BevelFilter'), type });
  assert.deepEqual([bevel('inner').inner, bevel('inner').onTop, bevel('outer').inner, bevel('outer').onTop, bevel('full').inner, bevel('full').onTop], [true, false, false, false, false, true]);
  // ハイライトとシャドウの色は、フィルタの形式では実機の画面に合わせて入れ替えて持つ（実機で確認）
  const b = FILTER_SPECS.BevelFilter.toDesc({ ...defaults('BevelFilter'), highlightColor: 0xff0000, shadowColor: 0x0000ff });
  assert.deepEqual([b.shadowColor.r, b.highlightColor.b], [255, 255]);
});

test('toDesc: 行列は 20 個・matrixX × matrixY 個にそろい、グラデーションは数が合うところまで', () => {
  const cm = defaults('ColorMatrixFilter');
  cm.matrix = [1, 2, 3];
  FILTER_SPECS.ColorMatrixFilter.fix(cm);
  assert.equal(cm.matrix.length, 20);
  assert.deepEqual(cm.matrix.slice(0, 4), [1, 2, 3, 0]);
  const cv = { ...defaults('ConvolutionFilter'), matrixX: 3, matrixY: 3, matrix: [1, 2, 3] };
  FILTER_SPECS.ConvolutionFilter.fix(cv);
  assert.deepEqual(cv.matrix, [1, 2, 3, 0, 0, 0, 0, 0, 0]);
  const g = FILTER_SPECS.GradientGlowFilter.toDesc({ ...defaults('GradientGlowFilter'), colors: [0xff0000, 0x00ff00, 0x0000ff], alphas: [1, 0.5], ratios: [0, 128, 255] });
  assert.equal(g.colors.length, 2);
  assert.deepEqual(g.colors[1], { color: { r: 0, g: 255, b: 0, a: 128 }, ratio: 128 });
});

test('fromDesc: タイムラインのフィルタを読み戻せる（toDesc の逆）', () => {
  for (const name of Object.keys(FILTER_SPECS)) {
    const props = defaults(name);
    if ('colors' in props) Object.assign(props, { colors: [0xff0000, 0x0000ff], alphas: [1, 1], ratios: [0, 255] });
    const desc = FILTER_SPECS[name].toDesc(props);
    assert.equal(FILTER_CLASS[desc.type], name);
    assert.deepEqual(FILTER_SPECS[name].toDesc({ ...defaults(name), ...FILTER_SPECS[name].fromDesc(desc) }), desc, name);
  }
});
