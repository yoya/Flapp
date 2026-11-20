// スクリプトの描画 API (MovieClip.lineTo など) で作る図形。座標は twips。
// 描画命令は図形 (shape/paths.js) と同じ形式で、paths() が描画側へ渡すスナップショットを返す。

const MAX_SEGMENTS = 200000; // 1 つの描き先に溜められる線分・曲線の数

const ROUND = { startCap: 'round', endCap: 'round', join: 'round', noClose: false };
/**
 * lineStyle の、端（caps）・角（joints）・拡大縮小（scaleMode）・miterLimit の名前から、線スタイルの指定を作る。
 * 知らない名前や省略は、丸い端・丸い角・拡大縮小あり・miterLimit 3 になる。
 */
export function lineOptions({ pixelHinting, scaleMode, caps, joints, miterLimit }) {
  const cap = { none: 'butt', square: 'square' }[caps] ?? 'round';
  const out = { startCap: cap, endCap: cap, join: ['bevel', 'miter'].includes(joints) ? joints : 'round', pixelHinting: pixelHinting === true };
  if (out.join === 'miter') out.miterLimit = Math.min(Math.max(Number.isFinite(miterLimit) ? miterLimit : 3, 1), 255);
  out.noHScale = scaleMode === 'none' || scaleMode === 'horizontal'; // 水平方向に拡大縮小しても、線の太さを変えない
  out.noVScale = scaleMode === 'none' || scaleMode === 'vertical';
  return out;
}
const MAX_STOPS = 15; // グラデーションの色の数の上限

/**
 * beginGradientFill の引数から、塗りのスタイル（図形と同じ形式）を作る。
 *   type: 'linear' | 'radial'   colors: { r, g, b, a } の配列   ratios: 数の配列（0〜255）
 *   matrix: { a, b, c, d, tx, ty }（tx, ty は twips。a〜d は、1638.4 px 四方の基準の箱を移す倍率）
 *   spread: 'pad' | 'reflect' | 'repeat'   linearRGB: 真なら linearRGB で補間   focal: 焦点（-1〜1。放射のみ）
 * 色と ratios の数が合わない、種類が不明、ratios が 0〜255 の外にあるときは null（塗りなしになる）。
 * 色が 1 つも無ければ黒の単色、ratios が小さくなる向きに並んでいるときは最初の色の単色になる（どれも実機で確認）。
 */
export function gradientStyle({ type, colors, ratios, matrix, spread = 'pad', linearRGB = false, focal = 0 }) {
  if ((type !== 'linear' && type !== 'radial') || colors.length !== ratios.length || ratios.some((r) => !(r >= 0 && r <= 255))) return null;
  if (!colors.length) return { type: 'solid', color: { r: 0, g: 0, b: 0, a: 255 } };
  const stops = colors.slice(0, MAX_STOPS).map((color, i) => ({ ratio: Math.round(ratios[i]), color }));
  if (stops.some((stop, i) => i && stop.ratio < stops[i - 1].ratio)) return { type: 'solid', color: stops[0].color };
  return { type, matrix, spread, linearRGB, stops, focal: type === 'radial' && Number.isFinite(focal) ? Math.min(Math.max(focal, -1), 1) : 0 };
}

export class Drawing {
  #ops = []; // 確定した描画命令
  #fill = null; // 作りかけの塗り
  #stroke = null; // 作りかけの線
  #line = null; // 現在の線スタイル（null は線なし）
  #start = null; // 作りかけの塗りの、今の部分パスの始点 { x, y }
  #x = 0;
  #y = 0;
  #snapshot = null;
  #segments = 0;
  bounds = null; // { xmin, xmax, ymin, ymax }。線の太さを含む
  edgeBounds = null; // 線の太さを含まない外接矩形

  /** 写し（duplicateMovieClip 用）。描いたもの・作りかけの塗りや線・今の位置と線スタイルまで写し、以後は別々に描ける。 */
  copy() {
    const out = new Drawing();
    const ops = this.#ops.map((op) => ({ ...op, path: op.path.map((cmd) => [...cmd]) }));
    out.#ops = ops;
    out.#fill = this.#fill ? ops[this.#ops.indexOf(this.#fill)] : null;
    out.#stroke = this.#stroke ? ops[this.#ops.indexOf(this.#stroke)] : null;
    out.#line = this.#line;
    out.#start = this.#start && { ...this.#start };
    out.#x = this.#x;
    out.#y = this.#y;
    out.#segments = this.#segments;
    out.bounds = this.bounds && { ...this.bounds };
    out.edgeBounds = this.edgeBounds && { ...this.edgeBounds };
    return out;
  }

