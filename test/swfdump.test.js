// tools/swfdump.js（SWF のタグ一覧。-d / --hex で、タグの中身も出す）の出力を確かめる。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const tool = fileURLToPath(new URL('../tools/swfdump.js', import.meta.url));
const fixture = fileURLToPath(new URL('fixtures/as3-triangles.swf', import.meta.url));
const run = (...args) => execFileSync(process.execPath, [tool, ...args], { encoding: 'utf8' });

test('既定: タグ一覧だけを出す（中身は出さない）', () => {
  const out = run(fixture);
  assert.match(out, /FileAttributes/);
  assert.doesNotMatch(out, /属性: /);
});

test('-d: タグの中身（解釈した項目）も出す', () => {
  const out = run('-d', fixture);
  assert.match(out, /属性: ActionScript3/);
  assert.match(out, /クラス: Main/);
  assert.match(out, /ID 0: Main/);
});

test('--hex: 中身の 16 進ダンプも出す', () => {
  const out = run('--hex', fixture);
  assert.match(out, /000000  /);
});
