// Canvas 2D による描画。表示リストをたどって描くだけで、状態は持たない（キャッシュを除く）。
//
// マスク・ブレンド・フィルタは、対象を別のキャンバス（レイヤー）に描いてから合成する。
//
// 未対応: グラデーションの reflect / repeat と linearRGB、線のグラデーション・ビットマップ塗り、
//         始端と終端で異なるキャップ、繰り返さないビットマップ塗りで画像から 1 画素より外側
//         （実機は縁の色で埋めるが、ここでは透明）、透明なレイヤー上での subtract。
import { MovieClip } from '../player/movie.js';
import { applyFilters } from './filters.js';

const GRADIENT_HALF = 16384; // グラデーションは (-16384, -16384)〜(16384, 16384) の正方形で定義される
const IDENTITY_CX = null;
// マスクは形だけを使うので、色とアルファによらず不透明に描く。
const OPAQUE_CX = { rm: 256, gm: 256, bm: 256, am: 0, ra: 0, ga: 0, ba: 0, aa: 255 };
const TINT_CACHE_SIZE = 8;

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
    this.bitmaps = new WeakMap(); // ビットマップ定義 → 描画に使える画像
    this.tinted = new WeakMap(); // ビットマップ定義 → Map(色変換 → 変換済みの画像)
    this.padded = new WeakMap(); // 画像 → 縁を 1 画素延ばした画像
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
    if (movie.stage) this.#drawContent(ctx, movie.stage, twipsToPixels, IDENTITY_CX, false);
    else if (movie.root.visible) this.#drawContent(ctx, movie.root, concat(twipsToPixels, movie.root.matrix), concatCx(IDENTITY_CX, movie.root.cxform), false);
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
    Object.assign(sub, { movie, scale: 1, compiled: this.compiled, bitmaps: this.bitmaps, tinted: this.tinted, padded: this.padded });
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
      const drawn = child.drawingPaths(); // 描画 API で描いた内容は子の下
      if (drawn) this.#drawShape(ctx, drawn, m, cx, mask);
      this.#drawChildren(ctx, child.sortedChildren(), 0, Infinity, m, cx, mask);
    } else if (child.character.type === 'shape') {
      this.#drawShape(ctx, child.character.paths, m, cx, mask);
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
    if (style.type === 'bitmap') {
      const def = style.bitmap ?? this.movie.dictionary.get(style.bitmapId); // スクリプトが作ったビットマップは、直接持っている
      const source = space && def?.type === 'bitmap' && this.#bitmapSource(def, cx);
      if (!source) return; // 未定義・未復号のビットマップは描かない
      ctx.transform(space.a, space.b, space.c, space.d, space.e, space.f);
      ctx.imageSmoothingEnabled = style.smooth;
      ctx.globalAlpha = source.alpha;
      if (style.repeat) {
        ctx.fillStyle = ctx.createPattern(source.image, 'repeat');
      } else {
        // 繰り返さない塗りは、縁の画素を 1 画素外へ延ばした画像を使う。そのままだと縁が
        // 外側の透明と補間されて薄くなる（実機は範囲外を縁の色で埋める）。
        const pattern = ctx.createPattern(this.#padded(source.image), 'no-repeat');
        pattern.setTransform(new DOMMatrix([1, 0, 0, 1, -1, -1]));
        ctx.fillStyle = pattern;
      }
      ctx.fill(op.spacePath, rule);
      ctx.globalAlpha = 1;
      return;
    }
    if (!space) {
      // 行列がつぶれたグラデーションは最後の色で塗りつぶす。
      ctx.fillStyle = css(style.stops.at(-1)?.color ?? { r: 0, g: 0, b: 0, a: 0 }, cx);
      ctx.fill(op.path2d, rule);
      return;
    }
    ctx.transform(space.a, space.b, space.c, space.d, space.e, space.f);
    const gradient = style.type === 'linear'
      ? ctx.createLinearGradient(-GRADIENT_HALF, 0, GRADIENT_HALF, 0)
      : ctx.createRadialGradient(style.focal * GRADIENT_HALF, 0, 0, 0, 0, GRADIENT_HALF);
    let last = 0;
    for (const stop of style.stops) {
      last = Math.max(last, stop.ratio / 255); // Canvas は位置が戻る指定を受け付けない
      gradient.addColorStop(last, css(stop.color, cx));
    }
    ctx.fillStyle = gradient;
    ctx.fill(op.spacePath, rule);
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
    const path = new Path2D();
    path.addPath(op.path2d, domMatrix({ ...m, tx: m.tx + snap, ty: m.ty + snap }));
    resetTransform(ctx);
    ctx.lineWidth = width;
    ctx.lineCap = style.startCap;
    ctx.lineJoin = style.join;
    ctx.miterLimit = style.miterLimit ?? 3;
    const color = style.color ?? (style.fill.type === 'solid' ? style.fill.color : style.fill.stops?.[0]?.color);
    ctx.strokeStyle = css(color ?? { r: 0, g: 0, b: 0, a: 255 }, cx);
    ctx.stroke(path);
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
