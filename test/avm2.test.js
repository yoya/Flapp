// AVM2 のうち、実機（デバッガ版）では確かめられない部分のテスト。期待値は資料に基づいて手で書いたもの。
// 実機と照合できるものは test/as3.test.js にある。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Movie } from '../src/player/movie.js';

async function run(name, frames, options = {}) {
  let time = 0;
  // NetStream が再生するファイルは、SWF からの相対パスで探して渡す。
  const media = (url) => { try { return readFileSync(new URL(url, new URL('fixtures/', import.meta.url))); } catch { return null; } };
  const movie = await Movie.load(readFileSync(new URL(`fixtures/${name}.swf`, import.meta.url)), { now: () => time, media, ...options });
  for (let i = 0; i < frames; i++) {
    time += 1000 / movie.frameRate;
    movie.advance();
    await new Promise((resolve) => setImmediate(resolve)); // 読み込んだ SWF の解析（非同期）を進める
  }
  return movie;
}

test('setTimeout / setInterval: 期限の順に呼ばれ、取り消したものは呼ばれない', async () => {
  const movie = await run('as3x-timeout', 30); // 12 fps で 2.5 秒
  assert.deepEqual(movie.traces, ['true true', 'interval 1', 'interval 2', 'timeout 1 two']);
  assert.deepEqual(movie.warnings, []);
});

test('SimpleButton: マウスに合わせて、表示する状態が切り替わる', async () => {
  const movie = await run('as3x-buttonstate', 1);
  const button = movie.root.sortedChildren()[0];
  const shown = () => button.sortedChildren().map((d) => d.name).join();
  const at = (x, y) => movie.mouseMove(x * 20, y * 20);
  assert.equal(shown(), 'up');
  at(30, 40); // 当たり判定用の形（40×20）の中
  assert.equal(shown(), 'over');
  assert.ok(movie.hoverButton); // 手の形のカーソル
  movie.mouseDown();
  assert.equal(shown(), 'down');
  at(200, 140); // 押したまま外へ
  assert.equal(shown(), 'up');
  movie.mouseUp();
  at(65, 40); // over の形（50×30）の中だが、当たり判定用の形の外
  assert.equal(shown(), 'up');
  at(30, 40);
  movie.mouseDown();
  movie.mouseUp();
  assert.equal(shown(), 'over');
  movie.keyDown(65); // スクリプトが enabled を false にする
  assert.equal(shown(), 'up');
  at(31, 40);
  assert.equal(shown(), 'up'); // 無効なボタンは、見た目が変わらない
  assert.equal(movie.hoverButton, null);
  assert.deepEqual(movie.traces, [
    'mouseOver b b', 'mouseDown b b', 'mouseOut b b', 'mouseOver b b', 'mouseDown b b', 'mouseUp b b', 'click b b', 'enabled false',
  ]);
  assert.deepEqual(movie.warnings, []);
});

test('読み込みは行わず、要求を記録して失敗を伝える。SharedObject は再生中だけ値を持つ', async () => {
  const movie = await run('as3x-netfail', 8);
  assert.deepEqual(movie.traces, [
    '[object SharedObject] 12 true 1,2 flushed 0 undefined',
    'undefined',
    'null',
    'URLLoader open 1',
    'URLLoader ioError true 2032 Error #2032: Stream Error. URL: missing-file.txt true true false false undefined 0 1',
    'Loader ioError true 2035 null 3', // Loader は 2035（URL Not Found）、URLLoader は 2032（Stream Error）
    'Sound ioError true 2032 null 0 3', // url は、読めたときに入る（実機でも、load の直後は null）
  ]);
  assert.deepEqual(movie.requests.map((r) => `${r.kind} ${r.url} ${r.target}`), [
    'load missing-file.txt ', 'navigateToURL http://example.com/page _blank', 'sendToURL http://example.com/log ', 'fscommand FSCommand:fullscreen true',
    'load unheard.txt ', 'load missing-file.swf ', 'loadSound http://example.com/missing-file.mp3 ',
  ]);
  assert.deepEqual(movie.warnings, ['unhandled ioError: unheard.txt']); // 誰も聞いていない失敗は、警告として残る
});

