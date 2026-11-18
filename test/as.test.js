// ActionScript のテスト。test/as/*.as を FFDec でコンパイルした SWF (test/fixtures/as-*.swf) を再生し、
// trace() の出力が実機（Flash Player デバッガ版）の出力 (test/expected/as-*.trace.txt) と一致することを確かめる。
// SWF と期待値の作り直しは `node tools/mkas.js` と `npm run oracle`。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';
import { realTrace } from './helpers.js';

const FRAMES = 40; // 実機の出力は再生開始から数秒後（12 fps で 30 フレーム前後）に取っている

const dir = new URL('fixtures/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => /^as-.*\.swf$/.test(f)).sort()) {
  const name = file.slice(0, -4);
  test(`${name}: trace が実機と一致する`, async () => {
    // 時刻は実時間ではなく、1 フレーム進めるごとにフレーム間隔ぶん進める。
    let time = 0;
    const encoding = name.endsWith('-sjis') ? 'shift_jis' : undefined; // SWF 5 以前の文字コード
    const movie = await Movie.load(readFileSync(new URL(file, dir)), { now: () => time, random: () => 0.5, encoding });
    for (let i = 0; i < FRAMES; i++) {
      time += 1000 / movie.frameRate;
      movie.advance();
    }
    const expected = realTrace(readFileSync(new URL(`expected/${name}.trace.txt`, import.meta.url)), encoding);
    assert.deepEqual(movie.traces, expected);
  });
}
