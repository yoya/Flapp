// 図形レコードを、塗りごと・線ごとのパスに組み直す。
//
// SWF の辺は「左右どちらにどの塗りがあるか」(fill0 / fill1) を持つだけで、塗りごとの輪郭には
// なっていない。そこで辺を塗り別に集め（fill0 側は向きを反転）、端点をつないで閉じた輪郭にする。
// 途中でスタイル表が差し替わる (NewStyles) と層が変わり、後の層が上に描かれる。

/**
 * @param {ReturnType<typeof import('../swf/shape.js').parseDefineShape>} shape
 * @returns {Array<{ kind: 'fill' | 'stroke', style: object, evenOdd?: boolean, path: Array<Array<string|number>> }>}
 * path は ['M', x, y] / ['L', x, y] / ['Q', cx, cy, x, y] / ['Z'] の列。座標は twips。
 */
export function shapeToPaths(shape) {
  const ops = [];
  let fillStyles = shape.fillStyles;
  let lineStyles = shape.lineStyles;
  let fills = new Map(); // 塗り番号 → 辺の列
  let lines = new Map(); // 線番号 → 辺の列
  let fill0 = 0, fill1 = 0, line = 0;
  let x = 0, y = 0;

  const add = (map, index, seg) => {
    let list = map.get(index);
    if (!list) map.set(index, (list = []));
    list.push(seg);
  };
  const flush = () => {
    for (const index of [...fills.keys()].sort((a, b) => a - b)) {
      const style = fillStyles[index - 1];
      if (style) ops.push({ kind: 'fill', style, evenOdd: !shape.usesWindingRule, path: closeLoops(fills.get(index)) });
    }
    for (const index of [...lines.keys()].sort((a, b) => a - b)) {
      const style = lineStyles[index - 1];
      if (style) ops.push({ kind: 'stroke', style, path: strokePath(lines.get(index), style.noClose) });
    }
    fills = new Map();
    lines = new Map();
  };

  for (const rec of shape.records) {
    if (rec.type === 'style') {
      if (rec.fillStyles) {
        // 同じレコードの塗り・線番号は、新しいスタイル表を指す。
        flush();
        fillStyles = rec.fillStyles;
        lineStyles = rec.lineStyles;
        fill0 = fill1 = line = 0;
      }
      if (rec.moveTo) ({ x, y } = rec.moveTo);
      if (rec.fill0 !== undefined) fill0 = rec.fill0;
      if (rec.fill1 !== undefined) fill1 = rec.fill1;
      if (rec.line !== undefined) line = rec.line;
      continue;
    }
    const seg = { x0: x, y0: y, x1: rec.x, y1: rec.y };
    if (rec.type === 'curve') {
      seg.cx = rec.cx;
      seg.cy = rec.cy;
    }
    // 両側が同じ塗りの辺は塗りの内部にあり、輪郭にならない。
    if (fill0 !== fill1) {
      if (fill1) add(fills, fill1, seg);
      if (fill0) add(fills, fill0, { ...seg, x0: seg.x1, y0: seg.y1, x1: seg.x0, y1: seg.y0 });
    }
    if (line) add(lines, line, seg);
    x = rec.x;
    y = rec.y;
  }
  flush();
  return ops;
}

const key = (px, py) => `${px},${py}`;
const draw = (seg) => (seg.cx === undefined ? ['L', seg.x1, seg.y1] : ['Q', seg.cx, seg.cy, seg.x1, seg.y1]);

// 辺の終点と次の辺の始点をつないで、閉じた輪郭の列にする。
function closeLoops(segs) {
  const starts = new Map(); // 始点 → まだ使っていない辺
  for (const seg of segs) {
    const k = key(seg.x0, seg.y0);
    const list = starts.get(k);
    if (list) list.push(seg);
    else starts.set(k, [seg]);
  }
  const used = new Set();
  const path = [];
  for (const first of segs) {
    if (used.has(first)) continue;
    path.push(['M', first.x0, first.y0]);
    for (let seg = first; seg; ) {
      used.add(seg);
      path.push(draw(seg));
      if (seg.x1 === first.x0 && seg.y1 === first.y0) break;
      // 同じ点から出る辺が複数あっても、どれを選んでも塗られる領域は変わらない。
      const next = starts.get(key(seg.x1, seg.y1));
      seg = undefined;
      while (next?.length) {
        const cand = next.pop();
        if (!used.has(cand)) {
          seg = cand;
          break;
        }
      }
    }
    path.push(['Z']);
  }
  return path;
}

// 線は描かれた順につなぐ。始点に戻った部分パスは閉じて、端ではなく角として描かせる。
function strokePath(segs, noClose) {
  const path = [];
  let sx, sy, ex, ey;
  for (const seg of segs) {
    if (seg.x0 !== ex || seg.y0 !== ey) {
      path.push(['M', seg.x0, seg.y0]);
      sx = seg.x0;
      sy = seg.y0;
    }
    path.push(draw(seg));
    ex = seg.x1;
    ey = seg.y1;
    if (ex === sx && ey === sy && !noClose) {
      path.push(['Z']);
      ex = ey = undefined; // 次の辺は新しい部分パスから
    }
  }
  return path;
}
