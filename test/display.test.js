import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Movie, MovieClip } from '../src/player/movie.js';
import { parseDefineButton, parsePlaceObject } from '../src/swf/display.js';
import { parseSWF } from '../src/swf/parse.js';
import { End, PlaceObject3, ShowFrame, blurFilter, fixtures, square, swf } from '../tools/mkfixtures.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1 / 65536, `${actual} ≈ ${expected}`);
const placesOf = async (name) => (await parseSWF(fixtures[name])).tags.filter((t) => t.code === 70).map(parsePlaceObject);

test('PlaceObject3: ブレンドモード', async () => {
  const places = await placesOf('blend');
  assert.deepEqual(places.filter((p) => p.depth >= 10 && p.depth < 20).map((p) => p.blendMode), [
    'multiply', 'screen', 'lighten', 'darken', 'difference', 'add', 'subtract', 'invert', 'overlay', 'hardlight',
  ]);
  assert.equal(places.find((p) => p.depth === 51).blendMode, 'layer');
  // ブレンドの後ろに行列や色変換があっても読める
  const withCx = places.find((p) => p.depth === 30);
  assert.equal(withCx.blendMode, 'multiply');
  assert.equal(withCx.cxform.am, 128);
});

test('PlaceObject3: フィルタ', async () => {
  const filters = (await placesOf('filter')).map((p) => p.filters);
  assert.deepEqual(filters[0], [{ type: 'blur', blurX: 4, blurY: 4, passes: 1 }]);
  assert.deepEqual(filters[1], [{ type: 'blur', blurX: 8, blurY: 2, passes: 3 }]);
  const shadow = filters[2][0];
  assert.deepEqual({ ...shadow, angle: 0 }, {
    type: 'dropShadow', color: { r: 0, g: 0, b: 0, a: 128 }, blurX: 4, blurY: 4, angle: 0, distance: 4,
    strength: 1, inner: false, knockout: false, compositeSource: true, passes: 1,
  });
  near(shadow.angle, Math.PI / 4);
  assert.deepEqual(filters[3][0], {
    type: 'glow', color: { r: 255, g: 0, b: 0, a: 255 }, blurX: 6, blurY: 6, strength: 2,
    inner: false, knockout: false, compositeSource: true, passes: 2,
  });
  assert.equal(filters[4][0].inner, true);
  assert.equal(filters[5][0].knockout, true);
  assert.deepEqual(filters[6][0], { type: 'colorMatrix', matrix: [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0.5, 0] });
  assert.deepEqual(filters[7].map((f) => f.type), ['blur', 'dropShadow']);
});

