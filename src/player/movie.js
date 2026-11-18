// 辞書（キャラクタ定義）、表示リスト、タイムラインの進行、スクリプトの実行順（仕様 3・5・13 章）。
// 描画や DOM には依存しない。
import { AVM1 } from '../avm1/interp.js';
import { MovieClipObject } from '../avm1/clip.js';
import { AVMFunction } from '../avm1/object.js';
import { Drawing } from './drawing.js';
import { parseBitmap } from '../swf/bitmap.js';
import { BUTTON_COND, parseDefineButton, parsePlaceObject, parseRemoveObject, parseSetBackgroundColor } from '../swf/display.js';
import { parseDefineMorphShape } from '../swf/morph.js';
import { parseSWF } from '../swf/parse.js';
import { LegacyText } from '../swf/legacy.js';
import { Reader } from '../swf/reader.js';
import { parseDefineShape } from '../swf/shape.js';
import { editTextToPaths, parseDefineEditText, parseDefineFont, parseDefineText, textToPaths } from '../swf/text.js';
import { shapeToPaths } from '../shape/paths.js';

const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
const PLACE_DEFAULTS = Object.freeze({
  matrix: IDENTITY, cxform: null, ratio: 0, name: '', clipDepth: 0, filters: null, blendMode: 'normal', visible: true,
});
const SHAPE_TAGS = new Set([2, 22, 32, 83]);
const BITMAP_TAGS = new Set([6, 20, 21, 35, 36, 90]);
const MAX_NESTING = 255;
const DYNAMIC_DEPTH = 16384; // これ以上の深度はスクリプトが作ったクリップ用
const MAX_TRACES = 10000;
// クリップイベントのフラグ（PlaceObject2 の CLIPEVENTFLAGS を下位バイトから並べた値）。
const EVENT = { load: 0x01, enterFrame: 0x02, unload: 0x04 };
const EVENT_METHOD = { load: 'onLoad', enterFrame: 'onEnterFrame', unload: 'onUnload' };
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

export class Movie {
  #over = null; // マウスが乗っているボタン
  #pressed = null; // マウスを押したときに乗っていたボタン（離すまで、他のボタンは反応しない）
  #pressedInside = false; // 押したまま、そのボタンの上にいるか
  #mouseDown = false;
  #mouseInside = false; // マウスがステージの上にあるか（最初の mouseMove までは外にある扱い）

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
   *   encoding: SWF 5 以前の文字列の文字コード（'shift_jis' など、TextDecoder が受け付ける名前）。省略すると 'windows-1252'。
   *             SWF 6 以降は常に UTF-8 なので使わない。SWF 5 以前では、クリップの名前などはバイト列のままの文字列になる
   *             （swf/legacy.js を参照）。trace の出力と表示する文字は、この文字コードで Unicode に直す。
   */
  static async load(bytes, options = {}) {
    const movie = new Movie(await parseSWF(bytes, options), options);
    await movie.#decodeBitmaps();
    movie.runActions(); // 1 フレーム目のアクション
    return movie;
  }

  #jpegTables;
  #pendingBitmaps = [];
  #bitmapPixelBudget;
  #queue = []; // 実行待ちのアクション { clip, code } / { clip, method, args }
  #initQueue = []; // DoInitAction（通常のアクションより先に実行する）
  #initDone = new Set(); // 実行済みの DoInitAction のスプライト ID
  #instanceNames = 0;

  /** 直接は使わず Movie.load() を使う（ビットマップの展開が非同期のため）。 */
  constructor(swf, { maxInstances = 100000, maxBitmapPixels = 1 << 26, trace, now, random, avm = {}, encoding = 'windows-1252' } = {}) {
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
    this.avm = this.isAS3 ? null : new AVM1({
      version: swf.version,
      trace: (text) => {
        const shown = this.legacy ? this.legacy.decode(text) : text;
        if (trace) trace(shown);
        else if (this.traces.length < MAX_TRACES) this.traces.push(shown);
      },
      legacy: this.legacy,
      now: now ?? (() => Date.now() - started),
      random,
      ...avm,
    });
    this.emptySprite = { type: 'sprite', id: -1, order: -1, timeline: Object.assign([[]], { labels: new Map() }) };

    const timeline = this.#buildTimeline(swf.tags, null);
    this.root = new MovieClip(this, { type: 'sprite', id: 0, order: Infinity, timeline }, 0, PLACE_DEFAULTS, 0, null);
  }

