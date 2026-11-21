// 辞書（キャラクタ定義）、表示リスト、タイムラインの進行、スクリプトの実行順（仕様 3・5・13 章）。
// 描画や DOM には依存しない。
import { AVM1, PLAYER_VERSION } from '../avm1/interp.js';
import { AVM2 } from '../avm2/vm.js';
import { installFlash } from '../avm2/flash.js';
import { MovieClipObject } from '../avm1/clip.js';
import { TextFieldObject } from '../avm1/textfield.js';
import { VideoScriptObject } from '../avm1/video.js';
import { AVMFunction } from '../avm1/object.js';
import { Drawing } from './drawing.js';
import { SoundMixer, buildStream } from './sound.js';
import { decodable, embeddedSequence } from './video.js';
import { parseDefineVideoStream, parseVideoFrame } from '../swf/video.js';
import { parseDefineButtonSound, parseDefineSound, parseSoundStreamBlock, parseSoundStreamHead, parseStartSound } from '../swf/sound.js';
import { imageFile, parseBitmap } from '../swf/bitmap.js';
import { BUTTON_COND, parseDefineButton, parsePlaceObject, parseRemoveObject, parseSetBackgroundColor } from '../swf/display.js';
import { parseDefineMorphShape } from '../swf/morph.js';
import { parseSWF } from '../swf/parse.js';
import { toBool, toStr } from '../avm1/convert.js';
import { LegacyText } from '../swf/legacy.js';
import { layoutRunsOf, mergeFormat, mergeRange, parseHtml, sameFormat, toHtml } from './richtext.js';
import { caretAt, indexAt, layoutOf, lineOf, restricts, shiftOps, wordAt } from './textedit.js';
import { compose, focalLength, lift, multiply as multiply3D, project, transform as transform3D } from './matrix3d.js';
import { Reader, SWFError } from '../swf/reader.js';
import { parseDefineShape } from '../swf/shape.js';
import { deviceMetrics, editTextToPaths, parseDefineEditText, parseDefineFont, parseDefineFontInfo, parseDefineText, plainText, textToPaths } from '../swf/text.js';
import { shapeToPaths } from '../shape/paths.js';

const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const PLACE_DEFAULTS = Object.freeze({
  matrix: IDENTITY, cxform: null, ratio: 0, name: '', clipDepth: 0, filters: null, blendMode: 'normal', visible: true, opaqueBackground: null,
});
const PASS = Symbol('pass'); // マウスの相手探しで「当たったが、受けるものが決まらない」
const SHAPE_TAGS = new Set([2, 22, 32, 83]);
const BITMAP_TAGS = new Set([6, 20, 21, 35, 36, 90]);
const MAX_NESTING = 255;
const DYNAMIC_DEPTH = 16384; // これ以上の深度はスクリプトが作ったクリップ用
const MAX_TRACES = 10000;
const MAX_LOADED_BYTES = 1 << 26; // ホストから受け取る読み込みデータの上限（64 MB）
// クリップイベントのフラグ（PlaceObject2 の CLIPEVENTFLAGS を下位バイトから並べた値）。
const EVENT = {
  load: 0x01, enterFrame: 0x02, unload: 0x04, mouseMove: 0x08, mouseDown: 0x10, mouseUp: 0x20, keyDown: 0x40, keyUp: 0x80,
  press: 0x0400, release: 0x0800, releaseOutside: 0x1000, rollOver: 0x2000, rollOut: 0x4000, dragOver: 0x8000, dragOut: 0x010000,
};
const EVENT_METHOD = {
  load: 'onLoad', enterFrame: 'onEnterFrame', unload: 'onUnload', mouseMove: 'onMouseMove', mouseDown: 'onMouseDown', mouseUp: 'onMouseUp',
  press: 'onPress', release: 'onRelease', releaseOutside: 'onReleaseOutside', rollOver: 'onRollOver', rollOut: 'onRollOut',
  dragOver: 'onDragOver', dragOut: 'onDragOut',
};
// これらのどれかを持つクリップは、ボタンと同じようにマウスに反応する。
const BUTTON_EVENTS = ['press', 'release', 'releaseOutside', 'rollOver', 'rollOut', 'dragOver', 'dragOut'];
const BUTTON_FLAGS = BUTTON_EVENTS.reduce((flags, name) => flags | EVENT[name], 0);
// Key.getCode() の値（仮想キーコード）→ ボタンの keyPress のキーコード。ここに無いキーは文字コードで照合する。
const BUTTON_KEY = { 37: 1, 39: 2, 36: 3, 35: 4, 45: 5, 46: 6, 8: 8, 13: 13, 38: 14, 40: 15, 33: 16, 34: 17, 9: 18, 27: 19 };
const concat = (p, l) => ({
  a: p.a * l.a + p.c * l.b, b: p.b * l.a + p.d * l.b, c: p.a * l.c + p.c * l.d, d: p.b * l.c + p.d * l.d,
  tx: p.a * l.tx + p.c * l.ty + p.tx, ty: p.b * l.tx + p.d * l.ty + p.ty,
});
function invert(m) {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 };
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, tx: (m.c * m.ty - m.d * m.tx) / det, ty: (m.b * m.tx - m.a * m.ty) / det };
}
// 矩形 b を行列 m で変換した外接矩形。
function transformBounds(b, m) {
  const xs = [];
  const ys = [];
  for (const [x, y] of [[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmin, b.ymax], [b.xmax, b.ymax]]) {
    // 実機と同じく、積を 1 つずつ twips の整数に丸めてから足す（45 度回した 40 px の正方形の高さは 56.6 px になる）。
    xs.push(Math.round(m.a * x) + Math.round(m.c * y) + Math.round(m.tx));
    ys.push(Math.round(m.b * x) + Math.round(m.d * y) + Math.round(m.ty));
  }
  return { xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) };
}
const union = (a, b) => (!a ? b : !b ? a : {
  xmin: Math.min(a.xmin, b.xmin), xmax: Math.max(a.xmax, b.xmax), ymin: Math.min(a.ymin, b.ymin), ymax: Math.max(a.ymax, b.ymax),
});

// 点 (px, py) から右へ伸ばした半直線が、パスの辺を横切る回数（奇数なら内側）。開いたままの輪郭は始点へ閉じて数える。
function crossings(path, px, py) {
  let n = 0;
  let sx = 0, sy = 0, x = 0, y = 0;
  const line = (x0, y0, x1, y1) => {
    if ((y0 > py) !== (y1 > py) && x0 + ((py - y0) / (y1 - y0)) * (x1 - x0) > px) n++;
  };
  const quad = (x0, y0, cx, cy, x1, y1) => {
    const at = (p0, c, p1, t) => (1 - t) * (1 - t) * p0 + 2 * t * (1 - t) * c + t * t * p1;
    // y が単調な区間 [t0, t1] で、高さ py を通る点を二分法で探す。
    const piece = (t0, t1) => {
      const above = at(y0, cy, y1, t0) > py;
      if (above === at(y0, cy, y1, t1) > py) return;
      let lo = t0, hi = t1;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (at(y0, cy, y1, mid) > py === above) lo = mid;
        else hi = mid;
      }
      if (at(x0, cx, x1, (lo + hi) / 2) > px) n++;
    };
    const d = y0 - 2 * cy + y1;
    const turn = d === 0 ? -1 : (y0 - cy) / d; // y の向きが変わる位置
    if (turn > 0 && turn < 1) {
      piece(0, turn);
      piece(turn, 1);
    } else {
      piece(0, 1);
    }
  };
  for (const cmd of path) {
    if (cmd[0] === 'M' || cmd[0] === 'Z') {
      line(x, y, sx, sy);
      if (cmd[0] === 'M') [, sx, sy] = cmd;
      x = sx;
      y = sy;
    } else if (cmd[0] === 'L') {
      line(x, y, cmd[1], cmd[2]);
      [, x, y] = cmd;
    } else if (cmd[0] === 'Q') {
      quad(x, y, cmd[1], cmd[2], cmd[3], cmd[4]);
      [, , , x, y] = cmd;
    }
  }
  line(x, y, sx, sy);
  return n;
}

// 図形の塗りのどれかが、点 (x, y) を含むか。
const insidePaths = (paths, x, y) => paths.some((op) => op.kind === 'fill' && crossings(op.path, x, y) % 2 === 1);

export class Movie {
  #over = null; // マウスが乗っているボタン
  #pressed = null; // マウスを押したときに乗っていたボタン（離すまで、他のボタンは反応しない）
  #pressedInside = false; // 押したまま、そのボタンの上にいるか
  #mouseDown = false;
  #keyChars = new Map(); // 押されているキーの仮想キーコード → 文字コード
  #mouseInside = false;
  textImages = new Map(); // <img src> の画像 src → { bitmap, failed, fields }
  focus = null; // キーボードのフォーカスを持つ表示オブジェクト（テキストフィールドなど。無ければ null）
  #selecting = null; // マウスで文字を選んでいる最中の { field, anchor }
  #lastClick = null; // ダブルクリックの判定用の、前のクリック { field, at, time }
  #drag = null; // startDrag で引きずっているクリップ { clip, bounds, dx, dy } // マウスがステージの上にあるか（最初の mouseMove までは外にある扱い）

  /**
   * @param {Uint8Array | ArrayBuffer} bytes
   * @param {object} [options]
   *   maxLength: 受け付ける展開後サイズの上限
   *   maxInstances: 表示リスト上に同時に存在できるオブジェクト数の上限（入れ子の爆発への備え）
   *   maxBitmapPixels: 全ビットマップの画素数の合計の上限（展開後のメモリへの備え）
   *   trace: (text) => void   trace() の出力先。省略すると movie.traces に溜める
   *   now: () => number       getTimer() 用の経過ミリ秒。省略すると読み込みからの実時間
   *   random: () => number    乱数。省略すると Math.random
   *   avm: AVM1 の上限（maxSteps, maxAllocations, maxDepth）
   *   onRequest: ({ kind, url, target, method }) => void   スクリプトが getURL / loadMovie / loadVariables を呼んだときの通知。
   *             kind はそのどれか。プレイヤー自身は移動も読み込みもしない（要求は movie.requests にも残る。実行は network に任せる）
   *   audio: 音の出力（player/sound.js の冒頭を参照。ブラウザでは audio/webaudio.js）。省略すると音は出ない
   *   media: (url) => Uint8Array | Promise<Uint8Array> | null   NetStream.play(url) が再生する FLV ファイルを返す関数。
   *             プレイヤーは自分ではファイルを取りに行かない。省略すると、どの URL も「見つからない」扱いになる
   *   video: H.264 の復号（video/webcodecs.js の冒頭を参照。ブラウザでは WebCodecsVideo）。省略すると、H.264 の FLV は映らない
   *   network: 移動と通信を、ホストに任せるための関数（省略すると、どちらも行わない。要求は記録だけして、読み込みは
   *             失敗として伝える）。プレイヤーは自分では通信しない。SWF を信用するか、どの URL を許すかは、ホストが決める。
   *             navigate: ({ url, target, method, data }) => void   getURL / navigateToURL などによる移動
   *             load: ({ url, method, data, contentType, headers }) => Uint8Array | ArrayBuffer | null（または、その Promise）
   *                   LoadVars / XML / loadVariables / URLLoader のデータ、loadMovie / MovieClipLoader / Loader の画像と SWF、
   *                   loadSound / Sound.load の MP3 の読み込み。data は送る本文（Uint8Array か null）。headers は、スクリプトが
   *                   足したヘッダ（addRequestHeader、URLRequest.requestHeaders。{ 名前: 値 }、無ければ undefined）。
   *                   AS3 の URL は、実機と同じ規則で escape した文字列（空白・非 ASCII・% などを含むとき）で渡す。
   *                   読めなければ null を返す（スクリプトには、読み込みの失敗として伝わる）
   *   storage: SharedObject の保存先（省略すると、再生中だけ値を持つ）。プレイヤーは自分では保存しない。
   *             load: (名前) => 文字列 | null   getLocal したときに、保存してある文字列を返す
   *             save: (名前, 文字列 | null) => 書けたか   flush() と saveSharedObjects() で書く。null はその名前を消す（clear()）
   *             名前は、スクリプトが getLocal に渡したもの。SWF ごとの区別は、ホストが付ける（実機は SWF の URL で分ける）。
   *             文字列は 100 KB まで。形式は player/sharedstore.js を参照
   *   matchPlayer: true にすると、見た目を実機の Flash Player に寄せる。既定は false。今のところ、次の 2 つが変わる:
   *             - 復号はできるが実機が映さないもの（インターレースの VP6）を、実機と同じに映さない
   *             - 埋め込みの H.263 / VP6 を整数倍で置いたとき、実機と同じに、横方向だけ右隣の画素と混ぜて描く
   *   fscommand2: (command, args, { setVariable }) => number | string   Flash Lite の FSCommand2 を処理する関数（ActionScript 1 / 2）。
   *             渡すと、FSCommand2 を Flash Lite として実行する（引数を取り出して、結果を積む。結果が数値でも文字列でもなければ -1）。
   *             setVariable(name, value) は、呼んだタイムラインの変数へ書く。省略すると、デスクトップ版の実機と同じく、命令を読み飛ばす
   *   decodeImage: ({ bytes, type }) => Promise<{ width, height, rgba }>   JPEG / PNG / GIF の画像を画素（乗算済みでない RGBA）にする関数
   *             （ブラウザでは render/canvas.js の decodeImage）。スクリプトが画素を読む画像（Loader で読んだ画像と、AS3 のクラスに結び付いた
   *             ビットマップ）だけに使う。省略すると、それらの画素は透明（読み込んだ画像）か白（クラスのビットマップ）になる
   *   rasterize: (movie, 表示オブジェクト, 行列, 幅, 高さ) => RGBA   表示オブジェクトを画像に描く処理（AS3 の BitmapData.draw 用。
   *             ブラウザでは CanvasRenderer の rasterizer()）。省略すると、表示オブジェクトの draw は警告を残して何もしない
   *   language: System.capabilities.language の値（'ja' など。既定は 'en'）
   *   encoding: SWF 5 以前の文字列の文字コード（'shift_jis' など、TextDecoder が受け付ける名前）。省略すると 'windows-1252'。
   *             SWF 6 以降は常に UTF-8 なので使わない。SWF 5 以前では、クリップの名前などはバイト列のままの文字列になる
   *             （swf/legacy.js を参照）。trace の出力と表示する文字は、この文字コードで Unicode に直す。
   */
  static async load(bytes, options = {}) {
    const movie = new Movie(await parseSWF(bytes, options), options);
    await movie.#decodeBitmaps(movie.library);
    if (movie.library.imports?.length) {
      await movie.#importAssets(movie.library);
      movie.#createRoot();
    }
    if (movie.avm2) {
      movie.#framePhase(); // AS3: 1 フレーム目の frameConstructed、フレームスクリプト、exitFrame
      movie.#guard(() => movie.avm2.display.loaded()); // 読み込みが済んだことを loaderInfo に伝える
    }
    movie.runActions(); // 1 フレーム目のアクション
    return movie;
  }

  #phaseDepth = 0;

  #bitmapPixelBudget;
  #queue = []; // 実行待ちのアクション { clip, code } / { clip, method, args }
  #late = []; // このフレームのアクションが全部済んだ後に実行する処理（loadMovie の onLoadInit）
  #initQueue = []; // DoInitAction（通常のアクションより先に実行する）
  #initDone = new Set(); // 実行済みの DoInitAction のスプライト ID
  #instanceNames = 0;

