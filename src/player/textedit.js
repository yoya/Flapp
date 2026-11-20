// 入力テキストフィールドの編集: restrict の判定、文字の位置の計算（クリックの位置からキャレットへ、キャレットの描画、上下の移動）。
//
// 文字の位置は、描画側（swf/text.js）の配置と同じ決まりの概算。端末のフォントの幅は movie.measureText（描く側が測る）で測り、無ければ
// 半角は大きさの半分、全角は 1 倍にする。実機のフォントとは一致しないので、クリックで決まるキャレットは 1 文字ほどずれることがある。

const GUTTER = 40; // フィールドの内側の余白（2px = 40 twips）

/**
 * restrict（入力できる文字の指定）で、文字 ch が入力できるか。"a-z"（範囲）、"^" 以降は除く文字（もう一度 ^ で、また許す文字）、
 * "\\" で次の文字をそのまま扱う。restrict が null ならどの文字も入力できる。"" ならどれも入力できない。
 */
export function restricts(restrict, ch) {
  if (restrict === null || restrict === undefined) return true;
  const code = ch.codePointAt(0);
  let allowed = restrict[0] === '^'; // ^ から始まるときは、はじめは全部許す
  let mode = true; // 今の部分が「許す」か「除く」か
  const chars = [...restrict];
  const read = (i) => (chars[i] === '\\' && i + 1 < chars.length ? [chars[i + 1], i + 2] : [chars[i], i + 1]);
  for (let i = 0; i < chars.length;) {
    if (chars[i] === '^') { mode = !mode; i++; continue; }
    let [lo, next] = read(i);
    let hi = lo;
    if (chars[next] === '-' && next + 1 < chars.length) { [hi, next] = read(next + 1); }
    if (code >= lo.codePointAt(0) && code <= hi.codePointAt(0)) allowed = mode;
    i = next;
  }
  return allowed;
}

/**
 * フィールドの行ごとの配置。戻り値は { lines: [{ start, end, x: 文字ごとの左端（最後は右端）, y, height }], width, height }（twips、フィールドの左上が原点）。
 * start〜end は文字列の中の範囲（行末の CR は含まない）。空の文字列でも、行は 1 つある。
 */
export function layoutOf(field) {
  const { text } = field;
  const shown = field.password ? text.replace(/[^\r]/g, '*') : text;
  const box = field.box;
  const base = field.format;
  const measure = field.movie?.measureText;
  const fmtAt = (i) => field.formatAt(i);
  const widthOf = (i) => {
    const f = fmtAt(i), size = f.size * 20, ch = shown[i];
    return (measure?.(ch, f) ?? (ch.codePointAt(0) >= 0x2e80 ? size : size * 0.5)) + (f.letterSpacing ?? 0) * 20;
  };
  const lines = [];
  let y = GUTTER;
  let at = 0;
  const paragraphs = shown.split('\r');
  paragraphs.forEach((par, n) => {
    if (!field.multiline && n > 0) return;
    const start = at;
    const pf = par.length ? fmtAt(start) : base;
    const left = GUTTER + (pf.leftMargin + pf.blockIndent) * 20 + (pf.bullet ? pf.size * 20 * 3 : 0);
    const right = box.xmax - box.xmin - GUTTER - pf.rightMargin * 20;
    // 折り返す位置（空白のあと。広さが足りなければ、その文字の前）。
    const ranges = [];
    let from = start, width = 0, lastSpace = -1;
    for (let i = start; i < start + par.length; i++) {
      const w = widthOf(i);
      const limit = right - left - (ranges.length === 0 ? pf.indent * 20 : 0);
      if (field.wordWrap && i > from && width + w > limit && shown[i] !== ' ') {
        const cut = lastSpace >= from ? lastSpace + 1 : i;
        ranges.push([from, cut]);
        from = cut;
        width = 0;
        for (let j = from; j < i; j++) width += widthOf(j);
        lastSpace = -1;
      }
      width += w;
      if (shown[i] === ' ') lastSpace = i;
    }
    ranges.push([from, start + par.length]);
    ranges.forEach(([a, b], row) => {
      const x0 = left + (row === 0 ? pf.indent * 20 : 0);
      const widths = [];
      let total = 0;
      for (let i = a; i < b; i++) { widths.push(widthOf(i)); total += widths[widths.length - 1]; }
      const extra = right - x0 - total;
      let x = x0 + (pf.align === 'right' ? extra : pf.align === 'center' ? extra / 2 : 0);
      const xs = [x];
      for (const w of widths) xs.push((x += w));
      let size = 0;
      for (let i = a; i < b; i++) size = Math.max(size, fmtAt(i).size * 20);
      if (!size) size = (pf.size ?? 12) * 20;
      const height = size * 1.15 + (pf.leading ?? 0) * 20;
      lines.push({ start: a, end: b, x: xs, y, height });
      y += height;
    });
    at = start + par.length + 1;
  });
  return { lines, width: Math.max(0, ...lines.map((l) => l.x[l.x.length - 1])) - GUTTER, height: y - GUTTER };
}

/** 文字の位置（index。文字列の長さまで）が、何行目にあるか。行の終わりと次の行の始まりが同じ位置のときは、前の行の終わり（折り返しでは次の行の頭）。 */
export function lineOf(layout, index) {
  const { lines } = layout;
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    if (index < lines[i].end || !next || (index === lines[i].end && next.start > lines[i].end)) return i;
  }
  return lines.length - 1;
}

/** フィールドの中の点 (x, y)（twips、フィールドの左上が原点）に近い、キャレットの位置（文字列の中の 0〜長さ）。 */
export function indexAt(layout, x, y) {
  const { lines } = layout;
  let row = 0;
  while (row < lines.length - 1 && y >= lines[row].y + lines[row].height) row++;
  const line = lines[row];
  for (let i = line.start; i < line.end; i++) if (x < (line.x[i - line.start] + line.x[i - line.start + 1]) / 2) return i;
  return line.end;
}

/** 位置 index のキャレットの座標（twips、フィールドの左上が原点）と行の高さ。 */
export function caretAt(layout, index) {
  const line = layout.lines[lineOf(layout, index)];
  return { x: line.x[Math.min(index, line.end) - line.start], y: line.y, height: line.height };
}
