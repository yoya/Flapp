# Flapp

Claude Code に Flash 仕様書を渡して生成された Flash Player です。
JavaScript で動きます。

# 機能

SWF ファイルを読み込んで、ブラウザの Canvas に再生します。依存パッケージはありません。

- **ファイル**: 無圧縮、zlib 圧縮 (CWS)、LZMA 圧縮 (ZWS) の SWF
- **表示**: 図形（単色・グラデーション・ビットマップの塗りと線）、ビットマップ、モーフ、文字（静的なテキストとテキストフィールド）、
  ボタン、マスク、ブレンド、9 分割拡大、シーン、フィルタ（ぼかし・影・光彩・ベベル・グラデーション光彩・グラデーションベベル・色行列・畳み込み）
- **スクリプト**: ActionScript 1 / 2 (AVM1) と ActionScript 3 (AVM2)
- **音**: イベント音とストリーム音（PCM、ADPCM、MP3）
- **ビデオ**: SWF に埋め込まれたビデオと FLV ファイル（Sorenson H.263、Screen Video、VP6 とアルファ付きの VP6。FLV では Screen Video v2 も。
  ブラウザでは H.264 と AAC も）
- **入力**: マウスとキーボード

SWF は、`trust` が未設定または 0 のとき（既定）、信用できない入力として扱います。

- スクリプトは命令を 1 つずつ解釈して実行し、`eval` やコード生成は使いません。
- 命令数、割り当て数、呼び出しの深さ、表示オブジェクトの数、ビットマップの画素数などに上限があります。
- プレイヤーは自分では通信もページの移動もしません。`getURL` や `URLLoader` などの要求は記録され、移動と読み込みは、
  ホストが `Movie.load` の `network` オプションで渡した関数に任されます。`trust` が 0 のときは `network` を渡さないので、何も起きません
  （読み込みは、スクリプトには失敗として伝わります）。

`trust`（`?trust` だけ、または `trust=1`）のときは、信用する SWF として、実機と同じように動くことを目指します。ブラウザのページでは、`network` を渡して
スクリプトによるページの移動と読み込みを許します（使い方は下の「ブラウザで再生する」）。今のところ `trust` で変わるのはこの点だけで、
上の実行の上限は、信用する場合でも適用されます。

未対応のもの:

- Screen Video v2 の、ストリームの中のパレット（実機も再生できません）
- 読み込んだ画像の画素を、スクリプトから読むこと（`Loader` の画像の `bitmapData` は、同じ大きさの透明な画像になります）
- `Loader` で読み込んだ ActionScript 1 / 2 の SWF のスクリプト（表示だけします）、AS3 の `ApplicationDomain` の分離（読み込んだ SWF の
  クラスは、いつも読み込んだ側の子のドメインとして扱います）、AS1 / 2 で版の違う SWF を読み込んだときの、版ごとのスクリプトの規則
- Stage3D、RTMP / RTMFP、DRM、Pixel Bender、TLF、カメラとマイク、印刷、Worker
- Nellymoser と Speex の音
- テキストフィールドへの文字入力、範囲ごとの書式
- スクリプトから作るフィルタ（`flash.filters` のクラス）と、描画 API のグラデーションの塗り（`beginGradientFill` など）
- 共有ライブラリ（`ImportAssets`）

# 使い方

Node.js（22 で動作を確認）とブラウザが要ります。

## ブラウザで再生する

```bash
npm run serve
```

`http://localhost:8123/web/index.html` を開き、SWF ファイル（または FLV ファイル）を選ぶか、ページにドロップします。
サーバはリポジトリ直下を、このマシン (127.0.0.1) にだけ公開します。

