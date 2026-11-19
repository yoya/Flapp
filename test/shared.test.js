// SharedObject の保存。ホストが storage オプションを渡したときだけ、data を保存して、次に再生したときに読み戻す。
// 実機は SharedObject をディスクに保存するが、サンドボックスの中では書けないので、実機との照合はしていない
// （test/as/sharedsave.as と test/as3/sharedsave.as は、保存する値の種類を並べたもの）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';
import { MAX_SAVED, decodeShared, encodeShared } from '../src/player/sharedstore.js';

const play = async (name, storage) => {
  const traces = [];
  const movie = await Movie.load(readFileSync(new URL(`fixtures/${name}.swf`, import.meta.url)), { trace: (s) => traces.push(s), storage });
  for (let i = 0; i < 4; i++) movie.advance();
  return { traces, movie };
};
const memory = () => {
  const files = new Map(), log = [];
  return { files, log, load: (name) => files.get(name) ?? null, save: (name, text) => { log.push(name); if (text === null) files.delete(name); else files.set(name, text); return true; } };
};

for (const [name, as3] of [['asx-sharedsave', false], ['as3x-sharedsave', true]]) {
  test(`${name}: storage が無ければ、再生をやり直すと消える`, async () => {
    const a = await play(name), b = await play(name);
    assert.equal(a.traces[0].split(' ')[0], 'n=1');
    assert.deepEqual(b.traces, a.traces);
  });

  test(`${name}: flush で保存して、次の再生で読み戻す`, async () => {
    const storage = memory();
    const first = await play(name, storage);
    const second = await play(name, storage);
    const third = await play(name, storage);
    assert.match(first.traces[0], /^n=1 /);
    assert.match(second.traces[0], /^n=2 /);
    assert.match(third.traces[0], /^n=3 /);
    // 2 回目以降も、保存した値が同じ形で戻る（関数・クリップ・Sprite は保存しない。-0 と NaN と Infinity は保つ）
    const rest = (t) => t.traces.slice(1, 4);
    assert.deepEqual(rest(second), rest(third));
    assert.equal(rest(second)[0], 'list=5 a true null undefined');
    assert.equal(rest(second)[1], `when=86400000 true nested=deep1`);
    assert.equal(rest(second)[2], `nan=NaN inf=-Infinity neg0=-Infinity fn=undefined ${as3 ? 'sprite' : 'mc'}=undefined`);
    // save2 は、保存した後に clear したので、保存先に残らない
    assert.deepEqual([...storage.files.keys()], ['save1']);
    assert.equal(second.traces.at(-2), 'other=undefined');
    assert.equal(second.traces.at(-1), 'cleared=undefined');
    assert.equal(second.traces.at(-3), 'flush=' + (as3 ? 'flushed' : 'true'));
  });
}

test('キーの順は、作った順のまま戻る', async () => {
  const storage = memory();
  const first = await play('asx-sharedsave', storage), second = await play('asx-sharedsave', storage);
  const keys = (t) => t.traces[0].replace(/^n=\d+ keys=/, '').split(',');
  assert.deepEqual(keys(second), keys(first).filter((k) => k !== 'mc' && k !== 'fn')); // 関数とクリップは保存しない
});

test('空のデータは保存先に残さない', async () => {
  const storage = memory();
  const { movie } = await play('asx-sharedsave', storage);
  movie.saveSharedObjects();
  assert.deepEqual([...storage.files.keys()], ['save1']); // save2 は clear したので、閉じるときにも書かれない
});

test('saveSharedObjects: flush しなくても、閉じるときに保存する', async () => {
  const storage = memory();
  const { movie } = await play('asx-sharedsave', storage);
  storage.files.clear(); // flush で書いたものを消して、saveSharedObjects だけで書き直す
  movie.saveSharedObjects();
  assert.ok(storage.files.has('save1'));
});

test('壊れた保存データは無いものとして扱う', async () => {
  for (const text of ['', 'x', '{"$":"o"}', '{"$":"o","v":[[1,2]]}', '{"$":"q"}', '[1]', 'null', '{"$":"o","v":"a"}']) {
    for (const name of ['asx-sharedsave', 'as3x-sharedsave']) {
      const storage = memory();
      storage.files.set('save1', text);
      assert.match((await play(name, storage)).traces[0], /^n=1 /, text);
    }
  }
});

test('サイズと深さの上限', () => {
  const adapter = {
    kind: (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v),
    time: (d) => d, items: (a) => a, entries: (o) => Object.entries(o),
  };
  assert.equal(encodeShared({ a: 'x'.repeat(MAX_SAVED) }, adapter), null);
  let deep = {};
  for (let i = 0; i < 100; i++) deep = { d: deep };
  assert.equal(encodeShared(deep, adapter), null);
  const cycle = {}; cycle.self = cycle;
  assert.equal(encodeShared(cycle, adapter), '{"$":"o","v":[["self",{"$":"u"}]]}');
  const builder = { undefined: () => undefined, date: (t) => t, array: (x) => x, object: (e) => Object.fromEntries(e) };
  assert.equal(decodeShared('x'.repeat(MAX_SAVED + 1), builder), undefined);
  let text = '{"$":"o","v":[]}';
  for (let i = 0; i < 100; i++) text = `{"$":"o","v":[["d",${text}]]}`;
  assert.equal(decodeShared(text, builder), undefined);
});
