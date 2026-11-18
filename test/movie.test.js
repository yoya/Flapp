import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Movie, MovieClip } from '../src/player/movie.js';
import { parsePlaceObject, parseRemoveObject } from '../src/swf/display.js';
import { parseSWF } from '../src/swf/parse.js';
import { DefineSprite, End, PlaceObject2, RemoveObject2, ShowFrame, fixtures, matrix, square, swf, tag, u16 } from '../tools/mkfixtures.js';

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const list = (clip) => clip.sortedChildren().map((c) => `${c.depth}:${c.character.id}@${c.matrix.tx},${c.matrix.ty}`).join(' ');
const load = (tags, options) => Movie.load(swf({ version: 8, tags }), options);

test('PlaceObject2 の解釈', async () => {
  const tags = (await parseSWF(fixtures['shape-fills'])).tags;
  assert.deepEqual(parsePlaceObject(tags[2]), { depth: 1, move: false, characterId: 1, matrix: { ...IDENTITY, tx: 400, ty: 300 } });
  assert.deepEqual(parsePlaceObject(tags[3]), {
    depth: 2, move: false, characterId: 1,
    matrix: { a: 0.5, b: 0.25, c: -0.25, d: 0.5, tx: 1200, ty: 1700 },
    cxform: { rm: 128, gm: 256, bm: 256, am: 192, ra: 0, ga: 0, ba: 64, aa: 0 },
  });

  const named = (await parseSWF(swf({ version: 8, tags: [PlaceObject2({ depth: 7, move: true, name: 'mc', clipDepth: 9 }), End()] }))).tags[0];
  assert.deepEqual(parsePlaceObject(named), { depth: 7, move: true, name: 'mc', clipDepth: 9 });
});

test('PlaceObject / PlaceObject3 / RemoveObject の解釈', () => {
  const body = (...bytes) => Uint8Array.from(bytes.flat());
  // PlaceObject: ID 3, 深度 4, 行列。残りがあれば CXFORM（アルファなし、加算のみ 8 ビット）
  assert.deepEqual(parsePlaceObject({ code: 4, body: body(u16(3), u16(4), matrix({ tx: 20, ty: 40 })) }),
    { characterId: 3, depth: 4, move: false, matrix: { ...IDENTITY, tx: 20, ty: 40 } });
  const withCx = parsePlaceObject({ code: 4, body: body(u16(3), u16(4), matrix(), 0b10100000, 0b00100000, 0b01000000, 0b01100000) });
  assert.deepEqual(withCx.cxform, { rm: 256, gm: 256, bm: 256, am: 256, ra: 8, ga: 16, ba: 24, aa: 0 });

  // PlaceObject3: HasClassName でクラス名が ID の前に入る
  const p3 = parsePlaceObject({ code: 70, body: body(0x06, 0x08, u16(2), 0x41, 0x00, u16(5), matrix({ tx: 100, ty: 0 })) });
  assert.deepEqual(p3, { depth: 2, move: false, className: 'A', characterId: 5, matrix: { ...IDENTITY, tx: 100, ty: 0 } });

  assert.deepEqual(parseRemoveObject({ code: 5, body: body(u16(3), u16(4)) }), { characterId: 3, depth: 4 });
  assert.deepEqual(parseRemoveObject({ code: 28, body: body(u16(4)) }), { depth: 4 });
});

test('配置・移動・削除・置き換え', async () => {
  const movie = await Movie.load(fixtures.timeline);
  assert.deepEqual(movie.backgroundColor, { r: 0xee, g: 0xee, b: 0xee, a: 255 });
  assert.equal(movie.root.totalFrames, 120);
  assert.deepEqual(movie.warnings, []);

  assert.equal(list(movie.root), '1:1@200,200');
  movie.advance();
  assert.equal(list(movie.root), '1:1@1200,400 2:2@2400,200');
  movie.advance();
  assert.equal(list(movie.root), '1:1@1200,400 5:3@2400,1400');
  const red = movie.root.children.get(1);
  assert.deepEqual(red.cxform, { rm: 256, gm: 256, bm: 256, am: 256, ra: 0, ga: 128, ba: 0, aa: 0 });
  movie.advance();
  assert.equal(list(movie.root), '1:2@1200,400 3:1@3600,2000 5:3@2400,1400');
  const blue = movie.root.children.get(1);
  assert.notEqual(blue, red); // 置き換えは新しいオブジェクト
  assert.deepEqual(blue.cxform, red.cxform); // 行列と色変換は引き継ぐ

  // スプライトは置かれた時点で 1 フレーム目を実行している
  const sprite = movie.root.children.get(5);
  assert.ok(sprite instanceof MovieClip);
  assert.equal(list(sprite), '1:2@200,200 2:1@0,0');
  assert.equal(movie.instances, 5);
});

