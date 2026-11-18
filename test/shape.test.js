import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shapeToPaths } from '../src/shape/paths.js';
import { parseSWF } from '../src/swf/parse.js';
import { SWFError } from '../src/swf/reader.js';
import { parseDefineShape } from '../src/swf/shape.js';
import { DefineShape, End, fixtures, lineStyle, solid, swf } from '../tools/mkfixtures.js';

const shapeOf = async (bytes) => {
  const tags = (await parseSWF(bytes)).tags;
  return parseDefineShape(tags.find((t) => t.name?.startsWith('DefineShape')));
};
const text = (path) => path.map((c) => c.join(' ')).join(' ');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1 / 65536, `${actual} ≈ ${expected}`);

test('DefineShape3: 塗り・線・レコード', async () => {
  const s = await shapeOf(fixtures['shape-fills']);
  assert.equal(s.id, 1);
  assert.deepEqual(s.bounds, { xmin: -30, xmax: 3530, ymin: -30, ymax: 1030 });
  assert.equal(s.usesWindingRule, false);
  assert.deepEqual(s.fillStyles, [
    { type: 'solid', color: { r: 255, g: 0, b: 0, a: 255 } },
    { type: 'solid', color: { r: 0, g: 0, b: 255, a: 128 } },
    { type: 'solid', color: { r: 0, g: 160, b: 0, a: 255 } },
  ]);
  assert.deepEqual(s.lineStyles, [
    { width: 60, color: { r: 0, g: 0, b: 0, a: 255 }, startCap: 'round', endCap: 'round', join: 'round', noClose: false },
  ]);
  assert.deepEqual(s.records.slice(0, 4), [
    { type: 'style', moveTo: { x: 0, y: 0 }, fill1: 1 },
    { type: 'line', x: 1000, y: 0 },
    { type: 'style', fill0: 2 },
    { type: 'line', x: 1000, y: 1000 },
  ]);
  assert.deepEqual(s.records.at(-5), { type: 'style', moveTo: { x: 3500, y: 500 }, fill1: 3, line: 1 });
  assert.deepEqual(s.records.at(-4), { type: 'curve', cx: 3500, cy: 1000, x: 3000, y: 1000 });
  assert.deepEqual(s.records.at(-1), { type: 'curve', cx: 3500, cy: 0, x: 3500, y: 500 });
});

test('辺を塗りごとの閉じた輪郭に組み直す', async () => {
  const ops = shapeToPaths(await shapeOf(fixtures['shape-fills']));
  assert.deepEqual(ops.map((o) => [o.kind, o.style.color.g, text(o.path)]), [
    ['fill', 0, 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 L 0 0 Z'],
    // 共有辺は fill0 側なので向きが反転して入る
    ['fill', 0, 'M 1000 1000 L 1000 0 L 2000 0 L 2000 1000 L 1000 1000 Z'],
    ['fill', 160, 'M 3500 500 Q 3500 1000 3000 1000 Q 2500 1000 2500 500 Q 2500 0 3000 0 Q 3500 0 3500 500 Z'],
    ['stroke', 0, 'M 3500 500 Q 3500 1000 3000 1000 Q 2500 1000 2500 500 Q 2500 0 3000 0 Q 3500 0 3500 500 Z'],
  ]);
  assert.ok(ops.slice(0, 3).every((o) => o.evenOdd));
});

test('スタイル表の差し替えで層が分かれる', async () => {
  const s = await shapeOf(fixtures['shape-layers']);
  assert.equal(s.fillStyles.length, 2);
  const change = s.records.find((r) => r.fillStyles);
  assert.deepEqual(change.fillStyles, [{ type: 'solid', color: { r: 0, g: 160, b: 0, a: 255 } }]);
  assert.deepEqual(change.lineStyles, []);

  const ops = shapeToPaths(s);
  assert.deepEqual(ops.map((o) => [o.style.color.r, o.style.color.g, text(o.path)]), [
    [255, 0, 'M 0 0 L 1200 0 L 1200 1200 L 0 1200 L 0 0 Z'],
    [0, 160, 'M 300 300 L 900 300 L 900 900 L 300 900 L 300 300 Z'], // 番号 1 は新しい表の緑
  ]);
});

test('DefineShape4: グラデーションと LINESTYLE2', async () => {
  const s = await shapeOf(fixtures['shape-gradient']);
  assert.deepEqual(s.edgeBounds, s.bounds);
  const [linear, radial, focal] = s.fillStyles;
  const g = 1400 / 32768;
  assert.equal(linear.type, 'linear');
  near(linear.matrix.a, g * Math.SQRT1_2);
  near(linear.matrix.c, -g * Math.SQRT1_2);
  assert.equal(linear.matrix.tx, 700);
  assert.equal(linear.spread, 'pad');
  assert.equal(linear.linearRGB, false);
  assert.deepEqual(linear.stops.map((p) => p.ratio), [0, 128, 255]);
  assert.deepEqual(linear.stops[1].color, { r: 255, g: 255, b: 0, a: 255 });
  assert.equal(radial.type, 'radial');
  assert.equal(radial.focal, 0);
  assert.equal(radial.matrix.a, g);
  assert.equal(focal.type, 'radial');
  assert.equal(focal.focal, 0.5);

  assert.deepEqual(s.lineStyles[0], {
    width: 40, startCap: 'round', endCap: 'round', join: 'bevel', noClose: false,
    noHScale: false, noVScale: false, pixelHinting: false, color: { r: 0, g: 0, b: 0, a: 128 },
  });
  assert.equal(s.lineStyles[1].join, 'miter');
  assert.equal(s.lineStyles[1].miterLimit, 3);

  const ops = shapeToPaths(s);
  assert.deepEqual(ops.map((o) => o.kind), ['fill', 'fill', 'fill', 'stroke', 'stroke']);
});

test('両側が同じ塗りの辺は輪郭に入らない', async () => {
  const bytes = swf({
    version: 8,
    tags: [DefineShape({
      id: 1, bounds: [0, 200, 0, 100], fills: [solid(1, 2, 3)], lines: [lineStyle(20, 0, 0, 0)],
      records: [
        ['style', { moveTo: [0, 0], fill1: 1 }], ['line', 200, 0], ['line', 0, 100], ['line', -200, 0], ['line', 0, -100],
        // 塗りの中を横切る線（両側とも塗り 1）
        ['style', { moveTo: [100, 0], fill0: 1, fill1: 1, line: 1 }], ['line', 0, 100],
      ],
    }), End()],
  });
  const ops = shapeToPaths(await shapeOf(bytes));
  assert.deepEqual(ops.map((o) => [o.kind, text(o.path)]), [
    ['fill', 'M 0 0 L 200 0 L 200 100 L 0 100 L 0 0 Z'],
    ['stroke', 'M 100 0 L 100 100'],
  ]);
});

test('壊れた図形は SWFError', async () => {
  const tag = (await parseSWF(fixtures['shape-fills'])).tags[1];
  // 終端レコードの手前で切る
  assert.throws(() => parseDefineShape({ code: tag.code, body: tag.body.subarray(0, tag.length - 8) }), SWFError);
  // 未知の塗り種別
  const bad = tag.body.slice();
  bad[2 + 8 + 1] = 0x77; // ID 2 バイト、RECT 8 バイト、塗りの数 1 バイトの次が最初の塗り種別
  assert.throws(() => parseDefineShape({ code: tag.code, body: bad }), /unknown fill style type 0x77/);
  assert.throws(() => parseDefineShape({ code: 9, body: tag.body }), SWFError);
});
