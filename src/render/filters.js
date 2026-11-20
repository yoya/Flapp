// 表示オブジェクトのフィルタ（ぼかし・影・光彩・ベベル・グラデーション光彩・グラデーションベベル・色行列・畳み込み・変位マップ）。
// DOM に依存しない画素演算。ベベル系とグラデーション光彩の向きと合成は、実機の画面から求めた規則による。

/**
 * @param {Uint8ClampedArray} rgba   乗算済みでない RGBA（Canvas の ImageData と同じ並び）
 * @param {number} width
 * @param {number} height
 * @param {object[]} filters        parsePlaceObject の filters
 * @param {number} scale            ステージ 1px あたりのデバイスピクセル数（ぼかし量と距離に掛かる）
 * @param {object} [area]           フィルタを掛ける表示オブジェクトの外接矩形 { x0, y0, x1, y1 }（デバイスピクセル。変位マップが使う）
 * @returns {{ rgba: Uint8ClampedArray, unsupported: string[] }}
 */
export function applyFilters(rgba, width, height, filters, scale, area = null) {
  const n = width * height;
  // 計算は乗算済みアルファの浮動小数で行う。
  let px = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i += 4) {
    const a = rgba[i + 3] / 255;
    px[i] = rgba[i] * a;
    px[i + 1] = rgba[i + 1] * a;
    px[i + 2] = rgba[i + 2] * a;
    px[i + 3] = rgba[i + 3];
  }

  const unsupported = [];
  for (const f of filters) {
    if (f.type === 'blur') {
      boxBlur(px, width, height, 4, blurSize(f.blurX, scale), blurSize(f.blurY, scale), f.passes);
    } else if (f.type === 'dropShadow' || f.type === 'glow') {
      px = shadow(px, width, height, f, scale);
    } else if (f.type === 'bevel' || f.type === 'gradientBevel' || f.type === 'gradientGlow') {
      px = bevel(px, width, height, f, scale);
    } else if (f.type === 'colorMatrix') {
      colorMatrix(px, f.matrix);
    } else if (f.type === 'convolution') {
      px = convolution(px, width, height, f);
    } else if (f.type === 'displacement') {
      px = displacement(px, width, height, f, scale, area);
    } else {
      unsupported.push(f.type);
    }
  }

  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n * 4; i += 4) {
    const a = px[i + 3];
    if (a <= 0) continue;
    const k = 255 / a;
    out[i] = px[i] * k;
    out[i + 1] = px[i + 1] * k;
    out[i + 2] = px[i + 2] * k;
    out[i + 3] = a;
  }
  return { rgba: out, unsupported };
}

// ぼかし量（ステージ px での箱の幅）をデバイスピクセルでの箱の幅にする。
// 幅 1 は「ぼかさない」なので、広がる分 (幅 - 1) だけを倍率に合わせる。
const blurSize = (amount, scale) => (amount - 1) * scale + 1;

/**
 * 箱形ぼかしを passes 回かける。幅 size の箱は、中心の画素と左右 (size - 1) / 2 画素ずつを平均する
 * （端数の分は端の画素に重みをかける）。size が 1 以下の方向はぼかさない。範囲外は透明として扱う。
 * @param {Float32Array} buf   channels 個ずつ並んだ画素（その場で書き換える）
 */
export function boxBlur(buf, width, height, channels, sizeX, sizeY, passes) {
  const line = new Float32Array(Math.max(width, height) + 1);
  const pass = (size, count, stride, lines, lineStride) => {
    if (size <= 1) return;
    const r = (size - 1) / 2;
    const whole = Math.floor(r);
    const frac = r - whole;
    for (let l = 0; l < lines; l++) {
      for (let c = 0; c < channels; c++) {
        const base = l * lineStride + c;
        // line[i] = 先頭から i 個の合計
        line[0] = 0;
        for (let i = 0; i < count; i++) line[i + 1] = line[i] + buf[base + i * stride];
        for (let i = 0; i < count; i++) {
          const lo = i - whole;
          const hi = i + whole + 1;
          let sum = line[Math.min(count, hi)] - line[Math.max(0, lo)];
          if (frac > 0) {
            if (lo - 1 >= 0) sum += frac * (line[lo] - line[lo - 1]);
            if (hi < count) sum += frac * (line[hi + 1] - line[hi]);
          }
          buf[base + i * stride] = sum / size;
        }
      }
    }
  };
  for (let p = 0; p < passes; p++) {
    pass(sizeX, width, channels, height, width * channels); // 横
    pass(sizeY, height, width * channels, width, channels); // 縦
  }
}