  /** 直接は使わず Movie.load() を使う（ビットマップの展開が非同期のため）。 */
  constructor(swf, { maxInstances = 100000, maxBitmapPixels = 1 << 26, trace, now, random, avm = {}, encoding = 'windows-1252', onRequest, language = 'en', audio, rasterize, media, video, matchPlayer = false, network, storage, decodeImage, fscommand2 } = {}) {
    this.media = media ?? null;
    this.decodeImage = decodeImage ?? null;
    this.network = network ?? null;
    this.storage = storage ?? null;
    this.measureText = null; // (文字, 書式, フォント名の代わり) => 幅（twips）。描く側（render/canvas.js の prepare）が、端末のフォントで測る関数を入れる
    this.matchPlayer = matchPlayer === true;
    this.video = video ?? null;
    this.rasterize = rasterize ? (d, m, width, height) => rasterize(this, d, m, width, height) : null;
    this.boundFields = new Set(); // 変数と連動しているテキストフィールド
    this.requests = []; // スクリプトが要求した URL（実行はしない）。{ kind, url, target, method }
    this.#bitmapPixelBudget = maxBitmapPixels;
    this.version = swf.version;
    this.encoding = encoding;
    this.legacy = swf.version < 6 ? new LegacyText(encoding) : null; // SWF 5 以前の文字列の扱い
    this.fileLength = swf.fileLength;
    this.frameSize = swf.frameSize; // twips
    this.frameRate = swf.frameRate;
    this.warnings = [...swf.warnings];
    this.backgroundColor = null; // SetBackgroundColor が無ければ null
    this.dictionary = new Map(); // キャラクタ ID → 定義
    this.exports = new Map(); // 書き出し名（リンケージ ID）→ キャラクタ ID
    // このムービー自身の SWF の定義。loadMovie などで読み込んだ SWF は、それぞれ別のライブラリを持つ（loadLibrary）。
    // クリップは、自分の属するライブラリからキャラクタを引く（MovieClip.library）。
    this.library = { dictionary: this.dictionary, exports: this.exports, version: swf.version, legacy: this.legacy, jpegTables: undefined, pending: [], main: true };
    this.maxInstances = maxInstances;
    this.instances = 0;
    this.mouse = { x: 0, y: 0 }; // ステージ座標（twips）
    this.clips = []; // 作られた順のムービークリップ（フレームごとの実行順に使う）
    this.traces = []; // trace() の出力（options.trace が無い場合）

    // FileAttributes の ActionScript3 フラグが立っていれば AVM2 用。AVM1 のスクリプトは動かさない。
    const attributes = swf.tags.find((t) => t.code === 69);
    this.isAS3 = !!attributes && attributes.length >= 1 && (attributes.body[0] & 0x08) !== 0;
    const started = Date.now();
    this.now = now ?? (() => Date.now() - started); // 再生開始からの経過ミリ秒
    this.sounds = new SoundMixer(this, audio ?? null);
    const traceOut = (text) => {
      const shown = this.legacy ? this.legacy.decode(text) : text;
      if (trace) trace(shown);
      else if (this.traces.length < MAX_TRACES) this.traces.push(shown);
    };
    /** スクリプトが要求した URL を記録する（実行はしない。移動と読み込みは navigate / load がホストに任せる）。 */
    this.request = (req) => {
      const shown = this.legacy ? { ...req, url: this.legacy.decode(req.url), target: this.legacy.decode(req.target) } : req;
      if (this.requests.length < MAX_TRACES) this.requests.push(shown);
      onRequest?.(shown);
    };
    this.symbolClasses = new Map(); // キャラクタ ID → 結び付けられた AS3 のクラス名 (SymbolClass)
    this.library.symbolClasses = this.symbolClasses;
    this.library.isAS3 = this.isAS3;
    this.unconstructed = new Set(); // AS3: 表示リストには入ったが、まだコンストラクタを呼んでいないクリップ
    // ActionScript 3 のムービーは AVM2 で、それ以外は AVM1 で動かす。機能を絞った版（tools/profiles.js）では、どちらかが無い
    // （AVM2・AVM1 が null）ことがある。無ければ、スクリプトなしで再生する。
    this.avm2 = this.isAS3 && AVM2 ? new AVM2({ trace: traceOut, now: this.now, random, ...avm }) : null;
    if (this.avm2) installFlash(this.avm2, this, { MovieClip, TextField, VideoObject });
    if (this.isAS3 && !AVM2) this.warn('ActionScript 3 is not included in this build; scripts do not run');
    this.avm = this.isAS3 || !AVM1 ? null : new AVM1({
      version: swf.version,
      trace: traceOut,
      legacy: this.legacy,
      stage: { width: (swf.frameSize.xmax - swf.frameSize.xmin) / 20, height: (swf.frameSize.ymax - swf.frameSize.ymin) / 20 },
      language,
      request: this.request,
      navigate: (req) => this.navigate(req),
      focus: { get: () => this.focus, set: (d) => this.setFocus(d) },
      fscommand2: fscommand2 ?? null,
      storage: this.storage,
      load: (req, done, options) => this.load(req, (fn) => this.avm.later(fn), done, options),
      now: this.now,
      random,
      ...avm,
    });
    this.emptySprite = { type: 'sprite', id: -1, order: -1, timeline: Object.assign([[]], { labels: new Map() }) };

    this.rootTimeline = this.#buildTimeline(swf.tags, null, this.library);
    // 共有ライブラリを取り込むものは、取り込んでからルート（1 フレーム目）を作る（Movie.load）。
    if (!this.library.imports?.length) this.#createRoot();
  }

