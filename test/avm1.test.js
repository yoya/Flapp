// AVM1 の安全面（上限と、JS 側への影響が無いこと）のテスト。実機では試せない（止まってしまう）ものをここで確かめる。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { numberToString } from '../src/avm1/convert.js';
import { AVM1 } from '../src/avm1/interp.js';
import { AVMArray, AVMObject } from '../src/avm1/object.js';
import { Movie } from '../src/player/movie.js';
import { End, ShowFrame, callOtherClip, swf, tag, u16 } from '../tools/mkfixtures.js';

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

test('getURL は移動せず、要求された URL だけを記録する', async () => {
  // getURL("http://example.com/a", "_blank")（GetURL）と、スタックから取る形（GetURL2、POST）
  const strings = [...cstr('http://example.com/a'), ...cstr('_blank')];
  const getURL = [0x83, ...u16(strings.length), ...strings];
  const seen = [];
  const movie = await movieWith([[getURL, push('next.swf'), push('/clip'), [0x9a, 1, 0, 0x82]]], { onRequest: (r) => seen.push(r.url) });
  assert.deepEqual(movie.requests, [
    { kind: 'getURL', url: 'http://example.com/a', target: '_blank', method: '' },
    { kind: 'loadMovie', url: 'next.swf', target: '/clip', method: 'POST' },
  ]);
  assert.deepEqual(seen, ['http://example.com/a', 'next.swf']);
});