// アルファ（1 画素 1 値）を (dx, dy) だけずらした写し。範囲の外は outside。
function shifted(alpha, width, height, dx, dy, outside = 0) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = y - dy;
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      out[y * width + x] = sx >= 0 && sx < width && sy >= 0 && sy < height ? alpha[sy * width + sx] : outside;
    }
  }
  return out;
}

// 影と光彩。元の絵のアルファをずらしてぼかし、指定の色を付けて元の絵と合成する。
function shadow(px, width, height, f, scale) {
  const n = width * height;
  const dx = f.type === 'dropShadow' ? Math.round(Math.cos(f.angle) * f.distance * scale) : 0;
  const dy = f.type === 'dropShadow' ? Math.round(Math.sin(f.angle) * f.distance * scale) : 0;
  const source = new Float32Array(n);
  for (let i = 0; i < n; i++) source[i] = f.inner ? 255 - px[i * 4 + 3] : px[i * 4 + 3]; // 内側の影は「絵の無いところ」から落ちる
  const alpha = shifted(source, width, height, dx, dy, f.inner ? 255 : 0);
  boxBlur(alpha, width, height, 1, blurSize(f.blurX, scale), blurSize(f.blurY, scale), f.passes);

  const { r, g, b } = f.color;
  const colorAlpha = f.color.a / 255;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const srcA = px[o + 3] / 255;
    let s = Math.min(255, alpha[i] * f.strength) * colorAlpha; // 影のアルファ (0〜255)
    if (f.inner) s *= srcA; // 内側の影は絵の中にだけ出る
    const sr = (r * s) / 255;
    const sg = (g * s) / 255;
    const sb = (b * s) / 255;
    // 上に重ねる側の重み (keep) と、下になる側に掛かる係数 (under)
    let srcWeight;
    let shadowWeight;
    if (f.inner) {
      shadowWeight = 1;
      srcWeight = f.knockout || !f.compositeSource ? 0 : 1 - s / 255; // 影が絵の上
    } else {
      srcWeight = f.knockout || !f.compositeSource ? 0 : 1;
      shadowWeight = f.knockout || f.compositeSource ? 1 - srcA : 1; // 絵が影の上
    }
    out[o] = px[o] * srcWeight + sr * shadowWeight;
    out[o + 1] = px[o + 1] * srcWeight + sg * shadowWeight;
    out[o + 2] = px[o + 2] * srcWeight + sb * shadowWeight;
    out[o + 3] = px[o + 3] * srcWeight + s * shadowWeight;
  }
  return out;
}

// グラデーションの色の表（位置 0〜255 → 乗算前の RGBA。端の外は端の色）。
function gradientTable(colors) {
  const table = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    let k = colors.findIndex((c) => c.ratio >= i);
    if (k < 0) k = colors.length - 1;
    const to = colors[k];
    const from = colors[Math.max(0, k - 1)];
    const t = to.ratio > from.ratio ? Math.max(0, Math.min(1, (i - from.ratio) / (to.ratio - from.ratio))) : 1;
    for (const [j, c] of ['r', 'g', 'b', 'a'].entries()) table[i * 4 + j] = from.color[c] + (to.color[c] - from.color[c]) * t;
  }
  return table;
}