test('ベベル・グラデーション光彩・畳み込みも読み飛ばさずに解釈する', () => {
  const fixed = (v) => { const n = Math.round(v * 65536); return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; };
  const float = (v) => [...new Uint8Array(new Float32Array([v]).buffer)];
  const tail = [...fixed(2), ...fixed(3), ...fixed(0.5), ...fixed(4), 0x80, 0x01]; // ぼかし 2x3、角度 0.5、距離 4、強さ 1.5
  const body = [
    0x02, 0x01, 1, 0, 9, 0, // HasCharacter / HasFilterList、深度 1、ID 9
    4, // フィルタ 4 個
    3, 1, 2, 3, 4, 5, 6, 7, 8, ...tail, 0b10110010, // ベベル: 内側・元の絵も描く・最前面、2 回
    4, 2, 10, 20, 30, 40, 50, 60, 70, 80, 0, 255, ...tail, 0b00100001, // グラデーション光彩: 2 色
    5, 2, 1, ...float(4), ...float(0.5), ...float(1), ...float(-1), 9, 8, 7, 6, 0b00000011, // 畳み込み 2x1
    1, ...fixed(5), ...fixed(6), 2 << 3, // ぼかし（前のフィルタの長さを正しく読めていれば合う）
  ];
  const { filters } = parsePlaceObject({ code: 70, body: Uint8Array.from(body) });
  assert.deepEqual(filters[0], {
    type: 'bevel', shadowColor: { r: 1, g: 2, b: 3, a: 4 }, highlightColor: { r: 5, g: 6, b: 7, a: 8 },
    blurX: 2, blurY: 3, angle: 0.5, distance: 4, strength: 1.5,
    inner: true, knockout: false, compositeSource: true, onTop: true, passes: 2,
  });
  assert.deepEqual(filters[1].colors, [
    { color: { r: 10, g: 20, b: 30, a: 40 }, ratio: 0 }, { color: { r: 50, g: 60, b: 70, a: 80 }, ratio: 255 },
  ]);
  assert.deepEqual([filters[1].type, filters[1].passes], ['gradientGlow', 1]);
  assert.deepEqual(filters[2], {
    type: 'convolution', matrixX: 2, matrixY: 1, divisor: 4, bias: 0.5, matrix: [1, -1],
    defaultColor: { r: 9, g: 8, b: 7, a: 6 }, clamp: true, preserveAlpha: true,
  });
  assert.deepEqual(filters[3], { type: 'blur', blurX: 5, blurY: 6, passes: 2 });
  // 未知のフィルタ番号
  assert.throws(() => parsePlaceObject({ code: 70, body: Uint8Array.from([0x02, 0x01, 1, 0, 9, 0, 1, 99]) }), /unknown filter 99/);
});

test('可視フラグ・フィルタ・ブレンドは表示オブジェクトに引き継がれる', async () => {
  const movie = await Movie.load(swf({
    version: 8, frames: 2,
    tags: [
      square(1, 100, [0, 0, 0]),
      PlaceObject3({ depth: 1, id: 1, visible: false, blendMode: 8, filters: [blurFilter(2, 2, 1)] }), ShowFrame(),
      PlaceObject3({ depth: 1, move: true, visible: true }), ShowFrame(),
      End(),
    ],
  }));
  const obj = movie.root.children.get(1);
  assert.deepEqual([obj.visible, obj.blendMode, obj.filters.length], [false, 'add', 1]);
  movie.advance();
  // 指定の無い属性は変わらない
  assert.deepEqual([obj.visible, obj.blendMode, obj.filters.length], [true, 'add', 1]);
});

test('ボタン: 状態ごとのレコードと、通常状態の表示', async () => {
  const tags = (await parseSWF(fixtures.button)).tags;
  const b2 = parseDefineButton(tags.find((t) => t.code === 34));
  assert.equal(b2.id, 4);
  assert.deepEqual(b2.records.map((r) => [r.up, r.over, r.down, r.hitTest, r.characterId, r.depth]), [
    [true, false, false, true, 1, 1], [true, false, false, false, 2, 2], [false, true, false, false, 2, 1], [false, false, true, false, 3, 1],
  ]);
  assert.deepEqual(b2.records[1].cxform, { rm: 256, gm: 256, bm: 256, am: 128, ra: 128, ga: 0, ba: 0, aa: 0 });
  assert.equal(b2.records[1].matrix.tx, 300);
  const b1 = parseDefineButton(tags.find((t) => t.code === 7));
  assert.deepEqual([b1.id, b1.records.length, b1.records[0].cxform], [5, 1, undefined]);

  const movie = await Movie.load(fixtures.button);
  assert.deepEqual(movie.warnings, []);
  const button = movie.root.children.get(1);
  assert.ok(button instanceof MovieClip);
  // 通常状態の 2 つだけが置かれる
  assert.deepEqual(button.sortedChildren().map((c) => [c.depth, c.character.id]), [[1, 1], [2, 2]]);
  assert.equal(button.children.get(2).cxform.am, 128);
  // スプライトの中のボタン
  const inner = movie.root.children.get(2).children.get(1);
  assert.deepEqual(inner.sortedChildren().map((c) => c.character.id), [2]);
});