  #createRoot() {
    this.root = new MovieClip(this, { type: 'sprite', id: 0, order: Infinity, timeline: this.rootTimeline }, 0, PLACE_DEFAULTS, 0, null);
    // AS1 / AS2 のレベル（_level0 がルート。loadMovieNum などで、上に重ねて別のムービーを読み込める）。番号 → ルートのクリップ
    this.levels = new Map([[0, this.root]]);
    // AS3 のステージ。ルートを子に持つ入れ物で、スクリプトが stage.addChild で入れたものはルートの兄弟になる。
    // ルートの parent は null のままにしておく（ルートを「親の無いクリップ」として扱っている箇所が多いため）。
    this.stage = null;
    if (this.avm2) {
      this.stage = new MovieClip(this, this.emptySprite, 0, { ...PLACE_DEFAULTS, name: 'stage' }, 0, null, this.avm2.display.stage);
      this.stage.removed = false;
      this.stage.children.set(0, this.root);
    }
  }

  /**
   * 移動の要求を、ホストに渡す（ホストが network.navigate を渡していなければ、何もしない）。
   * fscommand の呼び出し（"FSCommand:..."）と、レベルへの読み込み（target が "_level1" など）は、移動ではないので渡さない。
   */
  navigate(req) {
    if (!this.network?.navigate || /^fscommand:/i.test(req.url) || /^_level\d+$/i.test(req.target ?? '')) return;
    try {
      this.network.navigate(req);
    } catch (e) {
      this.warn(`navigation failed: ${e.message}`);
    }
  }

  /**
   * 読み込みを、ホストに頼む（ホストが network.load を渡していなければ、読めなかったことにする）。
   * 結果は、later で予約した処理（フレームの処理の中で動く）から done(バイト列 | null) に渡す。
   * ホストがその場で値を返せば次のフレームで、Promise を返せば解決した後のフレームで届く。
   * sync が真なら、ホストがその場で値を返したときは、done もその場で呼ぶ（AS2 の loadSound。実機は、ローカルのファイルなら
   * loadSound の中で onLoad を呼ぶ）。
   */
  load(req, later, done, { sync = false } = {}) {
    const deliver = (value) => {
      const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
      if (bytes && bytes.length > MAX_LOADED_BYTES) this.warn(`loaded data is too large (${bytes.length} bytes): ${req.url}`);
      done(bytes && bytes.length <= MAX_LOADED_BYTES ? bytes : null);
    };
    const finish = (value) => later(() => deliver(value));
    let found = null;
    try {
      if (this.network?.load) found = this.network.load(req);
    } catch (e) {
      this.warn(`loading failed: ${e.message}`);
    }
    if (found && typeof found.then === 'function') found.then(finish, () => finish(null));
    else if (sync) deliver(found);
    else finish(found);
  }

  /**
   * 読み込んだファイル（loadMovie / Loader）を、表示できる中身にする。結果は done に渡す（画像はその場で、SWF は解析が済んでから
   * later で予約した処理の中で）。{ bitmap }（画像）、{ character, library }（SWF。character はルートのタイムライン）、null（どちらでもない）。
   */
  loadContent(bytes, later, done) {
    let image = null;
    try {
      image = imageFile(bytes, this.#bitmapPixelBudget);
    } catch (e) {
      if (e.name !== 'SWFError') throw e;
      this.warn(`loaded image cannot be read: ${e.message}`);
      done(null);
      return;
    }
    if (image) {
      this.#bitmapPixelBudget -= image.width * image.height;
      const bitmap = { type: 'bitmap', id: -1, ...image };
      if (!this.decodeImage) { done({ bitmap, size: bytes.length }); return; }
      // 画素も用意する（スクリプトが bitmapData を読むため）。復号に失敗しても、表示はする。
      this.#pixelsOf(bitmap).then(() => later(() => done({ bitmap, size: bytes.length })));
      return;
    }
    const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0);
    if (magic !== 'FWS' && magic !== 'CWS' && magic !== 'ZWS') {
      done(null);
      return;
    }
    this.loadLibrary(bytes).then((content) => later(() => done(content)), (e) => {
      if (e.name !== 'SWFError') this.warn(`loaded movie cannot be read: ${e.message}`);
      else this.warn(`loaded movie cannot be read: ${e.message}`);
      later(() => done(null));
    });
  }

  /**
   * 読み込んだ SWF を解析して、そのライブラリ（辞書、書き出し名、版）と、ルートのタイムラインを作る。
   * 解析の上限（大きさ、ビットマップの画素数、表示オブジェクトの数）は、このムービーと共有する。
   */
  async loadLibrary(bytes, depth = 0) {
    const swf = await parseSWF(bytes);
    const attributes = swf.tags.find((t) => t.code === 69);
    const legacy = swf.version < 6 ? new LegacyText(this.encoding) : null;
    const library = {
      dictionary: new Map(), exports: new Map(), symbolClasses: new Map(), version: swf.version, legacy, jpegTables: undefined, pending: [], main: false, frameRate: swf.frameRate,
      isAS3: !!attributes && attributes.length >= 1 && (attributes.body[0] & 0x08) !== 0, frameSize: swf.frameSize, fileLength: swf.fileLength,
    };
    for (const w of swf.warnings) this.warn(`loaded movie: ${w}`);
    const timeline = this.#buildTimeline(swf.tags, null, library);
    await this.#decodeBitmaps(library);
    await this.#importAssets(library, depth + 1);
    // 図形のビットマップの塗りは、キャラクタ ID ではなくビットマップの定義そのものを持たせる（描画側は、このムービーの辞書しか知らない）。
    const bind = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 6) return;
      if (value.type === 'bitmap' && typeof value.bitmapId === 'number' && !value.bitmap) {
        const bitmap = library.dictionary.get(value.bitmapId);
        if (bitmap?.type === 'bitmap') value.bitmap = bitmap;
      }
      for (const v of Array.isArray(value) ? value : Object.values(value)) if (v && typeof v === 'object' && v.type !== 'sprite') bind(v, depth + 1);
    };
    for (const def of library.dictionary.values()) if (def.type === 'shape' || def.type === 'morph') bind(def, 0);
    return { character: { type: 'sprite', id: 0, order: Infinity, timeline, library }, library, size: swf.fileLength };
  }

  /**
   * AS1 / AS2: レベル n に中身を読み込む（loadMovieNum）。レベルが無ければ作る。content が null なら、レベルを取り除く
   * （_level0 は取り除かず、空にする）。読み込んだクリップを返す。
   */
  setLevel(n, content) {
    let clip = this.levels.get(n);
    if (!content) {
      if (!clip) return null;
      if (n === 0) clip.unload();
      else {
        clip.unload();
        clip.removed = true;
        this.levels.delete(n);
      }
      return null;
    }
    if (!clip) {
      clip = new MovieClip(this, this.emptySprite, n, PLACE_DEFAULTS, 0, null);
      clip.levelNumber = n;
      this.levels.set(n, clip);
    }
    clip.replaceContent(content);
    return clip;
  }

  /** レベルのルートを、番号の大きい順（手前から）に返す。 */
  levelsFromTop() {
    return [...this.levels].sort((a, b) => b[0] - a[0]).map(([, clip]) => clip);
  }

  #linked = null; // AS3: クラス名（"pkg::Name"）→ 結び付けられたキャラクタ

  /** AS3: クラス名（"pkg::Name"）に SymbolClass で結び付けられたキャラクタ。無ければ undefined。 */
  linkedCharacter(name) {
    if (!this.#linked) {
      this.#linked = new Map();
      for (const [id, cls] of this.symbolClasses) if (id !== 0) this.#linked.set(cls.replace(/\.(?=[^.]*$)/, '::'), this.dictionary.get(id));
    }
    return this.#linked.get(name);
  }

  /**
   * AS3: 読み込んだ SWF の SymbolClass を、クラス名の表に足す。同じ名前がすでにあれば、先にあった方を残す
   * （読み込んだ SWF は、読み込んだ側の子のアプリケーションドメインに入り、親の定義が優先される）。root はルートのキャラクタ（ID 0）。
   */
  addLinked(library, root) {
    this.linkedCharacter('');
    for (const [id, cls] of library.symbolClasses) {
      const key = cls.replace(/\.(?=[^.]*$)/, '::');
      if (!this.#linked.has(key)) this.#linked.set(key, id === 0 ? root : library.dictionary.get(id));
    }
  }

  /** このフレームのアクションが全部済んだ後に、run を実行する（loadMovie の onLoadInit 用。積んだ順に実行する）。 */
  queueLate(run) {
    if (this.avm) this.#late.push(run);
  }

  /** 開いている SharedObject を、storage へ書く（ホストが、ページを閉じる前やムービーを替える前に呼ぶ。実機も終了時に書く）。 */
  saveSharedObjects() {
    this.avm?.saveShared?.();
    this.avm2?.saveShared?.();
  }

  /**
   * 1 フレーム進め、たまったアクションを実行する。
   * クリップは新しく作られたものから順に処理し、ルートが最後になる（実機の trace の順序から確認した規則）。
   * このフレームで新しく作られるクリップは、1 フレーム目を表示したままにする。
   */
  advance() {
    const due = this.avm?.pending.splice(0) ?? []; // 前のフレームまでに予約された処理（読み込み失敗の通知など）
    this.#guard(() => this.avm?.runTimers());
    const as3 = this.avm2?.display;
    this.#guard(() => as3?.runStreams()); // 終わりまで再生した NetStream の通知
    this.#guard(() => this.avm?.runStreams());
    as3?.runTimers();
    this.clips = this.clips.filter((clip) => (clip.listed = !clip.removed));
    const clips = this.clips.slice();
    for (let i = clips.length - 1; i >= 0; i--) if (!clips[i].removed && !clips[i].unloadPending) clips[i].tick();
    as3?.broadcast('enterFrame'); // AS3 の enterFrame は、再生ヘッドが進んだ後に届く（実機で確認）
    this.onFrameConstructed?.(); // 各クリップがこのフレームの子を作り終え、フレームのスクリプトを実行する前（検証用の観測点）
    if (as3) this.#framePhase();
    this.runActions();
    for (const run of this.#late.splice(0)) this.#queue.push({ run });
    this.runActions();
    for (const fn of due) this.#guard(fn);
    this.runActions();
    // 音: ストリーム音を各クリップの今のフレームに合わせ、鳴り終わった音を片付ける。
    for (const clip of this.clips) if (clip.frames.stream) this.sounds.syncStream(clip);
    this.#guard(() => this.sounds.update());
    this.runActions(); // 鳴り終わりの通知 (onSoundComplete)
    // 変数と連動するテキストフィールドに、変数の値を反映する。
    for (const field of this.boundFields) {
      if (field.removed) this.boundFields.delete(field);
      else this.#guard(() => field.pull());
    }
    if (this.focus instanceof TextField) this.focus.tickCaret();
    this.#updateButtons(); // マウスが動かなくても、ボタンの方が現れたり消えたりする
  }

  // --- 入力 ---

  /** マウスの位置（ステージ座標、twips）を伝える。 */
  mouseMove(x, y) {
    const moved = !this.#mouseInside || x !== this.mouse.x || y !== this.mouse.y;
    this.mouse = { x, y };
    this.#mouseInside = true;
    if (moved) {
      this.#dragTo();
      this.#broadcast('mouseMove', 'Mouse', 'onMouseMove');
      if (this.#selecting && this.#mouseDown) this.#selecting.field.setSelection(this.#selecting.anchor, this.#selecting.field.indexAtStage(x, y));
    }
    this.#updateButtons();
    this.#mouseEvent(moved ? 'mouseMove' : null);
  }

  /** マウスがステージの外へ出たことを伝える。 */
  mouseLeave() {
    this.#mouseInside = false;
    this.#updateButtons();
    this.#mouseEvent(null);
  }

  // 実機の順序: 全クリップの mouseDown（新しいクリップから、ルートが最後）→ Mouse のリスナー → 押されたものの press。
  mouseDown() {
    this.#updateButtons();
    this.#mouseDown = true;
    this.#broadcast('mouseDown', 'Mouse', 'onMouseDown');
    if (this.#over) {
      this.#pressed = this.#over;
      this.#pressedInside = true;
      this.#buttonEvent(this.#pressed, 'press', 'down');
    }
    this.runActions();
    this.#mouseEvent('mouseDown');
    this.#clickFocus();
  }

  // マウスを押したときのフォーカス: 選べるテキストフィールドならそこへ（キャレットは押した位置）、それ以外なら外す。
  // 点 (x, y) にある、いちばん手前のテキストフィールド（無ければ null）。
  #fieldAt(x, y) {
    if (this.avm2) {
      const hit = this.#pick(this.stage, x, y);
      return hit instanceof TextField ? hit : null;
    }
    const find = (clip) => {
      const children = clip.sortedChildren();
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (!child.visible || child.clipDepth) continue;
        if (child instanceof TextField) { if (child.hitPoint(x, y)) return child; } else if (child instanceof MovieClip) { const found = find(child); if (found) return found; }
      }
      return null;
    };
    for (const level of this.levelsFromTop()) { const field = find(level); if (field) return field; }
    return null;
  }

  #clickFocus() {
    if (!this.#mouseInside) return;
    let field = this.#fieldAt(this.mouse.x, this.mouse.y);
    if (field && !(field.type === 'input' || field.selectable)) field = null;
    this.setFocus(field);
    if (!field) { this.#lastClick = null; return; }
    const at = field.indexAtStage(this.mouse.x, this.mouse.y), now = this.now();
    // 同じフィールドの同じ文字の上で 500 ms 以内にもう一度押したら、ダブルクリック: その単語（空白なら空白の続き）を選ぶ。
    const last = this.#lastClick;
    this.#lastClick = { field, at, time: now };
    if (last && last.field === field && last.at === at && now - last.time <= 500) {
      const [a, b] = wordAt(field.text, at);
      field.setSelection(a, b);
      this.#lastClick = null;
      this.#selecting = null;
      return;
    }
    field.setSelection(at, at);
    this.#selecting = { field, anchor: at };
  }

  /**
   * キーボードのフォーカスを target（表示オブジェクト。外すなら null）に移す。AS3 は focusOut / focusIn、AS2 は onKillFocus / onSetFocus が届く。
   * 選択は、フィールドごとに覚えている（フォーカスが無いと、選択もキャレットも描かない）。
   */
  setFocus(target) {
    if (target === this.focus) return;
    const old = this.focus;
    this.focus = target;
    for (const field of [old, target]) if (field instanceof TextField) field.changed();
    this.avm2?.display.focusChange(old, target);
    this.#guard(() => this.avm?.focusChange?.(old, target));
    this.runActions();
  }

 /**
   * テキストフィールドの <img src> の画像（JPEG・PNG・GIF）。ホストの network.load で読み、読めたら、使っているフィールドを描き直させる。
   * 戻り値は { bitmap（読めるまでは null）, failed }。ライブラリのビットマップの書き出し名（AS3 はクラス名）なら、それを描く。
   * ライブラリのクリップや SWF を指す src は描かない。
   */
  textImage(src, field) {
    let entry = this.textImages.get(src);
    // ライブラリのビットマップ（AS2 の書き出し名、AS3 のクラス名）なら、それを使う（読み込まない）。
    const linked = !entry && (this.exportedBitmap(src) ?? (this.avm2 ? this.linkedCharacter(src.replace(/\.(?=[^.]*$)/, '::')) : null));
    if (linked?.type === 'bitmap') {
      entry = { bitmap: linked, failed: false, fields: new Set() };
      this.textImages.set(src, entry);
    }
    if (!entry) {
      entry = { bitmap: null, failed: false, fields: new Set() };
      this.textImages.set(src, entry);
      const later = (fn) => (this.avm2 ? this.avm2.display.later(fn) : this.avm.later(fn));
      const fail = () => { entry.failed = true; };
      this.load({ url: src, method: 'GET', data: null, contentType: null }, later, (bytes) => {
        if (!bytes) { fail(); return; }
        this.loadContent(bytes, later, (content) => {
          entry.bitmap = content?.bitmap ?? null;
          if (!entry.bitmap) fail();
          for (const f of entry.fields) f.changed();
        });
      });
    }
    entry.fields.add(field);
    return entry;
  }

  /** AS2: 書き出し名 name の付いたビットマップの定義（無ければ null。名前の大文字と小文字は区別しない）。 */
  exportedBitmap(name) {
    const want = this.lower(name);
    for (const [key, id] of this.library.exports) {
      if (this.lower(key) !== want) continue;
      const def = this.library.dictionary.get(id);
      return def?.type === 'bitmap' ? def : null;
    }
    return null;
  }

  /**
   * 3D の表示オブジェクト d の透視投影 { center, focal }（px）。親をたどって、PerspectiveProjection を持つもの（AS3 の
   * transform.perspectiveProjection を代入したもの）の値、無ければルートのもの（既定は視野角 55 度、中心はステージの中央。
   * 焦点距離は (ステージの幅 / 2) / tan(視野角 / 2)。実機で確認）。
   */
  projection(d) {
    const width = (this.frameSize.xmax - this.frameSize.xmin) / 20, height = (this.frameSize.ymax - this.frameSize.ymin) / 20;
    let pp = null;
    for (let a = d?.parent; a && !pp; a = a.parent) if (a.pp && !a.pp.root) pp = a.pp;
    pp ??= this.root.pp ?? { fieldOfView: 55, center: null, root: true };
    return { center: pp.center ?? (pp.root ? { x: width / 2, y: height / 2 } : { x: 250, y: 250 }), focal: focalLength(pp.fieldOfView, pp.root ? width : 500) };
  }

  /** 打ち込まれた文字（IME で確定した文字列も）を、フォーカスのある入力フィールドへ入れる。キーが押されたことは、keyDown で別に伝える。 */
  textInput(text) {
    if (!(this.focus instanceof TextField)) return;
    this.compose('');
    this.focus.typeText(String(text));
    this.runActions();
  }

  /** IME で変換中の文字列を伝える（空にすると消える）。確定した文字列は textInput で渡す。 */
  compose(text) {
    const field = this.focus;
    if (!(field instanceof TextField) || field.type !== 'input') return;
    const next = text === '' || text === null || text === undefined ? null : String(text);
    if (next === field.composition) return;
    field.setComposition(next);
  }

  /** コピー: フォーカスのあるフィールドの選択中の文字列（無ければ null。パスワードのフィールドは何も渡さない）。 */
  copySelection() {
    const f = this.focus;
    if (!(f instanceof TextField) || f.password || f.selection[0] === f.selection[1]) return null;
    return f.text.slice(f.selection[0], f.selection[1]).replace(/\r/g, '\n');
  }

  /** 切り取り: copySelection と同じ文字列を返して、入力フィールドなら選択を消す。 */
  cutSelection() {
    const text = this.copySelection();
    if (text !== null && this.focus.type === 'input') { this.focus.deleteSelection(); this.runActions(); }
    return text;
  }

  /** 貼り付け: 文字列を、打ち込んだときと同じ規則で、フォーカスのある入力フィールドへ入れる。 */
  paste(text) {
    this.textInput(text);
  }

  /** マウスホイール: ポインタの下のスクロールできるフィールドを、lines 行（正なら下へ）動かす。動かせたら true。 */
  mouseWheel(lines) {
    if (!this.#mouseInside) return false;
    const field = this.#fieldAt(this.mouse.x, this.mouse.y);
    if (!field || field.mouseWheelEnabled === false) return false;
    const before = field.scrollV;
    field.setScroll(field.scrollV + Math.trunc(lines));
    return field.scrollV !== before;
  }

  /** テキストフィールドのスクロールが変わった（AS3 は scroll、AS2 は onScroller）。 */
  scrolled(field) {
    this.avm2?.display.scroll(field);
    this.#guard(() => this.avm?.scrolled?.(field));
  }

  /** AS3: テキストフィールドに文字が入る直前の textInput イベント。取り消されたら false。 */
  fireTextInput(field, text) {
    return this.avm2 ? this.avm2.display.textInput(field, text) : true;
  }

  /** 入力で文字列が変わったあとの通知（AS3 は change、AS2 は onChanged）。 */
  textChanged(field) {
    this.avm2?.display.change(field);
    this.#guard(() => this.avm?.textChanged?.(field));
  }

  mouseUp() {
    this.#updateButtons();
    this.#mouseDown = false;
    this.#selecting = null;
    this.#broadcast('mouseUp', 'Mouse', 'onMouseUp');
    if (this.#pressed) {
      if (this.#pressedInside) this.#buttonEvent(this.#pressed, 'release', 'over');
      else this.#buttonEvent(this.#pressed, 'releaseOutside', 'up');
      this.#over = this.#pressedInside ? this.#pressed : null;
      this.#pressed = null;
    }
    this.runActions();
    this.#updateButtons();
    this.#mouseEvent('mouseUp');
  }

  /**
   * キーが押されたことを伝える。
   * @param {number} code   仮想キーコード（Key.getCode() の値。A は 65、Enter は 13、← は 37 など）
   * @param {number} [ascii] 文字コード（Key.getAscii() の値）。省略すると、英字は小文字、数字と空白はそのままの文字とみなす
   */
  keyDown(code, ascii = code >= 65 && code <= 90 ? code + 32 : (code >= 48 && code <= 57) || code === 32 ? code : 0, { shift = false, ctrl = false, alt = false } = {}) {
    this.avm?.keyEvent(code, ascii, true);
    this.#broadcast('keyDown', 'Key', 'onKeyDown');
    // ボタンの keyPress。同じキーに反応するボタンがいくつあっても、実行されるのは表示順でいちばん下（奥）の 1 つだけ（実機で確認）。
    const key = BUTTON_KEY[code] ?? ascii;
    const find = (clip) => {
      if (!clip.visible) return null;
      for (const child of clip.sortedChildren()) {
        if (!(child instanceof MovieClip)) continue;
        if (!child.character.button) {
          const found = find(child);
          if (found) return found;
        } else if (child.visible && child.character.button.actions.some((action) => action.key === key)) {
          return child;
        }
      }
      return null;
    };
    let button = null;
    for (const level of key ? this.levelsFromTop() : []) if ((button = find(level))) break;
    for (const action of button?.character.button.actions ?? []) if (action.key === key) this.queueAction(button.parent, action.code);
    this.runActions();
    this.#keyChars.set(code, ascii);
    this.avm2?.display.key('keyDown', code, ascii, { shift, ctrl, alt });
    if (code === 9) this.#tab(shift);
    else if (this.focus instanceof TextField && !alt) { this.focus.editKey(code, { shift, ctrl }); this.runActions(); }
  }

  // Tab キー: 入力フィールドを、表示の順に次（Shift なら前）へ移す。
  #tab(reverse) {
    const fields = [];
    const collect = (clip) => {
      for (const child of clip.sortedChildren()) {
        if (!child.visible) continue;
        if (child instanceof TextField) { if (child.type === 'input' && child.ext?.tabEnabled !== false) fields.push(child); } else if (child instanceof MovieClip) collect(child);
      }
    };
    for (const level of [...this.levelsFromTop()].reverse()) collect(level);
    if (!fields.length) return;
    const at = fields.indexOf(this.focus);
    const next = at < 0 ? (reverse ? fields.length - 1 : 0) : (at + (reverse ? -1 : 1) + fields.length) % fields.length;
    this.setFocus(fields[next]);
    fields[next].setSelection(0, fields[next].text.length); // Tab で来たときは、全部を選ぶ
  }

  /** キーが離されたことを伝える。 */
  keyUp(code) {
    this.avm?.keyEvent(code, 0, false);
    this.#broadcast('keyUp', 'Key', 'onKeyUp');
    this.runActions();
    this.avm2?.display.key('keyUp', code, this.#keyChars.get(code) ?? 0, {}); // 離したときのイベントも、押したときの文字コードを持つ
    this.#keyChars.delete(code);
  }

  /** マウスが乗っているボタン、またはボタンのように反応するクリップ（無ければ null）。カーソルの形を変えるのに使う。 */
  get hoverButton() {
    return this.#over ?? (this.avm2?.display.handCursor() ? this.root : null);
  }

  // AS3: マウスの位置にあるオブジェクトへ、マウスのイベントを届ける（type が null なら、乗っているものの変化だけを伝える）。
  #mouseEvent(type) {
    if (!this.avm2) return;
    const hit = this.#mouseInside ? this.#pick(this.stage, this.mouse.x, this.mouse.y) : null;
    this.avm2.display.mouse(type, hit && hit !== PASS ? hit : null, this.#mouseInside, this.#mouseDown);
  }

  // AS3: clip の中で、点 (x, y) にあるいちばん手前の、マウスのイベントの相手（InteractiveObject）を探す。
  // 戻り値は、相手の表示オブジェクト、PASS（何かに当たったが、それを受けるものが clip の中には無い）、null（何にも当たらない）。
  // 実機で確かめた決まり:
  //  - 図形や描画 API の絵は相手にならず、それを持つクリップが受ける。mouseEnabled が偽のものに当たったときも、親が受ける。
  //  - 受けられない（mouseEnabled が偽の）クリップは、下にある子を続けて調べ、それでも決まらなければ親に任せる。
  //  - mouseChildren が偽のクリップは、子の代わりに自分が受ける。
  //  - ルート（メインタイムライン）は受けない。ルートの図形や、ルートに任されたぶんは、下に何も無ければステージが相手になる。
  #pick(clip, x, y) {
    const receives = clip.mouseEnabled !== false && clip !== this.root && clip !== this.stage;
    let passed = false;
    const children = clip.sortedChildren();
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (!child.visible || child.clipDepth) continue;
      let hit = null;
      if (!(child instanceof MovieClip) || child.leaf) {
        if (child.hitPoint(x, y)) hit = child instanceof TextField && child.mouseEnabled !== false ? child : PASS;
      } else if (child.hitArea) {
        // hitArea が決まっているクリップは、その形で当たる（本人の絵と子は当たらない）。
        if (child.hitArea.hitPoint(x, y)) hit = child.mouseEnabled !== false ? child : PASS;
      } else if (child.states) {
        // スクリプトが作ったボタン: 当たり判定用の状態の形で決める。その表示オブジェクトは表示リストに無いので、判定の間だけボタンの子として扱う。
        const area = child.states.hit;
        if (area) {
          const parent = area.parent;
          area.parent = child;
          try {
            if (area.hitPoint(x, y)) hit = child.mouseEnabled !== false ? child : PASS;
          } finally {
            area.parent = parent;
          }
        }
      } else if (child.character.button) {
        const local = child.globalToLocal(x, y);
        if (child.character.button.records.some((rec) => rec.hitTest && this.#hits(rec, local, 0))) hit = child.mouseEnabled !== false ? child : PASS;
      } else {
        hit = this.#pick(child, x, y);
      }
      if (!hit) continue;
      if (hit !== PASS && clip.mouseChildren !== false) return hit;
      if (receives) return clip;
      passed = true;
    }
    const drawn = clip.drawingPaths(); // 描画 API で描いた図形は、子より下にある
    if (drawn) {
      const local = clip.globalToLocal(x, y);
      if (insidePaths(drawn, local.x, local.y)) {
        if (receives) return clip;
        passed = true;
      }
    }
    return passed ? PASS : null;
  }

  // 全クリップにイベントを配り（新しいクリップから、ルートが最後）、続けて Mouse / Key のリスナーを呼ぶ。
  #broadcast(event, object, method) {
    if (!this.avm) return;
    for (let i = this.clips.length - 1; i >= 0; i--) if (!this.clips[i].removed) this.fire(this.clips[i], event);
    this.#queue.push({ run: () => this.avm.broadcast(object, method) });
  }

  // --- ドラッグ (startDrag) ---

  /**
   * クリップをマウスに追従させる。bounds は親の座標系での範囲（twips、{ left, top, right, bottom }）で、省略可。
   * lock が真なら、クリップの基準点がマウスの位置に来る。偽なら、つかんだ時点の位置関係を保つ。
   */
  startDrag(clip, lock, bounds) {
    const p = (clip.parent ?? clip).mouseLocal();
    this.#drag = { clip, bounds, dx: lock ? 0 : clip.matrix.tx - p.x, dy: lock ? 0 : clip.matrix.ty - p.y };
  }

  stopDrag() {
    this.#drag = null;
  }

  #dragTo() {
    const drag = this.#drag;
    if (!drag) return;
    if (drag.clip.removed) {
      this.#drag = null;
      return;
    }
    const p = (drag.clip.parent ?? drag.clip).mouseLocal();
    let x = p.x + drag.dx;
    let y = p.y + drag.dy;
    if (drag.bounds) {
      x = Math.min(Math.max(x, drag.bounds.left), drag.bounds.right);
      y = Math.min(Math.max(y, drag.bounds.top), drag.bounds.bottom);
    }
    drag.clip.setMatrix({ ...drag.clip.matrix, tx: Math.round(x), ty: Math.round(y) });
    drag.clip.dropTarget = this.clipUnderMouse(drag.clip)?.slashPath() ?? ''; // _droptarget
  }

  /** マウスの位置にあるいちばん手前のクリップ（exclude とその中身は除く）。ドラッグ中の _droptarget の値になる。 */
  clipUnderMouse(exclude) {
    const find = (clip) => {
      const children = clip.sortedChildren();
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child === exclude || !child.visible || child.clipDepth) continue;
        if (child instanceof MovieClip) {
          const found = find(child);
          if (found) return found;
        } else if (clip.parent && child.hitPoint(this.mouse.x, this.mouse.y)) {
          return clip;
        }
      }
      return null;
    };
    for (const level of this.levelsFromTop()) {
      const found = find(level);
      if (found) return found;
    }
    return null;
  }

  // --- ボタン ---

  // クリップがボタンのように反応するか（ボタンそのもの、または press などのハンドラを持つクリップ）。
  #buttonLike(clip) {
    if (clip.character.button) return true;
    if (clip.clipActions?.some((action) => action.events & BUTTON_FLAGS)) return true;
    const object = clip.scriptObject();
    return !!object && BUTTON_EVENTS.some((name) => object.get(EVENT_METHOD[name]) instanceof AVMFunction);
  }

  // enabled が偽のボタンやクリップは、マウスに反応しない。
  #enabled(clip) {
    if (clip.enabled === false) return false; // AS3 の SimpleButton.enabled
    const object = clip.scriptObject();
    return !object || toBool(this.avm, object.get('enabled') ?? true);
  }

  // マウス位置にあるいちばん手前のボタン（またはボタンのように反応するクリップ）。それ以外の図形は、上に重なっていても隠さない。
  #buttonAt(clip, x, y) {
    if (!clip.visible) return null;
    const children = clip.sortedChildren();
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.clipDepth || !(child instanceof MovieClip)) continue;
      if (!this.#buttonLike(child)) {
        const found = this.#buttonAt(child, x, y);
        if (found) return found;
        continue;
      }
      if (!child.visible || !this.#enabled(child)) continue;
      const button = child.character.button;
      if (!button) {
        // クリップは、表示中の中身の形で判定する。
        if (child.hitPoint(x, y)) return child;
        continue;
      }
      const m = invert(child.worldMatrix());
      const local = { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
      if (button.records.some((rec) => rec.hitTest && this.#hits(rec, local, 0, child.library.dictionary))) return child;
    }
    return null;
  }

  // 配置の記述 place（キャラクタと行列）が、親の座標系の点 p を含むか。図形は塗りの内側、スプライトは 1 フレーム目の中身で判定する。
  #hits(place, p, depth, dictionary) {
    const character = dictionary.get(place.characterId);
    if (!character || depth > 8) return false;
    const m = invert(place.matrix ?? IDENTITY);
    const q = { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty };
    if (character.type === 'shape') return insidePaths(character.paths, q.x, q.y);
    if (character.type === 'sprite') {
      return (character.timeline[0] ?? []).some((op) => op.op === 'place' && op.characterId !== undefined && this.#hits(op, q, depth + 1, dictionary));
    }
    return false;
  }

  // マウスとボタンの位置関係を調べ直し、変化があればイベントを起こす。
  #updateButtons() {
    if (this.#over?.removed) this.#over = null;
    if (this.#pressed?.removed) this.#pressed = null;
    let hit = null;
    this.#guard(() => { // ハンドラの有無を調べるときに、スクリプトの getter が動くことがある
      for (const level of this.#mouseInside ? this.levelsFromTop() : []) if ((hit = this.#buttonAt(level, this.mouse.x, this.mouse.y))) break;
    });
    if (this.#pressed) {
      // 押したまま出入りする
      const inside = hit === this.#pressed;
      if (inside !== this.#pressedInside) {
        this.#pressedInside = inside;
        this.#buttonEvent(this.#pressed, inside ? 'dragOver' : 'dragOut', inside ? 'down' : 'over');
      }
    } else if (!this.#mouseDown && hit !== this.#over) {
      if (this.#over) this.#buttonEvent(this.#over, 'rollOut', 'up');
      if (hit) this.#buttonEvent(hit, 'rollOver', 'over');
      this.#over = hit;
    }
    this.runActions();
  }

  // ボタンなら見た目を state に切り替えて条件 event のアクションを待ち行列に入れる（ボタンを置いたクリップが対象）。
  // クリップなら on(press) などのコードと、onPress などのメソッドを呼ぶ。
  #buttonEvent(target, event, state) {
    const button = target.character.button;
    if (button) {
      target.setButtonState(state);
      for (const action of button.actions) if (action.cond & BUTTON_COND[event]) this.queueAction(target.parent, action.code);
      const sound = target.character.buttonSounds?.[event]; // DefineButtonSound
      const defined = sound && target.library.dictionary.get(sound.soundId);
      if (defined?.type === 'sound') this.sounds.start(defined, sound.info, target.parent);
    } else {
      // クリップは、_up / _over / _down というフレームラベルがあれば、ハンドラより先にそのフレームへ移って止まる。
      const frame = target.frameNumber(`_${state}`);
      if (frame !== undefined) target.gotoFrame(frame, false);
    }
    this.fire(target, event);
  }

  /** AS3: new TextField() の表示オブジェクト（幅も高さも 100 px。表示リストの外に作る）を作って、as3 と結び付ける。 */
  newTextField(as3) {
    const character = { type: 'edittext', id: -2, order: -1, bounds: { xmin: 0, xmax: 2000, ymin: 0, ymax: 2000 }, edit: null, fontName: undefined };
    const field = new TextField(this, character, 0, PLACE_DEFAULTS, null);
    field.name = this.nextInstanceName();
    field.removed = true;
    field.as3 = as3;
    as3.display = field;
    return field;
  }

  /** AS3: new Video(幅, 高さ) の表示オブジェクト（表示リストの外に作る）を作って、as3 と結び付ける。 */
  newVideo(as3, width, height) {
    const video = new VideoObject(this, { type: 'video', id: -3, order: -1, width, height, codec: null, frames: null, smoothing: false }, 0, PLACE_DEFAULTS, null);
    video.name = this.nextInstanceName();
    video.removed = true;
    video.as3 = as3;
    as3.display = video;
    return video;
  }

  /** テキストフィールドの状態 edit（DefineEditText と同じ形）を描画命令にする。 */
  textPaths(edit, library = this.library) {
    return editTextToPaths(edit, fontsOf(library));
  }

  /** 名前の照合用の小文字化。SWF 5 以前は英字だけを対象にする（2 バイト文字を壊さない）。 */
  lower(name) {
    return this.legacy ? this.legacy.lower(name) : name.toLowerCase();
  }

  warn(message) {
    if (this.warnings.length < 100) this.warnings.push(message);
  }

  /** 名前の無いクリップに付ける名前（instance1, instance2, ...）。 */
  nextInstanceName() {
    return `instance${++this.#instanceNames}`;
  }

  #unnamedCounts = new Map(); // キャラクタ ID → それを置いたときに作られる、名前の無いオブジェクトの数（自分は除く）

  /**
   * AS3: キャラクタ id を置いたら付いたはずの instanceN の番号を、置かずに進める。
   * 実機では、タイムラインが前のフレームへ戻る（最終フレームから 1 フレーム目へ回るのも同じ）とき、そのまま残るオブジェクトのぶんも
   * 番号が進む（test/as3/lifecycle.as の出力から確認）。
   */
  skipInstanceNames(id, named) {
    const inside = (characterId, order) => {
      if (this.#unnamedCounts.has(characterId)) return this.#unnamedCounts.get(characterId);
      const character = this.dictionary.get(characterId);
      let n = 0;
      if (character?.type === 'sprite' && character.order < order) {
        for (const op of character.timeline[0] ?? []) {
          if (op.op === 'place' && op.characterId !== undefined) n += (op.name ? 0 : 1) + inside(op.characterId, character.order);
        }
      }
      this.#unnamedCounts.set(characterId, n);
      return n;
    };
    this.#instanceNames += (named ? 0 : 1) + inside(id, Infinity);
  }

  // --- アクションの待ち行列 ---

  #scriptsMissing = false;

  queueAction(clip, code) {
    if (this.avm) this.#queue.push({ clip, code });
    else if (!this.isAS3 && !this.#scriptsMissing) {
      this.#scriptsMissing = true; // 機能を絞った版（AVM1 なし）で、スクリプトのある SWF を再生した
      this.warn('ActionScript 1 / 2 is not included in this build; scripts do not run');
    }
  }

  queueInit(spriteId, clip, code) {
    if (!this.avm || this.#initDone.has(spriteId)) return;
    this.#initDone.add(spriteId);
    this.#initQueue.push({ clip, code });
  }

  /**
   * クリップイベントを発生させる。onClipEvent のコードと、同名のメソッド (onEnterFrame など) を待ち行列に入れる。
   * キーのイベントには対応するメソッドが無い（EVENT_METHOD に無いものは onClipEvent だけ）。
   */
  fire(clip, event) {
    if (!this.avm) return;
    for (const action of clip.clipActions ?? []) {
      if (action.events & EVENT[event]) this.#queue.push({ clip, code: action.code, removedOk: event === 'unload' });
    }
    if (EVENT_METHOD[event]) this.#queue.push({ clip, method: EVENT_METHOD[event], removedOk: event === 'unload', last: event === 'unload' });
  }

  /** 待ち行列が空になるまでアクションを実行する。実行中に積まれたものも続けて実行する。 */
  runActions() {
    const { avm } = this;
    if (!avm) return;
    for (;;) {
      const item = this.#initQueue.shift() ?? this.#queue.shift();
      if (!item) break;
      if (item.run) {
        this.#guard(item.run);
        continue;
      }
      if (avm.disabled || (item.clip.removed && !item.removedOk)) continue;
      const target = item.clip.scriptObject();
      this.#guard(() => {
        if (item.code) {
          avm.run(item.code, target);
        } else {
          const fn = target.get(item.method);
          if (fn instanceof AVMFunction) avm.invoke(fn, target, item.args);
        }
      });
      if (item.last) item.clip.finishUnload();
    }
  }

  // AS3: フレームの後半。frameConstructed を配り、フレームに入ったクリップのフレームスクリプトを実行し、exitFrame を配る。
  // フレームが進んだときのほか、スクリプトがフレームを移すたびに、その場で行われる（実機で確認）。
  #framePhase() {
    const { avm2 } = this;
    if (this.#phaseDepth >= 16) return; // ハンドラの中の移動がさらに移動を呼ぶ、という入れ子の歯止め
    this.#phaseDepth++;
    try {
      this.constructPending(this.stage);
      avm2.display.broadcast('frameConstructed');
      for (let round = 0; round < 1000; round++) {
        if (!this.clips.some((clip) => clip.scriptPending)) break;
        // 実行の順序は、このフレームで取り除かれたクリップが先で、あとは表示リストの順（親が先、子は下から上）。
        const pending = this.clips.filter((clip) => clip.scriptPending && clip.removed);
        const collect = (clip) => {
          if (clip.scriptPending) pending.push(clip);
          for (const child of clip.sortedChildren()) if (child instanceof MovieClip) collect(child);
        };
        collect(this.stage);
        for (const clip of pending) {
          if (!clip.scriptPending) continue;
          clip.scriptPending = false;
          const fn = clip.frameScripts?.get(clip.currentFrame);
          if (!fn || !clip.as3) continue;
          clip.inFrameScript = true;
          try {
            // this は渡さない。メソッド（FLA が作るフレームスクリプト）はクリップに結び付いていて、無名関数の this はクリップにならない（実機で確認）。
            avm2.run(() => avm2.call(fn, null, []), (text) => this.warn(`uncaught error: ${text}`));
          } finally {
            clip.inFrameScript = false;
          }
          // 自分のフレームスクリプトの中で頼まれた移動は、スクリプトが終わってから行う（最後に頼まれたものだけ）。
          const goto = clip.deferredGoto;
          clip.deferredGoto = null;
          if (goto) this.gotoFrame(clip, goto.frame, goto.play);
        }
      }
      avm2.display.broadcast('exitFrame');
    } finally {
      this.#phaseDepth--;
    }
  }

  /**
   * AS3: クリップのフレームを移す (gotoAndPlay / gotoAndStop など)。移した先のフレームのスクリプトは、その場で実行される。
   * 自分のフレームスクリプトの実行中なら、スクリプトが終わるまで移動を待つ。
   * 最終フレームより先を指定すると、最終フレームへ移るが、そのフレームのスクリプトは実行されない（実機で確認）。
   */
  gotoFrame(clip, frame, play) {
    if (clip.inFrameScript) {
      clip.deferredGoto = { frame, play };
      return;
    }
    const before = clip.currentFrame;
    clip.gotoFrame(frame, play);
    if (frame > clip.frames.length && clip.currentFrame !== before) clip.scriptPending = false;
    if (clip.removed) this.constructPending(clip); // 表示リストの外のクリップは、下の処理では辿れない
    this.#framePhase();
  }

  /**
   * AS3: タイムラインが置いたクリップのうち、まだのもののコンストラクタを呼ぶ（top とその子孫が対象）。
   * 実機と同じく、フレームが進んで enterFrame が配られた後に、表示リストの順（下から上）で、子を親より先に呼ぶ。
   */
  constructPending(top) {
    if (!this.unconstructed.size) return;
    const walk = (d) => {
      for (const child of d.sortedChildren?.() ?? []) walk(child);
      if (this.unconstructed.delete(d)) this.avm2.display.construct(d);
    };
    walk(top);
    // 呼ぶ前に取り除かれたものは、もう辿れない。
    if (top === this.stage) for (const clip of this.unconstructed) if (clip.removed) this.unconstructed.delete(clip);
  }

  // ABC を読み込む。壊れた ABC は警告を出して読み飛ばす。
  #loadABC(bytes, lazy) {
    try {
      this.avm2.run(() => this.avm2.loadABC(bytes, { lazy }), (text) => this.warn(`uncaught error: ${text}`));
    } catch (e) {
      if (e.name !== 'ABCError') throw e;
      this.warn(`ABC: ${e.message}`);
    }
  }

  // スクリプトを実行する。上限を超えたら、実機と同じく以後のスクリプトをすべて止める（再帰の深さの超過も同じ）。
  #guard(body) {
    if (this.avm?.disabled) return;
    try {
      body();
    } catch (e) {
      if (e.name !== 'AVMError' || !this.avm) throw e;
      this.warn(`scripts are disabled: ${e.message}`);
      this.avm.disabled = true;
    }
  }

  // タグ列を、定義（辞書へ）とフレームごとの操作（配置・削除・アクション）に分ける。
  // 定義は先にすべて辞書へ入れる（本来は読み込みの進行に合わせて増えるが、再生結果は変わらない）。
  #buildTimeline(tags, sprite, lib) {
    const frames = [];
    frames.labels = new Map(); // フレームラベル → フレーム番号
    let ops = [];
    let streamHead = null; // このタイムラインのストリーム音の形式
    const streamBlocks = [];
    for (const tag of tags) {
      try {
        if (tag.code === 1) {
          frames.push(ops);
          ops = [];
        } else if (tag.code === 4 || tag.code === 26 || tag.code === 70) {
          ops.push({ op: 'place', ...parsePlaceObject(tag, lib.version) });
        } else if (tag.code === 5 || tag.code === 28) {
          ops.push({ op: 'remove', ...parseRemoveObject(tag) });
        } else if (tag.code === 12) {
          ops.push({ op: 'action', code: tag.body });
        } else if (tag.code === 15 || tag.code === 89) {
          ops.push({ op: 'sound', ...parseStartSound(tag) });
        } else if (tag.code === 18 || tag.code === 45) {
          streamHead ??= parseSoundStreamHead(tag);
        } else if (tag.code === 19) {
          if (streamHead) streamBlocks.push({ frame: frames.length + 1, ...parseSoundStreamBlock(tag, streamHead) });
        } else if (tag.code === 43) {
          const name = new Reader(tag.body, lib.legacy !== null).string();
          if (!frames.labels.has(name)) frames.labels.set(name, frames.length + 1);
        } else if (sprite) {
          // 定義タグはスプライトの中には置けない（仕様 13 章）。
        } else if (tag.code === 59 && tag.length >= 2) {
          ops.push({ op: 'init', spriteId: tag.body[0] | (tag.body[1] << 8), code: tag.body.subarray(2) });
        } else if (tag.code === 86) {
          // DefineSceneAndFrameLabelData: シーン（開始フレームは 0 始まり）とフレームラベル。AS3 のシーンの API が使う。
          const r = new Reader(tag.body, lib.legacy !== null);
          const scenes = [];
          for (let n = r.encodedU32(); n > 0; n--) scenes.push({ offset: r.encodedU32(), name: r.string() });
          const labels = [];
          for (let n = r.encodedU32(); n > 0; n--) labels.push({ frame: r.encodedU32() + 1, name: r.string() });
          if (scenes.length) frames.scenes = scenes.sort((a, b) => a.offset - b.offset);
          frames.sceneLabels = labels.sort((a, b) => a.frame - b.frame);
        } else if (tag.code === 56) {
          const r = new Reader(tag.body, lib.legacy !== null);
          for (let n = r.u16(); n > 0; n--) {
            const id = r.u16();
            lib.exports.set(r.string(), id);
          }
        } else if (tag.code === 57 || tag.code === 71) {
          // ImportAssets / ImportAssets2: 別の SWF（url）が書き出した記号を、この SWF の ID として使う。読み込みは importAssets。
          const r = new Reader(tag.body, lib.legacy !== null);
          const url = r.string();
          if (tag.code === 71) { r.u8(); r.u8(); } // 予約（1 と 0）
          const items = [];
          for (let n = r.u16(); n > 0; n--) items.push({ id: r.u16(), name: r.string() });
          (lib.imports ??= []).push({ url, items });
        } else if ((tag.code === 82 || tag.code === 72) && this.avm2 && lib.isAS3) {
          // DoABC: フラグ（u32）と名前の後に ABC が続く。古い形 (72) は ABC だけ。
          let at = 0;
          if (tag.code === 82) {
            at = tag.body.indexOf(0, 4) + 1;
            if (at <= 0) throw new SWFError('DoABC has no name');
          }
          const lazy = tag.code === 82 && (tag.body[0] & 1) !== 0;
          this.#loadABC(tag.body.subarray(at), lazy);
        } else if (tag.code === 76 && this.avm2 && lib.isAS3) {
          const r = new Reader(tag.body);
          for (let n = r.u16(); n > 0; n--) {
            const id = r.u16();
            lib.symbolClasses.set(id, r.string());
          }
        } else if (tag.code === 14) {
          const sound = parseDefineSound(tag);
          if (!['pcm', 'pcm-native', 'adpcm', 'mp3'].includes(sound.format)) this.warn(`sound ${sound.id}: format ${sound.format} is not supported (it will be silent)`);
          this.#define({ type: 'sound', ...sound }, lib);
        } else if (tag.code === 60) {
          const video = parseDefineVideoStream(tag);
          if (video.numFrames > 0 && !decodable(video.codec)) this.warn(`video ${video.id}: codec ${video.codec} is not supported (it will not be shown)`);
          this.#define({ type: 'video', ...video, frames: new Map() }, lib);
        } else if (tag.code === 61) {
          // フレームのデータは、ビデオのキャラクタに番号つきで集める。どれを表示するかは、置くときの ratio で決まる。
          const frame = parseVideoFrame(tag);
          const video = lib.dictionary.get(frame.streamId);
          if (video?.type === 'video') video.frames.set(frame.frameNum, frame.data);
          else this.warn(`video frame for an undefined video stream ${frame.streamId}`);
        } else if (tag.code === 17) {
          const { buttonId, sounds } = parseDefineButtonSound(tag);
          const button = lib.dictionary.get(buttonId);
          if (button?.button) button.buttonSounds = sounds;
        } else if (tag.code === 87 && tag.length >= 6) {
          // DefineBinaryData: ID、予約（u32）、中身。AS3 のクラスに結び付けて、ByteArray として使う。
          this.#define({ type: 'binary', id: tag.body[0] | (tag.body[1] << 8), data: new Uint8Array(tag.body.subarray(6)) }, lib); // 写しにする（Node の Buffer の slice は写さない）
        } else if (tag.code === 23) {
          // DefineButtonCxform: DefineButton の中身の色変換。実機では、最初のレコードにだけかかる。
          const r = new Reader(tag.body);
          const target = lib.dictionary.get(r.u16());
          const first = target?.button?.records[0];
          if (first && !first.cxform) {
            first.cxform = r.cxform(false);
            for (const op of target.timeline[0]) if (op.depth === first.depth && op.characterId === first.characterId) op.cxform = first.cxform;
          }
        } else if (tag.code === 78) {
          // DefineScalingGrid: スプライト（ボタン）の 9 分割拡大の枠。描き方は描画側が決める。
          const r = new Reader(tag.body);
          const target = lib.dictionary.get(r.u16());
          if (target?.type === 'sprite') target.scalingGrid = r.rect();
        } else if (tag.code === 9) {
          if (lib.main) this.backgroundColor ??= parseSetBackgroundColor(tag);
        } else if (SHAPE_TAGS.has(tag.code)) {
          const shape = parseDefineShape(tag);
          this.#define({ type: 'shape', id: shape.id, bounds: shape.bounds, paths: shapeToPaths(shape) }, lib);
        } else if (tag.code === 7 || tag.code === 34) {
          // ボタンは、通常状態 (up) のキャラクタを置いた 1 フレームのスプライトとして扱う。
          // マウスに応じた状態の切り替えは MovieClip.setButtonState、イベントは Movie.mouseMove などが行う。
          const button = parseDefineButton(tag);
          const place = button.records.filter((rec) => rec.up).map((rec) => ({ op: 'place', move: false, ...rec }));
          this.#define({ type: 'sprite', id: button.id, timeline: Object.assign([place], { labels: new Map() }), button }, lib);
        } else if (tag.code === 46 || tag.code === 84) {
          this.#define({ type: 'morph', ...parseDefineMorphShape(tag) }, lib);
        } else if (tag.code === 10 || tag.code === 48 || tag.code === 75) {
          this.#define({ type: 'font', ...parseDefineFont(tag) }, lib);
        } else if (tag.code === 13 || tag.code === 62) {
          const font = lib.dictionary.get(tag.body[0] | (tag.body[1] << 8));
          if (font?.type === 'font') Object.assign(font, parseDefineFontInfo(tag, font.glyphCount));
        } else if (tag.code === 11 || tag.code === 33) {
          // 静的テキストは、グリフを並べた図形として扱う。
          const text = parseDefineText(tag);
          this.#define({ type: 'shape', id: text.id, bounds: text.bounds, paths: textToPaths(text, fontsOf(lib)) }, lib);
        } else if (tag.code === 37) {
          const edit = parseDefineEditText(tag, lib.legacy !== null);
          if (lib.legacy && edit.text !== undefined) edit.text = lib.legacy.decode(edit.text); // 表示用
          this.#define({ type: 'edittext', id: edit.id, bounds: edit.bounds, edit, fontName: fontsOf(lib)(edit.fontId)?.name }, lib);
        } else if (tag.code === 8) {
          lib.jpegTables ??= tag.body;
        } else if (BITMAP_TAGS.has(tag.code) && tag.length >= 2) {
          // 展開は非同期なので、ID だけ先に登録しておく。
          const def = { type: 'bitmap', id: tag.body[0] | (tag.body[1] << 8), width: 0, height: 0 };
          if (this.#define(def, lib)) lib.pending.push({ def, tag });
        } else if (tag.code === 39 && tag.tags) {
          const def = { type: 'sprite', id: tag.spriteId };
          if (this.#define(def, lib)) def.timeline = this.#buildTimeline(tag.tags, def, lib);
        }
      } catch (e) {
        if (e.name !== 'SWFError') throw e;
        this.warn(`tag ${tag.name ?? tag.code} at offset ${tag.offset}: ${e.message}`);
      }
    }
    if (streamHead && streamBlocks.length) frames.stream = buildStream(streamHead, streamBlocks);
    return frames;
  }

  // 圧縮された画像（def.encoded。JPEG のアルファは def.alpha）を、ホストの decodeImage で画素（def.rgba）にする。
  // JPEG3 / 4 の色はアルファを掛けた値なので、アルファで割り戻す。失敗したら、何もしない（警告だけ）。
  async #pixelsOf(def) {
    if (!this.decodeImage || !def.encoded || def.rgba) return;
    try {
      const { width, height, rgba } = await this.decodeImage(def.encoded);
      if (width !== def.width || height !== def.height) return;
      const out = new Uint8ClampedArray(rgba);
      if (def.alpha) {
        for (let i = 0, p = 0; i < out.length; i += 4, p++) {
          const a = def.alpha[p] ?? 0, k = a === 0 ? 0 : 255 / a;
          out[i] = Math.min(out[i], a) * k; out[i + 1] = Math.min(out[i + 1], a) * k; out[i + 2] = Math.min(out[i + 2], a) * k; out[i + 3] = a;
        }
      }
      def.rgba = out;
    } catch (e) {
      this.warn(`bitmap ${def.id} cannot be decoded: ${e.message}`);
    }
  }

  /**
   * 共有ライブラリ（ImportAssets）: url の SWF をホストの network.load で読み、その書き出し名の記号を、lib の ID と名前（attachMovie で
   * 使える）として登録する。再生を始める前に済ませる（実機は、読み込むまで取り込んだ記号を使うフレームへ進まない）。
   * 読めなければ（ホストが通信を任されていなければ）、警告を残して、その記号は無いままにする。取り込みの入れ子は 4 段まで。
   */
  async #importAssets(lib, depth = 0) {
    for (const { url, items } of lib.imports ?? []) {
      this.request({ kind: 'loadMovie', url, target: '', method: '' });
      let bytes = null;
      try {
        const found = depth < 4 && this.network?.load ? await this.network.load({ url, method: 'GET', data: null, contentType: null }) : null;
        bytes = found instanceof Uint8Array ? found : found instanceof ArrayBuffer ? new Uint8Array(found) : null;
      } catch (e) {
        this.warn(`ImportAssets ${url}: ${e.message}`);
      }
      if (!bytes || bytes.length > MAX_LOADED_BYTES) { this.warn(`ImportAssets ${url}: the shared library cannot be loaded`); continue; }
      let other;
      try {
        other = (await this.loadLibrary(bytes, depth)).library;
      } catch (e) {
        if (e.name !== 'SWFError') throw e;
        this.warn(`ImportAssets ${url}: ${e.message}`);
        continue;
      }
      for (const { id, name } of items) {
        const def = other.dictionary.get(other.exports.get(name));
        if (!def) { this.warn(`ImportAssets ${url}: "${name}" is not exported`); continue; }
        lib.dictionary.set(id, def);
        lib.exports.set(name, id);
      }
    }
  }

  async #decodeBitmaps(lib) {
    for (const { def, tag } of lib.pending) {
      try {
        Object.assign(def, await parseBitmap(tag, lib.jpegTables, this.#bitmapPixelBudget));
        this.#bitmapPixelBudget -= def.width * def.height;
        // AS3 のクラスに結び付いたものと、書き出し名の付いたもの（AS2 の BitmapData.loadBitmap）は、BitmapData として画素を読まれる。
        if (lib.symbolClasses?.has(def.id) || [...lib.exports.values()].includes(def.id)) await this.#pixelsOf(def);
      } catch (e) {
        if (e.name !== 'SWFError') throw e;
        this.warn(`tag ${tag.name} at offset ${tag.offset}: ${e.message}`);
      }
    }
    lib.pending = [];
  }

  #define(def, lib) {
    if (lib.dictionary.has(def.id)) {
      this.warn(`character ${def.id} is defined twice; the later definition is ignored`);
      return false;
    }
    def.order = lib.dictionary.size; // 定義された順番
    if (!lib.main) def.library = lib; // 読み込んだ SWF の定義は、どのライブラリのものかを覚えておく
    lib.dictionary.set(def.id, def);
    return true;
  }
}

