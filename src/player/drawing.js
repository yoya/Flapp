// スクリプトの描画 API (MovieClip.lineTo など) で作る図形。座標は twips。
// 描画命令は図形 (shape/paths.js) と同じ形式で、paths() が描画側へ渡すスナップショットを返す。

const ROUND = { startCap: 'round', endCap: 'round', join: 'round', noClose: false };

export class Drawing {
  #ops = []; // 確定した描画命令
  #fill = null; // 作りかけの塗り
  #stroke = null; // 作りかけの線
  #line = null; // 現在の線スタイル（null は線なし）
  #x = 0;
  #y = 0;
  #snapshot = null;
  bounds = null; // { xmin, xmax, ymin, ymax }

  clear() {
    this.#ops = [];
    this.#fill = this.#stroke = this.#line = null;
    this.#x = this.#y = 0;
    this.bounds = null;
    this.#snapshot = null;
  }

  /** width は twips。undefined なら線なし。 */
  lineStyle(width, color) {
    this.#stroke = null;
    this.#line = width === undefined || Number.isNaN(width) ? null : { ...ROUND, width: Math.max(0, width), color };
  }

  /** color が undefined なら塗りなし。 */
  beginFill(color) {
    this.endFill();
    if (color) {
      this.#fill = { kind: 'fill', style: { type: 'solid', color }, evenOdd: true, path: [['M', this.#x, this.#y]] };
      this.#ops.push(this.#fill);
    }
  }

  endFill() {
    if (this.#fill) this.#fill.path.push(['Z']);
    this.#fill = null;
    this.#stroke = null;
    this.#snapshot = null;
  }

  moveTo(x, y) {
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
  }

  /** 描画命令の配列。内容が変わるまで同じ配列を返す（描画側のキャッシュのため）。 */
  paths() {
    this.#snapshot ??= this.#ops.map((op) => ({ ...op, path: op.path.slice() }));
    return this.#snapshot;
  }
}
