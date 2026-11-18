// ボタンのイベント。test/fixtures/button-events.swf に、button-events.input.json の入力を順に与える。
// 期待値 (test/expected/button-events.input.trace.txt) は、同じ入力を実機に送って取った trace（node tools/oracle-input.js）。
// 見た目の切り替えは、同じ手順の途中で実機の画面を撮って確かめた内容。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';
import { realTrace } from './helpers.js';

const KEYS = { ArrowLeft: 1, Enter: 13 }; // SWF のキーコード。ほかは文字コード
const load = () => Movie.load(readFileSync(new URL('fixtures/button-events.swf', import.meta.url)));
const upState = (movie, id) => movie.clips.find((c) => c.character.id === id).sortedChildren().map((c) => c.character.id);

test('ボタン: 入力の手順どおりにアクションが実行される', async () => {
  const movie = await load();
  const steps = JSON.parse(readFileSync(new URL('fixtures/button-events.input.json', import.meta.url), 'utf8'));
  for (const [kind, a, b] of steps) {
    if (kind === 'move') movie.mouseMove(a * 20, b * 20);
    else if (kind === 'down') movie.mouseDown();
    else if (kind === 'up') movie.mouseUp();
    else movie.keyDown(KEYS[a] ?? a.charCodeAt(0));
    movie.advance();
  }
  assert.deepEqual(movie.traces, realTrace(readFileSync(new URL('expected/button-events.input.trace.txt', import.meta.url))));
  // 手順が意図どおりに働いていること（何も起きずに一致しているのではないこと）も確かめる。
  for (const line of ['A press', 'A releaseOutside', 'B dragOut', 'C release', 'D key z', 'E key y']) assert.ok(movie.traces.includes(line), line);
  // 同じキーに反応するボタンが複数あっても、実行されるのは表示順でいちばん下の 1 つ。見えないクリップの中の G は反応しない。
  for (const line of ['B key a', 'E key z', 'F key y', 'G key x', 'G press']) assert.ok(!movie.traces.includes(line), line);
});

test('ボタン: 状態に応じて表示するキャラクタが切り替わる', async () => {
  const movie = await load();
  assert.deepEqual(upState(movie, 10), [1]); // マウスが一度も来ていなければ通常の状態
  movie.advance();
  assert.deepEqual(upState(movie, 10), [1]);
  movie.mouseMove(70 * 20, 50 * 20);
  assert.deepEqual(upState(movie, 10), [2]);
  assert.equal(movie.hoverButton.character.id, 10);
  movie.mouseDown();
  assert.deepEqual(upState(movie, 10), [3]);
  movie.mouseMove(130 * 20, 50 * 20); // 押したまま B の上へ: A は over、B は変わらない
  assert.deepEqual([upState(movie, 10), upState(movie, 11)], [[2], [1]]);
  movie.mouseUp();
  assert.deepEqual([upState(movie, 10), upState(movie, 11)], [[1], [2]]);
  movie.mouseLeave();
  assert.deepEqual(upState(movie, 11), [1]);
  assert.equal(movie.hoverButton, null);
});

test('ボタン: ルートが見えなければ、どのボタンも反応しない', async () => {
  const movie = await load();
  movie.root.visible = false;
  movie.mouseMove(70 * 20, 50 * 20);
  movie.mouseDown();
  movie.mouseUp();
  movie.keyDown(97);
  assert.deepEqual(movie.traces, []);
});
