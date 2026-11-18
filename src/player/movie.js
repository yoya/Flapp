// 辞書（キャラクタ定義）、表示リスト、タイムラインの進行（仕様 3・13 章）。描画や DOM には依存しない。
import { parseBitmap } from '../swf/bitmap.js';
import { parseDefineButton, parsePlaceObject, parseRemoveObject, parseSetBackgroundColor } from '../swf/display.js';
import { parseDefineMorphShape } from '../swf/morph.js';
import { parseSWF } from '../swf/parse.js';
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

export class Movie {
  /**
   * @param {Uint8Array | ArrayBuffer} bytes
   * @param {{ maxLength?: number, maxInstances?: number, maxBitmapPixels?: number }} [options]
   *   maxInstances: 表示リスト上に同時に存在できるオブジェクト数の上限（入れ子の爆発への備え）
   *   maxBitmapPixels: 全ビットマップの画素数の合計の上限（展開後のメモリへの備え）
   */
  static async load(bytes, options = {}) {
    const movie = new Movie(await parseSWF(bytes, options), options);
    await movie.#decodeBitmaps();
    return movie;
  }

  #jpegTables;
  #pendingBitmaps = [];
  #bitmapPixelBudget;

  /** 直接は使わず Movie.load() を使う（ビットマップの展開が非同期のため）。 */
  constructor(swf, { maxInstances = 100000, maxBitmapPixels = 1 << 26 } = {}) {
    this.#bitmapPixelBudget = maxBitmapPixels;
    this.version = swf.version;
    this.frameSize = swf.frameSize; // twips
    this.frameRate = swf.frameRate;
    this.warnings = [...swf.warnings];
    this.backgroundColor = null; // SetBackgroundColor が無ければ null
    this.dictionary = new Map(); // キャラクタ ID → 定義
    this.maxInstances = maxInstances;
    this.instances = 0;

    const timeline = this.#buildTimeline(swf.tags, null);
    this.root = new MovieClip(this, { type: 'sprite', id: 0, order: Infinity, timeline });
  }

  /** 1 フレーム進める。 */
  advance() {
    this.root.advance();
  }

  warn(message) {
    if (this.warnings.length < 100) this.warnings.push(message);
  }

