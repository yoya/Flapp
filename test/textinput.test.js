// テキストフィールドへの入力（クリックでフォーカス、打鍵、BackSpace・矢印、選択、restrict、maxChars、イベント）。
// 実機へはキー入力を送れないので、期待値は仕様と、スクリプトから見える動き（test/as3/textfocus.as で実機と照合した値）に基づく。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';
import { restricts } from '../src/player/textedit.js';

async function open() {
  const movie = await Movie.load(readFileSync(new URL('fixtures/as3x-textinput.swf', import.meta.url)), { now: () => 0 });
  movie.advance();
  const field = (name) => [...movie.root.children.values()].find((c) => c.name === name);
  const click = (x, y) => { movie.mouseMove(x * 20, y * 20); movie.mouseDown(); movie.mouseUp(); };
  return { movie, a: field('a'), b: field('b'), c: field('c'), click };
}
const tail = (movie, n) => movie.traces.slice(-n);

test('クリックでフォーカスが移り、focusIn / focusOut が届く。外をクリックすると外れる', async () => {
  const { movie, a, c, click } = await open();
  click(50, 12);
  assert.equal(movie.focus, a);
  assert.deepEqual(movie.traces, ['focusIn a']);
  click(50, 120);
  assert.equal(movie.focus, c); // 選べる文字なので、静的なテキストにもフォーカスが移る
  assert.deepEqual(movie.traces, ['focusIn a', 'focusOut a c']);
  click(250, 190);
  assert.equal(movie.focus, null);
});

test('打ち込んだ文字は選択の位置に入り、textInput が先、change があとに届く', async () => {
  const { movie, a, click } = await open();
  click(50, 12);
  movie.textInput('abc');
  assert.equal(a.text, 'abc');
  assert.deepEqual([a.selection, a.caret], [[3, 3], 3]);
  assert.deepEqual(tail(movie, 2), ['textInput abc', 'change abc']);
  a.setSelection(1, 2);
  movie.textInput('Z');
  assert.equal(a.text, 'aZc'); // 選択は置き換わる
});

test('textInput を取り消すと、文字は入らない。静的なテキストにも入らない', async () => {
  const { movie, a, c, click } = await open();
  click(50, 12);
  movie.textInput('x');
  assert.equal(a.text, '');
  assert.deepEqual(tail(movie, 1), ['textInput x']);
  click(50, 120);
  movie.textInput('q');
  assert.equal(c.text, 'static');
});

test('restrict と maxChars', async () => {
  const { movie, a, click } = await open();
  click(50, 12);
  a.restrict = '0-9';
  a.maxChars = 3;
  movie.textInput('a1b2c3d4');
  assert.equal(a.text, '123');
  movie.textInput('9');
  assert.equal(a.text, '123');
});

test('BackSpace・Delete・矢印・Home・End', async () => {
  const { movie, a, click } = await open();
  click(50, 12);
  movie.textInput('abcde');
  movie.keyDown(8);
  assert.equal(a.text, 'abcd');
  movie.keyDown(37); movie.keyDown(37);
  assert.equal(a.caret, 2);
  movie.keyDown(46);
  assert.equal(a.text, 'abd');
  movie.keyDown(36);
  assert.equal(a.caret, 0);
  movie.keyDown(8); // 先頭の BackSpace は何も消さない
  assert.equal(a.text, 'abd');
  movie.keyDown(35);
  assert.equal(a.caret, 3);
});

test('Shift + 矢印で選択を広げ、Ctrl + A で全部を選ぶ', async () => {
  const { movie, a, click } = await open();
  click(50, 12);
  movie.textInput('abcd');
  movie.keyDown(37, 0, { shift: true });
  movie.keyDown(37, 0, { shift: true });
  assert.deepEqual([a.selection, a.caret], [[2, 4], 2]);
  movie.keyDown(39, 0, { shift: true });
  assert.deepEqual(a.selection, [3, 4]);
  movie.keyDown(65, 97, { ctrl: true });
  assert.deepEqual(a.selection, [0, 4]);
  movie.textInput('Q');
  assert.equal(a.text, 'Q');
});

test('Enter は複数行のフィールドでだけ改行になる。Tab で次の入力フィールドへ移る', async () => {
  const { movie, a, b, click } = await open();
  click(50, 12);
  movie.textInput('a');
  movie.keyDown(13, 13);
  assert.equal(a.text, 'a');
  movie.keyDown(9, 0);
  assert.equal(movie.focus, b);
  movie.textInput('x');
  movie.keyDown(13, 13);
  movie.textInput('y');
  assert.equal(b.text, 'x\ry');
  movie.keyDown(9, 0, { shift: true });
  assert.equal(movie.focus, a);
});

test('キーのイベントは、フォーカスのあるものに届く', async () => {
  const { movie, click } = await open();
  movie.keyDown(65, 97);
  assert.match(tail(movie, 1)[0], /^keyDown 65 \S+ false false$/); // フォーカスが無ければ、ステージが相手
  click(50, 12);
  movie.keyDown(66, 98, { ctrl: true, shift: true });
  assert.equal(tail(movie, 1)[0], 'keyDown 66 a true true');
});

test('マウスのドラッグで文字を選ぶ', async () => {
  const { movie, a, click } = await open();
  click(50, 12);
  movie.textInput('abcdef');
  movie.mouseMove(2 * 20, 12 * 20); movie.mouseDown();
  movie.mouseMove(150 * 20, 12 * 20);
  movie.mouseUp();
  assert.deepEqual(a.selection, [0, 6]);
});

test('restrict の書き方', () => {
  assert.equal(restricts(null, 'a'), true);
  assert.equal(restricts('', 'a'), false);
  assert.deepEqual([...'aBc1'].map((ch) => restricts('a-c', ch)), [true, false, true, false]);
  assert.deepEqual([...'aBc1'].map((ch) => restricts('^a-c', ch)), [false, true, false, true]);
  assert.deepEqual([...'ab1'].map((ch) => restricts('a-z^b', ch)), [true, false, false]);
  assert.equal(restricts('\\-', '-'), true);
  assert.equal(restricts('\\^', '^'), true);
  assert.equal(restricts('0-9\\-', '-'), true);
});

test('AS2: onChanged が届き、連動する変数が更新される。Selection でフォーカスが読める', async () => {
  const movie = await Movie.load(readFileSync(new URL('fixtures/asx-textinput.swf', import.meta.url)), { now: () => 0 });
  movie.advance();
  const field = (name) => [...movie.root.children.values()].find((c) => c.name === name);
  const a = field('a'), b = field('b');
  movie.mouseMove(50 * 20, 12 * 20); movie.mouseDown(); movie.mouseUp();
  assert.equal(movie.focus, a);
  movie.textInput('XY');
  assert.equal(a.text, 'initXY'); // フィールドの右の空きをクリックすると、キャレットは末尾
  assert.deepEqual(movie.traces, ['a.onSetFocus null', 'onChanged a initXY v=initXY']);
  movie.keyDown(9, 0);
  assert.equal(movie.focus, b);
  movie.keyDown(9, 0);
  assert.equal(movie.traces.at(-1), 'a.onSetFocus _level0.b');
  assert.equal(movie.focus, a);
});
