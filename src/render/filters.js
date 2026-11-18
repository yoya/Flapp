// 表示オブジェクトのフィルタ（ぼかし・影・光彩・色行列）。DOM に依存しない画素演算。
// 未対応: ベベル、グラデーション光彩、グラデーションベベル、畳み込み。

/**
 * @param {Uint8ClampedArray} rgba   乗算済みでない RGBA（Canvas の ImageData と同じ並び）
 * @param {number} width
 * @param {number} height
 * @param {object[]} filters        parsePlaceObject の filters
 * @param {number} scale            ステージ 1px あたりのデバイスピクセル数（ぼかし量と距離に掛かる）
 * @returns {{ rgba: Uint8ClampedArray, unsupported: string[] }}
 */
export function applyFilters(rgba, width, height, filters, scale) {
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
    } else if (f.type === 'colorMatrix') {
      colorMatrix(px, f.matrix);
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

// 影と光彩。元の絵のアルファをずらしてぼかし、指定の色を付けて元の絵と合成する。
function shadow(px, width, height, f, scale) {
  const n = width * height;
  const dx = f.type === 'dropShadow' ? Math.round(Math.cos(f.angle) * f.distance * scale) : 0;
  const dy = f.type === 'dropShadow' ? Math.round(Math.sin(f.angle) * f.distance * scale) : 0;
  const alpha = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const sy = y - dy;
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      const a = sx >= 0 && sx < width && sy >= 0 && sy < height ? px[(sy * width + sx) * 4 + 3] : 0;
      alpha[y * width + x] = f.inner ? 255 - a : a; // 内側の影は「絵の無いところ」から落ちる
    }
  }
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

// 色行列（4 行 5 列）。乗算前の RGBA に対して計算する。
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