test('最終フレームの次は 1 フレーム目に戻り、同じ深度・同じキャラクタの子は残る', async () => {
  const movie = await load([
    square(1, 100, [255, 0, 0]),
    DefineSprite(2, 2, [PlaceObject2({ depth: 1, id: 1 }), ShowFrame(), RemoveObject2(1), ShowFrame(), End()]),
    PlaceObject2({ depth: 1, id: 2, matrix: { tx: 10, ty: 0 } }), ShowFrame(),
    PlaceObject2({ depth: 1, move: true, matrix: { tx: 20, ty: 0 } }), PlaceObject2({ depth: 2, id: 1 }), ShowFrame(),
    ShowFrame(),
    End(),
  ]);
  const { root } = movie;
  const sprite = root.children.get(1);
  const frames = () => [root.currentFrame, sprite.currentFrame, list(root), sprite.children.size];

  assert.deepEqual(frames(), [1, 1, '1:2@10,0', 1]);
  movie.advance();
  assert.deepEqual(frames(), [2, 2, '1:2@20,0 2:1@0,0', 0]);
  movie.advance();
  assert.deepEqual(frames(), [3, 1, '1:2@20,0 2:1@0,0', 1]); // スプライトは自分で 1 フレーム目へ戻る
  movie.advance();
  // ルートが 1 フレーム目へ戻る: 深度 2 は消え、深度 1 は同じオブジェクトのまま行列だけ戻る
  assert.deepEqual(frames(), [1, 2, '1:2@10,0', 0]);
  assert.equal(root.children.get(1), sprite);
  assert.equal(movie.instances, 1);
});

test('1 フレームだけのタイムラインは繰り返し実行しない', async () => {
  const movie = await load([square(1, 100, [0, 0, 0]), PlaceObject2({ depth: 1, id: 1 }), ShowFrame(), End()]);
  const child = movie.root.children.get(1);
  movie.advance();
  movie.advance();
  assert.equal(movie.root.currentFrame, 1);
  assert.equal(movie.root.children.get(1), child);
});

test('このフレームで置かれたスプライトは、そのフレームでは進まない', async () => {
  const movie = await load([
    square(1, 100, [0, 0, 0]),
    DefineSprite(2, 3, [ShowFrame(), ShowFrame(), ShowFrame(), End()]),
    ShowFrame(),
    PlaceObject2({ depth: 1, id: 2 }), ShowFrame(),
    ShowFrame(),
    End(),
  ]);
  movie.advance();
  assert.equal(movie.root.children.get(1).currentFrame, 1);
  movie.advance();
  assert.equal(movie.root.children.get(1).currentFrame, 2);
});

test('未定義・後方定義・自己参照のキャラクタは置かない', async () => {
  const movie = await load([
    DefineSprite(1, 1, [PlaceObject2({ depth: 1, id: 1 }), PlaceObject2({ depth: 2, id: 2 }), ShowFrame(), End()]),
    square(2, 100, [0, 0, 0]),
    PlaceObject2({ depth: 1, id: 1 }), PlaceObject2({ depth: 2, id: 99 }), ShowFrame(),
    End(),
  ]);
  assert.equal(list(movie.root), '1:1@0,0');
  assert.equal(movie.root.children.get(1).children.size, 0);
  assert.deepEqual(movie.warnings, [
    'sprite 1 cannot place character 1 defined after it',
    'sprite 1 cannot place character 2 defined after it',
    'character 99 is not defined',
  ]);
});

test('入れ子で倍々に増える配置は上限で止まる', async () => {
  // スプライト n がスプライト n-1 を 2 つ置く。30 段で 2^30 個になるはずの構造
  const tags = [square(1, 100, [0, 0, 0])];
  for (let id = 2; id <= 31; id++) {
    tags.push(DefineSprite(id, 1, [PlaceObject2({ depth: 1, id: id - 1 }), PlaceObject2({ depth: 2, id: id - 1 }), ShowFrame(), End()]));
  }
  tags.push(PlaceObject2({ depth: 1, id: 31 }), ShowFrame(), End());
  const movie = await load(tags, { maxInstances: 500 });
  assert.equal(movie.instances, 500);
  assert.equal(movie.root.count() - 1, 500);
  assert.match(movie.warnings[0], /too many display objects \(limit 500\)/);
});

test('深すぎる入れ子は打ち切る', async () => {
  const tags = [square(1, 100, [0, 0, 0])];
  for (let id = 2; id <= 400; id++) tags.push(DefineSprite(id, 1, [PlaceObject2({ depth: 1, id: id - 1 }), ShowFrame(), End()]));
  tags.push(PlaceObject2({ depth: 1, id: 400 }), ShowFrame(), End());
  const movie = await load(tags);
  assert.equal(movie.instances, 255);
  assert.match(movie.warnings[0], /nested deeper than 255 levels/);
});

test('壊れたタグは警告にして読み飛ばす', async () => {
  const movie = await load([
    square(1, 100, [0, 0, 0]),
    square(1, 200, [0, 0, 0]), // ID の重複
    tag(26, [0x06, 1]), // PlaceObject2 が途中で切れている
    tag(2, [...u16(5), 0xf8]), // DefineShape の RECT が読めない
    PlaceObject2({ depth: 1, id: 1 }), ShowFrame(), End(),
  ]);
  assert.equal(list(movie.root), '1:1@0,0');
  assert.equal(movie.dictionary.get(1).bounds.xmax, 100); // 先の定義が残る
  assert.equal(movie.warnings.length, 3);
  assert.match(movie.warnings[0], /character 1 is defined twice/);
  assert.match(movie.warnings[1], /tag PlaceObject2 at offset \d+: cannot read/);
  assert.match(movie.warnings[2], /tag DefineShape at offset \d+: cannot read/);
});

test('埋まっている深度への新規配置は無視する（実機と同じ）', async () => {
  const movie = await Movie.load(fixtures['place-occupied']);
  const red = movie.root.children.get(1);
  movie.advance();
  assert.equal(list(movie.root), '1:1@400,400');
  assert.equal(movie.root.children.get(1), red);
  assert.deepEqual(movie.warnings, ['cannot place character 2 at depth 1: the depth is occupied']);
});