  clear() {
    this.#segments = 0;
    this.#ops = [];
    this.#fill = this.#stroke = this.#line = this.#start = null;
    this.#x = this.#y = 0;
    this.bounds = this.edgeBounds = null;
    this.#snapshot = null;
  }

  /**
   * width は twips。undefined なら線なし。extra は、線の端・角などの指定（図形の線スタイルと同じ名前）:
   * startCap / endCap（'round' | 'butt' | 'square'）、join（'round' | 'bevel' | 'miter'）、miterLimit、noHScale、noVScale、pixelHinting。
   */
  lineStyle(width, color, extra = {}) {
    this.#stroke = null;
    this.#line = width === undefined || Number.isNaN(width) ? null : { ...ROUND, ...extra, width: Math.max(0, width), color };
  }

  /** 今の線を、グラデーションで描く（lineGradientStyle。style は gradientStyle の戻り値）。線を引いていなければ何もしない。 */
  lineGradient(style) {
    if (!this.#line) return;
    this.#stroke = null;
    this.#line = { ...this.#line, fill: style };
  }

  /** 今の塗りの、重なりの規則（drawPath の winding）。偽なら nonZero。 */
  setWinding(evenOdd) {
    if (this.#fill) { this.#fill.evenOdd = evenOdd; this.#snapshot = null; }
  }

  /** 3 次ベジェ曲線。4 つに分けて、それぞれを 2 次曲線で近似する。 */
  cubicTo(c1x, c1y, c2x, c2y, x, y) {
    const [x0, y0] = [this.#x, this.#y];
    const at = (t, a, b, c, d) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
    const slope = (t, a, b, c, d) => { const u = 1 - t; return 3 * (u * u * (b - a) + 2 * u * t * (c - b) + t * t * (d - c)); };
    const N = 4;
    for (let i = 1; i <= N; i++) {
      const t0 = (i - 1) / N, t1 = i / N, h = (t1 - t0) / 2;
      // 区間の両端の点と接線から、2 次曲線の制御点を、両端の接線の中点の平均で取る。
      const px = at(t0, x0, c1x, c2x, x) + slope(t0, x0, c1x, c2x, x) * h, py = at(t0, y0, c1y, c2y, y) + slope(t0, y0, c1y, c2y, y) * h;
      const qx = at(t1, x0, c1x, c2x, x) - slope(t1, x0, c1x, c2x, x) * h, qy = at(t1, y0, c1y, c2y, y) - slope(t1, y0, c1y, c2y, y) * h;
      this.curveTo((px + qx) / 2, (py + qy) / 2, i === N ? x : at(t1, x0, c1x, c2x, x), i === N ? y : at(t1, y0, c1y, c2y, y));
    }
  }

  /** 今の塗りのスタイル（無ければ null）。 */
  fillStyle() {
    return this.#fill?.style ?? null;
  }

  /** 三角形を 1 つ、塗りのスタイル style で塗る（drawTriangles でビットマップを三角形ごとに貼るとき）。points は [[x, y] × 3]（twips）。 */
  fillTriangle(points, style) {
    if (++this.#segments > MAX_SEGMENTS) return;
    const path = [['M', ...points[0]], ['L', ...points[1]], ['L', ...points[2]], ['Z']];
    this.#ops.push({ kind: 'fill', style, evenOdd: true, path });
    for (const [x, y] of points) this.#extend(x, y);
    this.#snapshot = null;
  }

  /** color が undefined なら塗りなし。 */
  beginFill(color) {
    this.beginStyle(color && { type: 'solid', color });
  }

  /** 塗りのスタイル（図形と同じ形式。gradientStyle の戻り値など）で塗り始める。null なら塗りなし。 */
  beginStyle(style) {
    this.endFill();
    if (style) {
      this.#fill = { kind: 'fill', style, evenOdd: true, path: [['M', this.#x, this.#y]] };
      this.#start = { x: this.#x, y: this.#y };
      this.#ops.push(this.#fill);
    }
  }

  /**
   * 塗りの部分パスを閉じる辺に、線を引く（endFill、次の beginFill、moveTo のとき）。引く線は、閉じる時点の線スタイル。
   * 線を引いていなければ引かない（実機で確認）。描き終わりで閉じていない塗りも同じで、paths() の中で扱う。
   */
  #closeStroke() {
    const s = this.#start;
    if (!this.#fill || !s || !this.#line || (this.#x === s.x && this.#y === s.y)) return;
    if (!this.#stroke) {
      this.#stroke = { kind: 'stroke', style: this.#line, path: [['M', this.#x, this.#y]] };
      this.#ops.push(this.#stroke);
    }
    this.#stroke.path.push(['L', s.x, s.y]);
    this.#extend(this.#x, this.#y);
    this.#extend(s.x, s.y);
    this.#stroke = null; // 次の線は、今の位置から新しく始める
  }

  endFill() {
    this.#closeStroke();
    if (this.#fill) this.#fill.path.push(['Z']);
    this.#fill = null;
    this.#stroke = null;
    this.#snapshot = null;
  }

  moveTo(x, y) {
    this.#closeStroke();
    if (this.#fill) this.#start = { x, y };
    this.#x = x;
    this.#y = y;
    this.#fill?.path.push(['M', x, y]);
    this.#stroke = null;
    this.#snapshot = null;
  }

  lineTo(x, y) {
    this.#segment(['L', x, y], x, y);
  }

  curveTo(cx, cy, x, y) {
    // 外接矩形には、制御点ではなく曲線が実際に通る範囲を入れる。
    const extreme = (p0, c, p1) => {
      const d = p0 - 2 * c + p1;
      const t = d === 0 ? -1 : (p0 - c) / d;
      return t > 0 && t < 1 ? (1 - t) * (1 - t) * p0 + 2 * t * (1 - t) * c + t * t * p1 : p0;
    };
    if ([cx, cy, x, y].every(Number.isFinite)) this.#extend(extreme(this.#x, cx, x), extreme(this.#y, cy, y));
    this.#segment(['Q', cx, cy, x, y], x, y);
  }

  #segment(cmd, x, y) {
    if (![...cmd.slice(1)].every(Number.isFinite)) return;
    if (++this.#segments > MAX_SEGMENTS) return; // 描き足し続けるスクリプトへの備え（clear するまで、これ以上は増えない）
    this.#extend(this.#x, this.#y);
    this.#extend(x, y);
    this.#fill?.path.push(cmd);
    if (this.#line) {
      if (!this.#stroke) {
        this.#stroke = { kind: 'stroke', style: this.#line, path: [['M', this.#x, this.#y]] };
        this.#ops.push(this.#stroke);
      }
      this.#stroke.path.push(cmd);
    }
    this.#x = x;
    this.#y = y;
    this.#snapshot = null;
  }

  // 外接矩形を点 (x, y) まで広げる。線を引いているときは、線幅の半分だけ外側も含める。
  #extend(x, y) {
    const pad = this.#line ? this.#line.width / 2 : 0;
    const b = (this.bounds ??= { xmin: x - pad, xmax: x + pad, ymin: y - pad, ymax: y + pad });
    b.xmin = Math.min(b.xmin, x - pad);
    b.xmax = Math.max(b.xmax, x + pad);
    b.ymin = Math.min(b.ymin, y - pad);
    b.ymax = Math.max(b.ymax, y + pad);
    const e = (this.edgeBounds ??= { xmin: x, xmax: x, ymin: y, ymax: y });
    e.xmin = Math.min(e.xmin, x);
    e.xmax = Math.max(e.xmax, x);
    e.ymin = Math.min(e.ymin, y);
    e.ymax = Math.max(e.ymax, y);
  }

  /** 描画命令の配列。内容が変わるまで同じ配列を返す（描画側のキャッシュのため）。 */
  paths() {
    if (!this.#snapshot) {
      const ops = this.#ops.map((op) => ({ ...op, path: op.path.slice() }));
      // 描き終わりで閉じていない塗りの、閉じる辺（状態は変えない）
      const s = this.#start;
      if (this.#fill && this.#line && s && (this.#x !== s.x || this.#y !== s.y)) {
        const open = this.#stroke ? ops[this.#ops.indexOf(this.#stroke)] : null;
        if (open) open.path.push(['L', s.x, s.y]);
        else ops.push({ kind: 'stroke', style: this.#line, path: [['M', this.#x, this.#y], ['L', s.x, s.y]] });
      }
      this.#snapshot = ops;
    }
    return this.#snapshot;
  }
}