// ライブラリのフォントを、ID で引く関数。
const fontsOf = (lib) => (id) => {
  const font = lib.dictionary.get(id);
  return font?.type === 'font' ? font : undefined;
};

/** 表示リスト上の 1 オブジェクト。 */
export class DisplayObject {
  constructor(character, depth, desc, parent = null) {
    this.character = character;
    this.depth = depth;
    this.parent = parent;
    this.removed = false; // 表示リストから外されたか
    this.scripted = false; // スクリプトが位置や変形を変えたか（以後タイムラインの移動を受け付けない）
    this.apply(desc);
  }

  /** PlaceObject で決まる属性を反映する。 */
  apply(desc) {
    if (!this.scripted) {
      this.matrix = desc.matrix;
      this.xform = null; // スクリプト用の拡大率・回転の控え（行列が変わったら取り直す）
    }
    this.cxform = desc.cxform; // null は変換なし
    this.ratio = desc.ratio;
    if (desc.name) this.name = desc.name;
    this.name ??= '';
    this.clipDepth = desc.clipDepth;
    if (!this.scriptedFilters) this.filters = desc.filters; // null はフィルタなし。スクリプトで filters を代入したら、それを保つ
    this.blendMode = desc.blendMode;
    this.visible = desc.visible;
    this.opaqueBackground = desc.opaqueBackground; // 0xRRGGBB か null
  }

