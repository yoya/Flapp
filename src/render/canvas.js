// Canvas 2D による描画。表示リストをたどって描くだけで、状態は持たない（キャッシュを除く）。
//
// マスク・ブレンド・フィルタは、対象を別のキャンバス（レイヤー）に描いてから合成する。
//
// 9 分割拡大（DefineScalingGrid）は、実機の画面から求めた規則で描く: クリップの範囲（線を含む）を枠で 9 つに分け、
// 四隅は拡大せず、辺は一方向、中央は両方向に伸ばす。全体の大きさは普通に拡大したときと同じで、線幅は拡大しない。
// 縮めて四隅が入りきらないときは、四隅を入りきる比率で縮める（中央は幅 0）。対象はクリップ直下の図形と描画 API の内容で、
// 入れ子のクリップは普通に拡大する。倍率はステージから見たクリップの倍率で、回転や傾きがあるときは 9 分割せず普通に拡大する。
//
// バージョンの古い SWF（8 未満）のビットマップ塗りは、実機の画面から求めた規則で色を引く位置と補間を変える（#oldSampling）:
// メインのタイムラインが 2 フレーム以上あると補間しない、色を引く位置は装置の画素の左上の角で、バージョン 6 以下は
// 置く位置の小数を四捨五入する、など。
//
// グラデーションの範囲の外（reflect / repeat）は、描く範囲を覆う数だけ周期を並べた色の指定で描く。linearRGB は、
// 色の指定の間に、線形の色空間で補間した色を足して近づける。
//
// 未対応: 繰り返さないビットマップ塗りで画像から 1 画素より外側
//         （実機は縁の色で埋めるが、ここでは透明）、透明なレイヤー上での subtract。
import { MovieClip } from '../player/movie.js';
import { lift, multiply as multiply3D, project, transform as transform3D } from '../player/matrix3d.js';
import { applyFilters } from './filters.js';

const GRADIENT_HALF = 16384; // グラデーションは (-16384, -16384)〜(16384, 16384) の正方形で定義される
const IDENTITY_CX = null;
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
// マスクは形だけを使うので、色とアルファによらず不透明に描く。
const OPAQUE_CX = { rm: 256, gm: 256, bm: 256, am: 0, ra: 0, ga: 0, ba: 0, aa: 255 };
const TINT_CACHE_SIZE = 8;
const MAX_BLENDED_PIXELS = 1 << 24; // #blendRight で作る画像の画素数の上限
const MAX_GRADIENT_PERIODS = 256; // reflect / repeat のグラデーションで並べる周期の数の上限（その外は端の色）
const LINEAR_RGB_STEPS = 32; // linearRGB のグラデーションで、色の指定の間に足す色の数 + 1
const toLinear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

// Flash のブレンドモード → Canvas の合成方法（そのまま対応するもの）。
const COMPOSITE = {
  normal: 'source-over', layer: 'source-over', multiply: 'multiply', screen: 'screen', lighten: 'lighten',
  darken: 'darken', difference: 'difference', add: 'lighter', overlay: 'overlay', hardlight: 'hard-light',
  erase: 'destination-out',
};

const concat = (p, l) => ({
  a: p.a * l.a + p.c * l.b,
  b: p.b * l.a + p.d * l.b,
  c: p.a * l.c + p.c * l.d,
  d: p.b * l.c + p.d * l.d,
  tx: p.a * l.tx + p.c * l.ty + p.tx,
  ty: p.b * l.tx + p.d * l.ty + p.ty,
});
const domMatrix = (m) => new DOMMatrix([m.a, m.b, m.c, m.d, m.tx, m.ty]);

// 親の色変換 p の内側に子の色変換 c を合成する（子を先に適用）。null は変換なし。
function concatCx(p, c) {
  if (!p) return c;
  if (!c) return p;
  return {
    rm: (p.rm * c.rm) / 256, gm: (p.gm * c.gm) / 256, bm: (p.bm * c.bm) / 256, am: (p.am * c.am) / 256,
    ra: (p.rm * c.ra) / 256 + p.ra, ga: (p.gm * c.ga) / 256 + p.ga,
    ba: (p.bm * c.ba) / 256 + p.ba, aa: (p.am * c.aa) / 256 + p.aa,
  };
}

const clamp = (v) => Math.max(0, Math.min(255, Math.floor(v)));
function css(color, cx) {
  let { r, g, b, a } = color;
  if (cx) {
    r = clamp((r * cx.rm) / 256 + cx.ra);
    g = clamp((g * cx.gm) / 256 + cx.ga);
    b = clamp((b * cx.bm) / 256 + cx.ba);
    a = clamp((a * cx.am) / 256 + cx.aa);
  }
  return `rgba(${r},${g},${b},${a / 255})`;
}

// 端末のフォントの指定（CSS の font）。端末にある名前とは限らないので、名前から見当をつけた系統を後ろに付ける（実機の既定の
// "Times Roman" は明朝系）。r は { family, bold, italic, size }（size は描く単位の数）。
// 汎用の名前は、実機（mac）が使うフォントを先に挙げる。ブラウザの serif / sans-serif は、日本語の環境ではヒラギノになり、
// 字形も幅も実機と違う（実機の _sans の幅は Helvetica と同じ。test/as/textclip.as の画面で確認）。
const SANS = 'Helvetica, Arial, sans-serif', SERIF = 'Times, "Times New Roman", serif', MONO = 'Courier, "Courier New", monospace';
function deviceFont(r) {
  const generic = { _sans: SANS, _serif: SERIF, _typewriter: MONO, _ゴシック: SANS, _明朝: SERIF, _等幅: MONO, '_\x83S\x83V\x83b\x83N': 'Osaka, sans-serif' }[r.family];
  const fallback = /times|serif|georgia|garamond|palatino|book|mincho|明朝/i.test(r.family) ? SERIF : /courier|mono|consolas|typewriter/i.test(r.family) ? MONO : SANS;
  const family = generic ?? (r.family ? `"${r.family.replace(/["\\]/g, '')}", ${fallback}` : 'sans-serif');
  return `${r.italic ? 'italic ' : ''}${r.bold ? 'bold ' : ''}${r.size}px ${family}`;
}

// 段落の向き: 最初の強い文字（字）が右から左へ書く文字（ヘブライ・アラビアなど）なら rtl（Unicode の双方向の規則 P2。実機の画面で確認）。
// 文字の並べ替えは、ブラウザの fillText が同じ規則で行う。
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
function directionOf(text) {
  const strong = /\p{L}/u.exec(text);
  return strong && RTL.test(strong[0]) ? 'rtl' : 'ltr';
}

const resetTransform = (ctx) => ctx.setTransform(1, 0, 0, 1, 0, 0);
const domToMatrix = (m) => ({ a: m.a, b: m.b, c: m.c, d: m.d, tx: m.e, ty: m.f });