// ベベル・グラデーションベベル・グラデーション光彩。ぼかしたアルファを、角度の向きとその逆向きに距離だけずらして比べる。
// ベベルは、角度の向きの側（逆向きにずらしたアルファの方が大きい所）がハイライト、反対の側が影。グラデーションベベルは、
// 影の側を 255、ハイライトの側を 0 とする位置でグラデーションの色を引く。グラデーション光彩は、角度の向きにずらしたアルファ
// （内側でも反転しない）の位置で色を引く。内側は絵の中にだけ、外側は絵の外にだけ出る。onTop（full）はどちらにも出て、絵の上に重なる。
function bevel(px, width, height, f, scale) {
  const n = width * height;
  const dx = Math.round(Math.cos(f.angle) * f.distance * scale);
  const dy = Math.round(Math.sin(f.angle) * f.distance * scale);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = px[i * 4 + 3];
  boxBlur(alpha, width, height, 1, blurSize(f.blurX, scale), blurSize(f.blurY, scale), f.passes);
  const table = f.colors ? gradientTable(f.colors) : null;
  const lit = shifted(alpha, width, height, dx, dy); // 角度の逆向きから引いたアルファ
  const dark = f.type === 'gradientGlow' ? null : shifted(alpha, width, height, -dx, -dy);
  const out = new Float32Array(n * 4);
  const effect = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (f.type === 'bevel') {
      const d = (lit[i] - dark[i]) * f.strength;
      const color = d > 0 ? f.highlightColor : f.shadowColor;
      const a = (Math.min(255, Math.abs(d)) * color.a) / 255;
      effect[0] = (color.r * a) / 255; effect[1] = (color.g * a) / 255; effect[2] = (color.b * a) / 255; effect[3] = a;
    } else {
      const v = f.type === 'gradientGlow' ? lit[i] * f.strength : 128 + ((dark[i] - lit[i]) * f.strength) / 2;
      const t = Math.max(0, Math.min(255, Math.round(v))) * 4;
      const a = table[t + 3];
      effect[0] = (table[t] * a) / 255; effect[1] = (table[t + 1] * a) / 255; effect[2] = (table[t + 2] * a) / 255; effect[3] = a;
    }
    const srcA = px[o + 3] / 255;
    const keep = f.knockout || !f.compositeSource ? 0 : 1; // 元の絵を残すか
    if (f.onTop) {
      const over = effect[3] / 255;
      for (let j = 0; j < 4; j++) out[o + j] = effect[j] + px[o + j] * keep * (1 - over);
    } else if (f.inner) {
      const over = (effect[3] * srcA) / 255;
      for (let j = 0; j < 4; j++) out[o + j] = effect[j] * srcA + px[o + j] * keep * (1 - over);
    } else {
      const under = f.knockout ? 1 - srcA : keep ? 1 - srcA : 1;
      for (let j = 0; j < 4; j++) out[o + j] = px[o + j] * keep + effect[j] * under;
    }
  }
  return out;
}

// 畳み込み。乗算前の RGBA に行列を掛けて、divisor で割り bias を足す。行列は、デバイスの画素の間隔で掛ける。
// 計算するのは、絵が描かれた範囲（アルファが 0 でない画素を囲む矩形）を、左上へ行列の中心まで、右下へ行列の残りの大きさだけ
// 広げた範囲（3 × 3 なら左上へ 1、右下へ 2。実機の画面に合わせた）。その外は、clamp なら端の画素、そうでなければ defaultColor
// として読む。preserveAlpha なら、アルファは元のまま。
function convolution(px, width, height, f) {
  const n = width * height;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] <= 0) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return px;
  const { matrixX: mx, matrixY: my, matrix: m, defaultColor: dc } = f;
  const hx = Math.floor(mx / 2), hy = Math.floor(my / 2);
  x0 = Math.max(0, x0 - hx); y0 = Math.max(0, y0 - hy);
  x1 = Math.min(width - 1, x1 + mx - hx); y1 = Math.min(height - 1, y1 + my - hy);
  const plain = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i += 4) {
    const a = px[i + 3];
    const k = a > 0 ? 255 / a : 0;
    plain[i] = px[i] * k; plain[i + 1] = px[i + 1] * k; plain[i + 2] = px[i + 2] * k; plain[i + 3] = a;
  }
  const out = new Float32Array(n * 4);
  const divisor = f.divisor || 1;
  const outside = [dc.r, dc.g, dc.b, dc.a];
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const sum = [0, 0, 0, 0];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      sum[0] = sum[1] = sum[2] = sum[3] = 0;
      for (let j = 0; j < my; j++) {
        for (let i = 0; i < mx; i++) {
          const w = m[j * mx + i];
          if (!w) continue;
          let sx = x + i - hx, sy = y + j - hy;
          let sample = null;
          if (sx < x0 || sx > x1 || sy < y0 || sy > y1) {
            if (!f.clamp) sample = outside;
            sx = Math.max(x0, Math.min(x1, sx));
            sy = Math.max(y0, Math.min(y1, sy));
          }
          const s = (sy * width + sx) * 4;
          for (let c = 0; c < 4; c++) sum[c] += w * (sample ? sample[c] : plain[s + c]);
        }
      }
      const o = (y * width + x) * 4;
      const a = f.preserveAlpha ? plain[o + 3] : clamp(sum[3] / divisor + f.bias);
      for (let c = 0; c < 3; c++) out[o + c] = (clamp(sum[c] / divisor + f.bias) * a) / 255;
      out[o + 3] = a;
    }
  }
  return out;
}

