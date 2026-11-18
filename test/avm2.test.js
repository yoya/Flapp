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
