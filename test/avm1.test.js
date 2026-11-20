// AVM1 の安全面（上限と、JS 側への影響が無いこと）のテスト。実機では試せない（止まってしまう）ものをここで確かめる。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { numberToString } from '../src/avm1/convert.js';
import { AVM1 } from '../src/avm1/interp.js';
import { AVMArray, AVMObject } from '../src/avm1/object.js';
import { Movie } from '../src/player/movie.js';
import { DefineSprite, End, PlaceObject2, ShowFrame, callOtherClip, square, swf, tag, u16 } from '../tools/mkfixtures.js';

// 手書きのアクション列
const cstr = (s) => [...new TextEncoder().encode(s), 0];
const push = (...strings) => { const body = strings.flatMap((s) => [0, ...cstr(s)]); return [0x96, ...u16(body.length), ...body]; };
const jump = (offset) => [0x99, 2, 0, offset & 0xff, (offset >> 8) & 0xff];
const GetVariable = 0x1c, SetVariable = 0x1d, Add2 = 0x47, Trace = 0x26, DefineLocal = 0x3c;
const movieWith = (frames, options) => Movie.load(swf({
  version: 8, frames: frames.length,
  tags: [...frames.flatMap((actions) => [tag(12, [...actions.flat(), 0]), ShowFrame()]), End()],
}), options);

test('終わらないループは命令数の上限で止まり、以後のスクリプトは実行しない', async () => {
  const movie = await movieWith([[push('before'), Trace, jump(-5), push('after'), Trace], [push('frame 2'), Trace]], { avm: { maxSteps: 10000 } });
  assert.deepEqual(movie.traces, ['before']);
  assert.deepEqual(movie.warnings, ['scripts are disabled: script runs too long']);
  movie.advance(); // 再生自体は続く
  assert.equal(movie.root.currentFrame, 2);
  assert.deepEqual(movie.traces, ['before']);
});

test('倍々に伸びる文字列は長さの上限で止まる', async () => {
  // s = "x"; for (;;) s = s + s;
  const body = [push('s'), push('s'), GetVariable, push('s'), GetVariable, Add2, SetVariable];
  const size = body.flat().length;
  const movie = await movieWith([[push('s', 'x'), DefineLocal, ...body, jump(-(size + 5))]]);
  assert.deepEqual(movie.warnings, ['scripts are disabled: string is too long']);
});

test('オブジェクトや配列を作り続けると割り当ての上限で止まる', () => {
  const vm = new AVM1();
  vm.allocations = 1000;
  assert.throws(() => { for (;;) new AVMObject(vm, null); }, /allocates too much/);
  vm.allocations = 1000;
  const a = new AVMArray(vm);
  assert.throws(() => { for (let i = 0; ; i++) a.set(String(i), i); }, /allocates too much/);
  // 巨大な添字は配列の要素にせず、普通のプロパティとして持つ（長さは変わらない）
  vm.allocations = Infinity;
  const b = new AVMArray(vm);
  b.set('4000000000', 1);
  assert.equal(b.items.length, 0);
  assert.equal(b.get('4000000000'), 1);
});

test('スクリプトのプロパティ名は JS のオブジェクトに影響しない', () => {
  const vm = new AVM1();
  const o = new AVMObject(vm, vm.objectProto);
  const evil = new AVMObject(vm, null);
  evil.set('polluted', 'yes');
  o.set('__proto__', evil); // スクリプト上の継承元を差し替えるだけ
  o.set('constructor', 'c');
  o.set('toString', 'ts');
  o.set('hasOwnProperty', 'h');
  assert.equal(o.get('polluted'), 'yes');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(typeof o.toString, 'function'); // JS のメソッドはそのまま
  assert.equal(typeof o.hasOwnProperty, 'function');
  assert.equal(o.constructor, AVMObject);
  assert.deepEqual([...o.props.keys()], ['constructor', 'toString', 'hasOwnProperty']);
  // __proto__ が循環していても止まる
  const a = new AVMObject(vm, null);
  const b = new AVMObject(vm, a);
  a.set('__proto__', b);
  assert.equal(a.get('nothing'), undefined);
  assert.deepEqual(a.enumerate(), []);
});

