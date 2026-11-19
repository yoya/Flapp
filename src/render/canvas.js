// Canvas 2D による描画。表示リストをたどって描くだけで、状態は持たない（キャッシュを除く）。
//
// マスク・ブレンド・フィルタは、対象を別のキャンバス（レイヤー）に描いてから合成する。
//
// 9 分割拡大（DefineScalingGrid）は、実機の画面から求めた規則で描く: クリップの範囲（線を含む）を枠で 9 つに分け、
// 四隅は拡大せず、辺は一方向、中央は両方向に伸ばす。全体の大きさは普通に拡大したときと同じで、線幅は拡大しない。
// 縮めて四隅が入りきらないときは、四隅を入りきる比率で縮める（中央は幅 0）。対象はクリップ直下の図形と描画 API の内容で、
// 入れ子のクリップは普通に拡大する。倍率はステージから見たクリップの倍率で、回転や傾きがあるときは 9 分割せず普通に拡大する。
//
// 未対応: グラデーションの reflect / repeat と linearRGB、繰り返さないビットマップ塗りで画像から 1 画素より外側
//         （実機は縁の色で埋めるが、ここでは透明）、透明なレイヤー上での subtract。
import { MovieClip } from '../player/movie.js';
import { applyFilters } from './filters.js';

const GRADIENT_HALF = 16384; // グラデーションは (-16384, -16384)〜(16384, 16384) の正方形で定義される
const IDENTITY_CX = null;
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
// マスクは形だけを使うので、色とアルファによらず不透明に描く。
const OPAQUE_CX = { rm: 256, gm: 256, bm: 256, am: 0, ra: 0, ga: 0, ba: 0, aa: 255 };
const TINT_CACHE_SIZE = 8;
const MAX_BLENDED_PIXELS = 1 << 24; // #blendRight で作る画像の画素数の上限

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