// 塗りの図形（op.path）が届く範囲を、塗りの定義空間（space はそこから図形への行列）での外接矩形 { x0, y0, x1, y1 } にする。
function reachOf(op, space) {
  const inv = space.inverse();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const cmd of op.path) {
    for (let i = 1; i + 1 < cmd.length; i += 2) {
      const p = inv.transformPoint(new DOMPoint(cmd[i], cmd[i + 1]));
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/**
 * 圧縮された画像（JPEG / PNG / GIF）を、乗算済みでない RGBA の画素にする（Movie.load の decodeImage オプション）。ブラウザのデコーダを使う。
 * @param {{ bytes: Uint8Array, type: string }} encoded
 */
export async function decodeImage({ bytes, type }) {
  const image = await createImageBitmap(new Blob([bytes], { type }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, rgba: ctx.getImageData(0, 0, image.width, image.height).data };
}

export class CanvasRenderer {
  /** @param {HTMLCanvasElement | OffscreenCanvas} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.compiled = new WeakMap(); // 描画命令の配列 → Path2D 化したもの
    this.sliced = new WeakMap(); // 描画命令の配列 → 9 分割拡大の座標に移したもの { key, paths }
    this.slice = null; // 9 分割拡大で描いているクリップ { clip, x, y, m }
    this.bitmaps = new WeakMap(); // ビットマップ定義 → 描画に使える画像
    this.tinted = new WeakMap(); // ビットマップ定義 → Map(色変換 → 変換済みの画像)
    this.padded = new WeakMap(); // 画像 → 縁を 1 画素延ばした画像
    this.clamped = new WeakMap(); // 画像 → { 延ばす量 → 縁を延ばした画像 }
    this.decoding = new WeakSet(); // 復号を始めたビットマップ定義（読み込んだ画像など、prepare の後で現れたもの）
    this.decodes = new Set(); // 済んでいない復号（Promise）
    this.blended = new WeakMap(); // 画像 → { z, image }: 実機と同じに、横方向に右隣の画素を混ぜて拡大した画像（#blendRight）
    this.layers = []; // 使い回すレイヤー
  }

  /**
   * JPEG / PNG / GIF のビットマップを復号する。これを待たずに描くと、それらの塗りは描かれない。
   * @param {import('../player/movie.js').Movie} movie
   */
  async prepare(movie) {
    // テキストの折り返しのために、端末のフォントでの文字の幅（twips）を測る関数を渡す。
    const probe = new OffscreenCanvas(1, 1).getContext('2d');
    const widths = new Map();
    movie.measureText = (ch, f, family = f.font) => {
      const font = deviceFont({ family, bold: f.bold, italic: f.italic, size: f.size * 20 });
      const key = `${font}|${ch}`;
      let w = widths.get(key);
      if (w === undefined) {
        probe.font = font;
        w = probe.measureText(ch).width;
        widths.set(key, w);
      }
      return w;
    };
    for (const def of movie.dictionary.values()) {
      if (def.type !== 'bitmap' || !def.encoded || this.bitmaps.has(def)) continue;
      try {
        const image = await createImageBitmap(new Blob([def.encoded.bytes], { type: def.encoded.type }));
        this.bitmaps.set(def, def.alpha ? withAlpha(image, def.alpha) : image);
      } catch (e) {
        movie.warn(`bitmap ${def.id} cannot be decoded: ${e.message}`);
      }
    }
  }

  /**
   * 現在の表示リストを描く。
   * @param {import('../player/movie.js').Movie} movie
   * @param {number} [scale] ステージ 1px あたりのデバイスピクセル数
   */
  render(movie, scale = 1) {
    const { ctx, canvas } = this;
    const { xmin, xmax, ymin, ymax } = movie.frameSize;
    const width = Math.round(((xmax - xmin) / 20) * scale);
    const height = Math.round(((ymax - ymin) / 20) * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      this.layers = [];
    }
    resetTransform(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(movie.backgroundColor ?? { r: 255, g: 255, b: 255, a: 255 }, null);
    ctx.fillRect(0, 0, width, height);

    this.movie = movie;
    this.scale = scale;
    const twipsToPixels = { a: scale / 20, b: 0, c: 0, d: scale / 20, tx: (-xmin * scale) / 20, ty: (-ymin * scale) / 20 };
    this.base = twipsToPixels;
    this.w3 = null; // 3D の部分木を描いている間の、親のワールドの 3D の行列（px）
    // ルートにもスクリプトが位置や色変換を設定できる（_root._x など）。
    // AS3 のムービーは、ステージの子（ルートと、スクリプトがステージに直接入れたもの）を描く。
    // AS1 / AS2 のムービーは、レベル（_level0 がルート。loadMovieNum で読み込んだものは、その上に重なる）を番号の小さい順に描く。
    if (movie.stage) this.#drawContent(ctx, movie.stage, twipsToPixels, IDENTITY_CX, false);
    else {
      for (const level of movie.levelsFromTop().reverse()) {
        if (level.visible) this.#drawContent(ctx, level, concat(twipsToPixels, level.matrix), concatCx(IDENTITY_CX, level.cxform), false);
      }
    }
  }

  /** Movie.load の rasterize オプションに渡す関数（AS3 の BitmapData.draw が、表示オブジェクトを画像にするのに使う）。 */
  rasterizer() {
    return (movie, d, m, width, height) => this.#rasterize(movie, d, m, width, height);
  }

  /**
   * 表示オブジェクト d の中身を、幅 width・高さ height の画像に描いて、その RGBA を返す。
   * m は、d の座標（ピクセル）から画像の画素への行列。d 自身の位置や変形は使わない。
   */
  #rasterize(movie, d, m, width, height) {
    const sub = new CanvasRenderer(new OffscreenCanvas(width, height));
    Object.assign(sub, { movie, scale: 1, compiled: this.compiled, sliced: this.sliced, bitmaps: this.bitmaps, tinted: this.tinted, padded: this.padded, blended: this.blended, decoding: this.decoding, decodes: this.decodes });
    sub.base = { a: m.a / 20, b: m.b / 20, c: m.c / 20, d: m.d / 20, tx: m.tx, ty: m.ty };
    sub.#drawContent(sub.ctx, d, sub.base, IDENTITY_CX, false);
    return sub.ctx.getImageData(0, 0, width, height).data;
  }

  // children[start] 以降のうち、深度が maxDepth 以下のものを描く。描き終えた位置を返す。
  #drawChildren(ctx, children, start, maxDepth, matrix, cx, mask) {
    let i = start;
    while (i < children.length && children[i].depth <= maxDepth) {
      const child = children[i++];
      if (!child.clipDepth) {
        this.#drawObject(ctx, child, matrix, cx, mask);
        continue;
      }
      // クリップ層: 自分は描かれず、深度が clipDepth までの後続を自分の形で切り抜く。
      if (i >= children.length || children[i].depth > Math.min(child.clipDepth, maxDepth)) continue;
      const content = this.#acquireLayer();
      i = this.#drawChildren(content.ctx, children, i, Math.min(child.clipDepth, maxDepth), matrix, cx, mask);
      const shape = this.#acquireLayer();
      this.#drawObject(shape.ctx, child, matrix, OPAQUE_CX, true);
      this.#composite(content.ctx, shape, 'destination-in');
      this.#composite(ctx, content, 'source-over');
      this.#releaseLayer(shape);
      this.#releaseLayer(content);
    }
    return i;
  }

  #drawObject(ctx, child, parentMatrix, parentCx, mask) {
    if (!child.visible) return;
    // setMask で他のクリップのマスクになっているクリップは、それ自体は描かれない。
    if (!mask && child.maskFor && !child.maskFor.removed && child.maskFor.maskedBy === child) return;
    // setMask でマスクを付けられたクリップは、マスクのクリップの形で切り抜く。
    const masker = mask || child.maskDrawing ? null : child.maskedBy;
    if (masker && !masker.removed) {
      const content = this.#acquireLayer();
      child.maskDrawing = true; // 中身を描く間は、マスクをかけない（再帰でここへ戻らないように。maskedBy は保つので、自分の子のマスクは描かれない）
      this.#drawObject(content.ctx, child, parentMatrix, parentCx, false);
      child.maskDrawing = false;
      const shape = this.#acquireLayer();
      const parent = masker.parent ? concat(this.base, masker.parent.worldMatrix()) : this.base;
      this.#drawContent(shape.ctx, masker, concat(parent, masker.matrix), OPAQUE_CX, true); // マスクは _visible が偽でも効く
      this.#composite(content.ctx, shape, 'destination-in');
      this.#composite(ctx, content, 'source-over');
      this.#releaseLayer(shape);
      this.#releaseLayer(content);
      return;
    }
    if (child.t3 || this.w3) { this.#draw3D(ctx, child, parentMatrix, concatCx(parentCx, child.cxform), mask); return; }
    const m = concat(parentMatrix, child.matrix);
    const cx = concatCx(parentCx, child.cxform);
    // 不透明な背景色: 中身の外接矩形（自分の座標系）を、その色で塗る。色変換はかからない（実機で確認）。
    const background = mask ? null : child.opaqueBackground;
    const box = background !== null && background !== undefined && child.bounds(IDENTITY);
    if (box) {
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
      ctx.fillStyle = `#${background.toString(16).padStart(6, '0')}`;
      ctx.fillRect(box.xmin, box.ymin, box.xmax - box.xmin, box.ymax - box.ymin);
      resetTransform(ctx);
    }
    // マスクの形を描くときは、ブレンドとフィルタは意味を持たない。
    const blend = mask ? 'normal' : child.blendMode;
    const filters = mask ? null : child.filters;
    // scrollRect: 矩形（自分の座標系、px）の範囲だけを見せ、その左上を原点に置く。
    const body = (target) => {
      const sr = mask ? null : child.scrollRect;
      if (!sr) { this.#drawContent(target, child, m, cx, mask); return; }
      target.save();
      target.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
      target.beginPath();
      target.rect(0, 0, sr.width * 20, sr.height * 20);
      target.clip();
      resetTransform(target);
      this.#drawContent(target, child, concat(m, { a: 1, b: 0, c: 0, d: 1, tx: -sr.x * 20, ty: -sr.y * 20 }), cx, mask);
      target.restore();
    };
    if (blend === 'normal' && !filters?.length) {
      body(ctx);
      return;
    }
    // alpha と erase は下のアルファを削る合成で、layer の中でだけ意味を持つ。
    // 最終出力に直接かかる場合は何も描かない（実機での挙動は未確認）。
    if ((blend === 'alpha' || blend === 'erase') && ctx === this.ctx) return;
    const layer = this.#acquireLayer();
    body(layer.ctx);
    if (filters?.length) {
      const { width, height } = layer.canvas;
      const image = layer.ctx.getImageData(0, 0, width, height);
      const b = filters.some((f) => f.type === 'displacement') ? child.bounds(m) : null; // 変位マップは、外接矩形を基準にする
      const result = applyFilters(image.data, width, height, filters, this.scale, b && { x0: b.xmin, y0: b.ymin, x1: b.xmax, y1: b.ymax });
      layer.ctx.putImageData(new ImageData(result.rgba, width, height), 0, 0);
      for (const type of result.unsupported) {
        if (!this.movie.warnings.includes(`filter ${type} is not supported`)) this.movie.warn(`filter ${type} is not supported`);
      }
    }
    if (blend === 'alpha') {
      // 上のオブジェクトが覆う範囲だけ、下のアルファに上のアルファを掛ける（覆わない範囲は変えない）。
      // 下 × 上のアルファ と 下 × (1 - 覆う範囲) を別々に作って足す。
      const coverage = this.#acquireLayer();
      this.#drawContent(coverage.ctx, child, m, concatCx(OPAQUE_CX, cx), mask);
      const kept = this.#acquireLayer();
      this.#composite(kept.ctx, { canvas: ctx.canvas }, 'source-over');
      this.#composite(kept.ctx, layer, 'destination-in');
      this.#composite(ctx, coverage, 'destination-out');
      this.#composite(ctx, kept, 'lighter');
      this.#releaseLayer(kept);
      this.#releaseLayer(coverage);
    } else if (blend === 'invert') {
      // 重なった部分の下の色を反転する: レイヤーを同じアルファの白にして difference で重ねる。
      resetTransform(layer.ctx);
      layer.ctx.globalCompositeOperation = 'source-in';
      layer.ctx.fillStyle = '#fff';
      layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
      this.#composite(ctx, layer, 'difference');
    } else if (blend === 'subtract') {
      // 下 - 上 = 反転(反転(下) + 上)。下が不透明な場合にだけ正しい。
      this.#invert(ctx);
      this.#composite(ctx, layer, 'lighter');
      this.#invert(ctx);
    } else {
      this.#composite(ctx, layer, COMPOSITE[blend] ?? 'source-over');
    }
    this.#releaseLayer(layer);
  }

  #drawContent(ctx, child, m, cx, mask) {
    if (child instanceof MovieClip) {
      const outer = this.slice;
      // スクリプトの scale9Grid（px）は、タグの拡大の枠（twips）より優先する。
      const g9 = child.scale9Grid;
      const grid = g9 ? { xmin: g9.x * 20, xmax: (g9.x + g9.width) * 20, ymin: g9.y * 20, ymax: (g9.y + g9.height) * 20 } : child.character?.scalingGrid;
      const box = grid && child.bounds(IDENTITY);
      const unit = Math.hypot(this.base.a, this.base.b);
      const sx = Math.hypot(m.a, m.b) / unit;
      const sy = Math.hypot(m.c, m.d) / unit;
      if (box && sx > 0 && sy > 0 && m.b === 0 && m.c === 0) {
        // 1 つの軸の写像: 範囲 lo..hi を、枠 a..b で 3 つに分ける。s は倍率。
        const axis = (lo, hi, a, b, s) => {
          a = Math.min(Math.max(a, lo), hi);
          b = Math.min(Math.max(b, a), hi);
          const fixed = a - lo + (hi - b);
          const k = fixed > 0 ? Math.min(1, ((hi - lo) * s) / fixed) : 1;
          const left = lo * s + (a - lo) * k;
          const right = hi * s - (hi - b) * k;
          return (v) => (v <= a ? lo * s + (v - lo) * k : v >= b ? hi * s - (hi - v) * k : left + ((v - a) * (right - left)) / (b - a));
        };
        this.slice = {
          clip: child, key: `${sx},${sy},${box.xmin},${box.xmax},${box.ymin},${box.ymax}`,
          x: axis(box.xmin, box.xmax, grid.xmin, grid.xmax, sx), y: axis(box.ymin, box.ymax, grid.ymin, grid.ymax, sy),
          sx, sy, m: concat(m, { a: 1 / sx, b: 0, c: 0, d: 1 / sy, tx: 0, ty: 0 }),
        };
      } else this.slice = null;
      const drawn = child.drawingPaths(); // 描画 API で描いた内容は子の下
      if (drawn && this.slice) this.#drawShape(ctx, this.#sliced(drawn, IDENTITY), this.slice.m, cx, mask);
      else if (drawn) this.#drawShape(ctx, drawn, m, cx, mask);
      this.#drawChildren(ctx, child.sortedChildren(), 0, Infinity, m, cx, mask);
      this.slice = outer;
    } else if (child.character.type === 'shape') {
      if (this.slice?.clip === child.parent) this.#drawShape(ctx, this.#sliced(child.character.paths, child.matrix), this.slice.m, cx, mask);
      else this.#drawShape(ctx, child.character.paths, m, cx, mask);
    } else if (child.character.type === 'edittext' || child.character.type === 'video') {
      this.#drawShape(ctx, child.paths(), m, cx, mask);
    } else if (child.character.type === 'morph') {
      this.#drawShape(ctx, child.character.pathsAt(child.ratio), m, cx, mask);
    }
  }

  // --- 3D ---

  /**
   * 3D の表示オブジェクト（と、その中のもの）: 自分の中身を平面の画像に描き、ワールドの 3D の行列で写して透視投影した位置へ、
   * 格子の三角形ごとに貼る。子は、自分の行列を親として、同じように描く（入れ子の 3D も、射影の前に合成される。実機の画面で確認）。
   * 3D の部分木の中では、フィルタ・ブレンド・マスク・scrollRect・9 分割拡大は掛けない。
   */
  #draw3D(ctx, child, parentMatrix, cx, mask) {
    const parentW = this.w3 ?? (() => {
      const toStage = concat(domToMatrix(new DOMMatrix([this.base.a, this.base.b, this.base.c, this.base.d, this.base.tx, this.base.ty]).inverse()), parentMatrix);
      return lift({ ...toStage, tx: toStage.tx / 20, ty: toStage.ty / 20 });
    })();
    const W = multiply3D(parentW, child.local3D() ?? lift({ ...child.matrix, tx: child.matrix.tx / 20, ty: child.matrix.ty / 20 }));
    const { center, focal } = this.movie.projection(child);
    const toDevice = (x, y) => {
      const p = project(transform3D(W, x, y, 0, 1), center, focal);
      return p && { x: this.base.a * p.x * 20 + this.base.c * p.y * 20 + this.base.tx, y: this.base.b * p.x * 20 + this.base.d * p.y * 20 + this.base.ty };
    };
    const paths = child instanceof MovieClip ? child.drawingPaths() : child.character.type === 'shape' ? child.character.paths
      : child.character.type === 'morph' ? child.character.pathsAt(child.ratio) : child.paths?.();
    const b = paths?.length && child.bounds(IDENTITY);
    if (b && b.xmax > b.xmin && b.ymax > b.ymin) this.#warp(ctx, paths, b, toDevice, cx, mask);
    if (child instanceof MovieClip) {
      const saved = this.w3;
      this.w3 = W;
      this.#drawChildren(ctx, child.sortedChildren(), 0, Infinity, parentMatrix, cx, mask);
      this.w3 = saved;
    }
  }

  // paths（自分の座標、twips）を画像に描き、外接矩形 b を格子に分けて、toDevice（自分の座標の px → 装置の画素）で写した三角形に貼る。
  #warp(ctx, paths, b, toDevice, cx, mask) {
    const [x0, y0, x1, y1] = [b.xmin / 20, b.ymin / 20, b.xmax / 20, b.ymax / 20];
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => toDevice(x, y));
    if (corners.some((p) => !p)) return;
    // 画像の解像度: 写した先の辺の長さに合わせる（1 辺 2048 画素まで）。
    const side = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    const k = Math.min(8, Math.max(0.05, Math.max(side(corners[0], corners[1]), side(corners[3], corners[2])) / (x1 - x0), Math.max(side(corners[0], corners[3]), side(corners[1], corners[2])) / (y1 - y0)));
    const tw = Math.min(2048, Math.ceil((x1 - x0) * k) + 2), th = Math.min(2048, Math.ceil((y1 - y0) * k) + 2);
    const kx = (tw - 2) / (x1 - x0), ky = (th - 2) / (y1 - y0);
    const texture = new OffscreenCanvas(tw, th);
    const tctx = texture.getContext('2d');
    const outer = this.slice;
    this.slice = null;
    this.#drawShape(tctx, paths, { a: kx / 20, b: 0, c: 0, d: ky / 20, tx: 1 - x0 * kx, ty: 1 - y0 * ky }, cx, mask);
    this.slice = outer;
    const N = 8;
    const grid = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = x0 + ((x1 - x0) * i) / N, v = y0 + ((y1 - y0) * j) / N;
      grid.push({ s: toDevice(u, v), t: { x: 1 + (u - x0) * kx, y: 1 + (v - y0) * ky } });
    }
    const at = (i, j) => grid[j * (N + 1) + i];
    // 三角形は、継ぎ目が見えないよう少し重ねて貼る。重なったところの半透明が濃くならないよう、別の画像に「置き換え」で貼ってから重ねる。
    const layer = this.#acquireLayer();
    layer.ctx.globalCompositeOperation = 'copy';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      for (const tri of [[at(i, j), at(i + 1, j), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)]]) {
        if (tri.some((p) => !p.s)) continue;
        this.#triangle(layer.ctx, texture, tri);
      }
    }
    layer.ctx.globalCompositeOperation = 'source-over';
    resetTransform(layer.ctx);
    this.#composite(ctx, layer, 'source-over');
    this.#releaseLayer(layer);
  }

  // 画像 texture の三角形（各頂点の t）を、装置の三角形（s）へ、アフィン変換で貼る（継ぎ目が見えないよう、少し外へ広げて切り抜く）。
  #triangle(ctx, texture, [p, q, r]) {
    const [s0, s1, s2] = [p.s, q.s, r.s], [t0, t1, t2] = [p.t, q.t, r.t];
    const det = (t1.x - t0.x) * (t2.y - t0.y) - (t2.x - t0.x) * (t1.y - t0.y);
    if (!det) return;
    const a = ((s1.x - s0.x) * (t2.y - t0.y) - (s2.x - s0.x) * (t1.y - t0.y)) / det;
    const c = ((s2.x - s0.x) * (t1.x - t0.x) - (s1.x - s0.x) * (t2.x - t0.x)) / det;
    const bb = ((s1.y - s0.y) * (t2.y - t0.y) - (s2.y - s0.y) * (t1.y - t0.y)) / det;
    const d = ((s2.y - s0.y) * (t1.x - t0.x) - (s1.y - s0.y) * (t2.x - t0.x)) / det;
    const e = s0.x - a * t0.x - c * t0.y, f = s0.y - bb * t0.x - d * t0.y;
    const cxm = (s0.x + s1.x + s2.x) / 3, cym = (s0.y + s1.y + s2.y) / 3;
    const grow = (pt) => { const dx = pt.x - cxm, dy = pt.y - cym, l = Math.hypot(dx, dy) || 1; return [pt.x + (dx / l) * 0.6, pt.y + (dy / l) * 0.6]; };
    ctx.save();
    resetTransform(ctx);
    ctx.beginPath();
    ctx.moveTo(...grow(s0));
    ctx.lineTo(...grow(s1));
    ctx.lineTo(...grow(s2));
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, bb, c, d, e, f);
    ctx.drawImage(texture, 0, 0);
    ctx.restore();
  }

  // --- レイヤー ---

  #acquireLayer() {
    const layer = this.layers.pop();
    if (layer) {
      resetTransform(layer.ctx);
      layer.ctx.globalCompositeOperation = 'source-over';
      layer.ctx.globalAlpha = 1;
      layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      return layer;
    }
    const canvas = new OffscreenCanvas(this.canvas.width, this.canvas.height);
    return { canvas, ctx: canvas.getContext('2d') };
  }

  #releaseLayer(layer) {
    this.layers.push(layer);
  }

  #composite(ctx, layer, operation) {
    resetTransform(ctx);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = operation;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  #invert(ctx) {
    resetTransform(ctx);
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  // --- 図形 ---

  #compile(paths) {
    let ops = this.compiled.get(paths);
    if (ops) return ops;
    ops = paths.map((op) => {
      if (op.kind === 'text' || op.kind === 'unclip') return op;
      const path = new Path2D();
      for (const cmd of op.path) {
        if (cmd[0] === 'M') path.moveTo(cmd[1], cmd[2]);
        else if (cmd[0] === 'L') path.lineTo(cmd[1], cmd[2]);
        else if (cmd[0] === 'Q') path.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
        else path.closePath();
      }
      const compiled = { ...op, path2d: path };
      const style = op.style;
      if (op.kind === 'fill' && style.matrix) {
        // グラデーションとビットマップは、その定義空間で塗る。パスを逆行列でその空間へ移しておく。
        const space = domMatrix(style.matrix);
        if (space.a * space.d - space.b * space.c !== 0) {
          compiled.spaceMatrix = space;
          compiled.spacePath = new Path2D();
          compiled.spacePath.addPath(path, space.inverse());
        }
      }
      return compiled;
    });
    this.compiled.set(paths, ops);
    return ops;
  }

  // 図形の描画命令を、行列 matrix でクリップの座標へ移してから、9 分割拡大の写像（this.slice）で移す。
  // 塗りのグラデーションとビットマップは、普通に拡大したときと同じ向きと大きさにする。
  #sliced(paths, matrix) {
    const { x, y, sx, sy } = this.slice;
    const key = `${this.slice.key},${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.tx},${matrix.ty}`;
    const cached = this.sliced.get(paths);
    if (cached?.key === key) return cached.paths;
    const point = (px, py) => [x(matrix.a * px + matrix.c * py + matrix.tx), y(matrix.b * px + matrix.d * py + matrix.ty)];
    const result = paths.map((op) => {
      if (op.kind === 'text' || op.kind === 'unclip') return op;
      const path = op.path.map((cmd) =>
        cmd[0] === 'M' || cmd[0] === 'L' ? [cmd[0], ...point(cmd[1], cmd[2])] : cmd[0] === 'Q' ? ['Q', ...point(cmd[1], cmd[2]), ...point(cmd[3], cmd[4])] : cmd);
      const stretch = (style) => (style.matrix ? { ...style, matrix: concat({ a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 }, concat(matrix, style.matrix)) } : style);
      const style = op.kind === 'stroke' && op.style.fill ? { ...op.style, fill: stretch(op.style.fill) } : stretch(op.style);
      return { ...op, path, style };
    });
    this.sliced.set(paths, { key, paths: result });
    return result;
  }

  #drawShape(ctx, paths, m, cx, mask) {
    for (const op of this.#compile(paths)) {
      if (op.kind === 'clip') { ctx.save(); ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty); ctx.clip(op.path2d); } // clip 〜 unclip の間は、その範囲にだけ描く
      else if (op.kind === 'unclip') ctx.restore();
      else if (op.kind === 'fill') this.#fill(ctx, op, m, cx);
      else if (op.kind === 'text') this.#text(ctx, op, m, cx);
      else if (!mask) this.#stroke(ctx, op, m, cx); // マスクでは線は形に含めない
    }
    resetTransform(ctx);
  }

  #fill(ctx, op, m, cx) {
    const { style } = op;
    const rule = op.evenOdd ? 'evenodd' : 'nonzero';
    ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    if (style.type === 'solid') {
      ctx.fillStyle = css(style.color, cx);
      ctx.fill(op.path2d, rule);
      return;
    }
    const space = op.spaceMatrix;
    if (!space && style.type !== 'bitmap') {
      // 行列がつぶれたグラデーションは最後の色で塗りつぶす。
      ctx.fillStyle = css(style.stops.at(-1)?.color ?? { r: 0, g: 0, b: 0, a: 0 }, cx);
      ctx.fill(op.path2d, rule);
      return;
    }
    if (!space) return;
    ctx.transform(space.a, space.b, space.c, space.d, space.e, space.f);
    if (this.#paint(ctx, style, cx, m, style.type === 'bitmap' && !style.repeat ? reachOf(op, space) : null)) ctx.fill(op.spacePath, rule);
    ctx.globalAlpha = 1;
  }

  // バージョンの古い SWF の、ビットマップ塗りの色を引く位置のずれ（実機の画面から求めた規則。ビットマップの画素の単位で返す）。
  //   バージョン 8 以降: 装置の画素の中心で引く（Canvas の標準）。
  //   バージョン 7 以前: 装置の画素の左上の角で引く。補間なしでは、絵が装置の画素で 0.5 だけ右下へ動いて見える。
  //     境目にちょうど乗った点は、バージョン 7 では後ろの、6 以前では 1 つ手前のビットマップの画素になる（わずかに動かす量を変えて再現する）。
  //     補間ありでは、ビットマップの画素の左上の角を基準に補間する（拡大率 s のとき、絵が装置の画素で (s - 1) / 2 だけ
  //     左上へ動いて見える。s = 1 なら同じ）。
  //   バージョン 6 以前は、図形を置く位置（world の平行移動）の小数が、装置の画素へ四捨五入された位置を、ビットマップの
  //     原点にする（図形の縁は小数のまま）。塗りの行列の小数は丸められない。world は、図形を置く行列（装置の画素）。
  //   バージョン 6 以前は、等倍（装置の画素とビットマップの画素が 1 対 1）のビットマップは、補間ありの指定でも補間しない
  //     （補間なしと同じ規則になる）。
  //   バージョン 8 未満は、メインのタイムラインが 2 フレーム以上ある（アニメーションする）SWF では、補間ありの指定でも
  //     補間しない（旧版の「画質 HIGH では、アニメーションが無いときだけ補間する」規則。スプライトの中のアニメーションは数えない。
  //     stop で止まっていても、フレーム数で決まる）。
  //   返す nearest が真なら、補間なしで描く。
  #oldSampling(ctx, style, world) {
    const version = this.movie.version;
    const m = ctx.getTransform();
    const inverse = new DOMMatrix([m.a, m.b, m.c, m.d, 0, 0]).inverse();
    // 補間なしで、ちょうど境目に乗る点が、割り切れる値の誤差でどちらへ倒れるかを決める量（装置の画素）。
    // 倒れる向きはバージョン 8 以降と 7 は後ろの、6 以前は 1 つ手前のビットマップの画素。
    const shift = (k, rx, ry) => { const p = inverse.transformPoint(new DOMPoint(k + rx, k + ry)); return { du: p.x, dv: p.y }; };
    if (version >= 8) return style.smooth ? { du: 0, dv: 0 } : { ...shift(-1e-3, 0, 0), nearest: true };
    // 置く位置を丸める分（装置の画素）。
    const rx = version <= 6 && world ? Math.round(world.tx) - world.tx : 0, ry = version <= 6 && world ? Math.round(world.ty) - world.ty : 0;
    const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d); // ビットマップの 1 画素あたりの装置の画素数
    const unit = version <= 6 && Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3 && Math.abs(m.b) < 1e-3 && Math.abs(m.c) < 1e-3;
    const animated = (this.movie.root?.totalFrames ?? 1) > 1;
    if (!style.smooth || unit || animated) return { ...shift(version <= 6 ? 0.5 + 1e-3 : 0.5 - 1e-3, rx, ry), nearest: true };
    if (!(sx > 0 && sy > 0)) return { du: 0, dv: 0 };
    const p = inverse.transformPoint(new DOMPoint(rx, ry));
    return { du: 0.5 / sx - 0.5 + p.x, dv: 0.5 / sy - 0.5 + p.y };
  }

  // グラデーションかビットマップの塗りを、ctx の fillStyle にする（ctx の変換は、塗りの定義空間に合わせておく）。
  // 描けない（未定義・未復号のビットマップ）なら偽。
  #paint(ctx, style, cx, world, reach = null) {
    if (style.type === 'bitmap') {
      const def = style.bitmap ?? this.movie.dictionary.get(style.bitmapId); // スクリプトが作ったビットマップは、直接持っている
      const source = def?.type === 'bitmap' && this.#bitmapSource(def, cx);
      if (!source) return false;
      const old = this.#oldSampling(ctx, style, world);
      ctx.imageSmoothingEnabled = style.smooth && !old.nearest;
      ctx.globalAlpha = source.alpha;
      const blended = style.blendRight && !style.smooth && this.#blendRight(ctx, source.image);
      if (blended) {
        // 横方向は、装置の画素に合わせて拡大済みの画像を使う。
        const pattern = ctx.createPattern(blended.image, 'no-repeat');
        pattern.setTransform(new DOMMatrix([1 / blended.z, 0, 0, 1, 0, 0]));
        ctx.fillStyle = pattern;
      } else if (style.repeat) {
        const pattern = ctx.createPattern(source.image, 'repeat');
        if (old.du || old.dv) pattern.setTransform(new DOMMatrix([1, 0, 0, 1, old.du, old.dv]));
        ctx.fillStyle = pattern;
      } else {
        // 繰り返さない塗りは、範囲の外を縁の画素の色で埋める（実機で確認）。塗る図形が届く範囲（reach。ビットマップの画素の単位）まで、
        // 縁の画素を延ばした画像を使う（少なくとも 1 画素。そうしないと、縁が外側の透明と補間されて薄くなる）。
        const { image, left, top } = this.#clamped(source.image, reach);
        const pattern = ctx.createPattern(image, 'no-repeat');
        pattern.setTransform(new DOMMatrix([1, 0, 0, 1, old.du - left, old.dv - top]));
        ctx.fillStyle = pattern;
      }
      return true;
    }
    // 1 周期の色の指定（位置 0〜1）。周期の両端にも色を置く（繰り返したときに、隣の周期と補間されないように）。
    const stops = style.stops.map((stop) => ({ at: stop.ratio / 255, color: stop.color }));
    if (!stops.length) return false;
    if (stops[0].at > 0) stops.unshift({ at: 0, color: stops[0].color });
    if (stops.at(-1).at < 1) stops.push({ at: 1, color: stops.at(-1).color });
    if (style.linearRGB) {
      for (let i = stops.length - 1; i > 0; i--) {
        const [from, to] = [stops[i - 1], stops[i]];
        for (let k = LINEAR_RGB_STEPS - 1; k > 0; k--) {
          const t = k / LINEAR_RGB_STEPS;
          const mix = (c) => fromLinear(toLinear(from.color[c]) * (1 - t) + toLinear(to.color[c]) * t);
          stops.splice(i, 0, { at: from.at + (to.at - from.at) * t, color: { r: mix('r'), g: mix('g'), b: mix('b'), a: from.color.a * (1 - t) + to.color.a * t } });
        }
      }
    }
    // 範囲の外も描く場合は、描く範囲（キャンバス全体）を覆うだけの周期の数を求める。
    const focal = Math.max(-0.98, Math.min(0.98, style.focal));
    let periods = 1;
    if (style.spread !== 'pad') {
      const inverse = ctx.getTransform().inverse();
      const { width, height } = ctx.canvas;
      let reach = 0;
      for (const [px, py] of [[0, 0], [width, 0], [0, height], [width, height]]) {
        const p = inverse.transformPoint(new DOMPoint(px, py));
        // 線形は中心からの横の距離、放射は焦点からの距離で、その位置を含む円の大きさの上限を見積もる。
        reach = Math.max(reach, style.type === 'linear' ? Math.abs(p.x) / GRADIENT_HALF : Math.hypot(p.x - focal * GRADIENT_HALF, p.y) / (GRADIENT_HALF * (1 - Math.abs(focal))));
      }
      periods = style.type === 'linear' ? 2 * Math.ceil(Math.max(0, reach - 1) / 2) + 1 : Math.ceil(Math.max(1, reach));
      periods = Math.min(periods, MAX_GRADIENT_PERIODS + 1);
    }
    // 線形は中心の周期の両側に、放射は外側へ周期を並べる。折り返しは、中心から数えて奇数番目の周期を逆向きにする。
    const gradient = style.type === 'linear'
      ? ctx.createLinearGradient(-GRADIENT_HALF * periods, 0, GRADIENT_HALF * periods, 0)
      : ctx.createRadialGradient(focal * GRADIENT_HALF, 0, 0, (1 - periods) * focal * GRADIENT_HALF, 0, periods * GRADIENT_HALF);
    const center = style.type === 'linear' ? (periods - 1) / 2 : 0;
    let last = 0;
    for (let q = 0; q < periods; q++) {
      const mirrored = style.spread === 'reflect' && Math.abs(q - center) % 2 === 1;
      for (const stop of mirrored ? [...stops].reverse() : stops) {
        last = Math.max(last, (q + (mirrored ? 1 - stop.at : stop.at)) / periods); // Canvas は位置が戻る指定を受け付けない
        gradient.addColorStop(Math.min(1, last), css(stop.color, cx));
      }
    }
    ctx.fillStyle = gradient;
    return true;
  }

  #stroke(ctx, op, m, cx) {
    const { style } = op;
    // 線幅が変形で歪まないよう、パスをデバイス座標へ移してから等倍で描く。
    // 線幅の倍率は、対角方向の単位ベクトル (1, 1)/√2 が変形後に何倍の長さになるか（実機の画面から求めた規則。
    // 等倍・回転では 1、3 × 1 の拡大では √5、斜めの変形では面積比の平方根より小さくなる）。
    // 拡大縮小しない指定（実機の画面で確認）: 両方なら太さはデバイスピクセルのまま（ステージの拡大にも従わない）。noVScale だけなら横方向の
    // 拡大率、noHScale だけなら縦方向の拡大率で、向きによらず同じ太さになる。
    let objectScale = Math.hypot(m.a + m.c, m.b + m.d) / Math.SQRT2;
    if (style.noHScale && style.noVScale) objectScale = 1 / 20;
    else if (style.noVScale) objectScale = Math.hypot(m.a, m.b);
    else if (style.noHScale) objectScale = Math.hypot(m.c, m.d);
    // 実機に合わせる: 線幅は最小 1 デバイスピクセル。幅がデバイスピクセルの奇数のときは、
    // 縁が画素の境界に乗るよう半ピクセルずらす（2 倍解像度の実機の画面で確認した規則）。
    const width = Math.max(style.width * objectScale, 1);
    const rounded = Math.round(width);
    const snap = Math.abs(width - rounded) < 0.01 && rounded % 2 === 1 ? 0.5 : 0;
    const d = { ...m, tx: m.tx + snap, ty: m.ty + snap };
    const path = new Path2D();
    path.addPath(op.path2d, domMatrix(d));
    // グラデーションとビットマップの線は、線の形を別のレイヤーに描いてから、その形の中を塗る。
    const fill = style.fill && style.fill.type !== 'solid' ? style.fill : null;
    const space = fill && domMatrix(fill.matrix);
    const singular = space && space.a * space.d - space.b * space.c === 0;
    if (singular && fill.type === 'bitmap') return;
    const layer = space && !singular ? this.#acquireLayer() : null;
    const target = layer ? layer.ctx : ctx;
    resetTransform(target);
    target.lineWidth = width;
    target.lineJoin = style.join;
    target.miterLimit = style.miterLimit ?? 3;
    const color = style.color ?? (fill ? fill.stops?.at(-1)?.color : style.fill.color); // 行列がつぶれたグラデーションは最後の色
    target.strokeStyle = target.fillStyle = layer ? '#000' : css(color ?? { r: 0, g: 0, b: 0, a: 255 }, cx);
    if (style.startCap === style.endCap) {
      target.lineCap = style.startCap;
      target.stroke(path);
    } else {
      // 始端と終端でキャップが違う線: キャップなしで描いてから、閉じていない部分パスの両端にキャップを足す（実機で確認）。
      target.lineCap = 'butt';
      target.stroke(path);
      const subpaths = [];
      for (const cmd of op.path) {
        if (cmd[0] === 'Z') subpaths.at(-1).closed = true;
        else {
          if (cmd[0] === 'M') subpaths.push({ points: [], closed: false });
          for (let i = 1; i < cmd.length; i += 2) subpaths.at(-1).points.push([d.a * cmd[i] + d.c * cmd[i + 1] + d.tx, d.b * cmd[i] + d.d * cmd[i + 1] + d.ty]);
        }
      }
      for (const { points, closed } of subpaths) {
        if (closed) continue;
        for (const [cap, end, step] of [[style.startCap, 0, 1], [style.endCap, points.length - 1, -1]]) {
          if (cap === 'butt') continue;
          const [x, y] = points[end];
          let i = end + step;
          while (points[i] && points[i][0] === x && points[i][1] === y) i += step;
          if (cap === 'round' || !points[i]) {
            target.beginPath();
            target.arc(x, y, width / 2, 0, Math.PI * 2);
            if (cap === 'round') target.fill();
            continue;
          }
          // 四角: 端から外向きに、線幅の半分だけ延ばす。
          const len = Math.hypot(x - points[i][0], y - points[i][1]);
          const ux = ((x - points[i][0]) / len) * (width / 2);
          const uy = ((y - points[i][1]) / len) * (width / 2);
          target.beginPath();
          target.moveTo(x - uy, y + ux);
          target.lineTo(x - uy + ux, y + ux + uy);
          target.lineTo(x + uy + ux, y - ux + uy);
          target.lineTo(x + uy, y - ux);
          target.fill();
        }
      }
    }
    if (!layer) return;
    // 線の形の中を、塗りの定義空間で塗る（キャンバス全体を覆う矩形を、その空間で描く）。
    target.globalCompositeOperation = 'source-in';
    target.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    target.transform(space.a, space.b, space.c, space.d, space.e, space.f);
    if (this.#paint(target, fill, cx, m)) {
      const inverse = target.getTransform().inverse();
      const { width: w, height: h } = layer.canvas;
      const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([px, py]) => inverse.transformPoint(new DOMPoint(px, py)));
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      target.fillRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      target.globalAlpha = 1;
      this.#composite(ctx, layer, 'source-over');
    }
    this.#releaseLayer(layer);
  }

  // 埋め込みの字形が無いテキストを、端末のフォントで描く（実機と同じ見た目にはならない）。op.runs があれば、書式の違う文字の
  // まとまり（色・大きさ・太字・斜体・下線・字間）を、1 行に順に並べる。位置揃えは、測った幅の合計で決める。
  // op.ascent（行の上端から基準線まで）があれば、文字の基準線をそこにそろえる（実機と同じ。寸法は swf/text.js の deviceMetrics）。
  // 文字の大きさは、画面の画素で整数に丸めて描く（ちょうど半分なら偶数へ）。実機の BitmapData.draw で、縮めて描いた文字の幅が、丸めた大きさの幅と一致した
  // （18px を 0.8 倍 → 14px、0.75 倍 → 14px、1.25 倍 → 22px、1.37 倍 → 25px）。
  #text(ctx, op, m, cx) {
    ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    const scale = Math.hypot(m.c, m.d);
    const font = (r) => {
      const px = r.size * scale, low = Math.floor(px);
      const snapped = Math.abs(px - low - 0.5) < 1e-6 ? low + (low % 2) : Math.round(px);
      return deviceFont(scale > 0 ? { ...r, size: Math.max(1, snapped) / scale } : r);
    };
    const based = op.ascent !== undefined, y = based ? op.y + op.ascent : op.y;
    ctx.textBaseline = based ? 'alphabetic' : 'top';
    if ('direction' in ctx) ctx.direction = directionOf(op.runs ? op.runs.map((r) => r.text).join('') : op.text);
    if (!op.runs) {
      ctx.font = font(op);
      ctx.textAlign = 'left';
      ctx.fillStyle = css(op.color, cx);
      const extra = Math.max(0, op.width - ctx.measureText(op.text).width); // 枠より広い行は、揃え方によらず左端から並べる（実機で確認。test/as/textclip.as）
      ctx.fillText(op.text, op.x + (op.align === 'right' ? extra : op.align === 'center' ? extra / 2 : 0), y);
      if ('direction' in ctx) ctx.direction = 'ltr';
      return;
    }
    ctx.textAlign = 'left';
    const spaced = 'letterSpacing' in ctx;
    const widths = op.runs.map((r) => {
      ctx.font = font(r);
      if (spaced) ctx.letterSpacing = `${r.letterSpacing}px`;
      return ctx.measureText(r.text).width;
    });
    const total = widths.reduce((sum, w) => sum + w, 0);
    const extra = Math.max(0, op.width - total); // 枠より広い行は、揃え方によらず左端から並べる（実機で確認。test/as/textclip.as）
    let x = op.x + (op.align === 'right' ? extra : op.align === 'center' ? extra / 2 : 0);
    op.runs.forEach((r, i) => {
      ctx.font = font(r);
      if (spaced) ctx.letterSpacing = `${r.letterSpacing}px`;
      ctx.fillStyle = css(r.color, cx);
      ctx.fillText(r.text, x, y);
      if (r.underline) ctx.fillRect(x, based ? y + r.size * 0.27 : op.y + r.size * 1.02, widths[i], Math.max(r.size / 16, 20));
      x += widths[i];
    });
    if (spaced) ctx.letterSpacing = '0px';
    if ('direction' in ctx) ctx.direction = 'ltr';
  }

  // --- ビットマップ ---

  // 縁の画素を、上下左右に reach（{ x0, y0, x1, y1 }。ビットマップの画素の単位）の範囲まで延ばした画像と、元の画像の左上の位置。
  // 延ばす量は、少なくとも 1 画素、全体で 1 辺 4096 画素まで。
  #clamped(image, reach) {
    const { width: w, height: h } = image;
    const room = (n, size) => Math.max(1, Math.min(Math.ceil(n), Math.max(1, Math.floor((4096 - size) / 2))));
    const [left, top, right, bottom] = reach
      ? [room(-reach.x0, w), room(-reach.y0, h), room(reach.x1 - w, w), room(reach.y1 - h, h)]
      : [1, 1, 1, 1];
    if (left === 1 && top === 1 && right === 1 && bottom === 1) return { image: this.#padded(image), left: 1, top: 1 };
    const key = `${left},${top},${right},${bottom}`;
    let cache = this.clamped.get(image);
    if (!cache) this.clamped.set(image, (cache = new Map()));
    let out = cache.get(key);
    if (!out) {
      if (cache.size > 8) cache.clear();
      out = new OffscreenCanvas(w + left + right, h + top + bottom);
      const c = out.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(image, left, top);
      c.drawImage(image, 0, 0, 1, h, 0, top, left, h); // 左
      c.drawImage(image, w - 1, 0, 1, h, left + w, top, right, h); // 右
      c.drawImage(out, 0, top, out.width, 1, 0, 0, out.width, top); // 上（角を含む）
      c.drawImage(out, 0, top + h - 1, out.width, 1, 0, top + h, out.width, bottom); // 下（角を含む）
      cache.set(key, out);
    }
    return { image: out, left, top };
  }

  // 上下左右に 1 画素ずつ、縁の画素を複製した画像。
  #padded(image) {
    let padded = this.padded.get(image);
    if (padded) return padded;
    const { width: w, height: h } = image;
    padded = new OffscreenCanvas(w + 2, h + 2);
    const ctx = padded.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 1, 1);
    ctx.drawImage(image, 0, 0, 1, h, 0, 1, 1, h); // 左
    ctx.drawImage(image, w - 1, 0, 1, h, w + 1, 1, 1, h); // 右
    ctx.drawImage(padded, 0, 1, w + 2, 1, 0, 0, w + 2, 1); // 上（角を含む）
    ctx.drawImage(padded, 0, h, w + 2, 1, 0, h + 1, w + 2, 1); // 下（角を含む）
    this.padded.set(image, padded);
    return padded;
  }

  /**
   * 実機が、埋め込みの H.263 / VP6 のビデオを整数倍で描くときの絵を作る（Movie.load の matchPlayer を指定したときだけ使う）。
   * 実機は、横方向だけ、装置の各画素を「その画素 × 1/z ＋ 右隣の画素 × (1 − 1/z)」にする（z は、ビデオの 1 画素あたりの
   * 装置の画素数。右端は端の画素を延ばす）。ビデオの各画素の右端の 1 列だけが、右隣の画素と混ざることになる。
   * 実機の画面と、全画素で突き合わせて確かめた規則（なぜそうなるのかは分かっていない）。
   * 今の変換（ctx）で、回転が無く、ステージ上の拡大率が整数のときに、横に z 倍した画像を返す。それ以外は null（ふつうに描く）。
   */
  #blendRight(ctx, image) {
    const t = ctx.getTransform();
    const z = Math.round(t.a), zoom = Math.round(t.a / this.scale);
    if (t.b !== 0 || t.c !== 0 || z < 2 || Math.abs(t.a - z) > 1e-4 || zoom < 1 || Math.abs(t.a / this.scale - zoom) > 1e-4) return null;
    const { width: w, height: h } = image;
    if (w * z * h > MAX_BLENDED_PIXELS) return null;
    const cached = this.blended.get(image);
    if (cached?.z === z) return cached;
    const from = image.getContext('2d').getImageData(0, 0, w, h).data;
    const out = new ImageData(w * z, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const at = (y * w + x) * 4, next = (y * w + Math.min(x + 1, w - 1)) * 4;
        for (let i = 0; i < z; i++) {
          const to = (y * w * z + x * z + i) * 4;
          for (let k = 0; k < 4; k++) out.data[to + k] = i < z - 1 ? from[at + k] : Math.round(from[at + k] / z + from[next + k] * (1 - 1 / z));
        }
      }
    }
    const canvas = new OffscreenCanvas(w * z, h);
    canvas.getContext('2d').putImageData(out, 0, 0);
    const result = { z, image: canvas };
    this.blended.set(image, result);
    return result;
  }

  #decodeLater(def) {
    if (this.decoding.has(def)) return;
    this.decoding.add(def);
    const movie = this.movie;
    const done = createImageBitmap(new Blob([def.encoded.bytes], { type: def.encoded.type })).then((image) => {
      this.bitmaps.set(def, def.alpha ? withAlpha(image, def.alpha) : image);
    }, (e) => movie?.warn(`bitmap ${def.id} cannot be decoded: ${e.message}`));
    this.decodes.add(done);
    done.finally(() => this.decodes.delete(done));
  }

  /** 描いている途中で始めた画像の復号（読み込んだ画像など）が済むのを待つ。済んだら、描き直せば画像も描かれる。 */
  async decoded() {
    while (this.decodes.size) await Promise.all([...this.decodes]);
  }

  // 色変換を反映した画像と、描画時に掛けるアルファを返す。まだ復号されていなければ null。
  #bitmapSource(def, cx) {
    // ブラウザのデコーダが出したビデオの絵は、そのまま描ける画像として渡される（色変換は、アルファの乗算だけを反映する）。
    if (def.image) return { image: def.image, alpha: cx ? Math.max(0, Math.min(1, cx.am / 256)) : 1 };
    let image = this.bitmaps.get(def);
    // スクリプトが画素を書き換えたビットマップ（version が進んでいる）は、画像を作り直す。
    if (image && def.version !== undefined && image.version !== def.version) {
      image = null;
      this.tinted.delete(def);
    }
    if (!image) {
      // prepare の後で現れた JPEG / PNG / GIF（読み込んだ画像）は、ここで復号を始める。済むまでは描かない。
      if (def.encoded) {
        this.#decodeLater(def);
        return null;
      }
      if (!def.rgba) return null;
      image = new OffscreenCanvas(def.width, def.height);
      image.getContext('2d').putImageData(new ImageData(def.rgba, def.width, def.height), 0, 0);
      image.version = def.version;
      this.bitmaps.set(def, image);
    }
    if (!cx) return { image, alpha: 1 };
    // アルファの乗算だけなら、描画時のアルファで済む。
    if (cx.rm === 256 && cx.gm === 256 && cx.bm === 256 && !cx.ra && !cx.ga && !cx.ba && !cx.aa) {
      return { image, alpha: Math.max(0, Math.min(1, cx.am / 256)) };
    }
    let cache = this.tinted.get(def);
    if (!cache) this.tinted.set(def, (cache = new Map()));
    const key = `${cx.rm},${cx.gm},${cx.bm},${cx.am},${cx.ra},${cx.ga},${cx.ba},${cx.aa}`;
    let tinted = cache.get(key);
    if (!tinted) {
      if (cache.size >= TINT_CACHE_SIZE) cache.delete(cache.keys().next().value);
      tinted = pixelMap(image, (d, i) => {
        d[i] = clamp((d[i] * cx.rm) / 256 + cx.ra);
        d[i + 1] = clamp((d[i + 1] * cx.gm) / 256 + cx.ga);
        d[i + 2] = clamp((d[i + 2] * cx.bm) / 256 + cx.ba);
        d[i + 3] = clamp((d[i + 3] * cx.am) / 256 + cx.aa);
      });
      cache.set(key, tinted);
    }
    return { image: tinted, alpha: 1 };
  }
}

// 画像の各画素（乗算済みでない RGBA）を書き換えた新しいキャンバスを返す。
function pixelMap(image, fn) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.data.length; i += 4) fn(data.data, i);
  ctx.putImageData(data, 0, 0);
  return canvas;
}

// JPEG にアルファ（1 画素 1 バイト）を付ける。JPEG の色はアルファ乗算済みで入っている。
// 乗算済みなら色はアルファ以下のはずなので、超える値はアルファまで切り詰めてから乗算前に戻す。
function withAlpha(image, alpha) {
  let p = 0;
  return pixelMap(image, (d, i) => {
    const a = alpha[p++] ?? 0;
    const k = a === 0 ? 0 : 255 / a;
    d[i] = Math.min(d[i], a) * k;
    d[i + 1] = Math.min(d[i + 1], a) * k;
    d[i + 2] = Math.min(d[i + 2], a) * k;
    d[i + 3] = a;
  });
}
