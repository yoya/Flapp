// コミット済みのテスト用 SWF が生成器の出力と一致し、実機の trace 期待値が揃っていることを確認する。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fixtures } from '../tools/mkfixtures.js';

for (const [name, bytes] of Object.entries(fixtures)) {
  test(`fixture ${name}`, () => {
    const committed = readFileSync(new URL(`fixtures/${name}.swf`, import.meta.url));
    assert.deepEqual(new Uint8Array(committed), bytes, 'npm run fixtures で再生成が必要');
    assert.ok(existsSync(new URL(`expected/${name}.trace.txt`, import.meta.url)), 'npm run oracle で実機の trace 取得が必要');
  });
}