  /** AS3: 表示リストに戻ったときに呼ばれる。 */
  /**
   * 3D の表示オブジェクト（AS3 の z・rotationX などを代入したもの。t3 を持つ）の行列（px、Matrix3D.rawData と同じ並び）。2D なら null。
   * 2D の行列から位置・拡大率・回転（rotationZ）を取り、t3 の z・rotationX・rotationY・scaleZ と合わせて作る。
   */
  local3D() {
    if (!this.t3) return null;
    const m = this.matrix, flip = m.a * m.d - m.b * m.c < 0 ? -1 : 1;
    return compose({
      x: m.tx / 20, y: m.ty / 20, z: this.t3.z, rotationX: this.t3.rotationX, rotationY: this.t3.rotationY, rotationZ: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      scaleX: Math.hypot(m.a, m.b), scaleY: flip * Math.hypot(m.c, m.d), scaleZ: this.t3.scaleZ,
    });
  }

  revive() {
    this.removed = false;
  }

  /** スクリプトからの変形の変更。 */
  setMatrix(m) {
    this.matrix = m;
    this.scripted = true;
  }

  setCxform(cx) {
    this.cxform = cx;
  }

  /** 自分と子孫の数。 */
  count() {
    return 1;
  }

  /**
   * 行列 m で変換した先の座標系での外接矩形（twips）。何も無ければ null。
   * 子孫の図形を 1 つずつ変換先の座標系へ移してから合わせる（途中の階層で矩形にまとめると、
   * 回転した子を持つクリップの幅と高さが実機より大きくなる）。
   */
  bounds(m, edges = false) {
    const b = (edges ? this.character.edgeBounds : undefined) ?? this.character.bounds ?? this.character.startBounds;
    return b ? transformBounds(b, m) : null;
  }

  /** ステージ座標の点 (x, y)（twips）が、この図形の塗りの内側にあるか。 */
  hitPoint(x, y) {
    const paths = this.character.paths;
    if (!paths) return false;
    const m = invert(this.worldMatrix());
    return insidePaths(paths, m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty);
  }

  /** ステージ座標の点 (x, y)（twips）を、このオブジェクトの座標系に直す。 */
  globalToLocal(x, y) {
    const m = invert(this.worldMatrix());
    return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
  }

  /** 親の座標系での外接矩形。3D のものは、外接矩形の角を射影した点の外接矩形（実機の width / height と同じ）。 */
  boundsInParent() {
    if (!this.t3 || !this.parent) return this.bounds(this.matrix);
    const b = this.bounds(IDENTITY);
    if (!b) return b;
    let movie = null;
    for (let a = this; a && !movie; a = a.parent) movie = a.movie ?? null;
    if (!movie) return this.bounds(this.matrix);
    const w = this.world3D(), { center, focal } = movie.projection(this);
    let out = null;
    for (const [x, y] of [[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmax, b.ymax], [b.xmin, b.ymax]]) {
      const p = project(transform3D(w, x / 20, y / 20, 0, 1), center, focal);
      if (!p) continue;
      const q = this.parent.globalToLocal(p.x * 20, p.y * 20);
      out = out ? { xmin: Math.min(out.xmin, q.x), xmax: Math.max(out.xmax, q.x), ymin: Math.min(out.ymin, q.y), ymax: Math.max(out.ymax, q.y) } : { xmin: q.x, xmax: q.x, ymin: q.y, ymax: q.y };
    }
    // 0.5 px 単位で外へ広げる（実機の width / height から）。
    return out && { xmin: Math.floor(out.xmin / 10) * 10, xmax: Math.ceil(out.xmax / 10) * 10, ymin: Math.floor(out.ymin / 10) * 10, ymax: Math.ceil(out.ymax / 10) * 10 };
  }

  /** ルート（ステージ）から自分までの 3D の行列（px）。2D のものは、z を変えない行列として掛ける。 */
  world3D() {
    const own = this.local3D() ?? lift({ ...this.matrix, tx: this.matrix.tx / 20, ty: this.matrix.ty / 20 });
    return this.parent ? multiply3D(this.parent.world3D(), own) : own;
  }

  /** ルートから見た変換行列。 */
  worldMatrix() {
    return this.parent ? concat(this.parent.worldMatrix(), this.matrix) : this.matrix;
  }

  /** other の座標系での外接矩形。edges が真なら、線の太さを含めない（AS3 の getRect）。 */
  boundsIn(other, edges = false) {
    return this.bounds(concat(invert(other.worldMatrix()), this.worldMatrix()), edges);
  }
}

/** 自分のタイムラインと子を持つオブジェクト。ルートもこれ。 */
// 書式の既定値（createTextField で作ったフィールド。実機の getTextFormat の値）。
const DEFAULT_FORMAT = {
  font: 'Times Roman', size: 12, color: 0, bold: false, italic: false, underline: false, url: '', target: '', align: 'left',
  leftMargin: 0, rightMargin: 0, indent: 0, leading: 0, bullet: false, blockIndent: 0, letterSpacing: 0, kerning: false, display: 'block', tabStops: [],
};
const rgbOf = (n) => ({ r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 });

/** テキストフィールド（DefineEditText を置いたもの、または createTextField で作ったもの）。 */
export class TextField extends DisplayObject {
  #object = null;
  #paths = null;
  #synced; // 連動する変数と最後にやりとりした値

  constructor(movie, character, depth, desc, parent) {
    super(character, depth, desc, parent);
    this.movie = movie;
    const edit = character.edit;
    this.box = { ...character.bounds }; // 枠（twips）。_width / _height の代入で変わる
    // 書式。format は今の文字に付いているもの、newFormat はこれから入る文字に付くもの。
    this.newFormat = edit ? {
      ...DEFAULT_FORMAT, font: character.fontName ?? '', size: edit.height / 20, color: (edit.color.r << 16) | (edit.color.g << 8) | edit.color.b,
      align: edit.align, leftMargin: edit.leftMargin / 20, rightMargin: edit.rightMargin / 20, indent: edit.indent / 20, leading: edit.leading / 20,
    } : { ...DEFAULT_FORMAT };
    this.format = { ...this.newFormat };
    this.html = edit?.html ?? false;
    this.sheet = null; // スタイルシート（AS3 の TextField.styleSheet）
    this.selection = [0, 0]; // 選択の範囲 [始まり, 終わり]（文字の位置）。caret は、そのどちらか（動かしている側）
    this.caret = 0;
    this.scrollV = 1; // 最初に見える行（1 から）
    this.scrollH = 0; // 横にずらした量（px）
    this.live = false; // コンストラクタが終わるまで、スクロールの検査はしない
    this.scrollStamp = '1,1,0,0'; // 前に伝えた scrollV, maxScrollV, maxScrollH, scrollH（文字列が変わってこれが変わると、scroll のイベントを出す）
    this.composition = null; // IME で変換中の文字列（確定するまで、キャレットの位置に重ねて描く）
    this.caretOn = true; // キャレットの点滅（見えている間は true）
    this.blinkAt = 0; // 点滅の起点（キャレットを動かした時刻）
    this.htmlText = this.html ? edit.text : null; // html が真のとき、代入された HTML そのもの
    this.fmts = null; // 文字ごとの書式（範囲ごとの書式や HTML の書式があるときだけ。無ければ、全体が this.format）
    this.text = edit ? (this.html ? plainText(edit.text) : edit.text) : '';
    if (this.html && edit) this.setHtml(edit.text, false, edit.multiline);
    this.type = edit && !edit.readOnly ? 'input' : 'dynamic';
    this.multiline = edit?.multiline ?? false;
    this.wordWrap = edit?.wordWrap ?? false;
    this.password = edit?.password ?? false;
    this.selectable = edit ? !edit.noSelect : true;
    this.border = edit?.border ?? false;
    this.background = edit?.border ?? false;
    this.borderColor = 0;
    this.backgroundColor = 0xffffff;
    this.embedFonts = edit?.useOutlines ?? false;
    this.autoSize = 'none';
    this.maxChars = edit?.maxLength ?? null;
    this.restrict = null;
    this.variable = null;
    if (parent && !this.name) this.name = movie.nextInstanceName();
    if (edit?.variableName) this.bind(edit.variableName, true);
    this.live = true;
  }