  /**
   * 1 フレーム進め、たまったアクションを実行する。
   * クリップは新しく作られたものから順に処理し、ルートが最後になる（実機の trace の順序から確認した規則）。
   * このフレームで新しく作られるクリップは、1 フレーム目を表示したままにする。
   */
  advance() {
    this.#guard(() => this.avm?.runTimers());
    this.clips = this.clips.filter((clip) => !clip.removed);
    const clips = this.clips.slice();
    for (let i = clips.length - 1; i >= 0; i--) if (!clips[i].removed && !clips[i].unloadPending) clips[i].tick();
    this.runActions();
    this.#updateButtons(); // マウスが動かなくても、ボタンの方が現れたり消えたりする
  }

  // --- 入力 ---

  /** マウスの位置（ステージ座標、twips）を伝える。 */
  mouseMove(x, y) {
    this.mouse = { x, y };
    this.#mouseInside = true;
    this.#updateButtons();
  }

  /** マウスがステージの外へ出たことを伝える。 */
  mouseLeave() {
    this.#mouseInside = false;
    this.#updateButtons();
  }

  mouseDown() {
    this.#updateButtons();
    this.#mouseDown = true;
    if (this.#over) {
      this.#pressed = this.#over;
      this.#pressedInside = true;
      this.#buttonEvent(this.#pressed, BUTTON_COND.press, 'down');
    }
    this.runActions();
  }

