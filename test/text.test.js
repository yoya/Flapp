import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';
import { parseSWF } from '../src/swf/parse.js';
import { editTextToPaths, parseDefineEditText, parseDefineFont, parseDefineFontInfo, parseDefineText, textToPaths } from '../src/swf/text.js';
import { fixtures } from '../tools/mkfixtures.js';

const text = (path) => path.map((c) => c.join(' ')).join(' ');
const tagsOf = async (name) => (await parseSWF(fixtures[name])).tags;
const fontsOf = async () => {
  const fonts = new Map();
  for (const t of await tagsOf('text')) if ([10, 48, 75].includes(t.code)) fonts.set(new DataView(t.body.buffer, t.body.byteOffset).getUint16(0, true), parseDefineFont(t));
  return fonts;
};

test('DefineFont2 / DefineFont3 / DefineFont', async () => {
  const fonts = await fontsOf();
  const f2 = fonts.get(1);
  assert.deepEqual([f2.name, f2.glyphCount, f2.unitsPerEm, f2.bold, f2.italic], ['Flapp Test', 3, 1024, false, false]);
  assert.deepEqual(f2.codes, [73, 76, 79]); // I, L, O
  assert.deepEqual(f2.advances, [700, 700, 700]);
  assert.deepEqual([f2.ascent, f2.descent, f2.leading], [800, 200, 0]);
  assert.equal(text(f2.glyphPath(0)), 'M 250 -700 L 400 -700 L 400 0 L 250 0 L 250 -700 Z');
  // O は外周と穴の 2 つの輪郭
  assert.equal(text(f2.glyphPath(2)), 'M 100 -700 L 600 -700 L 600 0 L 100 0 L 100 -700 Z M 250 -550 L 250 -150 L 450 -150 L 450 -550 L 250 -550 Z');
  assert.equal(f2.glyphPath(3), null);
  assert.equal(f2.glyphPath(-1), null);

  // DefineFont3 は座標・送り幅とも 20 倍
  const f3 = fonts.get(2);
  assert.equal(f3.unitsPerEm, 20480);
  assert.deepEqual(f3.advances, [14000, 14000, 14000]);
  assert.equal(text(f3.glyphPath(0)), 'M 5000 -14000 L 8000 -14000 L 8000 0 L 5000 0 L 5000 -14000 Z');

  // DefineFont はグリフだけ
  const f1 = fonts.get(3);
  assert.deepEqual([f1.glyphCount, f1.codes, f1.advances], [3, null, null]);
  assert.equal(text(f1.glyphPath(1)), text(f2.glyphPath(1)));
});

test('DefineText: レコードと描画命令', async () => {
  const fonts = await fontsOf();
  const tags = await tagsOf('text');
  const t = parseDefineText(tags.find((x) => x.code === 11));
  assert.equal(t.id, 10);
  assert.deepEqual(t.records, [
    { fontId: 1, color: { r: 200, g: 0, b: 0, a: 255 }, xOffset: 0, yOffset: 800, height: 800, glyphs: [{ index: 1, advance: 547 }, { index: 2, advance: 547 }, { index: 1, advance: 547 }] },
    { color: { r: 0, g: 0, b: 200, a: 255 }, xOffset: 100, yOffset: 1700, glyphs: [{ index: 0, advance: 547 }, { index: 2, advance: 547 }] },
  ]);

  const ops = textToPaths(t, (id) => fonts.get(id));
  assert.equal(ops.length, 5);
  assert.ok(ops.every((o) => o.kind === 'fill' && o.evenOdd));
  // 1 文字目の L: 高さ 800 なので倍率 800/1024、ベースラインは y=800
  assert.equal(text(ops[0].path), 'M 78.125 253.125 L 195.3125 253.125 L 195.3125 682.8125 L 468.75 682.8125 L 468.75 800 L 78.125 800 L 78.125 253.125 Z');
  assert.deepEqual(ops[0].style.color, { r: 200, g: 0, b: 0, a: 255 });
  // 2 文字目は送り幅 547 だけ右
  assert.equal(ops[1].path[0][1], 547 + 78.125);
  // 2 レコード目はフォントと高さを引き継ぎ、位置と色だけ変わる
  assert.deepEqual(ops[3].path[0], ['M', 100 + 250 * (800 / 1024), 1700 - 700 * (800 / 1024)]);
  assert.deepEqual(ops[3].style.color, { r: 0, g: 0, b: 200, a: 255 });
  // フォントが無ければ何も描かない
  assert.deepEqual(textToPaths(t, () => undefined), []);
});