  // タグ列を、定義（辞書へ）とフレームごとの表示リスト操作に分ける。
  // 定義は先にすべて辞書へ入れる（本来は読み込みの進行に合わせて増えるが、再生結果は変わらない）。
  #buildTimeline(tags, sprite) {
    const frames = [];
    let ops = [];
    for (const tag of tags) {
      try {
        if (tag.code === 1) {
          frames.push(ops);
          ops = [];
        } else if (tag.code === 4 || tag.code === 26 || tag.code === 70) {
          ops.push({ op: 'place', ...parsePlaceObject(tag) });
        } else if (tag.code === 5 || tag.code === 28) {
          ops.push({ op: 'remove', ...parseRemoveObject(tag) });
        } else if (sprite) {
          // 定義タグはスプライトの中には置けない（仕様 13 章）。
        } else if (tag.code === 9) {
          this.backgroundColor ??= parseSetBackgroundColor(tag);
        } else if (SHAPE_TAGS.has(tag.code)) {
          const shape = parseDefineShape(tag);
          this.#define({ type: 'shape', id: shape.id, bounds: shape.bounds, paths: shapeToPaths(shape) });
        } else if (tag.code === 7 || tag.code === 34) {
          // ボタンは、通常状態 (up) のキャラクタを置いた 1 フレームのスプライトとして扱う。
          // マウスへの反応（over / down 状態、アクション）は未対応。
          const button = parseDefineButton(tag);
          const ops = button.records.filter((rec) => rec.up).map((rec) => ({ op: 'place', move: false, ...rec }));
          this.#define({ type: 'sprite', id: button.id, timeline: [ops], button });
        } else if (tag.code === 46 || tag.code === 84) {
          this.#define({ type: 'morph', ...parseDefineMorphShape(tag) });
        } else if (tag.code === 10 || tag.code === 48 || tag.code === 75) {
          this.#define({ type: 'font', ...parseDefineFont(tag) });
        } else if (tag.code === 11 || tag.code === 33) {
          // 静的テキストは、グリフを並べた図形として扱う。
          const text = parseDefineText(tag);
          this.#define({ type: 'shape', id: text.id, bounds: text.bounds, paths: textToPaths(text, this.#font) });
        } else if (tag.code === 37) {
          const edit = parseDefineEditText(tag);
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
  constructor(character, depth, desc) {
    this.character = character;
    this.depth = depth;
    this.apply(desc);
  }

  /** PlaceObject で決まる属性を反映する。 */
  apply(desc) {
    this.matrix = desc.matrix;
    this.cxform = desc.cxform; // null は変換なし
    this.ratio = desc.ratio;
    this.name = desc.name;
    this.clipDepth = desc.clipDepth;
    this.filters = desc.filters; // null はフィルタなし
    this.blendMode = desc.blendMode;
    this.visible = desc.visible;
  }

  /** 自分と子孫の数。 */
  count() {
    return 1;
  }
}

/** 自分のタイムラインと子を持つオブジェクト。ルートもこれ。 */
export class MovieClip extends DisplayObject {
  constructor(movie, character, depth = 0, desc = PLACE_DEFAULTS, level = 0) {
    super(character, depth, desc);
    this.movie = movie;
    this.level = level; // 入れ子の深さ（ルートが 0）
    this.frames = character.timeline;
    this.children = new Map(); // 深度 → DisplayObject
    this.currentFrame = 0; // 1 始まり。0 はまだ何も実行していない
    this.playing = true;
    if (this.frames.length > 0) this.#runFrame(1);
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

  /** 1 フレーム進める。最終フレームの次は 1 フレーム目へ戻る。 */
  advance() {
    // このフレームで新しく置かれる子は 1 フレーム目を表示したままにするので、先に今いる子を控える。
    const clips = [...this.children.values()].filter((c) => c instanceof MovieClip);
    if (this.playing && this.frames.length > 1) {
      if (this.currentFrame < this.frames.length) this.#runFrame(this.currentFrame + 1);
      else this.#rewind(1);
    }
    for (const clip of clips) {
      if (this.children.get(clip.depth) === clip) clip.advance();
    }
  }

  #runFrame(n) {
    this.currentFrame = n;
    for (const op of this.frames[n - 1]) {
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
        this.#instantiate(op.depth, desc);
      } else {
        child.apply(desc);
      }
    }
  }

  // 前のフレームへ戻る。1 フレーム目から target までを仮に実行して「あるべき表示リスト」を求め、
  // 深度とキャラクタが同じ子はそのまま残し（子のタイムラインは続きから進む）、それ以外を入れ替える。
  #rewind(target) {
    const wanted = new Map();
    for (let f = 0; f < target; f++) {
      for (const op of this.frames[f]) {
        if (op.op === 'remove') {
          wanted.delete(op.depth);
        } else {
          const desc = mergePlace(wanted.get(op.depth), op);
          if (desc) wanted.set(op.depth, desc);
        }
      }
    }
    for (const [depth, child] of [...this.children]) {
      const desc = wanted.get(depth);
      if (desc && desc.characterId === child.character.id) {
        child.apply(desc);
        wanted.delete(depth);
      } else {
        this.#remove(depth);
      }
    }
    for (const [depth, desc] of wanted) this.#instantiate(depth, desc);
    this.currentFrame = target;
  }

  #remove(depth) {
    const child = this.children.get(depth);
    if (!child) return;
    this.children.delete(depth);
    this.movie.instances -= child.count();
  }

  #instantiate(depth, desc) {
    const { movie } = this;
    const character = movie.dictionary.get(desc.characterId);
    if (!character) {
      movie.warn(`character ${desc.characterId} is not defined`);
      return;
    }
    // スプライトが参照できるのは、自分より前に定義されたキャラクタだけ（仕様 13 章）。
    // これで参照が循環せず、入れ子の深さは定義の数で頭打ちになる。
    if (character.order >= this.character.order) {
      movie.warn(`sprite ${this.character.id} cannot place character ${character.id} defined after it`);
      return;
    }
    if (character.type !== 'sprite' && character.type !== 'shape' && character.type !== 'morph') {
      movie.warn(`character ${character.id} (${character.type}) cannot be placed`);
      return;
    }
    if (movie.instances >= movie.maxInstances) {
      movie.warn(`too many display objects (limit ${movie.maxInstances})`);
      return;
    }
    // 生成は再帰するので、スタックを使い切らない深さで打ち切る。
    if (character.type === 'sprite' && this.level >= MAX_NESTING) {
      movie.warn(`sprites are nested deeper than ${MAX_NESTING} levels`);
      return;
    }
    movie.instances++;
    const child = character.type === 'sprite'
      ? new MovieClip(movie, character, depth, desc, this.level + 1)
      : new DisplayObject(character, depth, desc);
    this.children.set(depth, child);
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