test('数値の文字列化は実機の桁取りをなぞる', () => {
  const cases = [
    [0.1 + 0.2, '0.3'], [1 / 3, '0.333333333333333'], [100 / 3, '33.3333333333333'], [1e21, '1e+21'], [1e15, '1e+15'],
    [1e14, '100000000000000'], [123456789012345678, '1.23456789012346e+17'], [0.00001, '0.00001'], [0.000001, '1e-6'],
    [1.5e-7, '1.5e-7'], [-0, '0'], [2147483648, '2147483648'], [-2147483649, '-2147483649'], [255.5, '255.5'],
    [Number.MAX_VALUE, '1.79769313486231e+308'], [Number.MIN_VALUE, '4.94065645841247e-324'],
    [9007199254740993, '9.00719925474099e+15'], [-1.5e-7, '-1.5e-7'], [-123.456, '-123.456'], [NaN, 'NaN'], [-Infinity, '-Infinity'],
  ];
  for (const [n, expected] of cases) assert.equal(numberToString(n), expected, String(n));
});

test('別のクリップのフレームを call すると、呼ばれた側のクリップを対象に実行される', async () => {
  // リリース版の実機では、四角が (150, 100) px に表示される（デバッガ版はこの SWF で落ちる）。
  const movie = await Movie.load(callOtherClip);
  const card = movie.root.childByName('card');
  assert.deepEqual([card.matrix.tx, card.matrix.ty], [3000, 2000]);
  assert.deepEqual([movie.root.matrix.tx, movie.root.matrix.ty], [0, 0]);
});

test('getURL は要求を記録し、移動はホストの network.navigate に任せる', async () => {
  // getURL("http://example.com/a", "_blank")（GetURL）と、スタックから取る形（GetURL2）。GetURL2 のフラグは、最上位が
  // 変数の読み込み、次が対象がクリップ、下位 2 ビットがメソッド（仕様書の表と逆の並び。実機で確認）。
  const strings = [...cstr('http://example.com/a'), ...cstr('_blank')];
  const getURL = [0x83, ...u16(strings.length), ...strings];
  const getURL2 = (url, target, flags) => [push(url), push(target), [0x9a, 1, 0, flags]];
  const seen = [];
  const navigated = [];
  const SetVariable = 0x1d;
  const movie = await movieWith([[
    push('greeting'), push('hi there'), SetVariable,
    getURL,
    ...getURL2('next.swf', '/clip', 0x42), // ムービーの読み込み（POST）: 移動ではない
    ...getURL2('http://example.com/b', '_self', 0x01), // 移動（GET）: ルートの変数を付ける
    ...getURL2('FSCommand:quit', '', 0x00), // fscommand は移動ではない
    ...getURL2('other.swf', '_level1', 0x00), // レベルへの読み込み（loadMovieNum）は、移動ではない
  ]], { onRequest: (r) => seen.push(r.url), network: { navigate: (r) => navigated.push(r) } });
  assert.deepEqual(movie.requests, [
    { kind: 'getURL', url: 'http://example.com/a', target: '_blank', method: '' },
    { kind: 'loadMovie', url: 'next.swf', target: '/clip', method: 'POST' },
    { kind: 'getURL', url: 'http://example.com/b', target: '_self', method: 'GET' },
    { kind: 'getURL', url: 'FSCommand:quit', target: '', method: '' },
    { kind: 'loadMovie', url: 'other.swf', target: '_level1', method: '' },
  ]);
  assert.deepEqual(seen, ['http://example.com/a', 'next.swf', 'http://example.com/b', 'FSCommand:quit', 'other.swf']);
  assert.deepEqual(navigated, [
    { kind: 'getURL', url: 'http://example.com/a', target: '_blank', method: '', data: '' },
    // 送る変数は、作った順（for..in とは逆）で、空白は + にする。ルートの $version は送らない（loadVariablesNum の GET で実機に確認）。
    { kind: 'getURL', url: 'http://example.com/b', target: '_self', method: 'GET', data: 'greeting=hi+there' },
  ]);
  // ホストが network を渡していなければ、何も起きない（要求の記録だけ）。
  const quiet = await movieWith([[getURL]]);
  assert.equal(quiet.requests.length, 1);
  assert.deepEqual(quiet.warnings, []);
});

