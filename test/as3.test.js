// ActionScript 3 のテスト。test/as3/*.as を FFDec でコンパイルした SWF (test/fixtures/as3-*.swf) を再生し、
// trace() の出力が実機（Flash Player デバッガ版）の出力 (test/expected/as3-*.trace.txt) と一致することを確かめる。
// SWF と期待値の作り直しは `node tools/mkas3.js` と `npm run oracle`。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';
import { realTrace, replayInput } from './helpers.js';

const FRAMES = 40; // 実機の出力は再生開始から数秒後（12 fps で 30 フレーム前後）に取っている

const dir = new URL('fixtures/', import.meta.url);
for (const file of readdirSync(dir).filter((f) => /^as3-.*\.swf$/.test(f)).sort()) {
  const name = file.slice(0, -4);
  test(`${name}: trace が実機と一致する`, async () => {
    // 時刻は実時間ではなく、1 フレーム進めるごとにフレーム間隔ぶん進める。
    let time = 0;
    // NetStream が再生するファイルは、SWF からの相対パスで探して渡す（実機と同じ場所のファイルを使う）。
    const media = (url) => { try { return readFileSync(new URL(url, dir)); } catch { return null; } };
    // Sound.load などの読み込みも、同じフォルダからの相対パスのファイルを返す（実機にも、同じローカルのファイルを読ませてある）。
    const network = { load: ({ url }) => media(url) };
    const movie = await Movie.load(readFileSync(new URL(file, dir)), { now: () => time, random: () => 0.5, media, network });
    // 入力の手順 (<名前>.input.json) があれば、それを与えたときの出力を、同じ入力を実機へ送って取った trace と比べる。
    const input = new URL(`${name}.input.json`, dir);
    const withInput = existsSync(input);
    if (withInput) {
      replayInput(movie, JSON.parse(readFileSync(input, 'utf8')), 3); // 実機では 1 手順が 0.25 秒（12 fps で 3 フレーム）
    } else {
      for (let i = 0; i < FRAMES; i++) {
        time += 1000 / movie.frameRate;
        movie.advance();
      }
    }
    const expected = realTrace(readFileSync(new URL(`expected/${name}.${withInput ? 'input.' : ''}trace.txt`, import.meta.url)));
    assert.deepEqual(movie.traces, expected);
    assert.deepEqual(movie.warnings, []);
  });
}
