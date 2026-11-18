// 辞書（キャラクタ定義）、表示リスト、タイムラインの進行、スクリプトの実行順（仕様 3・5・13 章）。
// 描画や DOM には依存しない。
import { AVM1, PLAYER_VERSION } from '../avm1/interp.js';
import { AVM2 } from '../avm2/vm.js';
import { installFlash } from '../avm2/flash.js';
import { MovieClipObject } from '../avm1/clip.js';
import { TextFieldObject } from '../avm1/textfield.js';
import { AVMFunction } from '../avm1/object.js';
import { Drawing } from './drawing.js';
import { SoundMixer, buildStream } from './sound.js';
import { decodable, embeddedSequence } from './video.js';
import { parseDefineVideoStream, parseVideoFrame } from '../swf/video.js';
import { parseDefineButtonSound, parseDefineSound, parseSoundStreamBlock, parseSoundStreamHead, parseStartSound } from '../swf/sound.js';
import { parseBitmap } from '../swf/bitmap.js';
import { BUTTON_COND, parseDefineButton, parsePlaceObject, parseRemoveObject, parseSetBackgroundColor } from '../swf/display.js';
import { parseDefineMorphShape } from '../swf/morph.js';
import { parseSWF } from '../swf/parse.js';
import { toBool, toStr } from '../avm1/convert.js';
import { LegacyText } from '../swf/legacy.js';
import { Reader, SWFError } from '../swf/reader.js';
import { parseDefineShape } from '../swf/shape.js';
import { editTextToPaths, parseDefineEditText, parseDefineFont, parseDefineText, plainText, textToPaths } from '../swf/text.js';
import { shapeToPaths } from '../shape/paths.js';