test('SWF 4: 回転と拡大率の代入は、実機の固定小数の計算の端数まで（ほぼ）同じになる', async () => {
  // 実機は、0.25 度きざみの表と、重みが 1/4 しかない補間で sin / cos を求める。0.25 度の倍数でない角度を入れると、
  // 読み戻した回転は手前の 0.25 度の倍数に寄り、拡大率は少し縮む。拡大率の代入は、今の値との差が 16/65536 以下なら何もしない。
  // 期待値は、同じ手順を実機（SWF 4）で動かして読み戻した値。拡大率には、再現していない 0.01 ほどの端数が残る。
  const get = (index) => [push('mc'), push(String(index)), 0x22];
  const set = (index, value) => [push('mc'), push(String(index)), value, 0x23];
  const show = [get(10), push(' '), 0x21, get(2), 0x21, push(' '), 0x21, get(3), 0x21, Trace];
  const steps = { t: show, rd: (v) => set(10, [get(10), push(v), 0x0a]), r: (v) => set(10, push(v)), x: (v) => set(2, push(v)), y: (v) => set(3, push(v)) };
  const run = async (matrix, script) => {
    const actions = script.split(',').map((s) => { const [op, v] = s.split('='); return v === undefined ? steps[op] : steps[op](v); });
    const movie = await Movie.load(swf({ version: 4, tags: [
      square(1, 800, [255, 0, 0]),
      DefineSprite(2, 1, [PlaceObject2({ depth: 1, id: 1 }), ShowFrame(), End()]),
      PlaceObject2({ depth: 1, id: 2, name: 'mc', matrix: { ...matrix, tx: 2400, ty: 1600 } }),
      tag(12, [...actions.flat(Infinity), 0], true),
      ShowFrame(), End(),
    ] }));
    assert.deepEqual(movie.warnings, []);
    return movie.traces.map((line) => line.split(' ').map(Number));
  };
  const close = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((values, i) => values.forEach((v, k) => assert.ok(Math.abs(v - expected[i][k]) <= (k === 0 ? 0.003 : 0.012), `step ${i}: ${values} / ${expected[i]}`)));
  };
  // 縦横の拡大率が違う行列（実物のムービーにあったもの）に、「回転を 2 度戻して、拡大率を 100 に」を 2 回。
  close(await run({ a: -0.1584320068359375, b: -0.982391357421875, c: 1.5407562255859375, d: -0.24847412109375 }, 't,rd=-2,t,x=100,t,y=100,t,rd=-2,t,x=100,t,y=100,t'), [
    [-99.1612243652344, 99.5101928710938, 156.069946289063],
    [-101.047241210938, 99.45068359375, 155.978393554688],
    [-101.018615722656, 99.9404907226563, 155.978393554688],
    [-101.018615722656, 99.9404907226563, 99.9404907226563],
    [-103.014785766602, 99.8687744140625, 99.8687744140625],
    [-103.013961791992, 99.9282836914063, 99.8687744140625],
    [-103.013961791992, 99.9282836914063, 99.9282836914063],
  ]);
  // 0.25 度の倍数は正確。そうでない角度は、同じ値を入れ直すたびに行列が作り直されて、少しずつ寄っていく。
  close(await run({}, 'r=10.25,t,r=10.1,t,rd=0,t,rd=0,t,rd=0,t'), [
    [10.2501373291016, 100.001525878906, 100.001525878906],
    [10.0298767089844, 99.9465942382813, 99.9465942382813],
    [10.0137634277344, 99.8916625976563, 99.8916625976563],
    [10.009521484375, 99.8367309570313, 99.8367309570313],
    [10.0078277587891, 99.7817993164063, 99.7817993164063],
  ]);
  // 拡大率は、差が 16/65536 以下の代入を無視する（99.976 は 16、99.975 は 17 の差）。
  close(await run({}, 'x=99.98,t,x=99.976,t,x=99.975,t,x=50,x=50.02,t,x=50.03,t'), [
    [0, 100, 100], [0, 100, 100], [0, 99.9740600585938, 100], [0, 50, 100], [0, 50.0289916992188, 100],
  ]);
});

