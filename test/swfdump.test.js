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

const fixtureOf = (name) => fileURLToPath(new URL(`fixtures/${name}.swf`, import.meta.url));

test('-D: -d の出力はそのまま残し、入れ子の項目を足す', () => {
  const detail = run('-d', fixtureOf('button')).split('\n');
  const full = run('-D', fixtureOf('button')).split('\n');
  let i = 0;
  for (const line of full) if (line === detail[i]) i++;
  assert.equal(i, detail.length, '-d の行が、同じ順で -D にも出る');
  assert.equal(run('--full', fixtureOf('button')), full.join('\n'));
});

test('-D: シェイプのスタイルとレコード、ボタンのレコード、配置の行列', () => {
  const out = run('-D', fixtureOf('button'));
  assert.match(out, /FillStyles \(1\)\n\s+\[1\] solid #ff0000/);
  assert.match(out, /StyleChange moveTo \(0, 0\) fill1=1\n\s+StraightEdge to \(1000, 0\)/);
  assert.match(out, /ButtonRecord states=up CharacterId=2 Depth=2 Matrix=\[a=0\.399993896484375 b=0 c=0 d=0\.399993896484375 tx=300 ty=300\] ColorTransform=\[mult=256,256,256,128 add=128,0,0,0\]/);
  assert.match(out, /CharacterId: 4\n\s+Matrix: \[a=1 b=0 c=0 d=1 tx=400 ty=400\]/);
});

test('-D: モーフィングの開始と終了', () => {
  const out = run('-D', fixtureOf('morph'));
  assert.match(out, /\[1\] start: solid #ff0000\n\s+end: solid #0000ff/);
  assert.match(out, /EndEdges \(5\)\n\s+StyleChange moveTo \(400, -100\)\n\s+CurvedEdge control \(800, -100\) to \(900, 400\)/);
});

test('-D: フォントの文字コードと送り幅、テキストのレコード', () => {
  const out = run('-D', fixtureOf('text'));
  assert.match(out, /\[0\] code=0x0049 "I" advance=700\n\s+GlyphShape \(5\)/);
  assert.match(out, /TextRecord FontId=1 TextHeight=800 TextColor=#c80000 XOffset=0 YOffset=800\n\s+GlyphEntries \(3\): 1:547 2:547 1:547\n\s+Text: "LOL"/);
});

test('-D: AVM1 のアクション（定数プール、クリップイベント、SWF 5 以前の文字列）', () => {
  const out = run('-D', fixtureOf('as-clipevents'));
  assert.match(out, /ClipActionRecord events=Load\n\s+0000 {2}ConstantPool count=5\n\s+\[0\] "load "/);
  assert.match(out, /0015 {2}Push c0="load "/);
  assert.match(run('-D', fixtureOf('as-swf4-sjis')), /Push "\\x82\\xa0\\x82\\xa2"/);
  assert.match(run('-D', fixtureOf('as-arrays')), /DefineFunction2 "" \(r1:x, r2:y\) registers=3 flags=SuppressThis,SuppressArguments,SuppressSuper codeSize=12 \(→ 096e\)/);
});

test('-D: AVM2 の ABC（クラス、メソッドの命令列、例外）', () => {
  const out = run('-D', fixture);
  assert.match(out, /Class \[0\] Main extends flash\.display::MovieClip \(sealed\)/);
  assert.match(out, /001b {2}newclass 0 \(Main\)/);
  assert.match(out, /0030 {2}jump → 0052/);
  assert.match(out, /exception from=0020 to=0030 target=0034 type=Error var=err/);
});

test('-D: 音とビデオの頭、ビットマップ', () => {
  assert.match(run('-D', fixtureOf('sound-stream')), /StreamSoundCompression: adpcm {2}StreamSoundRate: 22050 {2}StreamSoundSize: 16 {2}StreamSoundType: mono\n\s+StreamSoundSampleCount: 1838/);
  assert.match(run('-D', fixtureOf('video-h263')), /StreamID: 1 {2}FrameNum: 0 {2}VideoData: 1827 bytes\n\s+PictureHeader: version=1 size=64x48 type=intra quantizer=4/);
  const bitmaps = run('-D', fixtureOf('bitmap-jpeg'));
  assert.match(bitmaps, /ImageData: JPEG, 1218 bytes\n\s+Size: 48 x 32\n\s+BitmapAlphaData: 73 bytes \(zlib\)/);
  assert.match(bitmaps, /ImageData: PNG, 3826 bytes/);
});