const resetTransform = (ctx) => ctx.setTransform(1, 0, 0, 1, 0, 0);

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
    const masker = mask ? null : child.maskedBy;
    if (masker && !masker.removed) {
      const content = this.#acquireLayer();
      child.maskedBy = null; // 中身を描く間だけ外す（再帰でここへ戻らないように）
      this.#drawObject(content.ctx, child, parentMatrix, parentCx, false);
      child.maskedBy = masker;
      const shape = this.#acquireLayer();
      const parent = masker.parent ? concat(this.base, masker.parent.worldMatrix()) : this.base;
      this.#drawContent(shape.ctx, masker, concat(parent, masker.matrix), OPAQUE_CX, true); // マスクは _visible が偽でも効く
      this.#composite(content.ctx, shape, 'destination-in');
      this.#composite(ctx, content, 'source-over');
      this.#releaseLayer(shape);
      this.#releaseLayer(content);
      return;
    }
    const m = concat(parentMatrix, child.matrix);
    const cx = concatCx(parentCx, child.cxform);
    // マスクの形を描くときは、ブレンドとフィルタは意味を持たない。
    const blend = mask ? 'normal' : child.blendMode;
    const filters = mask ? null : child.filters;
    if (blend === 'normal' && !filters?.length) {
      this.#drawContent(ctx, child, m, cx, mask);
      return;
    }
    // alpha と erase は下のアルファを削る合成で、layer の中でだけ意味を持つ。
    // 最終出力に直接かかる場合は何も描かない（実機での挙動は未確認）。
    if ((blend === 'alpha' || blend === 'erase') && ctx === this.ctx) return;
    const layer = this.#acquireLayer();
    this.#drawContent(layer.ctx, child, m, cx, mask);
    if (filters?.length) {
      const { width, height } = layer.canvas;
      const image = layer.ctx.getImageData(0, 0, width, height);
      const result = applyFilters(image.data, width, height, filters, this.scale);
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
      const grid = child.character?.scalingGrid;
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
      if (op.kind === 'text') return op;
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
      if (op.kind === 'text') return op;
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
      if (op.kind === 'fill') this.#fill(ctx, op, m, cx);
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
    if (this.#paint(ctx, style, cx)) ctx.fill(op.spacePath, rule);
    ctx.globalAlpha = 1;
  }

  // グラデーションかビットマップの塗りを、ctx の fillStyle にする（ctx の変換は、塗りの定義空間に合わせておく）。
  // 描けない（未定義・未復号のビットマップ）なら偽。
  #paint(ctx, style, cx) {
    if (style.type === 'bitmap') {
      const def = style.bitmap ?? this.movie.dictionary.get(style.bitmapId); // スクリプトが作ったビットマップは、直接持っている
      const source = def?.type === 'bitmap' && this.#bitmapSource(def, cx);
      if (!source) return false;
      ctx.imageSmoothingEnabled = style.smooth;
      ctx.globalAlpha = source.alpha;
      const blended = style.blendRight && !style.smooth && this.#blendRight(ctx, source.image);
      if (blended) {
        // 横方向は、装置の画素に合わせて拡大済みの画像を使う。
        const pattern = ctx.createPattern(blended.image, 'no-repeat');
        pattern.setTransform(new DOMMatrix([1 / blended.z, 0, 0, 1, 0, 0]));
        ctx.fillStyle = pattern;
      } else if (style.repeat) {
        ctx.fillStyle = ctx.createPattern(source.image, 'repeat');
      } else {
        // 繰り返さない塗りは、縁の画素を 1 画素外へ延ばした画像を使う。そのままだと縁が
        // 外側の透明と補間されて薄くなる（実機は範囲外を縁の色で埋める）。
        const pattern = ctx.createPattern(this.#padded(source.image), 'no-repeat');
        pattern.setTransform(new DOMMatrix([1, 0, 0, 1, -1, -1]));
        ctx.fillStyle = pattern;
      }
      return true;
    }
    const gradient = style.type === 'linear'
      ? ctx.createLinearGradient(-GRADIENT_HALF, 0, GRADIENT_HALF, 0)
      : ctx.createRadialGradient(style.focal * GRADIENT_HALF, 0, 0, 0, 0, GRADIENT_HALF);
    let last = 0;
    for (const stop of style.stops) {
      last = Math.max(last, stop.ratio / 255); // Canvas は位置が戻る指定を受け付けない
      gradient.addColorStop(last, css(stop.color, cx));
    }
    ctx.fillStyle = gradient;
    return true;
  }

  #stroke(ctx, op, m, cx) {
    const { style } = op;
    // 線幅が変形で歪まないよう、パスをデバイス座標へ移してから等倍で描く。
    // 線幅の倍率は、対角方向の単位ベクトル (1, 1)/√2 が変形後に何倍の長さになるか（実機の画面から求めた規則。
    // 等倍・回転では 1、3 × 1 の拡大では √5、斜めの変形では面積比の平方根より小さくなる）。
    const objectScale = style.noHScale && style.noVScale ? this.scale / 20 : Math.hypot(m.a + m.c, m.b + m.d) / Math.SQRT2;
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
    if (this.#paint(target, fill, cx)) {
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

  // 埋め込みの字形が無いテキストを、端末のフォントで描く（実機と同じ見た目にはならない）。
  #text(ctx, op, m, cx) {
    const generic = { _sans: 'sans-serif', _serif: 'serif', _typewriter: 'monospace' }[op.family];
    const family = generic ?? (op.family ? `"${op.family.replace(/["\\]/g, '')}", sans-serif` : 'sans-serif');
    ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    ctx.font = `${op.italic ? 'italic ' : ''}${op.bold ? 'bold ' : ''}${op.size}px ${family}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = op.align === 'right' || op.align === 'center' ? op.align : 'left';
    ctx.fillStyle = css(op.color, cx);
    const x = op.align === 'right' ? op.x + op.width : op.align === 'center' ? op.x + op.width / 2 : op.x;
    ctx.fillText(op.text, x, op.y);
  }

  // --- ビットマップ ---

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