  /** スクリプトから見たこのフィールド。AVM1 が無ければ undefined。 */
  scriptObject() {
    if (!this.movie.avm) return undefined;
    return (this.#object ??= new TextFieldObject(this.movie.avm, this));
  }

  dotPath() {
    return `${this.parent.dotPath()}.${this.name}`;
  }

  slashPath() {
    return `${this.parent.parent ? this.parent.slashPath() : ''}/${this.name}`;
  }

  /** 見た目にかかわる状態が変わったら呼ぶ。 */
  changed() {
    this.#paths = null;
    const n = this.text.length; // 文字列が短くなったら、選択も収める（実機で確認）
    if (this.selection[1] > n || this.caret > n) { this.selection = [Math.min(this.selection[0], n), Math.min(this.selection[1], n)]; this.caret = Math.min(this.caret, n); }
  }

  /** 文字列を入れる。書式は newFormat に戻る。fromScript が真なら、連動する変数にも書く。 */
  setText(text, fromScript) {
    this.text = text.replace(/\r\n|\n/g, '\r'); // 改行は CR で持つ
    this.format = { ...this.newFormat };
    this.fmts = null;
    this.changed();
    this.#checkScroll();
    if (fromScript && this.variable) this.#publish();
  }

  /** 変数 name と連動させる（null で解除）。initial が真（定義で指定された場合）なら、変数が未定義のときに今の文字列を変数へ入れる。 */
  bind(name, initial = false) {
    this.variable = name || null;
    if (!this.variable) {
      this.movie.boundFields.delete(this);
      return;
    }
    this.movie.boundFields.add(this);
    if (initial && this.#variable() === undefined) this.#publish();
    else this.pull();
  }

  /** 連動する変数に値があれば、それを表示する文字列にする。 */
  pull() {
    if (!this.variable) return;
    const value = this.#variable();
    if (value === undefined) return;
    const raw = toStr(this.movie.avm, value);
    // 変数が、最後にやりとりした値から変わったときだけ読む（スクリプトが htmlText などで変えた中身は、変数が変わるまで残る）。
    // HTML のフィールドは値を HTML として読み、そうでなければ書式を newFormat に戻す（実機で確認。test/as/htmlvar.as）。
    if (raw === this.#synced) return;
    this.#synced = raw;
    const text = this.movie.legacy ? this.movie.legacy.decode(raw) : raw; // SWF 5 以前の変数はバイト列。表示は文字コードで直す
    if (this.html) this.setHtml(text, false);
    else this.setText(text, false);
  }

  // 今の中身を連動する変数へ書く。HTML のフィールドは HTML の形で書く（実機で確認。test/as/htmlvar.as）。
  #publish() {
    const text = this.html ? this.toHtml() : this.text;
    this.#synced = this.movie.legacy ? this.movie.legacy.encode(text) : text; // SWF 5 以前の変数はバイト列
    this.#variable(this.#synced);
  }

  // 連動する変数を読む（引数なし）か、書く。変数名は、フィールドを置いたクリップから見たパスでもよい。
  #variable(...value) {
    const { avm } = this.movie;
    const target = this.parent?.scriptObject();
    if (!avm || !target) return undefined;
    const frame = { target, thisValue: target, scopes: [{ object: avm.global }, { object: target, target: true }] };
    if (value.length) return avm.setVariable(frame, this.variable, value[0]);
    return avm.getVariable(frame, this.variable);
  }

  // --- 入力・選択 ---

  /** 選択を (anchor, caret) にする。範囲は文字列の長さに収め、caret（動かしている側）は後ろの引数（実機で確認）。 */
  setSelection(anchor, caret) {
    const n = this.text.length, clamp = (v) => Math.min(Math.max(v, 0), n);
    const a = clamp(anchor), b = clamp(caret);
    this.selection = [Math.min(a, b), Math.max(a, b)];
    this.caret = b;
    this.#paths = null;
    this.#touchCaret();
    if (this.movie.focus === this) this.#follow();
  }

  // キャレットを動かしたら、点滅を最初（見える状態）からやり直す。
  #touchCaret() {
    this.blinkAt = this.movie.now();
    this.caretOn = true;
  }

  /** 点滅の状態を、今の時刻に合わせる（フレームごとに呼ぶ）。変わったら描き直しになる。 */
  tickCaret() {
    const on = Math.floor((this.movie.now() - this.blinkAt) / 500) % 2 === 0;
    if (on !== this.caretOn && this.selection[0] === this.selection[1]) { this.caretOn = on; this.#paths = null; }
  }

  /**
   * スクロールの状態（概算の配置から）。maxV は最初に見える行の最大、bottom は今、最後まで見えている行（どちらも 1 から）、
   * maxH は横にずらせる最大（px。折り返しがあれば 0）。範囲を出ていた scrollV / scrollH は収める。
   */
  scrollInfo() {
    const layout = this.layout(), { lines } = layout;
    const visH = this.box.ymax - this.box.ymin - 80, visW = this.box.xmax - this.box.xmin - 80;
    let maxV = lines.length;
    for (let v = 1; v <= lines.length; v++) if (layout.height - (lines[v - 1].y - 40) <= visH) { maxV = v; break; }
    const maxH = this.wordWrap ? 0 : Math.max(0, Math.ceil((layout.width + this.compositionWidth() - visW) / 20));
    this.scrollV = Math.min(Math.max(this.scrollV, 1), maxV);
    this.scrollH = Math.min(Math.max(this.scrollH, 0), maxH);
    const top = lines[this.scrollV - 1].y - 40;
    let bottom = this.scrollV;
    while (bottom < lines.length && lines[bottom].y + lines[bottom].height - 40 - top <= visH) bottom++;
    return { layout, maxV, maxH, bottom, visW, visH, offsetY: top };
  }

  /** スクロールを変える（範囲に収める）。変わったら scroll のイベントが届く。 */
  setScroll(v = this.scrollV, h = this.scrollH) {
    const before = [this.scrollV, this.scrollH];
    this.scrollV = Number.isFinite(v) ? Math.trunc(v) : 1;
    this.scrollH = Number.isFinite(h) ? Math.trunc(h) : 0;
    const info = this.scrollInfo(), stamp = `${this.scrollV},${info.maxV},${info.maxH},${this.scrollH}`;
    this.scrollStamp = stamp;
    if (this.scrollV === before[0] && this.scrollH === before[1]) return;
    this.#paths = null;
    this.movie.scrolled(this);
  }

  /** 文字列が変わった後に呼ぶ。スクロールの範囲か位置が変わっていたら、scroll のイベントを出す（実機で確認: scrollV が同じでも、最大が変われば出る）。 */
  #checkScroll() {
    if (!this.live) return;
    const info = this.scrollInfo(), stamp = `${this.scrollV},${info.maxV},${info.maxH},${this.scrollH}`;
    if (stamp === this.scrollStamp) return;
    this.scrollStamp = stamp;
    this.movie.scrolled(this);
  }

  /** 変換中の文字列の幅（twips）。 */
  compositionWidth() {
    if (!this.composition) return 0;
    const f = this.formatAt(Math.max(0, this.selection[0] - 1));
    return [...this.composition].reduce((sum, ch) => sum + (this.movie.measureText?.(ch, f, this.deviceFont) ?? (ch.codePointAt(0) >= 0x2e80 ? f.size * 20 : f.size * 10)), 0);
  }

  /** IME で変換中の文字列を入れる（null で消す）。見える位置までスクロールする。 */
  setComposition(text) {
    this.composition = text;
    this.#paths = null;
    this.#follow();
  }

  // キャレットが見える位置まで、スクロールする。
  #follow() {
    if (this.type !== 'input') return;
    const info = this.scrollInfo(), row = lineOf(info.layout, this.caret) + 1;
    let v = this.scrollV, h = this.scrollH;
    if (row < v) v = row;
    else if (row > info.bottom) v = row - (info.bottom - v);
    if (!this.wordWrap) {
      const x = (caretAt(info.layout, this.composition ? this.selection[0] : this.caret).x + this.compositionWidth() - 40) / 20, visible = info.visW / 20;
      if (x < h) h = Math.floor(x);
      else if (x > h + visible) h = Math.ceil(x - visible);
    }
    this.setScroll(v, h);
  }


  /** キャレットや選択の描画に使う、文字の配置（概算）。 */
  layout() {
    return layoutOf(this);
  }

  /** ステージの点 (x, y)（twips）に近い、キャレットの位置。 */
  indexAtStage(x, y) {
    const m = invert(this.worldMatrix());
    return indexAt(this.layout(), m.a * x + m.c * y + m.tx - this.box.xmin, m.b * x + m.d * y + m.ty - this.box.ymin);
  }

  /** 入力の結果（文字列が変わった）を、連動する変数とスクリプトへ伝える。 */
  #edited() {
    if (this.variable) this.#publish();
    this.changed();
    this.#touchCaret();
    this.#follow();
    this.movie.textChanged(this);
  }

  /**
   * 打ち込まれた文字列を、選択の範囲に入れる。入った文字列（入らなければ空）を返す。
   * restrict に合わない文字、複数行でないフィールドの改行は捨てる。maxChars までしか入らない。textInput イベントが取り消されたら入れない。
   */
  typeText(text) {
    if (this.type !== 'input') return '';
    let out = '';
    for (const ch of text.replace(/\r\n|\n/g, '\r')) {
      if ((ch === '\r' && !this.multiline) || (ch < ' ' && ch !== '\r') || !restricts(this.restrict, ch)) continue;
      out += ch;
    }
    if (!out || !this.movie.fireTextInput(this, out)) return '';
    const [a, b] = this.selection;
    if (this.maxChars) out = out.slice(0, Math.max(0, this.maxChars - (this.text.length - (b - a))));
    if (!out) return '';
    this.replace(a, b, out);
    this.selection = [a + out.length, a + out.length];
    this.caret = a + out.length;
    this.#edited();
    return out;
  }

  /** 選択を消す（切り取り）。 */
  deleteSelection() {
    this.#erase(this.selection[0], this.selection[1]);
  }

  /** 範囲 a〜b を消す（BackSpace・Delete）。 */
  #erase(a, b) {
    if (a < 0 || b > this.text.length || b <= a) return;
    this.replace(a, b, '');
    this.selection = [a, a];
    this.caret = a;
    this.#edited();
  }

  /**
   * 編集のキー。code は仮想キーコード。BackSpace（8）、Delete（46）、← ↑ → ↓（37〜40）、Home（36）、End（35）、Enter（13。複数行のとき改行）、
   * Ctrl / ⌘ + A（全部を選ぶ）。Shift を押していれば、選択を広げる。扱ったら true。
   */
  editKey(code, { shift = false, ctrl = false } = {}) {
    if (this.type !== 'input') return false;
    const [a, b] = this.selection, n = this.text.length;
    const move = (to) => {
      to = Math.min(Math.max(to, 0), n);
      if (shift) this.setSelection(this.caret === b ? a : b, to); // 動かしていない側が、広げるときの基点
      else this.setSelection(to, to);
    };
    const layout = () => this.layout();
    switch (code) {
      case 8: if (b > a) this.#erase(a, b); else this.#erase(a - 1, a); return true;
      case 46: if (b > a) this.#erase(a, b); else this.#erase(a, a + 1); return true;
      case 37: if (!shift && b > a) this.setSelection(a, a); else move(this.caret - 1); return true;
      case 39: if (!shift && b > a) this.setSelection(b, b); else move(this.caret + 1); return true;
      case 36: { const l = layout(); move(l.lines[lineOf(l, this.caret)].start); return true; }
      case 35: { const l = layout(); move(l.lines[lineOf(l, this.caret)].end); return true; }
      case 38: case 40: {
        if (!this.multiline) { move(code === 38 ? 0 : n); return true; }
        const l = layout(), row = lineOf(l, this.caret) + (code === 38 ? -1 : 1);
        if (row < 0) move(0);
        else if (row >= l.lines.length) move(n);
        else move(indexAt(l, caretAt(l, this.caret).x, l.lines[row].y));
        return true;
      }
      case 13: if (this.multiline) this.typeText('\r'); return true;
      case 65: if (ctrl) { this.setSelection(0, n); return true; } return false;
      default: return false;
    }
  }

  // --- 文字ごとの書式 ---

  /** 文字ごとの書式の並び（無ければ、全体が this.format として作る）。 */
  #materialize() {
    return (this.fmts ??= Array.from({ length: this.text.length }, () => this.format));
  }

  /** i 番目の文字の書式。 */
  formatAt(i) {
    return this.fmts?.[i] ?? this.format;
  }

  // 全部が同じ書式なら、文字ごとの並びをやめる。this.format は、最初の文字の書式に合わせる。
  #settle() {
    if (this.fmts) {
      if (this.fmts.length === 0) this.fmts = null;
      else if (this.fmts.every((f) => sameFormat(f, this.fmts[0]))) { this.format = this.fmts[0]; this.fmts = null; } else this.format = this.fmts[0];
    }
    this.changed();
  }

  /** 範囲 a〜b（文字の位置。b は含まない）の書式。違う項目は null。範囲が空なら null。 */
  getFormat(a, b) {
    if (b <= a) return null;
    return this.fmts ? mergeRange(this.fmts, a, b) : { ...this.format };
  }

  /** 範囲 a〜b の書式に、partial の null でない項目を重ねる（partial は書式の項目の一部）。 */
  setFormat(partial, a, b) {
    if (b <= a) return;
    const fmts = this.#materialize();
    const cache = new Map();
    for (let i = a; i < b; i++) {
      let merged = cache.get(fmts[i]);
      if (!merged) { merged = mergeFormat(fmts[i], partial); cache.set(fmts[i], merged); }
      fmts[i] = merged;
    }
    this.#settle();
  }

  /**
   * 範囲 a〜b を str に置き換える。入る文字の書式は、置き換える範囲の最後の文字（範囲が空なら、その直前の文字）の書式、
   * 範囲の前に文字が無ければ最初の文字、文字が無ければ newFormat（実機で確認）。選択位置は呼ぶ側で決める。
   */
  replace(a, b, str) {
    const old = this.fmts ?? null;
    let at = Math.max(0, Math.min(b, this.text.length) - 1);
    while (at > 0 && old?.[at]?.img) at--; // 入る文字は、画像の文字の書式を引き継がない（実機で確認）
    const insert = this.text.length === 0 || old?.[at]?.img ? this.newFormat : old ? old[at] : this.format;
    const before = old ? old.slice(0, a) : Array.from({ length: a }, () => this.format);
    const after = old ? old.slice(b) : Array.from({ length: this.text.length - b }, () => this.format);
    this.text = this.text.slice(0, a) + str.replace(/\n/g, '\r') + this.text.slice(b);
    this.fmts = [...before, ...Array.from({ length: str.length }, () => insert), ...after];
    this.htmlText = null;
    if (this.fmts.length === 0) this.format = { ...this.newFormat };
    this.#settle();
    this.#checkScroll();
  }

  /**
   * スタイルシート（{ get(セレクタ) → スタイル | null }。player/richtext.js の cssPatch の形）を付ける。null なら外す。
   * 付けると、今の内容を HTML として読み直す（HTML で入れた内容は、入れた HTML そのもの）。外したときは、そのときの書式が残る。
   */
  setStyleSheet(sheet) {
    this.sheet = sheet;
    if (sheet) this.setHtml(this.htmlText ?? this.toHtml(), false);
    else this.htmlText = null;
  }

  /** スタイルシートの中身が変わったときに、内容を読み直す。 */
  reapplySheet() {
    if (this.sheet && this.htmlText !== null) this.setHtml(this.htmlText, false);
  }

  /** HTML を文字列と書式にして入れる。書式を指定しない文字は newFormat。連動する変数には書かない（実機で確認。test/as/htmlvar.as）。 */
  setHtml(html, _fromScript, multiline = this.multiline) {
    const { text, fmts } = parseHtml(html, this.newFormat, { multiline, condenseWhite: this.condenseWhite === true, styles: this.sheet });
    this.text = text;
    this.fmts = fmts;
    this.format = fmts[0] ?? { ...this.newFormat };
    this.htmlText = html;
    this.#settle();
    this.#checkScroll();
  }

  // 文字の寸法の概算（端末のフォントの寸法は実機と同じにならない）: 1 文字 = 大きさの半分（幅）。行の高さは実機で測った式（deviceMetrics）。
  approxWidth() {
    let best = 0, width = 0;
    for (let i = 0; i <= this.text.length; i++) {
      if (i === this.text.length || this.text[i] === '\r') { best = Math.max(best, width); width = 0; } else width += this.formatAt(i).size * 0.5;
    }
    return Math.round(best);
  }

  approxHeight() {
    if (!this.text) return 0;
    let total = 0, ascent = 0, descent = 0;
    for (let i = 0; i <= this.text.length; i++) {
      if (i === this.text.length || this.text[i] === '\r') {
        if (!ascent) ({ ascent, descent } = deviceMetrics(this.format.size, this.deviceFont ?? this.format.font));
        total += ascent + descent;
        ascent = descent = 0;
      } else {
        const f = this.formatAt(i), m = deviceMetrics(f.size, this.deviceFont ?? f.font);
        ascent = Math.max(ascent, m.ascent);
        descent = Math.max(descent, m.descent);
      }
    }
    return total;
  }

  /** 端末のフォントで描くときに、書式のフォント名の代わりに使う名前。SWF 5 以前は、名前によらず Times で描く（実機で確認。test/text.test.js）。 */
  get deviceFont() {
    return (this.character.library ?? this.movie.library).version < 6 ? 'Times Roman' : undefined;
  }

  /** 今の文字列と書式を、実機と同じ形の HTML にしたもの。 */
  toHtml() {
    return toHtml(this.text, this.fmts ?? Array.from({ length: this.text.length }, () => this.format));
  }

  /** 描画命令（図形と同じ形式）。内容が変わるまで同じ配列を返す。 */
  paths() {
    if (!this.#paths) {
      const edit = this.character.edit;
      const f = this.format;
      this.#paths = this.movie.textPaths({
        bounds: this.box, fontId: edit?.fontId, fontName: f.font, useOutlines: this.embedFonts,
        deviceFont: this.deviceFont,
        height: f.size * 20, color: rgbOf(f.color), bold: f.bold, italic: f.italic, align: f.align,
        leftMargin: f.leftMargin * 20, rightMargin: f.rightMargin * 20, indent: f.indent * 20, leading: f.leading * 20,
        text: this.text, html: false, password: this.password, multiline: this.multiline, wordWrap: this.wordWrap,
        measure: this.movie.measureText, // 描く側が文字の幅を測る関数（無ければ概算）
        images: this.#images(),
        runs: this.fmts ? layoutRunsOf(this.text, this.fmts) : !this.embedFonts && this.text && (this.wordWrap || f.bullet || f.blockIndent) ? [{ text: this.text, fmt: f }] : null, // 端末のフォントで、折り返しや箇条書きがあるときは、書式が 1 つでも同じ配置を使う // 文字ごとの書式があるときだけ（text と同じ並び）
        border: this.border, background: this.background, borderColor: rgbOf(this.borderColor), backgroundColor: rgbOf(this.backgroundColor),
      }, this.character.library);
      this.#paths = this.#clipped(this.#withSelection(this.#paths));
    }
    return this.#paths;
  }

  // 文字列の中の画像（<img>）のうち、読み込めたもの。幅と高さは、両方の指定があるときだけ使う（片方だけなら無視。実機で確認）。
  #images() {
    if (!this.fmts) return null;
    const out = [];
    this.fmts.forEach((f, index) => {
      if (!f.img) return;
      const bitmap = this.movie.textImage(f.img.src, this)?.bitmap;
      if (!bitmap) return;
      const sized = f.img.width !== undefined && f.img.height !== undefined;
      out.push({ index, bitmap, width: sized ? f.img.width : bitmap.width, height: sized ? f.img.height : bitmap.height, align: (f.img.align ?? '').toLowerCase(), hspace: f.img.hspace ?? 8, vspace: f.img.vspace ?? 8 });
    });
    return out;
  }

  // 文字（背景と枠の後ろ）を、フィールドの枠の内側（余白 2px）だけに見せる。最後まで入らない行は、最初に見える行のほかは描かない
  // （実機で確認。test/as/textclip.as）。スクロールしているときは、文字をずらす。
  #clipped(ops) {
    const n = (this.background ? 1 : 0) + (this.border ? 1 : 0);
    if (ops.length <= n) return ops;
    const info = this.scrollInfo(), { lines } = info.layout, { xmin, xmax, ymin, ymax } = this.box;
    const bottom = Math.min(ymax - 40, info.bottom < lines.length ? ymin + lines[info.bottom].y - info.offsetY : Infinity);
    const inner = { kind: 'clip', style: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 255 } }, evenOdd: true, path: [['M', xmin + 40, ymin + 40], ['L', xmax - 40, ymin + 40], ['L', xmax - 40, bottom], ['L', xmin + 40, bottom], ['Z']] };
    const body = this.scrollV > 1 || this.scrollH > 0 ? shiftOps(ops.slice(n), -this.scrollH * 20, -info.offsetY) : ops.slice(n);
    return [...ops.slice(0, n), inner, ...body, { kind: 'unclip' }];
  }

  // フォーカスがあるとき、選択（黒地に白い文字）とキャレット（1 本の縦線）を重ねる。実機で、選択の見た目を確かめた。
  #withSelection(ops) {
    if (this.movie.focus !== this || (this.type !== 'input' && !this.selectable)) return ops;
    const layout = this.layout(), [a, b] = this.selection, { xmin, ymin } = this.box;
    const black = { r: 0, g: 0, b: 0, a: 255 }, white = { r: 255, g: 255, b: 255, a: 255 };
    const out = [...ops];
    const rect = (x1, y1, x2, y2) => ({ kind: 'fill', style: { type: 'solid', color: black }, evenOdd: true, path: [['M', x1, y1], ['L', x2, y1], ['L', x2, y2], ['L', x1, y2], ['Z']] });
    if (b > a) {
      for (const line of layout.lines) {
        const from = Math.max(a, line.start), to = Math.min(b, line.end);
        if (to <= from) continue;
        const x1 = xmin + line.x[from - line.start], x2 = xmin + line.x[to - line.start], f = this.formatAt(from);
        out.push(rect(x1, ymin + line.y, x2, ymin + line.y + line.height));
        out.push({ kind: 'text', text: this.password ? '*'.repeat(to - from) : this.text.slice(from, to), x: x1, y: ymin + line.y, ascent: line.ascent, width: x2 - x1 + 40, align: 'left', size: f.size * 20, family: this.deviceFont ?? f.font, bold: f.bold, italic: f.italic, color: white });
      }
    } else if (this.type === 'input' && this.caretOn && !this.composition) {
      const at = caretAt(layout, this.caret);
      out.push(rect(xmin + at.x, ymin + at.y, xmin + at.x + 20, ymin + at.y + at.height));
    }
    if (this.composition && this.type === 'input') {
      // 変換中の文字列は、選択の始まりに重ねて、下線を引く（確定すると、そこに入る）。
      const at = caretAt(layout, this.selection[0]), f = this.formatAt(Math.max(0, this.selection[0] - 1)), width = this.compositionWidth();
      out.push({ kind: 'fill', style: { type: 'solid', color: white }, evenOdd: true, path: [['M', xmin + at.x, ymin + at.y], ['L', xmin + at.x + width, ymin + at.y], ['L', xmin + at.x + width, ymin + at.y + at.height], ['L', xmin + at.x, ymin + at.y + at.height], ['Z']] });
      out.push({ kind: 'text', x: xmin + at.x, y: ymin + at.y, ascent: at.ascent, width: width + 40, align: 'left', size: f.size * 20, runs: [{ text: this.composition, size: f.size * 20, family: this.deviceFont ?? f.font, bold: f.bold, italic: f.italic, underline: true, color: { r: 0, g: 0, b: 0, a: 255 }, letterSpacing: 0 }] });
    }
    return out;
  }

  bounds(m) {
    return transformBounds(this.box, m);
  }

  hitPoint(x, y) {
    const m = invert(this.worldMatrix());
    const px = m.a * x + m.c * y + m.tx;
    const py = m.b * x + m.d * y + m.ty;
    return px >= this.box.xmin && px <= this.box.xmax && py >= this.box.ymin && py <= this.box.ymax;
  }
}