const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const PLACE_DEFAULTS = Object.freeze({
  matrix: IDENTITY, cxform: null, ratio: 0, name: '', clipDepth: 0, filters: null, blendMode: 'normal', visible: true,
});
const PASS = Symbol('pass'); // マウスの相手探しで「当たったが、受けるものが決まらない」
const SHAPE_TAGS = new Set([2, 22, 32, 83]);
const BITMAP_TAGS = new Set([6, 20, 21, 35, 36, 90]);
const MAX_NESTING = 255;
const DYNAMIC_DEPTH = 16384; // これ以上の深度はスクリプトが作ったクリップ用
const MAX_TRACES = 10000;
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
   *             kind はそのどれか。プレイヤーは移動も読み込みもしない（要求は movie.requests にも残る）
   *   audio: 音の出力（player/sound.js の冒頭を参照。ブラウザでは audio/webaudio.js）。省略すると音は出ない
   *   media: (url) => Uint8Array | Promise<Uint8Array> | null   AS3 の NetStream.play(url) が再生する FLV ファイルを返す関数。
   *             プレイヤーは自分ではファイルを取りに行かない。省略すると、どの URL も「見つからない」扱いになる
   *   video: H.264 の復号（video/webcodecs.js の冒頭を参照。ブラウザでは WebCodecsVideo）。省略すると、H.264 の FLV は映らない
   *   rasterize: (movie, 表示オブジェクト, 行列, 幅, 高さ) => RGBA   表示オブジェクトを画像に描く処理（AS3 の BitmapData.draw 用。
   *             ブラウザでは CanvasRenderer の rasterizer()）。省略すると、表示オブジェクトの draw は警告を残して何もしない
   *   language: System.capabilities.language の値（'ja' など。既定は 'en'）
   *   encoding: SWF 5 以前の文字列の文字コード（'shift_jis' など、TextDecoder が受け付ける名前）。省略すると 'windows-1252'。
   *             SWF 6 以降は常に UTF-8 なので使わない。SWF 5 以前では、クリップの名前などはバイト列のままの文字列になる
   *             （swf/legacy.js を参照）。trace の出力と表示する文字は、この文字コードで Unicode に直す。
   */
  static async load(bytes, options = {}) {
    const movie = new Movie(await parseSWF(bytes, options), options);
    await movie.#decodeBitmaps();
    if (movie.avm2) {
      movie.#framePhase(); // AS3: 1 フレーム目の frameConstructed、フレームスクリプト、exitFrame
      movie.#guard(() => movie.avm2.display.loaded()); // 読み込みが済んだことを loaderInfo に伝える
    }
    movie.runActions(); // 1 フレーム目のアクション
    return movie;
  }

  #phaseDepth = 0;

  #jpegTables;
  #pendingBitmaps = [];
  #bitmapPixelBudget;
  #queue = []; // 実行待ちのアクション { clip, code } / { clip, method, args }
  #initQueue = []; // DoInitAction（通常のアクションより先に実行する）
  #initDone = new Set(); // 実行済みの DoInitAction のスプライト ID
  #instanceNames = 0;

  /** 直接は使わず Movie.load() を使う（ビットマップの展開が非同期のため）。 */
  constructor(swf, { maxInstances = 100000, maxBitmapPixels = 1 << 26, trace, now, random, avm = {}, encoding = 'windows-1252', onRequest, language = 'en', audio, rasterize, media, video } = {}) {
    this.media = media ?? null;
    this.video = video ?? null;
    this.rasterize = rasterize ? (d, m, width, height) => rasterize(this, d, m, width, height) : null;
    this.boundFields = new Set(); // 変数と連動しているテキストフィールド
    this.requests = []; // スクリプトが要求した URL（実行はしない）。{ kind, url, target, method }
    this.#bitmapPixelBudget = maxBitmapPixels;
    this.version = swf.version;
    this.legacy = swf.version < 6 ? new LegacyText(encoding) : null; // SWF 5 以前の文字列の扱い
    this.fileLength = swf.fileLength;
    this.frameSize = swf.frameSize; // twips
    this.frameRate = swf.frameRate;
    this.warnings = [...swf.warnings];
    this.backgroundColor = null; // SetBackgroundColor が無ければ null
    this.dictionary = new Map(); // キャラクタ ID → 定義
    this.exports = new Map(); // 書き出し名（リンケージ ID）→ キャラクタ ID
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
    /** スクリプトが要求した URL を記録する（実行はしない）。 */
    this.request = (req) => {
      const shown = this.legacy ? { ...req, url: this.legacy.decode(req.url), target: this.legacy.decode(req.target) } : req;
      if (this.requests.length < MAX_TRACES) this.requests.push(shown);
      onRequest?.(shown);
    };
    this.symbolClasses = new Map(); // キャラクタ ID → 結び付けられた AS3 のクラス名 (SymbolClass)
    this.unconstructed = new Set(); // AS3: 表示リストには入ったが、まだコンストラクタを呼んでいないクリップ
    // ActionScript 3 のムービーは AVM2 で、それ以外は AVM1 で動かす。
    this.avm2 = this.isAS3 ? new AVM2({ trace: traceOut, now: this.now, random, ...avm }) : null;
    if (this.avm2) installFlash(this.avm2, this, { MovieClip, TextField, VideoObject });
    this.avm = this.isAS3 ? null : new AVM1({
      version: swf.version,
      trace: traceOut,
      legacy: this.legacy,
      stage: { width: (swf.frameSize.xmax - swf.frameSize.xmin) / 20, height: (swf.frameSize.ymax - swf.frameSize.ymin) / 20 },
      language,
      request: this.request,
      now: this.now,
      random,
      ...avm,
    });
    this.emptySprite = { type: 'sprite', id: -1, order: -1, timeline: Object.assign([[]], { labels: new Map() }) };

    const timeline = this.#buildTimeline(swf.tags, null);
    this.root = new MovieClip(this, { type: 'sprite', id: 0, order: Infinity, timeline }, 0, PLACE_DEFAULTS, 0, null);
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
   * 1 フレーム進め、たまったアクションを実行する。
   * クリップは新しく作られたものから順に処理し、ルートが最後になる（実機の trace の順序から確認した規則）。
   * このフレームで新しく作られるクリップは、1 フレーム目を表示したままにする。
   */
  advance() {
    const due = this.avm?.pending.splice(0) ?? []; // 前のフレームまでに予約された処理（読み込み失敗の通知など）
    this.#guard(() => this.avm?.runTimers());
    const as3 = this.avm2?.display;
    this.#guard(() => as3?.runStreams()); // 終わりまで再生した NetStream の通知
    as3?.runTimers();
    this.clips = this.clips.filter((clip) => (clip.listed = !clip.removed));
    const clips = this.clips.slice();
    for (let i = clips.length - 1; i >= 0; i--) if (!clips[i].removed && !clips[i].unloadPending) clips[i].tick();
    as3?.broadcast('enterFrame'); // AS3 の enterFrame は、再生ヘッドが進んだ後に届く（実機で確認）
    this.onFrameConstructed?.(); // 各クリップがこのフレームの子を作り終え、フレームのスクリプトを実行する前（検証用の観測点）
    if (as3) this.#framePhase();
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
  }

  mouseUp() {
    this.#updateButtons();
    this.#mouseDown = false;
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
  keyDown(code, ascii = code >= 65 && code <= 90 ? code + 32 : (code >= 48 && code <= 57) || code === 32 ? code : 0) {
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
    const button = key ? find(this.root) : null;
    for (const action of button?.character.button.actions ?? []) if (action.key === key) this.queueAction(button.parent, action.code);
    this.runActions();
    this.#keyChars.set(code, ascii);
    this.avm2?.display.key('keyDown', code, ascii);
  }

  /** キーが離されたことを伝える。 */
  keyUp(code) {
    this.avm?.keyEvent(code, 0, false);
    this.#broadcast('keyUp', 'Key', 'onKeyUp');
    this.runActions();
    this.avm2?.display.key('keyUp', code, this.#keyChars.get(code) ?? 0); // 離したときのイベントも、押したときの文字コードを持つ
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
        } else if (clip !== this.root && child.hitPoint(this.mouse.x, this.mouse.y)) {
          return clip;
        }
      }
      return null;
    };
    return find(this.root);
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
      if (button.records.some((rec) => rec.hitTest && this.#hits(rec, local, 0))) return child;
    }
    return null;
  }

  // 配置の記述 place（キャラクタと行列）が、親の座標系の点 p を含むか。図形は塗りの内側、スプライトは 1 フレーム目の中身で判定する。
  #hits(place, p, depth) {
    const character = this.dictionary.get(place.characterId);
    if (!character || depth > 8) return false;
    const m = invert(place.matrix ?? IDENTITY);
    const q = { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty };
    if (character.type === 'shape') return insidePaths(character.paths, q.x, q.y);
    if (character.type === 'sprite') {
      return (character.timeline[0] ?? []).some((op) => op.op === 'place' && op.characterId !== undefined && this.#hits(op, q, depth + 1));
    }
    return false;
  }

  // マウスとボタンの位置関係を調べ直し、変化があればイベントを起こす。
  #updateButtons() {
    if (this.#over?.removed) this.#over = null;
    if (this.#pressed?.removed) this.#pressed = null;
    let hit = null;
    this.#guard(() => { // ハンドラの有無を調べるときに、スクリプトの getter が動くことがある
      hit = this.#mouseInside ? this.#buttonAt(this.root, this.mouse.x, this.mouse.y) : null;
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
      const defined = sound && this.dictionary.get(sound.soundId);
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
  textPaths(edit) {
    return editTextToPaths(edit, this.#font);
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

  queueAction(clip, code) {
    if (this.avm) this.#queue.push({ clip, code });
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
            avm2.run(() => avm2.call(fn, clip.as3, []), (text) => this.warn(`uncaught error: ${text}`));
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
  #buildTimeline(tags, sprite) {
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
          ops.push({ op: 'place', ...parsePlaceObject(tag, this.version) });
        } else if (tag.code === 5 || tag.code === 28) {
          ops.push({ op: 'remove', ...parseRemoveObject(tag) });
        } else if (tag.code === 12) {
          ops.push({ op: 'action', code: tag.body });
        } else if (tag.code === 15) {
          ops.push({ op: 'sound', ...parseStartSound(tag) });
        } else if (tag.code === 18 || tag.code === 45) {
          streamHead ??= parseSoundStreamHead(tag);
        } else if (tag.code === 19) {
          if (streamHead) streamBlocks.push({ frame: frames.length + 1, ...parseSoundStreamBlock(tag, streamHead) });
        } else if (tag.code === 43) {
          const name = new Reader(tag.body, this.legacy !== null).string();
          if (!frames.labels.has(name)) frames.labels.set(name, frames.length + 1);
        } else if (sprite) {
          // 定義タグはスプライトの中には置けない（仕様 13 章）。
        } else if (tag.code === 59 && tag.length >= 2) {
          ops.push({ op: 'init', spriteId: tag.body[0] | (tag.body[1] << 8), code: tag.body.subarray(2) });
        } else if (tag.code === 56) {
          const r = new Reader(tag.body, this.legacy !== null);
          for (let n = r.u16(); n > 0; n--) {
            const id = r.u16();
            this.exports.set(r.string(), id);
          }
        } else if ((tag.code === 82 || tag.code === 72) && this.avm2) {
          // DoABC: フラグ（u32）と名前の後に ABC が続く。古い形 (72) は ABC だけ。
          let at = 0;
          if (tag.code === 82) {
            at = tag.body.indexOf(0, 4) + 1;
            if (at <= 0) throw new SWFError('DoABC has no name');
          }
          const lazy = tag.code === 82 && (tag.body[0] & 1) !== 0;
          this.#loadABC(tag.body.subarray(at), lazy);
        } else if (tag.code === 76 && this.avm2) {
          const r = new Reader(tag.body);
          for (let n = r.u16(); n > 0; n--) {
            const id = r.u16();
            this.symbolClasses.set(id, r.string());
          }
        } else if (tag.code === 14) {
          const sound = parseDefineSound(tag);
          if (!['pcm', 'pcm-native', 'adpcm', 'mp3'].includes(sound.format)) this.warn(`sound ${sound.id}: format ${sound.format} is not supported (it will be silent)`);
          this.#define({ type: 'sound', ...sound });
        } else if (tag.code === 60) {
          const video = parseDefineVideoStream(tag);
          if (!decodable(video.codec)) this.warn(`video ${video.id}: codec ${video.codec} is not supported (it will not be shown)`);
          this.#define({ type: 'video', ...video, frames: new Map() });
        } else if (tag.code === 61) {
          // フレームのデータは、ビデオのキャラクタに番号つきで集める。どれを表示するかは、置くときの ratio で決まる。
          const frame = parseVideoFrame(tag);
          const video = this.dictionary.get(frame.streamId);
          if (video?.type === 'video') video.frames.set(frame.frameNum, frame.data);
          else this.warn(`video frame for an undefined video stream ${frame.streamId}`);
        } else if (tag.code === 17) {
          const { buttonId, sounds } = parseDefineButtonSound(tag);
          const button = this.dictionary.get(buttonId);
          if (button?.button) button.buttonSounds = sounds;
        } else if (tag.code === 9) {
          this.backgroundColor ??= parseSetBackgroundColor(tag);
        } else if (SHAPE_TAGS.has(tag.code)) {
          const shape = parseDefineShape(tag);
          this.#define({ type: 'shape', id: shape.id, bounds: shape.bounds, paths: shapeToPaths(shape) });
        } else if (tag.code === 7 || tag.code === 34) {
          // ボタンは、通常状態 (up) のキャラクタを置いた 1 フレームのスプライトとして扱う。
          // マウスに応じた状態の切り替えは MovieClip.setButtonState、イベントは Movie.mouseMove などが行う。
          const button = parseDefineButton(tag);
          const place = button.records.filter((rec) => rec.up).map((rec) => ({ op: 'place', move: false, ...rec }));
          this.#define({ type: 'sprite', id: button.id, timeline: Object.assign([place], { labels: new Map() }), button });
        } else if (tag.code === 46 || tag.code === 84) {
          this.#define({ type: 'morph', ...parseDefineMorphShape(tag) });
        } else if (tag.code === 10 || tag.code === 48 || tag.code === 75) {
          this.#define({ type: 'font', ...parseDefineFont(tag) });
        } else if (tag.code === 11 || tag.code === 33) {
          // 静的テキストは、グリフを並べた図形として扱う。
          const text = parseDefineText(tag);
          this.#define({ type: 'shape', id: text.id, bounds: text.bounds, paths: textToPaths(text, this.#font) });
        } else if (tag.code === 37) {
          const edit = parseDefineEditText(tag, this.legacy !== null);
          if (this.legacy && edit.text !== undefined) edit.text = this.legacy.decode(edit.text); // 表示用
          this.#define({ type: 'edittext', id: edit.id, bounds: edit.bounds, edit, fontName: this.#font(edit.fontId)?.name });
        } else if (tag.code === 8) {
          this.#jpegTables ??= tag.body;
        } else if (BITMAP_TAGS.has(tag.code) && tag.length >= 2) {
          // 展開は非同期なので、ID だけ先に登録しておく。
          const def = { type: 'bitmap', id: tag.body[0] | (tag.body[1] << 8), width: 0, height: 0 };
          if (this.#define(def)) this.#pendingBitmaps.push({ def, tag });
        } else if (tag.code === 39 && tag.tags) {
          const def = { type: 'sprite', id: tag.spriteId };
          if (this.#define(def)) def.timeline = this.#buildTimeline(tag.tags, def);
        }
      } catch (e) {
        if (e.name !== 'SWFError') throw e;
        this.warn(`tag ${tag.name ?? tag.code} at offset ${tag.offset}: ${e.message}`);
      }
    }
    if (streamHead && streamBlocks.length) frames.stream = buildStream(streamHead, streamBlocks);
    return frames;
  }

  #font = (id) => {
    const font = this.dictionary.get(id);
    return font?.type === 'font' ? font : undefined;
  };

  async #decodeBitmaps() {
    for (const { def, tag } of this.#pendingBitmaps) {
      try {
        Object.assign(def, await parseBitmap(tag, this.#jpegTables, this.#bitmapPixelBudget));
        this.#bitmapPixelBudget -= def.width * def.height;
      } catch (e) {
        if (e.name !== 'SWFError') throw e;
        this.warn(`tag ${tag.name} at offset ${tag.offset}: ${e.message}`);
      }
    }
    this.#pendingBitmaps = [];
  }

  #define(def) {
    if (this.dictionary.has(def.id)) {
      this.warn(`character ${def.id} is defined twice; the later definition is ignored`);
      return false;
    }
    def.order = this.dictionary.size; // 定義された順番
    this.dictionary.set(def.id, def);
    return true;
  }
}

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
    this.filters = desc.filters; // null はフィルタなし
    this.blendMode = desc.blendMode;
    this.visible = desc.visible;
  }

  /** AS3: 表示リストに戻ったときに呼ばれる。 */
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

  /** 親の座標系での外接矩形。 */
  boundsInParent() {
    return this.bounds(this.matrix);
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
  leftMargin: 0, rightMargin: 0, indent: 0, leading: 0, bullet: false,
};
const rgbOf = (n) => ({ r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 });

/** テキストフィールド（DefineEditText を置いたもの、または createTextField で作ったもの）。 */
export class TextField extends DisplayObject {
  #object = null;
  #paths = null;

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
    this.htmlText = this.html ? edit.text : null; // html が真のとき、代入された HTML そのもの
    this.text = edit ? (this.html ? plainText(edit.text) : edit.text) : '';
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
  }

  /** 文字列を入れる。書式は newFormat に戻る。fromScript が真なら、連動する変数にも書く。 */
  setText(text, fromScript) {
    this.text = text.replace(/\r\n|\n/g, '\r'); // 改行は CR で持つ
    this.format = { ...this.newFormat };
    this.changed();
    if (fromScript && this.variable) this.#variable(this.text);
  }

  /** 変数 name と連動させる（null で解除）。initial が真（定義で指定された場合）なら、変数が未定義のときに今の文字列を変数へ入れる。 */
  bind(name, initial = false) {
    this.variable = name || null;
    if (!this.variable) {
      this.movie.boundFields.delete(this);
      return;
    }
    this.movie.boundFields.add(this);
    if (initial && this.#variable() === undefined) this.#variable(this.text);
    else this.pull();
  }

  /** 連動する変数に値があれば、それを表示する文字列にする。 */
  pull() {
    if (!this.variable) return;
    const value = this.#variable();
    if (value === undefined) return;
    const text = toStr(this.movie.avm, value).replace(/\r\n|\n/g, '\r');
    if (text !== this.text) {
      this.text = text;
      this.changed();
    }
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

  /** 描画命令（図形と同じ形式）。内容が変わるまで同じ配列を返す。 */
  paths() {
    if (!this.#paths) {
      const edit = this.character.edit;
      const f = this.format;
      this.#paths = this.movie.textPaths({
        bounds: this.box, fontId: edit?.fontId, fontName: f.font, useOutlines: this.embedFonts,
        height: f.size * 20, color: rgbOf(f.color), bold: f.bold, italic: f.italic, align: f.align,
        leftMargin: f.leftMargin * 20, rightMargin: f.rightMargin * 20, indent: f.indent * 20, leading: f.leading * 20,
        text: this.text, html: false, password: this.password, multiline: this.multiline, wordWrap: this.wordWrap,
        border: this.border, background: this.background, borderColor: rgbOf(this.borderColor), backgroundColor: rgbOf(this.backgroundColor),
      });
    }
    return this.#paths;
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
    this.#sequence ??= embeddedSequence(codec, frames, (message) => this.movie.warn(`video ${this.character.id}: ${message}`), this.character);
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
          style: { type: 'bitmap', bitmap: image, matrix: { a: w / image.width, b: 0, c: 0, d: h / image.height, tx: 0, ty: 0 }, repeat: false, smooth: this.smoothing },
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
  constructor(movie, character, depth = 0, desc = PLACE_DEFAULTS, level = 0, parent = null, as3 = null) {
    super(character, depth, desc, parent);
    this.movie = movie;
    this.level = level; // 入れ子の深さ（ルートが 0）
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
    const matches = (child) => (child instanceof MovieClip || child instanceof TextField) && fold(child.name) === wanted;
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
    return this.parent ? `${this.parent.dotPath()}.${this.name}` : '_level0';
  }

  slashPath() {
    if (!this.parent) return '/';
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
  frameNumber(spec) {
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
    return Math.max(1, Math.min(n, this.frames.length));
  }

  actionsOfFrame(n) {
    return (this.frames[n - 1] ?? []).filter((op) => op.op === 'action').map((op) => op.code);
  }

  /** 指定フレームへ移動する。途中のフレームは配置・削除だけを行い、アクションは移動先のものだけを実行する。 */
  gotoFrame(n, play) {
    if (this.frames.length === 0) return;
    const target = Math.max(1, Math.min(Math.trunc(n), this.frames.length));
    this.playing = play;
    if (target === this.currentFrame) return;
    if (target > this.currentFrame) {
      for (let f = this.currentFrame + 1; f <= target; f++) this.#runFrame(f, f === target);
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
    const id = this.movie.exports.get(exportName);
    const character = id === undefined ? undefined : this.movie.dictionary.get(id);
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
    return this.parent.#instantiate(depth, desc, true, this.character);
  }

  /** 中身を空にする（unloadMovie、または読み込みに失敗した loadMovie）。フレーム数は 0 になる。 */
  unload() {
    if (this.removed) return;
    for (const depth of [...this.children.keys()]) this.#remove(depth);
    this.#drawing = null;
    this.frames = Object.assign([], { labels: new Map() });
    this.currentFrame = 0;
    this.playing = false;
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
    if (this.playing && this.frames.length > 1) {
      this.isPlaying = true; // AS3 の isPlaying。最初は偽で、再生ヘッドが自分で進むと真になる
      if (this.currentFrame < this.frames.length) this.#runFrame(this.currentFrame + 1, true);
      else this.#rewind(1);
    }
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
        const sound = this.movie.dictionary.get(op.soundId);
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
      const sound = op.op === 'sound' ? this.movie.dictionary.get(op.soundId) : undefined;
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
    const character = given ?? movie.dictionary.get(desc.characterId);
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
  };
}