- 音は、ページを最初にクリックするかキーを押した後から鳴ります（ブラウザの制限）。
- SWF 5 以前のファイルは、文字コードをページ上の一覧から選べます（ファイルからは判別できないため）。
- `trace()` の出力、スクリプトが要求した URL、警告は、ステージの下に表示されます。
- 「この SWF を信用する」をオンにする（または URL に `?trust` を付ける。`trust` が無いか `trust=0` なら信用しません）と、スクリプトによるページの移動（`getURL`、`navigateToURL`）と、
  読み込み（`fetch`）を行います。読み込めるのは、`LoadVars`・`XML`・`loadVariables`・`URLLoader` のデータ、`loadMovie`・`MovieClipLoader`・
  `loadMovieNum`・`Loader` の画像（JPEG・PNG・GIF）と SWF、`loadSound`・`Sound.load` の MP3 です。`NetStream.play` の FLV も、同じように http / https から取ります。
  `SharedObject` は、ブラウザの localStorage に保存します（SWF ごと。`flush()` と、ページを閉じるときに書き、次に開いたときに読みます。
  信用しないときは、再生中だけ値を持ちます）。保存できるのは、数値・文字列・真偽値・null・undefined・Date・配列・普通のオブジェクトで、100 KB までです。http / https 以外の URL（`javascript:` など）は開きません。
  別のサーバからの読み込みは、相手が CORS で許しているときだけできます。既定は信用しません（信用できない SWF では、オンにしないでください）。

## コードから使う

```js
import { Movie } from './src/player/movie.js';
import { CanvasRenderer } from './src/render/canvas.js';

const renderer = new CanvasRenderer(canvas);
const movie = await Movie.load(bytes, {
  trace: console.log,
  rasterize: renderer.rasterizer(),
  media: (url) => (url === 'movie.flv' ? flvBytes : null), // NetStream.play(url) が再生する FLV（プレイヤーは自分では取りに行かない）
  network: { // 移動と読み込みを許すときだけ渡す（どの URL を許すかは、ここで決める）
    navigate: ({ url, target, method, data }) => window.open(url, target || '_self'),
    load: async ({ url, method, data, contentType }) => new Uint8Array(await (await fetch(url, { method, body: data })).arrayBuffer()),
  },
});
await renderer.prepare(movie); // JPEG などのビットマップを復号する
setInterval(() => {
  movie.advance(); // 1 フレーム進める
  renderer.render(movie);
}, 1000 / movie.frameRate);
```

入力は `movie.mouseMove(x, y)`（twips）、`mouseDown()`、`mouseUp()`、`keyDown(code)`、`keyUp(code)` で伝えます。
`Movie.load` のオプションは [src/player/movie.js](src/player/movie.js) の `load` の説明にあります。
描画をしなければ Node.js だけでも動きます（テストはこの形で動かしています）。

## テスト

```bash
npm test
```

SWF の中身を見るには `node tools/swfdump.js file.swf` を使います。

# 備考

- 実装のもとにした仕様書は [docs/](docs/) にあります（SWF File Format Specification v19、AVM2 Overview、Video File Format Specification v10）。
- 仕様書に無い挙動は、実機（Adobe Animate 同梱の Flash Player デバッガ版）で同じ SWF を再生し、`trace()` の出力や画面と
  突き合わせて合わせています。実機は挙動を確かめるためだけに使い、そのコードは解析も移植もしていません。
- 実機の出力は `test/expected/` にコミットしてあるので、テストを走らせるだけなら実機は不要です。
  取り直す (`npm run oracle`) には、macOS と実機が要ります。
- テスト用の SWF も `test/fixtures/` にコミットしてあります。作り直すには、`npm run fixtures` のほかに、
  ActionScript をコンパイルする `tools/mkas.js` / `tools/mkas3.js` 用の Java と FFDec が要ります。
- 端末のフォントで決まる文字の寸法など、実機と同じにならないところがあります。
- VP6 には公開された仕様が無いので、VP6 の復号（[src/video/vp6.js](src/video/vp6.js)）だけは、FFmpeg の復号器を JavaScript に移したものです。
  このファイルと、それに寄りかかるテスト用の素材の生成（[tools/mkvp6.js](tools/mkvp6.js)）は、FFmpeg と同じ LGPL 2.1 以降
  （[LICENSES/LGPL-2.1-or-later.txt](LICENSES/LGPL-2.1-or-later.txt)）で、著作権の表示は vp6.js の冒頭にあります。
- インターレースの VP6 は、実機では映りません（埋め込みのビデオは黒くなり、FLV は何も映りません）が、Flapp は FFmpeg と同じに復号して
  映します。`Movie.load` に `matchPlayer: true` を渡すと（ブラウザのページでは URL に `?matchPlayer` を付けると）、実機と同じに映しません。
- 実機は、埋め込みの H.263 / VP6 のビデオを整数倍で描くとき、横方向だけ、各画素の右端を右隣の画素と混ぜます。
  Flapp は混ぜずに描きますが、`matchPlayer: true` のときは実機と同じに混ぜます。