/**
 * ビデオ（DefineVideoStream を置いたもの、または AS3 の new Video()）。
 * 埋め込みのビデオは、置くときの ratio が「何番のフレームを表示するか」を表す。
 * source が設定されていれば、そちら（NetStream）の絵を表示する。
 */
export class VideoObject extends DisplayObject {
  #sequence = null;
  #paths = null; // { image, width, height, list }
  #object = null;

  /** スクリプト（ActionScript 1 / 2）から見たこのビデオ。AVM1 が無ければ undefined。 */
  scriptObject() {
    if (!this.movie.avm) return undefined;
    return (this.#object ??= new VideoScriptObject(this.movie.avm, this));
  }

  dotPath() {
    return `${this.parent.dotPath()}.${this.name}`;
  }

  slashPath() {
    return `${this.parent.parent ? this.parent.slashPath() : ''}/${this.name}`;
  }

  constructor(movie, character, depth, desc, parent) {
    super(character, depth, desc, parent);
    this.movie = movie;
    this.source = null; // 絵の出どころ { image(): 画像 | null }
    this.smoothing = character.smoothing ?? false;
    this.#cleared = null;
  }

  #cleared = null; // clear() したときの絵 { image, version }。次の絵が来るまで、何も表示しない

  // 絵の出どころから、今の画像をもらう。
  #current() {
    if (this.source) return this.source.image();
    const { codec, frames } = this.character;
    if (!frames?.size || !decodable(codec)) return null;
    this.#sequence ??= embeddedSequence(codec, frames, (message) => this.movie.warn(`video ${this.character.id}: ${message}`), this.character, this.movie.matchPlayer);
    return this.#sequence.show(this.ratio);
  }

  /** 今表示する画像（player/video.js の形）。無ければ null。 */
  image() {
    const image = this.#current();
    if (this.#cleared && image === this.#cleared.image && image?.version === this.#cleared.version) return null;
    this.#cleared = null;
    return image;
  }

  /** 表示している絵を消す（次のフレームの絵が来れば、また表示される）。 */
  clear() {
    const image = this.#current();
    this.#cleared = { image, version: image?.version };
  }

  /** 描画命令: 画像を、ビデオの枠（キャラクタの幅と高さ）いっぱいに引き伸ばして塗った矩形。画像が無ければ空。 */
  paths() {
    const image = this.image();
    if (!image) return [];
    const { width, height } = this.character;
    const p = this.#paths;
    if (!p || p.image !== image || p.width !== image.width || p.height !== image.height || p.smooth !== this.smoothing) {
      const w = width * 20, h = height * 20;
      this.#paths = {
        image, width: image.width, height: image.height, smooth: this.smoothing,
        list: [{
          kind: 'fill', evenOdd: false, path: [['M', 0, 0], ['L', w, 0], ['L', w, h], ['L', 0, h], ['Z']],
          style: {
            type: 'bitmap', bitmap: image, matrix: { a: w / image.width, b: 0, c: 0, d: h / image.height, tx: 0, ty: 0 }, repeat: false, smooth: this.smoothing,
            // 実機は、埋め込みの H.263 / VP6 を整数倍で描くとき、横方向だけ右隣の画素と混ぜる（render/canvas.js の #blendRight）。
            // matchPlayer を指定したときだけ、描画側にそれを頼む。
            blendRight: this.movie.matchPlayer && !this.source && (this.character.codec === 'h263' || this.character.codec === 'vp6'),
          },
        }],
      };
    }
    return this.#paths.list;
  }

  bounds(m) {
    return transformBounds({ xmin: 0, xmax: this.character.width * 20, ymin: 0, ymax: this.character.height * 20 }, m);
  }

  hitPoint(x, y) {
    const p = this.globalToLocal(x, y);
    return p.x >= 0 && p.x <= this.character.width * 20 && p.y >= 0 && p.y <= this.character.height * 20;
  }
}

export class MovieClip extends DisplayObject {
  #object = null;
  #drawing = null;

  /** as3: スクリプトが new で作った AS3 のオブジェクト（その表示オブジェクトとして、表示リストの外に作る）。 */
  constructor(movie, character, depth = 0, desc = PLACE_DEFAULTS, level = 0, parent = null, as3 = null, loadedInfo = null) {
    super(character, depth, desc, parent);
    this.movie = movie;
    if (loadedInfo) this.loadedInfo = loadedInfo; // AS3: Loader で読み込んだ SWF のルートなら、その contentLoaderInfo
    this.level = level; // 入れ子の深さ（ルートが 0）
    // キャラクタを引くライブラリ。読み込んだ SWF のクリップは、その SWF のライブラリ。中身の無いクリップは、親のもの。
    this.library = character.library ?? parent?.library ?? movie.library;
    this.frames = character.timeline;
    this.children = new Map(); // 深度 → DisplayObject
    this.currentFrame = 0; // 1 始まり。0 はまだ何も実行していない
    this.playing = true;
    this.clipActions = desc.clipActions ?? null;
    this.unloadPending = false; // 取り除かれたが、unload の処理がまだ済んでいない
    this.limbo = null; // unload 待ちの子（名前での参照だけは続く）
    if ((parent || as3) && !this.name) this.name = movie.nextInstanceName(); // ルートの名前は空
    if (!parent && !as3 && movie.avm2) this.name = 'root1'; // AS3 のルート（instanceN の番号は使わない）
    // AS3: 表示リストに載っていない（new で作っただけ、または載っていない親の中の）クリップは、載るまでタイムラインを進めない。
    if (as3 || (movie.avm2 && parent?.removed)) this.removed = true;
    this.listed = !this.removed; // movie.clips に入っているか
    if (this.listed) movie.clips.push(this);
    if (parent) movie.fire(this, 'load');
    // AS3: オブジェクトを先に作っておき（子が自分を親のプロパティに入れられるように）、子を作ってからコンストラクタを呼ぶ。
    // new で作られた場合は、呼び出し側（AVM2）がこの後でコンストラクタを呼ぶ。
    if (as3) {
      this.as3 = as3;
      as3.display = this;
    } else if (movie.avm2) {
      movie.avm2.display.attach(this);
    }
    if (this.frames.length > 0) this.#runFrame(1, true);
    // タイムラインが置いたクリップのコンストラクタは、すぐには呼ばない（Movie の constructPending を参照）。
    if (movie.avm2 && !as3) movie.unconstructed.add(this);
  }

  get totalFrames() {
    return this.frames.length;
  }

  /** 下から上の順の子。深度の小さい順。AS3 のスクリプトが順序を入れ替えた後は、その順序 (zorder)。 */
  sortedChildren() {
    return this.zorder ? this.zorder.slice() : [...this.children.values()].sort((a, b) => a.depth - b.depth);
  }

  // --- AS3 の表示リスト操作 ---

  /**
   * child を、表示順の index 番目に入れる（省略するといちばん上）。別の親の子なら、そこから外す。
   * スクリプトが入れた子の深度は 16384 以上の空き番号にして、タイムラインの操作（深度で指定する）が触れないようにする。
   * 入れられない（入れ子が深すぎる、数の上限）場合は false。
   */
  insertChild(child, index) {
    const { movie } = this;
    for (let c = this; c; c = c.parent) if (c === child) return false; // 自分や親を、自分の子にはできない
    const height = (d) => { let h = 0; for (const c of d.children?.values() ?? []) h = Math.max(h, 1 + height(c)); return h; };
    if (this.level + 1 + height(child) > MAX_NESTING) {
      movie.warn(`sprites are nested deeper than ${MAX_NESTING} levels`);
      return false;
    }
    if (!this.removed && child.removed && movie.instances + child.count() > movie.maxInstances) {
      movie.warn(`too many display objects (limit ${movie.maxInstances})`);
      return false;
    }
    child.parent?.detachChild(child);
    const order = this.sortedChildren();
    let key = DYNAMIC_DEPTH;
    for (const depth of this.children.keys()) key = Math.max(key, depth + 1);
    child.depth = key;
    child.parent = this;
    this.children.set(key, child);
    const relevel = (d, level) => { d.level = level; for (const c of d.children?.values() ?? []) relevel(c, level + 1); };
    relevel(child, this.level + 1);
    if (this.zorder || (index !== undefined && index < order.length)) {
      this.zorder ??= order;
      this.zorder.splice(index ?? order.length, 0, child);
    }
    if (!this.removed) {
      movie.instances += child.count();
      child.revive();
    }
    return true;
  }

  /** 子 child を表示リストから外す。child と子孫は、また入れられるまでタイムラインが進まない。 */
  detachChild(child) {
    if (this.children.get(child.depth) === child) this.#remove(child.depth, true);
  }

  /** 子 child の表示順を index 番目にする。 */
  setChildIndex(child, index) {
    this.zorder ??= this.sortedChildren();
    this.zorder.splice(this.zorder.indexOf(child), 1);
    this.zorder.splice(index, 0, child);
  }

  /** 表示リストに戻った自分と子孫を、タイムラインを進める対象に戻す。 */
  revive() {
    this.removed = false;
    if (!this.listed) {
      this.listed = true;
      this.movie.clips.push(this);
    }
    for (const child of this.children.values()) {
      if (child instanceof MovieClip) child.revive();
      else child.removed = false;
    }
  }

  count() {
    let n = 1;
    for (const child of this.children.values()) n += child.count();
    return n;
  }

  // --- スクリプトとの橋渡し ---

  /** スクリプトから見たこのクリップ。AVM1 が無い（AS3 の）場合は undefined。 */
  scriptObject() {
    if (!this.movie.avm) return undefined;
    if (!this.#object) {
      this.#object = new MovieClipObject(this.movie.avm, this);
      if (!this.parent) this.#object.define('$version', PLAYER_VERSION); // ルートはプレイヤーの版を変数に持つ
    }
    return this.#object;
  }

  childByName(name, caseInsensitive) {
    const fold = (s) => (caseInsensitive ? this.movie.lower(s) : s);
    const wanted = fold(name);
    const matches = (child) => (child instanceof MovieClip || child instanceof TextField || child instanceof VideoObject) && fold(child.name) === wanted;
    for (const child of this.children.values()) if (matches(child)) return child;
    for (const child of this.limbo ?? []) if (matches(child)) return child;
    return undefined;
  }

  /** unload の処理が済んだので、完全に取り除かれた状態にする。 */
  finishUnload() {
    this.removed = true;
    this.unloadPending = false;
    this.parent?.limbo?.delete(this);
  }

  dotPath() {
    return this.parent ? `${this.parent.dotPath()}.${this.name}` : `_level${this.levelNumber ?? 0}`;
  }

  slashPath() {
    if (!this.parent) return this.levelNumber ? `_level${this.levelNumber}` : '/';
    return `${this.parent.parent ? this.parent.slashPath() : ''}/${this.name}`;
  }

  /** マウス位置をこのクリップの座標系で返す（twips）。 */
  mouseLocal() {
    const m = invert(this.worldMatrix());
    const { x, y } = this.movie.mouse;
    return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
  }

