日本語 | [English](README.en.md)

# Flapp

Claude Code に Flash 仕様書を渡して生成された Flash Player です。
JavaScript で動きます。

# 機能

SWF ファイルを読み込んで、ブラウザの Canvas に再生します。依存パッケージはありません。

- **ファイル**: 無圧縮 (FWS)、zlib 圧縮 (CWS)、LZMA 圧縮 (ZWS) の SWF
- **表示**: 図形（単色・グラデーション・ビットマップの塗りと線）、ビットマップ、モーフ、文字（静的なテキストと、テキストフィールド。範囲ごとの書式と、`htmlText` の書式タグ・箇条書き・折り返し）、
  ボタン、マスク、ブレンド、9 分割拡大、シーン、フィルタ（ぼかし・影・光彩・ベベル・グラデーション光彩・グラデーションベベル・色行列・畳み込み・変位マップ）、
  3D 変形（AS3 の `z`・`rotationX` / `rotationY`・`Matrix3D`・透視投影）
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
- 読み込んだ画像の画素は、ホストが `decodeImage`（ブラウザでは画像のデコーダ）を渡したときだけ読めます。JPEG の画素の値は、復号器の違いで
  実機と少しずれます
- `Loader` で読み込んだ ActionScript 1 / 2 の SWF のスクリプト（表示だけします）、AS3 の `ApplicationDomain` の分離（読み込んだ SWF の
  クラスは、いつも読み込んだ側の子のドメインとして扱います）、AS1 / 2 で版の違う SWF を読み込んだときの、版ごとのスクリプトの規則
- AVM2 のバイトコードの検証（VerifyError）はしません。定義の無いクラスを参照したときは、実行の途中で見つけるので、実機と違う例外になることがあります
  （実機は、親クラスが無いクラスを定義する段階で #1014 にします。Flapp は、そのクラスの初期化の途中で #1065 にします）。
- Stage3D、RTMP / RTMFP、DRM、Pixel Bender、TLF、カメラとマイク、印刷、Worker
- Nellymoser と Speex の音
- テキストフィールドの入力のうち、右から左へ書く文字は、並べ替えて表示しますが、
  1 行の中で書式が変わるところをまたいだ並べ替えと、キャレット・選択の位置（文字列の順のまま）は未対応です。クリックで決まる
  キャレットの位置は、端末のフォントの幅で測るので、実機と 1 文字ほどずれることがあります
- `<img>` タグのうち、ライブラリのクリップや SWF を指す `src`（JPEG・PNG・GIF の URL は `network.load` で読み、ライブラリのビットマップは
  書き出し名・クラス名で描きます）、`align` の `left` と `right` 以外の指定、`getImageReference`
- `a:hover` などリンクの状態のスタイル（`StyleSheet` は AS2・AS3 とも `TextField.styleSheet` に付けられます）
- 3D 変形のうち、3D の部分木の中でのフィルタ・ブレンド・マスク・`scrollRect`・9 分割拡大、3D のものの `getBounds`、`Matrix3D.pointAt`
  （実機と同じ値にならない）
- `ShaderFilter`。`BitmapData` の `perlinNoise`・`pixelDissolve` は、乱数の列が実機と違うので値が一致しません。`applyFilter` のぼかし系は、
  縁の外の半透明の値が実機と少しずれます

# 使い方

Node.js（22 で動作を確認）とブラウザが要ります。

## ページに SWF を埋め込む

`<flapp-player>` 要素で、ページの中に SWF を直接置けます（Flash の `<embed>` の代わりです）。
ES モジュールを読むので、ファイルではなく http で配信してください（`npm run serve` でも動きます）。

```html
<script type="module" src="web/flapp.js"></script>
<flapp-player src="movie.swf"></flapp-player>
```

- 属性: `src`（SWF の URL）、`trust`（付けると、信用する SWF として動かします。付けなければ、通信もページの移動もしません。下の「ブラウザで再生する」を参照）、
  `encoding`（SWF 5 以前の文字コード。省略するとブラウザの言語から決めます）、`match-player`（実機が映さないものを映さない）。
  `src` や `trust` を変えると、読み直します。
- `trust` を付けたときの通信は、次の属性で絞れます（どれも省略すると、実機と同じく許します）。
  - `allow-networking`: `all`（既定）、`internal`（読み込みだけで、ページの移動をしない）、`none`（どちらもしない）。実機の `allowNetworking` と同じ段階です。
  - `allow-origins`: 通信してよいオリジンを空白で区切って並べます（例: `allow-origins="https://cdn.example https://api.example"`）。`*` か省略なら、どこでも。
  - `credentials`: 読み込みでクッキーなどを送るか。`same-origin`（既定）、`omit`、`include`。
  - `allow-navigation`: `gesture`（既定。このページそのものの移動は、クリックやキーの直後だけ）、`always`。
  - `redirect-to`（試験用）: `http://127.0.0.1:18124` のような localhost の起点。あると、SWF の読み込み・メディア・移動の宛先を、
    起点の `/x/<元のホスト>/<パス>?<クエリ>` に切り替えます（元の宛先への許可は先に従います）。移動はページを動かさず、同じメソッドと
    中身を送るだけです。localhost 以外の起点は、通信をすべて止めます。読み込みの応答を読むには、受信側が CORS を返す必要があります。

  どの場合も、実機が許さないヘッダ（`Cookie`、`Referer`、`Authorization` など）は送りません。SharedObject の保存は、SWF ごとに合わせて 100KB
  （実機の既定）までです。画面の外に出ているあいだは、1 秒に 2 回だけ進めます。ページを完全に分けたいときは、別のオリジンの `<iframe sandbox>` の中に
  置いてください（スクリプトはそのページのオリジンで動きます）。