test('DefineText2: アルファつきの色と行列', async () => {
  const fonts = await fontsOf();
  const t = parseDefineText((await tagsOf('text')).find((x) => x.code === 33));
  assert.deepEqual(t.records[0].color, { r: 0, g: 120, b: 0, a: 128 });
  assert.deepEqual(t.matrix, { a: 1.5, b: 0, c: Math.round(-0.3 * 65536) / 65536, d: 1, tx: 0, ty: 0 });
  const ops = textToPaths(t, (id) => fonts.get(id));
  // L の左上 (100, -700) em → 高さ 400: (39.0625, 126.5625) → 行列で x' = 1.5x + c*y
  const [, x, y] = ops[0].path[0];
  assert.ok(Math.abs(x - (1.5 * 39.0625 + t.matrix.c * 126.5625)) < 1e-9);
  assert.equal(y, 126.5625);
});

test('DefineEditText: 枠・中央寄せ・複数行', async () => {
  const fonts = await fontsOf();
  const e = parseDefineEditText((await tagsOf('text')).find((x) => x.code === 37));
  assert.deepEqual(
    [e.id, e.fontId, e.height, e.text, e.multiline, e.border, e.useOutlines, e.readOnly, e.html, e.align, e.leading, e.variableName],
    [13, 1, 500, 'LOL\rIO', true, true, true, true, false, 'center', 40, ''],
  );
  assert.deepEqual(e.color, { r: 0, g: 0, b: 160, a: 255 });

  const ops = editTextToPaths(e, (id) => fonts.get(id));
  assert.deepEqual(ops.map((o) => o.kind), ['fill', 'stroke', 'fill', 'fill', 'fill', 'fill', 'fill']);
  assert.equal(text(ops[0].path), 'M 0 0 L 2200 0 L 2200 1300 L 0 1300 Z');
  assert.equal(ops[1].style.width, 1); // 極細線
  // 1 行目 "LOL" の幅は 3 × 700 × 500/1024。内側の幅 2200 - 80 の中央に置く
  const scale = 500 / 1024;
  const start = 40 + (2120 - 3 * 700 * scale) / 2;
  assert.deepEqual(ops[2].path[0], ['M', start + 100 * scale, 40 + (800 - 700) * scale]);
  // 2 行目は (ascent + descent) × 倍率 + leading だけ下
  const second = ops[5].path[0];
  assert.equal(second[2], 40 + 1000 * scale + 40 + (800 - 700) * scale);
});

test('テキストフィールド: 字形が無ければ端末フォント、HTML とパスワード', () => {
  const base = {
    bounds: { xmin: 0, xmax: 2000, ymin: 0, ymax: 400 }, color: { r: 1, g: 2, b: 3, a: 255 }, height: 240,
    align: 'right', leftMargin: 100, rightMargin: 0, indent: 0, leading: 0, multiline: true,
  };
  let ops = editTextToPaths({ ...base, text: 'あ\nb' }, () => undefined);
  assert.deepEqual(ops.map((o) => [o.kind, o.text, o.x, o.y, o.width, o.align, o.size]), [
    ['text', 'あ', 140, 40, 1820, 'right', 240],
    ['text', 'b', 140, 40 + 240, 1820, 'right', 240], // 行の高さは、実機で測った式（大きさ 12 で 12 px）
  ]);
  ops = editTextToPaths({ ...base, html: true, text: '<p align="left"><font color="#ff0000">a &lt; b</font></p><p>c&amp;d</p>' }, () => undefined);
  assert.deepEqual(ops.map((o) => o.text), ['a < b', 'c&d']);
  ops = editTextToPaths({ ...base, password: true, multiline: false, text: 'abc\rde' }, () => undefined);
  assert.deepEqual(ops.map((o) => o.text), ['*****']);
  assert.deepEqual(editTextToPaths({ ...base, text: '' }, () => undefined), []);
});

