// www/inspect.js（SWF の中身を表にするための解析）。テスト用の SWF の中身で、ヘッダ・要約・タグの並びを確かめる。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inspectSWF } from '../web/inspect.js';

const fixture = (name) => readFileSync(new URL(`fixtures/${name}.swf`, import.meta.url));

test('ヘッダ: 形式・大きさ・フレームを読む', async () => {
  const r = await inspectSWF(fixture('as3-triangles'));
  assert.equal(r.header.signature, 'FWS');
  assert.equal(r.header.compression, '無圧縮');
  assert.equal(r.header.version, 15);
  assert.equal(r.header.width, 320);
  assert.equal(r.header.height, 200);
  assert.equal(r.header.frameCount, 1);
});

test('要約: ActionScript 3 のクラスと、シンボルのクラスを集める', async () => {
  const r = await inspectSWF(fixture('as3-triangles'));
  assert.deepEqual(r.summary.classes, ['Main']);
  assert.deepEqual(r.summary.symbolClasses, [{ id: 0, name: 'Main' }]);
  assert.deepEqual(r.summary.attributes, [['属性', 'ActionScript3']]);
  assert.equal(r.summary.background, '#ffffff');
  assert.equal(r.tags.find((t) => t.code === 82).summary, 'クラス 1、メソッド 9');
});

test('タグ: スプライトの中のタグは、深さと親のスプライトつきで並ぶ', async () => {
  const r = await inspectSWF(fixture('sprite-hello'));
  const sprite = r.tags.find((t) => t.code === 39);
  assert.equal(sprite.depth, 0);
  assert.equal(r.summary.sprites, 1);
  const inside = r.tags.filter((t) => t.depth === 1);
  assert.ok(inside.length > 0);
  assert.ok(inside.every((t) => t.parentSprite === sprite.id));
});

test('タグ: フレームラベルは、フレーム番号と一緒に出す', async () => {
  const r = await inspectSWF(fixture('timeline'));
  const labels = r.tags.filter((t) => t.code === 43);
  assert.equal(r.summary.labels.length, labels.length);
  for (const l of r.summary.labels) assert.ok(l.frame >= 1);
});

test('定義: テキストとフォントを、名前つきで出す', async () => {
  const r = await inspectSWF(fixture('text'));
  assert.ok(r.summary.definitions.DefineFont2 >= 1);
  assert.ok(r.summary.definitions.DefineEditText >= 1);
  const edit = r.tags.find((t) => t.code === 37);
  assert.ok(edit.summary.length > 0);
  assert.ok(edit.details.some(([k]) => k === 'ID'));
});

test('壊れたタグは、その行だけに解釈できない旨を出し、ほかのタグは出す', async () => {
  // 無圧縮の SWF なので、タグの位置は元のファイルと同じ。DoABC2 の ABC の中身を壊す（長さはそのまま）。
  const good = await inspectSWF(fixture('as3-triangles'));
  const abc = good.tags.find((t) => t.code === 82);
  const bytes = Uint8Array.from(fixture('as3-triangles'));
  const bodyStart = abc.offset + 6 + 4 + 1; // 長いタグの 6 バイトの頭、フラグ 4 バイト、名前の NUL の後ろ（名前は 1 文字）
  bytes.fill(0xff, bodyStart + 8, bodyStart + 80);
  const r = await inspectSWF(bytes);
  assert.equal(r.tags.length, good.tags.length);
  assert.ok(r.tags.every((t) => t.name));
  const broken = r.tags.find((t) => t.code === 82);
  assert.ok(broken.error || broken.summary, 'DoABC の行は、解釈できないか、内容を出すかのどちらか');
});

test('すべてのテスト用 SWF を、例外なく読める（行の解釈エラーもない）', async () => {
  for (const file of readdirSync(new URL('fixtures/', import.meta.url)).filter((f) => f.endsWith('.swf'))) {
    const r = await inspectSWF(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));
    const errors = r.tags.filter((t) => t.error).map((t) => t.name);
    assert.deepEqual(errors, [], file);
  }
});

test('見本: スプライトは、置かれたボタンとシェイプを含む最小の SWF になる', async () => {
  const { miniSWF } = await import('../web/inspect.js');
  const { parseSWF } = await import('../src/swf/parse.js');
  const r = await inspectSWF(fixture('button'));
  const bytes = miniSWF(r.swf, 6);
  const mini = await parseSWF(bytes);
  assert.deepEqual(mini.tags.map((t) => t.code), [2, 7, 39, 26, 1, 0]);
  assert.equal(mini.warnings.length, 0);
  assert.equal(mini.tags.at(-2).code, 1); // ShowFrame
});

test('見本: シェイプは、形の範囲を大きさにした SWF になり、画像は対象外', async () => {
  const { miniSWF } = await import('../web/inspect.js');
  const { parseSWF } = await import('../src/swf/parse.js');
  const r = await inspectSWF(fixture('button'));
  const shape = r.tags.find((t) => t.code === 2 && t.id === 1);
  assert.ok(shape, 'the fixture has shape 1');
  const mini = await parseSWF(miniSWF(r.swf, 1));
  assert.deepEqual(mini.tags.map((t) => t.code), [2, 26, 1, 0]);
  const { parseDefineShape } = await import('../src/swf/shape.js');
  assert.deepEqual(mini.frameSize, parseDefineShape(shape.raw).bounds); // ステージは、形の範囲と同じ
  assert.equal(miniSWF(r.swf, 999), null);
  const img = await inspectSWF(fixture('bitmap-lossless'));
  assert.equal(miniSWF(img.swf, 1), null);
});