test('LoadVars / XML の送信と、変数を付けた getURL / loadVariables は、ホストの network に任せる', async () => {
  // test/as/netsend.as（実機では確かめられないので、期待値は手で書いたもの）。
  const answers = { 'echo.txt': 'echo=got+it', 'xml-echo.txt': '<ok/>', 'vars.txt': 'answer=42' };
  const calls = [];
  const network = {
    load: (r) => {
      calls.push(`load ${r.method} ${r.url} [${r.data ? new TextDecoder().decode(r.data) : ''}] ${r.contentType}`);
      return answers[r.url] ? new TextEncoder().encode(answers[r.url]) : null;
    },
    navigate: (r) => calls.push(`navigate ${r.method} ${r.url} ${r.target} [${r.data.slice(0, 30)}]`),
  };
  const run = async (options) => {
    let time = 0;
    const movie = await Movie.load(readFileSync(new URL('fixtures/asx-netsend.swf', import.meta.url)), { now: () => time, ...options });
    for (let i = 0; i < 4; i++) {
      time += 1000 / movie.frameRate;
      movie.advance();
    }
    return movie;
  };
  const movie = await run({ network });
  assert.deepEqual(movie.traces, ['sendAndLoad true', 'send true', 'reply true status=undefined echo=got it', 'xml reply true ok', 'box onData answer=42']);
  assert.deepEqual(calls, [
    'load POST echo.txt [score=12&user=yo%20ya] application/x-www-form-urlencoded', // sendAndLoad: 中身を本文にして送る
    'navigate POST http://example.com/form _blank [score=12&user=yo%20ya]', // send: 中身を付けて移動する
    'load POST xml-echo.txt [<a b="1">x</a>] application/x-www-form-urlencoded',
    'navigate GET http://example.com/page _self [form=score%3D12%26user%3Dyo%25]', // getURL(…, "GET"): ルートの変数を作った順に付ける（先頭は form。LoadVars は toString の文字列）
    'load GET next.swf [] null', // getURL(…, "_level1") は、レベルへの読み込み
    'load POST vars.txt [color=red] application/x-www-form-urlencoded', // box.loadVariables(…, "POST"): box の変数を送る
  ]);
  assert.deepEqual(movie.warnings, []);
  // network が無ければ、読み込みは失敗として伝わり、移動は起きない。
  const offline = await run({});
  assert.deepEqual(offline.traces, ['sendAndLoad true', 'send true', 'reply false status=undefined echo=undefined', 'xml reply false undefined']);
});

test('BitmapData.draw は、テキストフィールドも描く処理に渡す', async () => {
  // 描く処理（ブラウザでは CanvasRenderer）の代わりに、受け取ったものを覚えて、全体を赤く塗った画像を返す。
  const got = [];
  const rasterize = (movie, d, m, width, height) => {
    got.push([d.constructor.name, d.text, m.a, m.tx, width, height]);
    return new Uint8ClampedArray(width * height * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
  };
  const movie = await Movie.load(readFileSync(new URL('fixtures/asx-drawtext.swf', import.meta.url)), { rasterize });
  assert.deepEqual(got, [['TextField', 'abc', 2, 1, 4, 4]]);
  assert.deepEqual(movie.traces, ['ff0000']);
});
