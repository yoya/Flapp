import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';
import { parseDefineMorphShape } from '../src/swf/morph.js';
import { parseSWF } from '../src/swf/parse.js';
import { SWFError } from '../src/swf/reader.js';
import { fixtures } from '../tools/mkfixtures.js';

const text = (path) => path.map((c) => c.join(' ')).join(' ');
const morphs = async () => (await parseSWF(fixtures.morph)).tags.filter((t) => t.code === 46).map(parseDefineMorphShape);

test('比率 0 は開始形状、65535 は終了形状', async () => {
  const [m] = await morphs();
  assert.equal(m.id, 1);
  assert.deepEqual(m.startBounds, { xmin: -10, xmax: 810, ymin: -10, ymax: 810 });
  assert.deepEqual(m.endBounds, { xmin: -160, xmax: 960, ymin: -160, ymax: 960 });

  const start = m.pathsAt(0);
  assert.deepEqual(start.map((o) => o.kind), ['fill', 'stroke']);
  // 終了側に曲線がある辺は、開始側でも「制御点が中点の曲線」になる
  assert.equal(text(start[1].path), 'M 0 0 Q 400 0 800 0 L 800 800 Q 400 800 0 800 L 0 0 Z');
  assert.deepEqual(start[0].style.color, { r: 255, g: 0, b: 0, a: 255 });
  assert.equal(start[1].style.width, 20);

  const end = m.pathsAt(65535);
  assert.equal(text(end[1].path), 'M 400 -100 Q 800 -100 900 400 L 400 900 Q 0 900 -100 400 L 400 -100 Z');
  assert.deepEqual(end[0].style.color, { r: 0, g: 0, b: 255, a: 255 });
  assert.deepEqual(end[1].style.color, { r: 0, g: 160, b: 0, a: 255 });
  assert.equal(end[1].style.width, 120);
});

test('中間の比率は座標・色・線幅を線形に補間する', async () => {
  const [m] = await morphs();
  const t = 13107 / 65535; // ちょうど 0.2
  const [fill, stroke] = m.pathsAt(13107);
  assert.equal(t, 0.2);
  assert.equal(text(stroke.path), 'M 80 -20 Q 480 -20 820 80 L 720 820 Q 320 820 -20 720 L 80 -20 Z');
  assert.deepEqual(fill.style.color, { r: 204, g: 0, b: 51, a: 255 });
  assert.equal(stroke.style.width, 40);
  // 同じ比率は同じ結果を使い回す。範囲外の比率は端に丸める
  assert.equal(m.pathsAt(13107), m.pathsAt(13107));
  assert.equal(m.pathsAt(-5), m.pathsAt(0));
  assert.equal(m.pathsAt(1e9), m.pathsAt(65535));
});

test('グラデーションは行列と色の位置も補間する', async () => {
  const [, m] = await morphs();
  const [a] = m.pathsAt(0);
  const [b] = m.pathsAt(65535);
  assert.equal(a.style.type, 'linear');
  assert.deepEqual([a.style.matrix.tx, b.style.matrix.tx], [200, 400]);
  assert.deepEqual(a.style.stops.map((s) => s.ratio), [0, 255]);
  assert.deepEqual(b.style.stops.map((s) => s.ratio), [64, 255]);
  assert.deepEqual(b.style.stops[0].color, { r: 0, g: 0, b: 255, a: 255 });
  // fill0 側の塗りなので、辺の向きを反転した輪郭になる
  assert.equal(text(a.path), 'M 400 0 L 0 0 L 0 800 L 400 800 L 400 0 Z');
  assert.equal(text(b.path), 'M 800 0 L 0 0 L 0 800 L 800 800 L 800 0 Z');
});

test('モーフ図形は ratio つきで置ける', async () => {
  const movie = await Movie.load(fixtures.morph);
  assert.deepEqual(movie.warnings, []);
  const kids = movie.root.sortedChildren();
  assert.deepEqual(kids.slice(0, 5).map((c) => [c.character.type, c.ratio]), [['morph', 0], ['morph', 16384], ['morph', 32768], ['morph', 49152], ['morph', 65535]]);
});

test('壊れたモーフ図形は SWFError', async () => {
  const tag = (await parseSWF(fixtures.morph)).tags.find((t) => t.code === 46);
  assert.throws(() => parseDefineMorphShape({ code: 46, body: tag.body.subarray(0, 30) }), SWFError);
  const bad = tag.body.slice();
  new DataView(bad.buffer).setUint32(2 + 7 + 7, 0x7fffffff, true); // EndEdges の位置を範囲外に（ID 2 バイト、RECT 7 バイト × 2 の次）
  assert.throws(() => parseDefineMorphShape({ code: 46, body: bad }), /out of range/);
  assert.throws(() => parseDefineMorphShape({ code: 2, body: tag.body }), SWFError);
});