  mouseUp() {
    this.#updateButtons();
    this.#mouseDown = false;
    if (this.#pressed) {
      if (this.#pressedInside) this.#buttonEvent(this.#pressed, BUTTON_COND.release, 'over');
      else this.#buttonEvent(this.#pressed, BUTTON_COND.releaseOutside, 'up');
      this.#over = this.#pressedInside ? this.#pressed : null;
      this.#pressed = null;
    }
    this.runActions();
    this.#updateButtons();
  }

  /**
   * キーが押されたことを伝える。code は SWF のキーコード（印字できる文字は ASCII コード、
   * 1 ← / 2 → / 3 Home / 4 End / 5 Insert / 6 Delete / 8 Backspace / 13 Enter / 14 ↑ / 15 ↓ / 16 PageUp / 17 PageDown / 18 Tab / 19 Esc）。
   */
  keyDown(code) {
    // 同じキーに反応するボタンがいくつあっても、実行されるのは表示順でいちばん下（奥）の 1 つだけ（実機で確認）。
    const find = (clip) => {
      if (!clip.visible) return null;
      for (const child of clip.sortedChildren()) {
        if (!(child instanceof MovieClip)) continue;
        if (!child.character.button) {
          const found = find(child);
          if (found) return found;
        } else if (child.visible && child.character.button.actions.some((action) => action.key === code)) {
          return child;
        }
      }
      return null;
    };
    const button = code ? find(this.root) : null;
    for (const action of button?.character.button.actions ?? []) if (action.key === code) this.queueAction(button.parent, action.code);
    this.runActions();
  }

  /** マウスが乗っているボタン（無ければ null）。カーソルの形を変えるのに使う。 */
  get hoverButton() {
    return this.#over;
  }

  // マウス位置にあるいちばん手前のボタン。ボタンでない図形は、上に重なっていてもボタンを隠さない。
  #buttonAt(clip, x, y) {
    if (!clip.visible) return null;
    const children = clip.sortedChildren();
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child.clipDepth || !(child instanceof MovieClip)) continue;
      if (!child.character.button) {
        const found = this.#buttonAt(child, x, y);
        if (found) return found;
        continue;
      }
      if (!child.visible) continue;
      const m = invert(child.worldMatrix());
      const local = { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
      if (child.character.button.records.some((rec) => rec.hitTest && this.#hits(rec, local, 0))) return child;
    }
    return null;
  }

  // 配置の記述 place（キャラクタと行列）が、親の座標系の点 p を含むか。図形は塗りの内側、スプライトは 1 フレーム目の中身で判定する。
  #hits(place, p, depth) {
    const character = this.dictionary.get(place.characterId);
    if (!character || depth > 8) return false;
    const m = invert(place.matrix ?? IDENTITY);
    const q = { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty };
    if (character.type === 'shape') {
      return character.paths.some((op) => op.kind === 'fill' && crossings(op.path, q.x, q.y) % 2 === 1);
    }
    if (character.type === 'sprite') {
      return (character.timeline[0] ?? []).some((op) => op.op === 'place' && op.characterId !== undefined && this.#hits(op, q, depth + 1));
    }
    return false;
  }

  // マウスとボタンの位置関係を調べ直し、変化があればイベントを起こす。
  #updateButtons() {
    if (this.#over?.removed) this.#over = null;
    if (this.#pressed?.removed) this.#pressed = null;
    const hit = this.#mouseInside ? this.#buttonAt(this.root, this.mouse.x, this.mouse.y) : null;
    if (this.#pressed) {
      // 押したまま出入りする
      const inside = hit === this.#pressed;
      if (inside !== this.#pressedInside) {
        this.#pressedInside = inside;
        this.#buttonEvent(this.#pressed, inside ? BUTTON_COND.dragOver : BUTTON_COND.dragOut, inside ? 'down' : 'over');
      }
    } else if (!this.#mouseDown && hit !== this.#over) {
      if (this.#over) this.#buttonEvent(this.#over, BUTTON_COND.rollOut, 'up');
      if (hit) this.#buttonEvent(hit, BUTTON_COND.rollOver, 'over');
      this.#over = hit;
    }
    this.runActions();
  }

  // ボタンの見た目を state に切り替え、条件 cond のアクションを待ち行列に入れる。アクションはボタンを置いたクリップを対象に実行される。
  #buttonEvent(button, cond, state) {
    button.setButtonState(state);
    for (const action of button.character.button.actions) if (action.cond & cond) this.queueAction(button.parent, action.code);
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

  // --- アクションの待ち行列 ---

  queueAction(clip, code) {
    if (this.avm) this.#queue.push({ clip, code });
  }

  queueInit(spriteId, clip, code) {
    if (!this.avm || this.#initDone.has(spriteId)) return;
    this.#initDone.add(spriteId);
    this.#initQueue.push({ clip, code });
  }

  /** クリップイベントを発生させる。onClipEvent のコードと、同名のメソッド (onEnterFrame など) を待ち行列に入れる。 */
  fire(clip, event) {
    if (!this.avm) return;
    for (const action of clip.clipActions ?? []) {
      if (action.events & EVENT[event]) this.#queue.push({ clip, code: action.code, removedOk: event === 'unload' });
    }
    this.#queue.push({ clip, method: EVENT_METHOD[event], removedOk: event === 'unload', last: event === 'unload' });
  }

  /** 待ち行列が空になるまでアクションを実行する。実行中に積まれたものも続けて実行する。 */
  runActions() {
    const { avm } = this;
    if (!avm) return;
    for (;;) {
      const item = this.#initQueue.shift() ?? this.#queue.shift();
      if (!item) break;
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

  // スクリプトを実行する。上限を超えたら、実機と同じく以後のスクリプトをすべて止める（再帰の深さの超過も同じ）。
  #guard(body) {
    if (!this.avm || this.avm.disabled) return;
    try {
      body();
    } catch (e) {
      if (e.name !== 'AVMError') throw e;
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
          this.#define({ type: 'shape', id: edit.id, bounds: edit.bounds, paths: editTextToPaths(edit, this.#font) });
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
  bounds(m) {
    const b = this.character.bounds ?? this.character.startBounds;
    return b ? transformBounds(b, m) : null;
  }

  /** 親の座標系での外接矩形。 */
  boundsInParent() {
    return this.bounds(this.matrix);
  }

  /** ルートから見た変換行列。 */
  worldMatrix() {
    return this.parent ? concat(this.parent.worldMatrix(), this.matrix) : this.matrix;
  }

  /** other の座標系での外接矩形。 */
  boundsIn(other) {
    return this.bounds(concat(invert(other.worldMatrix()), this.worldMatrix()));
  }
}

/** 自分のタイムラインと子を持つオブジェクト。ルートもこれ。 */
export class MovieClip extends DisplayObject {
  #object = null;
  #drawing = null;

  constructor(movie, character, depth = 0, desc = PLACE_DEFAULTS, level = 0, parent = null) {
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
    if (parent && !this.name) this.name = movie.nextInstanceName(); // ルートの名前は空
    movie.clips.push(this);
    if (parent) movie.fire(this, 'load');
    if (this.frames.length > 0) this.#runFrame(1, true);
  }

  get totalFrames() {
    return this.frames.length;
  }

  /** 深度の小さい順（下から上）の子。 */
  sortedChildren() {
    return [...this.children.values()].sort((a, b) => a.depth - b.depth);
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
      if (!this.parent) this.#object.define('$version', 'MAC 35,0,0,60'); // ルートはプレイヤーの版を変数に持つ
    }
    return this.#object;
  }

  childByName(name, caseInsensitive) {
    const fold = (s) => (caseInsensitive ? this.movie.lower(s) : s);
    const wanted = fold(name);
    const matches = (child) => child instanceof MovieClip && fold(child.name) === wanted;
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

  /** 描画 API で描いた内容（無ければ null）。子より下に描かれる。 */
  drawingPaths() {
    return this.#drawing ? this.#drawing.paths() : null;
  }

  bounds(m) {
    let b = this.#drawing?.bounds ? transformBounds(this.#drawing.bounds, m) : null;
    for (const child of this.children.values()) b = union(b, child.bounds(concat(m, child.matrix)));
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

  /** 自分と同じシンボルを、親の中に別の名前・深度で置く。 */
  duplicate(name, depth) {
    if (!this.parent) return undefined;
    const desc = { ...describe(this), name, clipActions: this.clipActions };
    return this.parent.#instantiate(depth, desc, true, this.character);
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
      if (this.currentFrame < this.frames.length) this.#runFrame(this.currentFrame + 1, true);
      else this.#rewind(1);
    }
  }

  #runFrame(n, withActions) {
    this.currentFrame = n;
    for (const op of this.frames[n - 1]) {
      if (op.op === 'action') {
        if (withActions) this.movie.queueAction(this, op.code);
        continue;
      }
      if (op.op === 'init') {
        this.movie.queueInit(op.spriteId, this, op.code);
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
    this.#reconcile(wanted);
    this.currentFrame = target;
    for (const op of this.frames[target - 1]) if (op.op === 'action') this.movie.queueAction(this, op.code);
  }

  // 表示リストを wanted（深度 → 配置の記述）に合わせる。
  #reconcile(wanted) {
    for (const [depth, child] of [...this.children]) {
      if (depth >= DYNAMIC_DEPTH) {
        wanted.delete(depth); // タグがこの深度に置いていても、埋まっているので置き直さない
        continue;
      }
      const desc = wanted.get(depth);
      if (desc && desc.characterId === child.character.id) {
        child.apply(desc);
        wanted.delete(depth);
      } else {
        this.#remove(depth);
      }
    }
    for (const [depth, desc] of wanted) this.#instantiate(depth, desc);
  }

  #remove(depth) {
    const child = this.children.get(depth);
    if (!child) return;
    this.children.delete(depth);
    this.movie.instances -= child.count();
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
    if (character.type !== 'sprite' && character.type !== 'shape' && character.type !== 'morph') {
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
    movie.instances++;
    // 子の 1 フレーム目のアクションは待ち行列に入るだけなので、実行される時には親への登録は済んでいる。
    const child = character.type === 'sprite'
      ? new MovieClip(movie, character, depth, desc, this.level + 1, this)
      : new DisplayObject(character, depth, desc, this);
    this.children.set(depth, child);
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