- 大きさは SWF のステージの大きさです（CSS で変えられます）。マウスの動きとボタンを伝え、キーは要素をクリックして選んでいる間だけ伝えます。
  音は、ページを最初にクリックするかキーを押した後から鳴ります。
- イベント: `trace`（`event.detail` に `trace()` の文字列、信用しないときは、スクリプトが要求した URL も）、`warning`、`error`、`loaded`。
  `element.movie` が再生中の `Movie` です。`element.load(bytes, { label })` でバイト列から読めます。`element.stop()` で止めます。
- スクリプトからは、`import { embed } from './web/flapp.js'; embed(document.body, 'movie.swf', { trust: false })` でも置けます。

動く例は [web/embed-demo.html](web/embed-demo.html) です（`?swf=` で別の SWF、`&trust` で信用する SWF として動かします）。

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

## スマートフォン（iPhone・Android）で使う

再生ページ・埋め込み（`<flapp-player>`）・解析ページは、iPhone（Safari）と Android（Chrome）の画面でも使えるようにしてあります。

- **タッチ**: タップはクリック、指でなぞるとドラッグになります（マウスと同じ入力として SWF に伝えます）。SWF の上では、指の動きを SWF に渡すので、
  ページのスクロールや拡大はしません（ページを動かすときは、SWF の外を触ってください）。
- **表示**: ステージが画面より広いときは、縦横の比を保ったまま、画面の幅に収まるように縮めます。触った位置は、ステージの座標に直して伝えます。
- **文字の入力**: 入力フィールドをタップすると、画面のキーボードが出ます。ほかの所をタップすると閉じます。
- **音**: 最初にタップした後から鳴ります（ブラウザの制限）。

できないこと: マウスを乗せるだけの動き（ホバー）、2 本以上の指での操作（最初の 1 本だけを使います）、右クリックのメニュー。キーで操作する SWF には、
外付けのキーボードが要ります。

確認は、パソコンのブラウザをスマートフォンの画面の大きさ・タッチ入力にして行いました。実機（iPhone・Android）では、まだ確かめていません。

## SWF の中身を見る（SWF インスペクタ）

`web/inspect.html` は、SWF のヘッダ・要約・タグの一覧を表にします。行をクリックすると、そのタグの中身（解釈した項目と先頭 256 バイトの 16 進ダンプ）を出します。
読むだけで、SWF は実行しません。

```
npm run serve
```

`http://127.0.0.1:8123/web/inspect.html` を開き、SWF をファイルの選択かドラッグで渡します。同じサイトの SWF は
`?src=../test/fixtures/button.swf` のように URL で開けます。

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

入力は `movie.mouseMove(x, y)`（twips）、`mouseDown()`、`mouseUp()`、`keyDown(code, ascii, { shift, ctrl, alt })`、`keyUp(code)` で伝えます。
打ち込まれた文字は、キーが押されたこと（`keyDown`）とは別に `movie.textInput(text)` で渡します（フォーカスのある入力フィールドへ入ります。
ブラウザでの使い方は [web/flapp.js](web/flapp.js) の `attachInput`）。クリックでフォーカスが移り、Tab で次の入力フィールドへ移ります。
IME は変換中の文字列を `movie.compose(text)`、コピー・切り取り・貼り付けは `copySelection()` / `cutSelection()` / `paste(text)`、
ホイールは `mouseWheel(lines)` で伝えます。キャレットの点滅とスクロール（`scrollV` / `scrollH`）はプレイヤーが持ちます。
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
- 端末のフォントで決まる文字の寸法など、実機と同じにならないところがあります。行の高さと基準線の位置は、実機（mac の日本語の環境）で
  フォントの名前ごとに測った値を使い、`_sans`・`_serif`・`_typewriter` は Helvetica・Times・Courier で描きます（文字の幅は、ブラウザの
  フォントで測ります）。
- VP6 には公開された仕様が無いので、VP6 の復号（[src/video/vp6.js](src/video/vp6.js)）だけは、FFmpeg の復号器を JavaScript に移したものです。
  このファイルと、それに寄りかかるテスト用の素材の生成（[tools/mkvp6.js](tools/mkvp6.js)）は、FFmpeg と同じ LGPL 2.1 以降
  （[LICENSES/LGPL-2.1-or-later.txt](LICENSES/LGPL-2.1-or-later.txt)）で、著作権の表示は vp6.js の冒頭にあります。
- インターレースの VP6 は、実機では映りません（埋め込みのビデオは黒くなり、FLV は何も映りません）が、Flapp は FFmpeg と同じに復号して
  映します。`Movie.load` に `matchPlayer: true` を渡すと（ブラウザのページでは URL に `?matchPlayer` を付けると）、実機と同じに映しません。
- 実機は、埋め込みの H.263 / VP6 のビデオを整数倍で描くとき、横方向だけ、各画素の右端を右隣の画素と混ぜます。
  Flapp は混ぜずに描きますが、`matchPlayer: true` のときは実機と同じに混ぜます。