// 色行列（4 行 5 列）。乗算前の RGBA に対して計算する。
// 変位マップ（実機の画面から求めた規則。test/as3/displace.as）:
//  - 地図の画素は、表示オブジェクトの外接矩形の左上から mapPoint だけずれたところに、ステージの 1px = 地図の 1 画素で重なる
//    （オブジェクトの拡大縮小は関係ない）。地図の外は動かさない。
//  - 各画素は、地図の成分の値 c から (c - 128) × scale / 256（ステージの px）だけ離れた画素の色になる。
//  - 外接矩形の外を指したとき: wrap は反対側から、clamp は縁の画素、ignore は動かさない、color は color / alpha の色。
//  - color のときだけ、外接矩形の周りに |scale| / 2 ずつ広げて描く（広げたところは color になる）。
function displacement(px, width, height, f, scale, area) {
  const map = f.map;
  if (!map?.rgba || !area) return px;
  const out = new Float32Array(px);
  const channel = { 1: 0, 2: 1, 4: 2, 8: 3 };
  const cx = channel[f.componentX] ?? -1, cy = channel[f.componentY] ?? -1;
  const [x0, y0, x1, y1] = [Math.round(area.x0), Math.round(area.y0), Math.round(area.x1), Math.round(area.y1)];
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return px;
  const grow = f.mode === 'color';
  const gx = grow ? Math.round((Math.abs(f.scaleX) / 2) * scale) : 0, gy = grow ? Math.round((Math.abs(f.scaleY) / 2) * scale) : 0;
  const a = f.color.a;
  const color = [f.color.r * (a / 255), f.color.g * (a / 255), f.color.b * (a / 255), a];
  for (let y = Math.max(0, y0 - gy); y < Math.min(height, y1 + gy); y++) {
    for (let x = Math.max(0, x0 - gx); x < Math.min(width, x1 + gx); x++) {
      const mx = Math.floor((x - area.x0 + 0.5) / scale - f.point.x), my = Math.floor((y - area.y0 + 0.5) / scale - f.point.y);
      let dx = 0, dy = 0;
      if (mx >= 0 && my >= 0 && mx < map.width && my < map.height) {
        const i = (my * map.width + mx) * 4;
        if (cx >= 0) dx = ((map.rgba[i + cx] - 128) * f.scaleX) / 256;
        if (cy >= 0) dy = ((map.rgba[i + cy] - 128) * f.scaleY) / 256;
      }
      let sx = x + Math.round(dx) * scale, sy = y + Math.round(dy) * scale;
      const o = (y * width + x) * 4;
      if (sx < x0 || sx >= x1 || sy < y0 || sy >= y1) {
        if (f.mode === 'ignore') continue;
        if (f.mode === 'color') { out.set(color, o); continue; }
        if (f.mode === 'clamp') { sx = Math.min(Math.max(sx, x0), x1 - 1); sy = Math.min(Math.max(sy, y0), y1 - 1); } else { sx = x0 + ((((sx - x0) % bw) + bw) % bw); sy = y0 + ((((sy - y0) % bh) + bh) % bh); }
      }
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) { out.fill(0, o, o + 4); continue; }
      const s = (Math.round(sy) * width + Math.round(sx)) * 4;
      out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2]; out[o + 3] = px[s + 3];
    }
  }
  return out;
}

function colorMatrix(px, m) {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    const k = a > 0 ? 255 / a : 0;
    const r = px[i] * k;
    const g = px[i + 1] * k;
    const b = px[i + 2] * k;
    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
    const na = clamp(m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19]);
    const pre = na / 255;
    px[i] = clamp(m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4]) * pre;
    px[i + 1] = clamp(m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9]) * pre;
    px[i + 2] = clamp(m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14]) * pre;
    px[i + 3] = na;
  }
}