test('表示オブジェクトの BitmapData.draw は、描画側が無ければ警告を残して何もしない', async () => {
  const movie = await run('as3x-visual', 3);
  assert.deepEqual(movie.traces, ['center 20000000 corner 20000000']); // 描き込まれていない
  assert.deepEqual(movie.warnings, ['BitmapData.draw of a display object needs a renderer']);
});

test('表示オブジェクトの BitmapData.draw は、rasterize オプションの処理が返した画像を重ねる', async () => {
  // 全面が不透明な赤の画像を返す、仮の描画側。
  const rasterize = (movie, d, m, width, height) => new Uint8ClampedArray(width * height * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
  const movie = await Movie.load(readFileSync(new URL('fixtures/as3x-visual.swf', import.meta.url)), { now: () => 0, rasterize });
  assert.deepEqual(movie.traces, ['center ffff0000 corner ffff0000']);
  assert.deepEqual(movie.warnings, []);
});

test('NetStream: 一時停止と位置の変更、見つからないファイル、サーバへの接続', async () => {
  const movie = await run('as3x-netstream2', 26);
  assert.deepEqual(movie.traces, [
    '1 NetStream.Play.Start 0',
    '1 NetStream.Buffer.Full 0',
    'paused 83 64 48',
    'still 83', // 止めている間は進まない
    'seek 333', // 0.4 秒を指定すると、その手前のキーフレーム（333 ms）になる
    'toggled 416',
    '9 NetStream.Seek.Notify 500',
    '10 NetStream.Buffer.Flush 583',
    '10 NetStream.Play.Stop 583',
    '10 NetStream.Buffer.Empty 583',
    '21 missing NetStream.Play.StreamNotFound error',
    '21 server NetConnection.Connect.Failed error false',
  ]);
  assert.deepEqual(movie.requests.map((r) => `${r.kind} ${r.url}`), [
    'play ../../tools/assets/video-h263.flv', 'play no-such-file.flv', 'connect rtmp://example.com/app', 'play unheard.flv',
  ]);
  assert.deepEqual(movie.warnings, ['unhandled netStatus: NetStream.Play.StreamNotFound']); // 誰も聞いていない失敗は、警告として残る
});

test('URLLoader と navigateToURL は、ホストの network に任せる', async () => {
  // as3x-urlloader: 同じファイルを、文字・変数・バイト列として読む（実機のデバッガ版は、読み込みが成功しても open の直後に落ちる。
  // 落ちる前の出力 "text open true false" までは、実機と同じ）。
  const loads = [];
  const network = { load: (r) => { loads.push(`${r.method} ${r.url}`); try { return readFileSync(new URL(r.url, new URL('fixtures/', import.meta.url))); } catch { return null; } } };
  const movie = await run('as3x-urlloader', 4, { network });
  assert.deepEqual(movie.traces, [
    'text undefined 0 0',
    'after load undefined 0 0',
    'text open true false',
    'text progress true false 34/34',
    'text complete true false 34/34 string String [name=Flapp&n=42&msg=hello+world%21]',
    'variables open true false',
    'variables progress true false 34/34',
    'variables complete true false 34/34 object flash.net::URLVariables name=Flapp n=42 string msg=[hello world!]',
    'binary open true false',
    'binary progress true false 34/34',
    'binary complete true false 34/34 object flash.utils::ByteArray length=34 position=0 [name]',
  ]);
  assert.deepEqual(loads, Array(3).fill('GET ../../tools/assets/net-vars.txt'));
  assert.deepEqual(movie.warnings, []);
  // as3x-netfail: navigateToURL は移動として、sendToURL は応答を受け取らない読み込みとして渡る。fscommand は渡らない。
  const calls = [];
  const failing = await run('as3x-netfail', 8, { network: { navigate: (r) => calls.push(`navigate ${r.method} ${r.url} ${r.target}`), load: (r) => { calls.push(`load ${r.method} ${r.url}`); return null; } } });
  assert.deepEqual(calls, ['load GET missing-file.txt', 'navigate GET http://example.com/page _blank', 'load GET http://example.com/log', 'load GET unheard.txt', 'load GET missing-file.swf', 'load GET http://example.com/missing-file.mp3']);
  assert.equal(failing.traces[4], 'URLLoader ioError true 2032 Error #2032: Stream Error. URL: missing-file.txt true true false false undefined 0 1');
});

test('Loader: 画像と AS3 の SWF を読み込んで子にする。unload と loadBytes', async () => {
  // as3x-loader（実機のデバッガ版は、読み込んだ子のムービーの addedToStage の直後に落ちる。そこまでの出力と、子のコンストラクタの中で
  // root と loaderInfo が見えて stage が見えないことは、実機と同じ）。読み込まれる側は as3-loadchild（単独では実機と照合している）。
  const fixtures = new URL('fixtures/', import.meta.url);
  const network = { load: (r) => { try { return readFileSync(new URL(r.url, fixtures)); } catch { return null; } } };
  const movie = await run('as3x-loader', 12, { network });
  assert.deepEqual(movie.traces, [
    'after load null 0 0 null',
    'image open true ',
    'image progress true ',
    'image init true  content=flash.display::Bitmap children=1 same=true size=32x24 type=image/png bytes=true loader=true content size=32x24 parent=true swfVersion error 2098',
    'image complete true  content=flash.display::Bitmap children=1 same=true size=32x24 type=image/png bytes=true loader=true content size=32x24 parent=true swfVersion error 2098',
    'movie open true ',
    'movie progress true ',
    'child constructor [object ChildMain] true false true 2',
    'child addedToStage true true',
    'movie init true  content=ChildMain children=1 same=true size=240x160 type=application/x-shockwave-flash bytes=true loader=true content size=40x20 parent=true swf=15 as=3 rate=12 frames=1/2 root=true childVar=hello',
    'movie complete true  content=ChildMain children=1 same=true size=240x160 type=application/x-shockwave-flash bytes=true loader=true content size=40x20 parent=true swf=15 as=3 rate=12 frames=1/2 root=true childVar=hello',
    'child frame 2 2 false',
    'image unload null 0',
    'after unload null 0 null',
    'loadBytes called null',
    'image open true ',
    'image progress true ',
    'image init true  content=flash.display::Bitmap children=1 same=true size=32x24 type=image/gif bytes=true loader=true content size=32x24 parent=true swfVersion error 2098',
    'image complete true  content=flash.display::Bitmap children=1 same=true size=32x24 type=image/gif bytes=true loader=true content size=32x24 parent=true swfVersion error 2098',
  ]);
  assert.deepEqual(movie.warnings, []);
  // 読み込んだ SWF の中身は、Loader の子として表示リストに入っている（子のムービーの図形が、ステージの上に描かれる）。
  const loader = movie.root.sortedChildren().find((d) => d.as3 && d.loadedInfo === undefined && d.sortedChildren?.().some((c) => c.loadedInfo));
  assert.ok(loader);
});

test('Loader で読んだ画像の bitmapData は、ホストの decodeImage で画素になる（アルファの無い画像は不透明）', async () => {
  const assets = new URL('../tools/assets/', import.meta.url);
  const network = { load: (req) => readFileSync(new URL(req.url.split('/').pop(), assets)) };
  // ホストの復号の代わり: 左上だけ赤、ほかは緑。
  const decodeImage = async ({ bytes }) => {
    const width = 32, height = 24, rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([0, 255, 0, 255], i);
    rgba.set([255, 0, 0, 255], 0);
    return { width, height, rgba };
  };
  const movie = await run('as3x-loaderpixels', 12, { network, decodeImage });
  assert.deepEqual(movie.traces, [
    'pic.png 32 24 false ffff0000,ff00ff00,ff00ff00,ff00ff00,ff00ff00',
    'pic.gif 32 24 false ffff0000,ff00ff00,ff00ff00,ff00ff00,ff00ff00',
    'pic.jpg 32 24 false ffff0000,ff00ff00,ff00ff00,ff00ff00,ff00ff00',
  ]);
});
