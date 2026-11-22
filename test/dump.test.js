// web/dump.js（tools/swfdump.js の -D）。すべてのテスト用 SWF を、どのタグも解釈できずに終わることなく出せるかを確かめる。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inspectSWF } from '../web/inspect.js';
import { dumpContext, dumpTag } from '../web/dump.js';

test('すべてのテスト用 SWF を、例外なく、壊れた命令なしで出せる', async () => {
  for (const file of readdirSync(new URL('fixtures/', import.meta.url)).filter((f) => f.endsWith('.swf'))) {
    const report = await inspectSWF(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));
    const ctx = dumpContext(report.header.version);
    for (const row of report.tags) {
      const lines = dumpTag(row, ctx);
      const bad = lines.find((l) => /解釈できません|\(broken\)|\(truncated|Unknown_0x|unknown type/.test(l));
      assert.equal(bad, undefined, `${file}: ${row.name} at ${row.offset}`);
    }
  }
});

test('壊れたタグは例外を投げ、AVM1 の切れたアクションは、そこまでを出して切れた旨を書く', async () => {
  const report = await inspectSWF(readFileSync(new URL('fixtures/button.swf', import.meta.url)));
  const row = report.tags.find((t) => t.code === 2);
  assert.throws(() => dumpTag({ ...row, raw: { ...row.raw, body: row.raw.body.subarray(0, 12) } }, dumpContext(8)), { name: 'SWFError' });
  // Stop、Push（長さ 7 と書いてあるのに 3 バイトしかない）
  const lines = dumpTag({ raw: { code: 12, body: Uint8Array.from([0x07, 0x96, 0x07, 0x00, 0x00, 0x61, 0x00]) } }, dumpContext(8));
  assert.deepEqual(lines, ['0000  Stop', '0001  Push (truncated: length 7)']);
});