  /** 描画 API の描き先。 */
  drawing() {
    return (this.#drawing ??= new Drawing());
  }

  /**
   * AS3 の Bitmap: 表示するビットマップ（{ width, height, rgba, version }。スクリプトが画素を書き換える）を設定する。null で外す。
   * 描画命令は、そのビットマップで塗った矩形 1 つ（図形のビットマップの塗りと同じ形式。ビットマップは bitmapId ではなく直接持つ）。
   */
  setPicture(bitmap, smooth) {
    if (!bitmap) {
      // ビットマップの無い Bitmap は、大きさ 0 の矩形として扱われる（中身の無いスプライトとは違う）。
      this.picture = { bounds: { xmin: 0, xmax: 0, ymin: 0, ymax: 0 }, paths: [] };
      return;
    }
    const w = bitmap.width * 20, h = bitmap.height * 20;
    this.picture = {
      bounds: { xmin: 0, xmax: w, ymin: 0, ymax: h },
      paths: [{
        kind: 'fill', evenOdd: false, style: { type: 'bitmap', bitmap, matrix: { a: 20, b: 0, c: 0, d: 20, tx: 0, ty: 0 }, repeat: false, smooth },
        path: [['M', 0, 0], ['L', w, 0], ['L', w, h], ['L', 0, h], ['Z']],
      }],
    };
  }

  /** 描画 API で描いた内容（無ければ null）。子より下に描かれる。 */
  drawingPaths() {
    if (this.picture) return this.picture.paths;
    return this.#drawing ? this.#drawing.paths() : null;
  }

  bounds(m, edges = false) {
    const own = this.picture ? this.picture.bounds : edges ? this.#drawing?.edgeBounds : this.#drawing?.bounds;
    let b = own ? transformBounds(own, m) : null;
    for (const child of this.children.values()) b = union(b, child.bounds(concat(m, child.matrix), edges));
    return b;
  }

  /** フレーム番号（1 始まり）またはラベルを、有効なフレーム番号にする。該当するラベルが無ければ undefined。 */
  frameNumber(spec, clamp = true) {
    let n;
    if (typeof spec === 'number') n = Math.trunc(spec);
    else if (/^\d+$/.test(spec)) n = Number(spec);
    else {
      const ci = this.movie.avm?.caseInsensitive;
      for (const [label, frame] of this.frames.labels) {
        if (label === spec || (ci && this.movie.lower(label) === this.movie.lower(spec))) n = frame;
      }
      if (n === undefined) return undefined;
    }
    if (Number.isNaN(n)) return undefined;
    return clamp ? Math.max(1, Math.min(n, this.frames.length)) : n; // clamp が偽なら、丸めずに返す（gotoFrame が丸める）
  }

  actionsOfFrame(n) {
    return (this.frames[n - 1] ?? []).filter((op) => op.op === 'action').map((op) => op.code);
  }

  /** 指定フレームへ移動する。途中のフレームは配置・削除だけを行い、アクションは移動先のものだけを実行する。 */
  gotoFrame(n, play) {
    if (this.frames.length === 0) return;
    const target = Math.max(1, Math.min(Math.trunc(n), this.frames.length));
    // AS1 / AS2 で、存在しないフレーム（フレーム数より後）へ移ると、最後のフレームへ移るが、そのフレームのスクリプトは実行しない
    // （実機で確認。実行すると、最後のフレームから前のフレームへ戻るスクリプトが、1 回の処理の中で際限なく続いてしまう）。
    const beyond = Math.trunc(n) > this.frames.length && !this.movie.avm2;
    this.playing = play;
    if (target === this.currentFrame) return;
    if (target > this.currentFrame) {
      for (let f = this.currentFrame + 1; f <= target; f++) this.#runFrame(f, f === target && !beyond);
    } else {
      this.#rewind(target);
    }
  }

  // --- スクリプトが作る・消すクリップ ---

  highestDepth() {
    let max = DYNAMIC_DEPTH - 1;
    for (const depth of this.children.keys()) max = Math.max(max, depth);
    return max;
  }

  /** 書き出し名 exportName のシンボルを、名前 name・深度 depth で置く。 */
  attach(exportName, name, depth) {
    const id = this.library.exports.get(exportName);
    const character = id === undefined ? undefined : this.library.dictionary.get(id);
    if (character?.type !== 'sprite') return undefined;
    const child = this.#instantiate(depth, { ...PLACE_DEFAULTS, characterId: id, name }, true);
    // Object.registerClass で登録されたクラスがあれば、そのインスタンスにする。
    const cls = this.movie.avm?.registeredClasses.get(exportName);
    if (child && cls) {
      const obj = child.scriptObject();
      const proto = cls.get('prototype');
      if (proto) obj.proto = proto;
      this.movie.avm.invoke(cls, obj, []);
    }
    return child;
  }

  createEmpty(name, depth) {
    const child = this.#instantiate(depth, { ...PLACE_DEFAULTS, name }, true, this.movie.emptySprite);
    if (child) child.currentFrame = 0; // 空のクリップの _currentframe は 0（_totalframes は 1）
    return child;
  }

  /** 空のテキストフィールドを作る。位置と大きさは twips。 */
  createTextField(name, depth, x, y, width, height) {
    const character = { type: 'edittext', id: -2, order: -1, bounds: { xmin: 0, xmax: width, ymin: 0, ymax: height }, edit: null, fontName: undefined };
    return this.#instantiate(depth, { ...PLACE_DEFAULTS, name, matrix: { ...IDENTITY, tx: x, ty: y } }, true, character);
  }

  /** 自分と同じシンボルを、親の中に別の名前・深度で置く。 */
  duplicate(name, depth) {
    if (!this.parent) return undefined;
    const desc = { ...describe(this), name, clipActions: this.clipActions };
    const copy = this.parent.#instantiate(depth, desc, true, this.character);
    // 描画 API で描いた中身も写す（スクリプトで作った子は写さない。SWF 6〜8 の実機で確認）。
    if (copy && this.#drawing) copy.#drawing = this.#drawing.copy();
    return copy;
  }

  /** 中身を空にする（unloadMovie、または読み込みに失敗した loadMovie）。フレーム数は 0 になる。 */
  unload() {
    if (this.removed) return;
    for (const depth of [...this.children.keys()]) this.#remove(depth);
    this.#drawing = null;
    this.picture = null;
    this.frames = Object.assign([], { labels: new Map() });
    this.currentFrame = 0;
    this.playing = false;
  }

  /**
   * 中身を、読み込んだ画像か SWF に置き換える（loadMovie など）。このクリップ自体（名前、位置、変形）はそのまま残る。
   * content は Movie.loadContent の結果。画像は 1 フレームのクリップになり、SWF はそのルートのタイムラインを再生する。
   * 新しい中身の 1 フレーム目（画像なら、その表示）は、次のフレームの、このクリップの処理の中で始まる（実機で確認）。
   * SWF のフレーム数は、すぐに見える。
   */
  replaceContent(content) {
    if (this.removed) return;
    this.unload();
    this.contentPending = content;
    if (content.bitmap) {
      this.frames = Object.assign([[]], { labels: new Map() });
      return;
    }
    this.character = content.character;
    this.library = content.character.library;
    this.frames = content.character.timeline;
  }

  /** スクリプトが作った子（深度 16384 以上。テキストフィールドなど）を取り除く。 */
  removeDynamicChild(child) {
    if (child.depth >= DYNAMIC_DEPTH && this.children.get(child.depth) === child) this.#remove(child.depth);
  }

  /** スクリプトが作ったクリップ（深度 16384 以上）を取り除く。 */
  removeDynamic() {
    if (this.parent && this.depth >= DYNAMIC_DEPTH) this.parent.#remove(this.depth);
  }

  swapDepths(a, b) {
    const x = this.children.get(a);
    const y = this.children.get(b);
    if (!x) return;
    this.children.delete(a);
    this.children.delete(b);
    x.depth = b;
    this.children.set(b, x);
    if (y) {
      y.depth = a;
      this.children.set(a, y);
    }
  }

  // --- タイムライン ---

  /** このクリップを 1 フレーム進める（子は Movie.advance が別に進める）。最終フレームの次は 1 フレーム目へ戻る。 */
  tick() {
    this.movie.fire(this, 'enterFrame');
    // 読み込んだ中身の始まり。1 フレーム目を実行し、このフレームのアクションが済んだ後に onLoadInit を届ける。
    const content = this.contentPending;
    if (content) {
      this.contentPending = null;
      if (content.bitmap) {
        this.currentFrame = 1;
        this.setPicture(content.bitmap, false);
      } else {
        this.playing = true;
        if (this.frames.length > 0) this.#runFrame(1, true);
      }
      if (this.loadInit) this.movie.queueLate(this.loadInit);
      this.loadInit = null;
      return;
    }
    if (this.playing && this.frames.length > 1) {
      this.isPlaying = true; // AS3 の isPlaying。最初は偽で、再生ヘッドが自分で進むと真になる
      if (this.currentFrame < this.frames.length) this.#runFrame(this.currentFrame + 1, true);
      else this.#rewind(1);
    }
  }

  // StartSound の音。StartSound2 は、AS3 のクラス名（pkg.Name）に結び付いた音を鳴らす。
  #soundOf(op) {
    if (op.className === undefined) return this.library.dictionary.get(op.soundId);
    return this.movie.linkedCharacter(op.className.replace(/\.(?=[^.]*$)/, '::'));
  }

  #runFrame(n, withActions) {
    this.currentFrame = n;
    if (withActions) this.scriptPending = true; // AS3: このフレームのスクリプト (addFrameScript) を実行する
    for (const op of this.frames[n - 1]) {
      if (op.op === 'action') {
        if (withActions) this.movie.queueAction(this, op.code);
        continue;
      }
      if (op.op === 'init') {
        this.movie.queueInit(op.spriteId, this, op.code);
        continue;
      }
      if (op.op === 'sound') {
        // 途中のフレームを飛ばして移動するときは鳴らさない。
        const sound = this.#soundOf(op);
        if (withActions && sound?.type === 'sound') this.movie.sounds.start(sound, op.info, this);
        continue;
      }
      if (op.op === 'remove') {
        this.#remove(op.depth);
        continue;
      }
      const child = this.children.get(op.depth);
      const desc = mergePlace(child && describe(child), op);
      if (!desc) {
        if (child && op.characterId !== undefined) {
          this.movie.warn(`cannot place character ${op.characterId} at depth ${op.depth}: the depth is occupied`);
        }
        continue;
      }
      if (op.characterId !== undefined) {
        this.#remove(op.depth);
        this.#instantiate(op.depth, { ...desc, clipActions: op.clipActions });
      } else {
        child.apply(desc);
      }
    }
  }

  /** ステージ座標の点 (x, y)（twips）が、表示中の中身（子孫の図形と、描画 API で描いた図形）の内側にあるか。 */
  hitPoint(x, y) {
    const drawn = this.drawingPaths();
    if (drawn) {
      const m = invert(this.worldMatrix());
      if (insidePaths(drawn, m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty)) return true;
    }
    for (const child of this.children.values()) if (child.visible && !child.clipDepth && child.hitPoint(x, y)) return true;
    return false;
  }

  /** 自分と親がすべて表示されているか（_visible が偽のクリップの中のボタンは反応しない）。 */
  shown() {
    for (let c = this; c; c = c.parent) if (!c.visible) return false;
    return true;
  }

  /** ボタンの見た目を切り替える（state は 'up' / 'over' / 'down'）。前後の状態に共通のキャラクタはそのまま残る。 */
  setButtonState(state) {
    const wanted = new Map();
    for (const rec of this.character.button.records) if (rec[state]) wanted.set(rec.depth, { ...PLACE_DEFAULTS, ...rec });
    this.#reconcile(wanted);
  }

  // 前のフレームへ戻る。1 フレーム目から target までを仮に実行して「あるべき表示リスト」を求め、
  // 深度とキャラクタが同じ子はそのまま残し（子のタイムラインは続きから進む）、それ以外を入れ替える。
  // スクリプトが作ったクリップ（深度 16384 以上）はタイムラインの管理外なので触らない。
  #rewind(target) {
    const wanted = new Map();
    for (let f = 0; f < target; f++) {
      for (const op of this.frames[f]) {
        if (op.op === 'remove') {
          wanted.delete(op.depth);
        } else if (op.op === 'place') {
          const desc = mergePlace(wanted.get(op.depth), op);
          if (desc) wanted.set(op.depth, { ...desc, clipActions: op.clipActions ?? wanted.get(op.depth)?.clipActions });
        }
      }
    }
    this.#reconcile(wanted, true);
    this.currentFrame = target;
    this.scriptPending = true;
    for (const op of this.frames[target - 1]) {
      if (op.op === 'action') this.movie.queueAction(this, op.code);
      const sound = op.op === 'sound' ? this.#soundOf(op) : undefined;
      if (sound?.type === 'sound') this.movie.sounds.start(sound, op.info, this);
    }
  }

  // 表示リストを wanted（深度 → 配置の記述）に合わせる。replay: タイムラインを前へ戻すための呼び出し。
  #reconcile(wanted, replay = false) {
    for (const [depth, child] of [...this.children]) {
      if (depth >= DYNAMIC_DEPTH) {
        wanted.delete(depth); // タグがこの深度に置いていても、埋まっているので置き直さない
        continue;
      }
      const desc = wanted.get(depth);
      if (desc && desc.characterId === child.character.id) {
        child.apply(desc);
        wanted.delete(depth);
        if (replay && this.movie.avm2) this.movie.skipInstanceNames(desc.characterId, !!desc.name);
      } else {
        this.#remove(depth);
      }
    }
    for (const [depth, desc] of wanted) this.#instantiate(depth, desc);
  }

  // byScript: AS3 のスクリプトによる削除 (removeChild)。
  #remove(depth, byScript = false) {
    const child = this.children.get(depth);
    if (!child) return;
    if (this.movie.avm2) {
      this.movie.avm2.display.removing(child); // removed / removedFromStage のイベント。ハンドラが表示リストを変えることがある
      if (this.children.get(depth) !== child) return;
      if (!byScript) this.movie.avm2.display.named(child, null); // タイムラインが取り除いた子は、親の同名のプロパティも null になる
    }
    this.children.delete(depth);
    if (this.zorder) this.zorder.splice(this.zorder.indexOf(child), 1);
    if (this.movie.avm2) child.parent = null; // AS3 では、外されたオブジェクトの parent は null になる
    if (!child.removed) this.movie.instances -= child.count();
    if (!(child instanceof MovieClip)) {
      child.removed = true;
      return;
    }
    // unload の処理（onClipEvent(unload) か onUnload）を持つクリップは、それが実行されるまで
    // 名前で参照できる状態が続く（実機で確認）。持たないクリップはその場で消える。
    const handler = child.clipActions?.some((a) => a.events & EVENT.unload)
      || child.scriptObject()?.get('onUnload') instanceof AVMFunction;
    child.#unload();
    if (handler) {
      child.unloadPending = true;
      (this.limbo ??= new Set()).add(child);
    } else {
      child.removed = true;
    }
  }

  // 取り除かれるときに、子孫から順に unload イベントを出す。子孫はその場で取り除かれた扱いにする。
  #unload() {
    for (const child of this.children.values()) {
      if (child instanceof MovieClip) child.#unload();
      child.removed = true;
    }
    this.movie.fire(this, 'unload');
  }

  // dynamic: スクリプトからの配置。定義順の制約を外し、既にある深度は置き換える。
  #instantiate(depth, desc, dynamic = false, given = undefined) {
    const { movie } = this;
    const character = given ?? this.library.dictionary.get(desc.characterId);
    if (!character) {
      movie.warn(`character ${desc.characterId} is not defined`);
      return undefined;
    }
    // スプライトが参照できるのは、自分より前に定義されたキャラクタだけ（仕様 13 章）。
    // これで参照が循環せず、入れ子の深さは定義の数で頭打ちになる。
    if (!dynamic && character.order >= this.character.order) {
      movie.warn(`sprite ${this.character.id} cannot place character ${character.id} defined after it`);
      return undefined;
    }
    if (!['sprite', 'shape', 'morph', 'edittext', 'video'].includes(character.type)) {
      movie.warn(`character ${character.id} (${character.type}) cannot be placed`);
      return undefined;
    }
    if (dynamic) this.#remove(depth);
    if (movie.instances >= movie.maxInstances) {
      movie.warn(`too many display objects (limit ${movie.maxInstances})`);
      return undefined;
    }
    // 生成は再帰するので、スタックを使い切らない深さで打ち切る。
    if (character.type === 'sprite' && this.level >= MAX_NESTING) {
      movie.warn(`sprites are nested deeper than ${MAX_NESTING} levels`);
      return undefined;
    }
    if (!(movie.avm2 && this.removed)) movie.instances++; // 表示リストの外で作られるものは、載るときに数える
    // 子の 1 フレーム目のアクションは待ち行列に入るだけなので、実行される時には親への登録は済んでいる。
    const child = character.type === 'sprite' ? new MovieClip(movie, character, depth, desc, this.level + 1, this)
      : character.type === 'edittext' ? new TextField(movie, character, depth, desc, this)
        : character.type === 'video' ? new VideoObject(movie, character, depth, desc, this)
          : new DisplayObject(character, depth, desc, this);
    this.children.set(depth, child);
    if (movie.avm2 && this.removed) child.removed = true;
    if (movie.avm2 && !(child instanceof MovieClip)) {
      // AS3 では、図形などにも instanceN の名前が付き、クリップと同じ順番で added などのイベントが届く。
      if (!child.name) child.name = movie.nextInstanceName();
      movie.unconstructed.add(child);
    }
    if (this.zorder) {
      // スクリプトが順序を入れ替えた後にタイムラインが置くものは、自分より深度の小さいタイムラインの子のすぐ上に入れる。
      let at = 0;
      this.zorder.forEach((other, i) => { if (other.depth < depth) at = i + 1; });
      this.zorder.splice(at, 0, child);
    }
    return child;
  }
}

const describe = (obj) => ({
  characterId: obj.character.id,
  matrix: obj.matrix,
  cxform: obj.cxform,
  ratio: obj.ratio,
  name: obj.name,
  clipDepth: obj.clipDepth,
  filters: obj.filters,
  blendMode: obj.blendMode,
  visible: obj.visible,
  opaqueBackground: obj.opaqueBackground,
});

// PlaceObject を、その深度の現在の状態 prev（無ければ undefined）に適用した結果を返す。何もしない場合は null。
//   キャラクタあり・移動なし → 新規配置（既定値から）。その深度が埋まっていれば何もしない
//                               （仕様に記載なし。実機は配置せず警告を出す: test/fixtures/place-occupied.swf）
//   キャラクタなし・移動あり → 既存の属性を変更
//   キャラクタあり・移動あり → 置き換え（指定の無い属性は既存を引き継ぐ）
function mergePlace(prev, op) {
  const hasCharacter = op.characterId !== undefined;
  if (!hasCharacter && !(op.move && prev)) return null;
  if (hasCharacter && !op.move && prev) return null;
  const base = op.move && prev ? prev : PLACE_DEFAULTS;
  return {
    characterId: hasCharacter ? op.characterId : prev.characterId,
    matrix: op.matrix ?? base.matrix,
    cxform: op.cxform ?? base.cxform,
    ratio: op.ratio ?? base.ratio,
    name: op.name ?? base.name,
    clipDepth: op.clipDepth ?? base.clipDepth,
    filters: op.filters ?? base.filters,
    blendMode: op.blendMode ?? base.blendMode,
    visible: op.visible ?? base.visible,
    opaqueBackground: op.opaqueBackground ?? base.opaqueBackground,
  };
}
