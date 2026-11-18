// AVM2 のうち、実機（デバッガ版）では確かめられない部分のテスト。期待値は資料に基づいて手で書いたもの。
// 実機と照合できるものは test/as3.test.js にある。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';

async function run(name, frames) {
  let time = 0;
  const movie = await Movie.load(readFileSync(new URL(`fixtures/${name}.swf`, import.meta.url)), { now: () => time });
  for (let i = 0; i < frames; i++) {
    time += 1000 / movie.frameRate;
    movie.advance();
  }
  return movie;
}

test('setTimeout / setInterval: 期限の順に呼ばれ、取り消したものは呼ばれない', async () => {
  const movie = await run('as3x-timeout', 30); // 12 fps で 2.5 秒
  assert.deepEqual(movie.traces, ['true true', 'interval 1', 'interval 2', 'timeout 1 two']);
  assert.deepEqual(movie.warnings, []);
});

test('SimpleButton: マウスに合わせて、表示する状態が切り替わる', async () => {
  const movie = await run('as3x-buttonstate', 1);
  const button = movie.root.sortedChildren()[0];
  const shown = () => button.sortedChildren().map((d) => d.name).join();
  const at = (x, y) => movie.mouseMove(x * 20, y * 20);
  assert.equal(shown(), 'up');
  at(30, 40); // 当たり判定用の形（40×20）の中
  assert.equal(shown(), 'over');
  assert.ok(movie.hoverButton); // 手の形のカーソル
  movie.mouseDown();
  assert.equal(shown(), 'down');
  at(200, 140); // 押したまま外へ
  assert.equal(shown(), 'up');
  movie.mouseUp();
  at(65, 40); // over の形（50×30）の中だが、当たり判定用の形の外
  assert.equal(shown(), 'up');
  at(30, 40);
  movie.mouseDown();
  movie.mouseUp();
  assert.equal(shown(), 'over');
  movie.keyDown(65); // スクリプトが enabled を false にする
  assert.equal(shown(), 'up');
  at(31, 40);
  assert.equal(shown(), 'up'); // 無効なボタンは、見た目が変わらない
  assert.equal(movie.hoverButton, null);
  assert.deepEqual(movie.traces, [
    'mouseOver b b', 'mouseDown b b', 'mouseOut b b', 'mouseOver b b', 'mouseDown b b', 'mouseUp b b', 'click b b', 'enabled false',
  ]);
  assert.deepEqual(movie.warnings, []);
});

test('読み込みは行わず、要求を記録して失敗を伝える。SharedObject は再生中だけ値を持つ', async () => {
  const movie = await run('as3x-netfail', 8);
  assert.deepEqual(movie.traces, [
    '[object SharedObject] 12 true 1,2 flushed 0 undefined',
    'undefined',
    'null',
    'URLLoader open 1',
    'URLLoader ioError true 2032 Error #2032: Stream Error. URL: missing-file.txt true true false false undefined 0 1',
    'Loader ioError true 2032 null 3',
    'Sound ioError true 2032 http://example.com/missing-file.mp3 0 3',
  ]);
  assert.deepEqual(movie.requests.map((r) => `${r.kind} ${r.url} ${r.target}`), [
    'load missing-file.txt ', 'navigateToURL http://example.com/page _blank', 'sendToURL http://example.com/log ', 'fscommand FSCommand:fullscreen true',
    'load unheard.txt ', 'load missing-file.swf ', 'loadSound http://example.com/missing-file.mp3 ',
  ]);
  assert.deepEqual(movie.warnings, ['unhandled ioError: unheard.txt']); // 誰も聞いていない失敗は、警告として残る
});

test('表示オブジェクトの BitmapData.draw は、描画側が無ければ警告を残して何もしない', async () => {
  const movie = await run('as3x-visual', 3);
  assert.deepEqual(movie.traces, ['center 20000000 corner 20000000']); // 描き込まれていない
  assert.deepEqual(movie.warnings, ['BitmapData.draw of a display object needs a renderer']);
});

test('表示オブジェクトの BitmapData.draw は、rasterize オプションの処理が返した画像を重ねる', async () => {
  // 全面が不透明な赤の画像を返す、仮の描画側。
  const rasterize = (movie, d, m, width, height) => new Uint8ClampedArray(width * height * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
  const movie = await Movie.load(readFileSync(new URL('fixtures/as3x-visual.swf', import.meta.url)), { now: () => 0, rasterize });
  assert.deepEqual(movie.traces, ['center ffff0000 corner ffff0000']);
  assert.deepEqual(movie.warnings, []);
});