test('テキストは置ける。フォントは置けない', async () => {
  const movie = await Movie.load(fixtures.text);
  assert.deepEqual(movie.warnings, []);
  // 静的テキストは図形、テキストフィールドは内容を変えられる表示オブジェクトになる。
  assert.deepEqual(movie.root.sortedChildren().map((c) => [c.character.id, c.character.type, (c.character.paths ?? c.paths()).length]), [
    [10, 'shape', 5], [11, 'shape', 4], [12, 'shape', 3], [13, 'edittext', 9], // 文字は枠の内側で切る（clip と unclip の 2 つ）
  ]);
  assert.equal(movie.dictionary.get(1).type, 'font');
});

test('SWF 4 の変数連動テキスト: 変数のバイト列を、指定の文字コードで表示する', async () => {
  const movie = await Movie.load(fixtures['as-swf4-edittext-sjis'], { encoding: 'shift_jis' });
  movie.advance();
  const shown = [];
  const walk = (c) => { if (c.variable) shown.push(c.text); for (const [, child] of c.children ?? []) walk(child); };
  walk(movie.root);
  assert.deepEqual(shown, ['あい', 'アヂ']); // 実機の画面と同じ（定義の初期値も、スクリプトが入れた値も）
});

test('字形の無い DefineFont に、DefineFontInfo で名前と文字コードが付く', () => {
  const font = parseDefineFont({ code: 10, body: new Uint8Array([7, 0]) }); // id だけ（実機は受け付ける）
  assert.equal(font.glyphCount, 0);
  const name = [...new TextEncoder().encode('_sans')];
  assert.deepEqual(parseDefineFontInfo({ code: 13, body: new Uint8Array([7, 0, name.length, ...name, 0x04 | 0x02]) }, 0), { id: 7, name: '_sans', bold: true, italic: true, codes: [] });
  // DefineFontInfo2 は言語コードの後に文字コードの表が続く（WideCodes なら 2 バイトずつ）。
  assert.deepEqual(parseDefineFontInfo({ code: 62, body: new Uint8Array([7, 0, 1, 0x41, 0x01, 1, 0x42, 0x30, 0x41, 0]) }, 2).codes, [0x3042, 0x41]);
});

test('SWF 5 以前の端末のフォントの文字は、フォントの名前によらず Times で描く', async () => {
  // 実機の画面で確かめた（DefineFont2・DefineFontInfo の名前が _sans でも、SWF 4・5 は Times、SWF 6 は名前どおり）。
  const movie = await Movie.load(fixtures['as-swf4-edittext-sjis'], { encoding: 'shift_jis' });
  movie.advance();
  const families = [...movie.root.children.values()].flatMap((c) => c.paths().filter((op) => op.kind === 'text').map((op) => op.family));
  assert.deepEqual(families, ['Times Roman', 'Times Roman']);
});

test('<img> の src がライブラリのビットマップの書き出し名なら、それを描く', async () => {
  const { DefineBitsLossless, End, ShowFrame, swf, tag, u16 } = await import('../tools/mkfixtures.js');
  const bytes = swf({
    version: 8,
    tags: [
      DefineBitsLossless({ id: 1, format: 5, width: 2, height: 2, pixel: () => [0, 255, 0, 0] }),
      tag(56, [...u16(1), ...u16(1), ...new TextEncoder().encode('pic'), 0]),
      ShowFrame(), End(),
    ],
  });
  const movie = await Movie.load(bytes);
  const field = movie.root.createTextField('tf', 1, 0, 0, 4000, 2000);
  field.multiline = true;
  field.setHtml('a<img src="pic" width="20" height="20">b', true);
  const op = field.paths().find((o) => o.kind === 'fill' && o.style.type === 'bitmap');
  assert.equal(op?.style.bitmap, movie.dictionary.get(1));
  assert.equal(op.style.matrix.a, (20 * 20) / 2); // 2 px の画像を 20 px に
});
