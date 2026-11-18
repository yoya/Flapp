// Canvas 2D による描画。表示リストをたどって図形を描くだけで、状態は持たない（キャッシュを除く）。
//
// 未対応: ビットマップ塗り、クリップ層（マスク）、グラデーションの reflect / repeat と linearRGB、
//         線のグラデーション塗り、始端と終端で異なるキャップ。
import { MovieClip } from '../player/movie.js';

const GRADIENT_HALF = 16384; // グラデーションは (-16384, -16384)〜(16384, 16384) の正方形で定義される

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

export class CanvasRenderer {
  /** @param {HTMLCanvasElement | OffscreenCanvas} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.compiled = new WeakMap(); // 図形の定義 → Path2D 化した描画命令
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
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css(movie.backgroundColor ?? { r: 255, g: 255, b: 255, a: 255 }, null);
    ctx.fillRect(0, 0, width, height);

    this.scale = scale;
    const twipsToPixels = { a: scale / 20, b: 0, c: 0, d: scale / 20, tx: (-xmin * scale) / 20, ty: (-ymin * scale) / 20 };
    this.#drawClip(movie.root, twipsToPixels, null);
  }

  #drawClip(clip, matrix, cx) {
    for (const child of clip.sortedChildren()) {
      if (child.clipDepth) continue; // クリップ層は未対応。マスク形状そのものは描かない
      const m = concat(matrix, child.matrix);
      const c = concatCx(cx, child.cxform);
      if (child instanceof MovieClip) this.#drawClip(child, m, c);
      else if (child.character.type === 'shape') this.#drawShape(child.character, m, c);
    }
  }

  #compile(shape) {
    let ops = this.compiled.get(shape);
    if (ops) return ops;
    ops = shape.paths.map((op) => {
      const path = new Path2D();
      for (const cmd of op.path) {
        if (cmd[0] === 'M') path.moveTo(cmd[1], cmd[2]);
        else if (cmd[0] === 'L') path.lineTo(cmd[1], cmd[2]);
        else if (cmd[0] === 'Q') path.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
        else path.closePath();
      }
      const compiled = { ...op, path2d: path };
      const style = op.style;
      if (op.kind === 'fill' && (style.type === 'linear' || style.type === 'radial')) {
        // グラデーションはその定義空間で塗る。パスを逆行列でその空間へ移しておく。
        const g = domMatrix(style.matrix);
        if (g.a * g.d - g.b * g.c !== 0) {
          compiled.gradientMatrix = g;
          compiled.gradientPath = new Path2D();
          compiled.gradientPath.addPath(path, g.inverse());
        }
      }
      return compiled;
    });
    this.compiled.set(shape, ops);
    return ops;
  }

  #drawShape(shape, m, cx) {
    const { ctx } = this;
    for (const op of this.#compile(shape)) {
      if (op.kind === 'fill') this.#fill(op, m, cx);
      else this.#stroke(op, m, cx);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  #fill(op, m, cx) {
    const { ctx } = this;
    const { style } = op;
    const rule = op.evenOdd ? 'evenodd' : 'nonzero';
    ctx.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    if (style.type === 'solid') {
      ctx.fillStyle = css(style.color, cx);
      ctx.fill(op.path2d, rule);
    } else if (style.type === 'linear' || style.type === 'radial') {
      if (!op.gradientPath) {
        // 行列がつぶれている場合は最後の色で塗りつぶす。
        ctx.fillStyle = css(style.stops.at(-1)?.color ?? { r: 0, g: 0, b: 0, a: 0 }, cx);
        ctx.fill(op.path2d, rule);
        return;
      }
      const g = op.gradientMatrix;
      ctx.transform(g.a, g.b, g.c, g.d, g.e, g.f);
      const gradient = style.type === 'linear'
        ? ctx.createLinearGradient(-GRADIENT_HALF, 0, GRADIENT_HALF, 0)
        : ctx.createRadialGradient(style.focal * GRADIENT_HALF, 0, 0, 0, 0, GRADIENT_HALF);
      let last = 0;
      for (const stop of style.stops) {
        last = Math.max(last, stop.ratio / 255); // Canvas は位置が戻る指定を受け付けない
        gradient.addColorStop(last, css(stop.color, cx));
      }
      ctx.fillStyle = gradient;
      ctx.fill(op.gradientPath, rule);
    }
    // ビットマップ塗りは未対応（何も描かない）。
  }

  #stroke(op, m, cx) {
    const { ctx } = this;
    const { style } = op;
    // 線幅が変形で歪まないよう、パスをデバイス座標へ移してから等倍で描く。
    const path = new Path2D();
    path.addPath(op.path2d, domMatrix(m));
    const objectScale = style.noHScale && style.noVScale ? this.scale / 20 : Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = Math.max(style.width * objectScale, this.scale); // 最小でも 1px
    ctx.lineCap = style.startCap;
    ctx.lineJoin = style.join;
    ctx.miterLimit = style.miterLimit ?? 3;
    const color = style.color ?? (style.fill.type === 'solid' ? style.fill.color : style.fill.stops?.[0]?.color);
    ctx.strokeStyle = css(color ?? { r: 0, g: 0, b: 0, a: 255 }, cx);
    ctx.stroke(path);
  }
}
