// BitmapData の画素の操作（AS3 の flash.display.BitmapData と、AS2 の flash.display.BitmapData で共通）。VM に依存しない。
//
// ビットマップは { width, height, transparent, rgba（乗算済みでない RGBA）, version, type: 'bitmap' }。書き換えたら version を進める
// （描画側が画像を作り直す）。実機は、アルファを掛けた値（乗算済み）で持つので、半透明の画素は書き込んだ色と少し違う色が読める。
// ここでは、書き込むときにその往復を行って同じ値にする。矩形は { x0, y0, x1, y1 }（x1, y1 は含まない、整数）。
// 規則は、実機の AS3 の BitmapData で確かめた（test/as3/bitmap*.as）。

import { applyFilters } from '../render/filters.js';

export const MAX_PIXELS = 16777215; // 全体の画素数の上限（古い実機と同じ値。今の実機はもっと大きなものも作れる）

// 色の成分 c（0〜255）にアルファ a を掛ける・戻す。戻すほうは、255/a を 1/256 刻みに丸めた値を掛けて、端数を
// 「0.5 以下なら切り捨て」にする（実機の出力から求めた式。各アルファ値で実機と一致する）。
const premultiply = (c, a) => Math.round((c * a) / 255);
const unmultiply = (c, a) => Math.min(255, (c * Math.round(65280 / a) + 127) >> 8);

export const CHANNEL = { 1: 0, 2: 1, 4: 2, 8: 3 }; // BitmapDataChannel の値 → RGBA の中の位置

/**
 * 操作の一式を作る。host: { charge(n) 割り当ての上限から引く, step(n) 命令数の上限から引く, invalid() 大きさが不正なときに投げる }。
 */
export function bitmapOps({ charge = () => {}, step = () => {}, invalid = () => { throw new RangeError('invalid bitmap size'); } } = {}) {
  const work = (r) => { if (r.x1 > r.x0 && r.y1 > r.y0) step(((r.x1 - r.x0) * (r.y1 - r.y0)) >> 3); };
  const changed = (b) => { b.version++; };
  const whole = (b) => ({ x0: 0, y0: 0, x1: b.width, y1: b.height });
  const create = (width, height, transparent) => {
    if (!(width >= 1 && height >= 1 && width * height <= MAX_PIXELS)) invalid();
    charge((width * height) >> 4);
    return { width, height, transparent, rgba: new Uint8ClampedArray(width * height * 4), version: 0, type: 'bitmap' };
  };
  // ARGB の 32 ビットの色を、画素として持つ形 [r, g, b, a] にする（不透明なビットマップではアルファは 255）。
  const pixel = (b, argb) => {
    const a = b.transparent ? argb >>> 24 : 255;
    if (a === 0) return [0, 0, 0, 0];
    if (a === 255) return [(argb >> 16) & 0xff, (argb >> 8) & 0xff, argb & 0xff, 255];
    return [unmultiply(premultiply((argb >> 16) & 0xff, a), a), unmultiply(premultiply((argb >> 8) & 0xff, a), a), unmultiply(premultiply(argb & 0xff, a), a), a];
  };
  const put = (b, i, [r, g, bl, a]) => { b.rgba[i] = r; b.rgba[i + 1] = g; b.rgba[i + 2] = bl; b.rgba[i + 3] = a; };
  const argbAt = (b, i) => ((b.rgba[i + 3] << 24) | (b.rgba[i] << 16) | (b.rgba[i + 1] << 8) | b.rgba[i + 2]) >>> 0;
  const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.width && y < b.height;
  /** 矩形 { x, y, width, height }（px。四捨五入する）を、ビットマップの範囲に収めた整数の矩形にする。 */
  const clipRect = (b, { x, y, width, height }) => {
    const rx = Math.round(x), ry = Math.round(y);
    return { x0: Math.max(0, rx), y0: Math.max(0, ry), x1: Math.min(b.width, rx + Math.round(width)), y1: Math.min(b.height, ry + Math.round(height)) };
  };
  const fill = (b, r, argb) => {
    work(r);
    const p = pixel(b, argb);
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) put(b, (y * b.width + x) * 4, p);
    changed(b);
  };
  // 画素 (sr, sg, sb, sa) を、b の位置 i の画素の上に重ねる。
  const over = (b, i, sr, sg, sb, sa) => {
    if (sa === 255) { put(b, i, [sr, sg, sb, 255]); return; }
    if (sa === 0) return;
    const d = b.rgba;
    const da = d[i + 3];
    const k = (da * (255 - sa)) / 255;
    const a = sa + k;
    put(b, i, [Math.round((sr * sa + d[i] * k) / a), Math.round((sg * sa + d[i + 1] * k) / a), Math.round((sb * sa + d[i + 2] * k) / a), b.transparent ? Math.round(a) : 255]);
  };
  // source の矩形 rect（{ x, y, width, height }）を、dest の点 (dx, dy) へ写す。両方の範囲に収まる部分だけ。visit(dest の位置, source の位置, 元の画素) を呼ぶ。
  const transfer = (dest, source, rect, point, visit) => {
    const sx = Math.round(rect.x), sy = Math.round(rect.y), dx = Math.round(point.x), dy = Math.round(point.y);
    const x0 = Math.max(0, -sx, -dx), y0 = Math.max(0, -sy, -dy);
    const x1 = Math.min(Math.round(rect.width), source.width - sx, dest.width - dx), y1 = Math.min(Math.round(rect.height), source.height - sy, dest.height - dy);
    work({ x0, y0, x1, y1 });
    // 同じビットマップの中での写しでも壊れないように、元の画素は先に控える。
    const from = source === dest ? source.rgba.slice() : source.rgba;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) visit(((dy + y) * dest.width + dx + x) * 4, ((sy + y) * source.width + sx + x) * 4, from);
    changed(dest);
  };

  return {
    create, pixel, put, argbAt, inside, whole, work, changed, clipRect, fill, over,
    getPixel32: (b, x, y) => (inside(b, x, y) ? argbAt(b, (y * b.width + x) * 4) : 0),
    // setPixel は色だけを変える（アルファはそのまま）。
    setPixel: (b, x, y, rgb) => {
      if (!inside(b, x, y)) return;
      const i = (y * b.width + x) * 4;
      put(b, i, pixel(b, ((b.rgba[i + 3] << 24) | (rgb & 0xffffff)) >>> 0));
      changed(b);
    },
    setPixel32: (b, x, y, argb) => { if (inside(b, x, y)) { put(b, (y * b.width + x) * 4, pixel(b, argb)); changed(b); } },
    clone: (b) => { const copy = create(b.width, b.height, b.transparent); copy.rgba.set(b.rgba); return copy; },
    /**
     * copyPixels: source の rect を dest の point へ。mask（アルファ用のビットマップ）と maskPoint があれば、その点からのアルファを掛ける。
     * merge が真なら重ねる（先が不透明なビットマップなら、merge の指定にかかわらず重ねる。実機で確認）。
     */
    copyPixels: (b, s, rect, point, mask = null, maskPoint = null, merge = false) => {
      const ax = mask && maskPoint ? Math.round(maskPoint.x) : 0, ay = mask && maskPoint ? Math.round(maskPoint.y) : 0;
      const sx = Math.round(rect.x), sy = Math.round(rect.y);
      transfer(b, s, rect, point, (di, si, from) => {
        let a = s.transparent ? from[si + 3] : 255;
        if (mask) {
          const px = (si / 4) % s.width - sx + ax, py = Math.floor(si / 4 / s.width) - sy + ay;
          a = inside(mask, px, py) ? Math.round((a * mask.rgba[(py * mask.width + px) * 4 + 3]) / 255) : 0;
        }
        if (merge || mask || !b.transparent) over(b, di, from[si], from[si + 1], from[si + 2], a);
        else put(b, di, [from[si], from[si + 1], from[si + 2], a]);
      });
    },
    copyChannel: (b, s, rect, point, fromChannel, toChannel) => {
      const si0 = CHANNEL[fromChannel], di0 = CHANNEL[toChannel];
      if (si0 === undefined || di0 === undefined) return;
      transfer(b, s, rect, point, (di, si, data) => { if (di0 !== 3 || b.transparent) b.rgba[di + di0] = si0 === 3 && !s.transparent ? 255 : data[si + si0]; });
    },
    // 色変換。m は [[赤の倍率, 加算], [緑…], [青…], [アルファ…]]。端数は切り捨てる（アルファ 255 の半分は 127。実機で確認）。
    colorTransform: (b, r, m) => {
      work(r);
      const at = (k, v) => Math.max(0, Math.min(255, Math.floor(v * m[k][0] + m[k][1])));
      for (let y = r.y0; y < r.y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const i = (y * b.width + x) * 4;
          const a = b.transparent ? at(3, b.rgba[i + 3]) : 255;
          put(b, i, pixel(b, ((a << 24) | (at(0, b.rgba[i]) << 16) | (at(1, b.rgba[i + 1]) << 8) | at(2, b.rgba[i + 2])) >>> 0));
        }
      }
      changed(b);
    },
    // (x, y) と同じ色でつながった範囲を塗る。
    floodFill: (b, px, py, argb) => {
      if (!inside(b, px, py)) return;
      const target = argbAt(b, (py * b.width + px) * 4);
      const p = pixel(b, argb);
      if (argbAt({ rgba: p }, 0) === target) return;
      const stack = [py * b.width + px];
      while (stack.length) {
        const at = stack.pop();
        if (argbAt(b, at * 4) !== target) continue;
        step(1);
        put(b, at * 4, p);
        const cx = at % b.width;
        if (cx > 0) stack.push(at - 1);
        if (cx < b.width - 1) stack.push(at + 1);
        if (at >= b.width) stack.push(at - b.width);
        if (at < b.width * (b.height - 1)) stack.push(at + b.width);
      }
      changed(b);
    },
    scroll: (b, dx, dy) => {
      const from = b.rgba.slice();
      work(whole(b));
      for (let py = Math.max(0, dy); py < Math.min(b.height, b.height + dy); py++) {
        for (let px = Math.max(0, dx); px < Math.min(b.width, b.width + dx); px++) {
          const di = (py * b.width + px) * 4, si = ((py - dy) * b.width + px - dx) * 4;
          b.rgba[di] = from[si]; b.rgba[di + 1] = from[si + 1]; b.rgba[di + 2] = from[si + 2]; b.rgba[di + 3] = from[si + 3];
        }
      }
      changed(b);
    },
    // (画素 & mask) が color に等しい（find が偽なら、等しくない）画素を囲む矩形 { x, y, width, height }。
    colorBounds: (b, mask, color, find) => {
      const want = (color & mask) >>> 0;
      let x0 = b.width, y0 = b.height, x1 = -1, y1 = -1;
      work(whole(b));
      for (let y = 0; y < b.height; y++) {
        for (let x = 0; x < b.width; x++) {
          if ((((argbAt(b, (y * b.width + x) * 4) & mask) >>> 0) === want) !== find) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      return x1 < 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    },
    // 点との判定は「アルファがしきい値より大きい」、矩形との判定は「しきい値以上」（実機で確認）。
    hitPoint: (b, ox, oy, threshold, x, y) => inside(b, x - ox, y - oy) && b.rgba[((y - oy) * b.width + x - ox) * 4 + 3] > threshold,
    hitRect: (b, ox, oy, threshold, rect) => {
      const r = clipRect(b, { ...rect, x: rect.x - ox, y: rect.y - oy });
      work(r);
      for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (b.rgba[(y * b.width + x) * 4 + 3] >= threshold) return true;
      return false;
    },
    hitBitmap: (b, ox, oy, threshold, s, tx, ty, threshold2) => {
      const limit1 = Math.max(1, threshold), limit2 = Math.max(1, threshold2);
      work(whole(b));
      for (let y = 0; y < b.height; y++) {
        for (let x = 0; x < b.width; x++) {
          const sx = x + ox - tx, sy = y + oy - ty;
          if (b.rgba[(y * b.width + x) * 4 + 3] >= limit1 && inside(s, sx, sy) && s.rgba[(sy * s.width + sx) * 4 + 3] >= limit2) return true;
        }
      }
      return false;
    },
    // 乱数で埋める（乱数の列は実機と同じではない）。channels は BitmapDataChannel の和。
    noise: (b, seed, low, high, channels, gray) => {
      let state = (seed || 1) >>> 0;
      const next = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state; };
      const lo = Math.max(0, Math.min(255, low)), hi = Math.max(lo, Math.min(255, high));
      const value = () => lo + (next() % (hi - lo + 1));
      work(whole(b));
      for (let i = 0; i < b.rgba.length; i += 4) {
        const g = value();
        const on = (bit) => (gray ? g : channels & bit ? value() : 0);
        put(b, i, [on(1), on(2), on(4), b.transparent && channels & 8 ? value() : 255]);
      }
      changed(b);
    },
    /**
     * threshold: source の rect の各画素を (画素 & mask) と (threshold & mask) で比べ（op は < <= > >= == !=。32 ビットの符号なしで比べる）、
     * 当てはまれば color、当てはまらなければ copySource のときだけ元の画素を、b の point へ書く。当てはまった数を返す。op が不正なら null。
     */
    threshold: (b, s, rect, point, op, threshold, color, mask, copySource) => {
      const test = { '<': (x, y) => x < y, '<=': (x, y) => x <= y, '>': (x, y) => x > y, '>=': (x, y) => x >= y, '==': (x, y) => x === y, '!=': (x, y) => x !== y }[op];
      if (!test) return null;
      const want = (threshold & mask) >>> 0, p = pixel(b, color);
      let count = 0;
      transfer(b, s, rect, point, (di, si, from) => {
        const v = ((from[si + 3] << 24) | (from[si] << 16) | (from[si + 1] << 8) | from[si + 2]) >>> 0;
        if (test((v & mask) >>> 0, want)) { put(b, di, p); count++; } else if (copySource) put(b, di, pixel(b, v));
      });
      return count;
    },
    // merge: 各成分を (元 × 倍率 + 先 × (256 − 倍率)) / 256 にする（倍率は 0〜256）。不透明な画素で実機と一致する（半透明の画素は、端数が 1 違うことがある）。
    merge: (b, s, rect, point, mults) => {
      const k = mults.map((m) => Math.max(0, Math.min(256, m)));
      transfer(b, s, rect, point, (di, si, from) => {
        const d = b.rgba;
        const mix = (c, m) => Math.floor((from[si + c] * m + d[di + c] * (256 - m)) / 256);
        put(b, di, pixel(b, ((mix(3, k[3]) << 24) | (mix(0, k[0]) << 16) | (mix(1, k[1]) << 8) | mix(2, k[2])) >>> 0));
      });
    },
    // paletteMap: 成分ごとの表（256 個の ARGB。null の成分は、その成分そのもの）の値を足したものを、新しい画素にする。
    paletteMap: (b, s, rect, point, tables) => {
      const shift = [16, 8, 0, 24];
      transfer(b, s, rect, point, (di, si, from) => {
        let v = 0;
        for (let c = 0; c < 4; c++) v += tables[c] ? tables[c][from[si + c]] >>> 0 : (from[si + c] << shift[c]) >>> 0;
        put(b, di, pixel(b, v >>> 0));
      });
    },
    /**
     * compare: 同じなら 0、幅が違えば -3、高さが違えば -4。違えば差のビットマップ（色が違う画素は 0xFF と成分ごとの差（下位 8 ビット）、
     * アルファだけが違う画素は 0xFFFFFF とアルファの差、同じ画素は 0。実機で確認）。
     */
    compare: (a, o) => {
      if (a.width !== o.width) return -3;
      if (a.height !== o.height) return -4;
      const out = create(a.width, a.height, true);
      let same = true;
      for (let i = 0; i < a.rgba.length; i += 4) {
        const [r, g, bl, al] = [0, 1, 2, 3].map((c) => (a.rgba[i + c] - o.rgba[i + c]) & 0xff);
        if (r || g || bl) { put(out, i, [r, g, bl, 255]); same = false; } else if (al) { put(out, i, [255, 255, 255, al]); same = false; }
      }
      return same ? 0 : out;
    },
    /** applyFilter: source の rect を、フィルタ desc（表示オブジェクトのフィルタと同じ形式）にかけて、b の point へ書く（重ねずに置き換える）。 */
    applyFilter: (b, s, rect, point, desc) => {
      const sx = Math.round(rect.x), sy = Math.round(rect.y), w = Math.round(rect.width), h = Math.round(rect.height);
      if (!(w > 0 && h > 0)) return;
      const tmp = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(s, sx + x, sy + y)) tmp.set(s.rgba.subarray(((sy + y) * s.width + sx + x) * 4, ((sy + y) * s.width + sx + x) * 4 + 4), (y * w + x) * 4);
      work({ x0: 0, y0: 0, x1: w, y1: h });
      const { rgba } = applyFilters(tmp, w, h, [desc], 1);
      const result = { width: w, height: h, rgba, transparent: true };
      transfer(b, result, { x: 0, y: 0, width: w, height: h }, point, (di, si, from) => put(b, di, pixel(b, ((from[si + 3] << 24) | (from[si] << 16) | (from[si + 1] << 8) | from[si + 2]) >>> 0)));
    },
    /**
     * perlinNoise: パーリンノイズで埋める。乱数の列と雑音の作り方は実機と同じではない（値は一致しない）が、周波数（baseX / baseY px で
     * 1 周期）、オクターブ（ひとつ上がるごとに周波数 2 倍・強さ半分）、stitch（端でつながる）、fractal（偽なら乱流 = 絶対値の和）、
     * 成分の選び方と灰色は仕様どおり。offsets はオクターブごとの位置のずれ（{ x, y } の配列）。
     */
    perlinNoise: (b, baseX, baseY, octaves, seed, stitch, fractal, channels, gray, offsets) => {
      let state = (Math.abs(seed) || 1) >>> 0;
      const rand = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state; };
      const perm = Array.from({ length: 256 }, (_, i) => i);
      for (let i = 255; i > 0; i--) { const j = rand() % (i + 1); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      const grads = Array.from({ length: 4 }, () => Array.from({ length: 256 }, () => { const a = (rand() / 4294967296) * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; }));
      const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
      const noise = (ch, x, y, wrapX, wrapY) => {
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        const g = (ix, iy) => {
          const gx = wrapX ? ((ix % wrapX) + wrapX) % wrapX : ix, gy = wrapY ? ((iy % wrapY) + wrapY) % wrapY : iy;
          return grads[ch][perm[(perm[gx & 255] + gy) & 255]];
        };
        const dot = (ix, iy) => { const v = g(ix, iy); return v[0] * (x - ix) + v[1] * (y - iy); };
        const u = fade(fx), v = fade(fy);
        const a = dot(x0, y0) + (dot(x0 + 1, y0) - dot(x0, y0)) * u, c = dot(x0, y0 + 1) + (dot(x0 + 1, y0 + 1) - dot(x0, y0 + 1)) * u;
        return a + (c - a) * v; // おおよそ -0.7〜0.7
      };
      const bx = Math.max(1, Math.abs(baseX)), by = Math.max(1, Math.abs(baseY));
      const used = [1, 2, 4, 8].map((bit) => (channels & bit) !== 0);
      work(whole(b));
      for (let y = 0; y < b.height; y++) {
        for (let x = 0; x < b.width; x++) {
          const out = [0, 0, 0, 0];
          for (let ch = 0; ch < 4; ch++) {
            if (!(gray ? ch === 0 || ch === 3 : used[ch])) continue;
            let sum = 0, amp = 1, freqX = 1 / bx, freqY = 1 / by, total = 0;
            for (let o = 0; o < Math.max(1, octaves); o++) {
              const off = offsets?.[o] ?? { x: 0, y: 0 };
              const wrapX = stitch ? Math.max(1, Math.round(b.width * freqX)) : 0, wrapY = stitch ? Math.max(1, Math.round(b.height * freqY)) : 0;
              const n = noise(ch, (x + off.x) * freqX, (y + off.y) * freqY, wrapX, wrapY);
              sum += (fractal ? n : Math.abs(n)) * amp;
              total += amp;
              amp /= 2; freqX *= 2; freqY *= 2;
            }
            const v = sum / total;
            out[ch] = Math.max(0, Math.min(255, Math.round(fractal ? (v / 1.4 + 0.5) * 255 : (v / 0.7) * 255)));
          }
          const a = b.transparent && used[3] ? out[3] : 255;
          if (gray) out[1] = out[2] = out[0];
          put(b, (y * b.width + x) * 4, pixel(b, ((a << 24) | (out[0] << 16) | (out[1] << 8) | out[2]) >>> 0));
        }
      }
      changed(b);
    },
    /**
     * pixelDissolve: 元の rect の画素のうち count 個を、乱数で選んだ位置に写す（元と先が同じなら color で埋める）。次に渡す種を返す。
     * 選ぶ順番は実機と同じではない。
     */
    pixelDissolve: (b, s, rect, point, seed, count, color) => {
      const sx = Math.round(rect.x), sy = Math.round(rect.y), w = Math.round(rect.width), h = Math.round(rect.height);
      const n = w * h;
      if (!(n > 0)) return seed;
      let state = (seed >>> 0) || 1;
      const next = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state; };
      const dx = Math.round(point.x), dy = Math.round(point.y), p = pixel(b, color);
      const from = s.rgba.slice();
      step(Math.min(count, n));
      for (let i = 0; i < Math.min(count, n); i++) {
        const k = next() % n, x = k % w, y = Math.floor(k / w);
        if (!inside(b, dx + x, dy + y) || !inside(s, sx + x, sy + y)) continue;
        const di = ((dy + y) * b.width + dx + x) * 4, si = ((sy + y) * s.width + sx + x) * 4;
        if (s === b) put(b, di, p); else put(b, di, [from[si], from[si + 1], from[si + 2], b.transparent ? from[si + 3] : 255]);
      }
      changed(b);
      return state | 0;
    },
    /** 元のビットマップ s を、行列 m（{ a, b, c, d, tx, ty }、px）で写した絵（b と同じ大きさの RGBA）。clip の外は透明。いちばん近い画素を取る。 */
    transformed: (b, s, m, clip) => {
      const det = m.a * m.d - m.b * m.c;
      if (det === 0) return null;
      const image = new Uint8ClampedArray(b.width * b.height * 4);
      for (let y = clip.y0; y < clip.y1; y++) {
        for (let x = clip.x0; x < clip.x1; x++) {
          const px = x + 0.5 - m.tx, py = y + 0.5 - m.ty;
          const sx = Math.floor((m.d * px - m.c * py) / det), sy = Math.floor((m.a * py - m.b * px) / det);
          if (!inside(s, sx, sy)) continue;
          const si = (sy * s.width + sx) * 4, di = (y * b.width + x) * 4;
          image[di] = s.rgba[si]; image[di + 1] = s.rgba[si + 1]; image[di + 2] = s.rgba[si + 2]; image[di + 3] = s.rgba[si + 3];
        }
      }
      return image;
    },
    /** 絵 image（b と同じ大きさの RGBA）を、clip の範囲で b の上に重ねる。cx は色変換（colorTransform と同じ形、null なら無し）。 */
    drawImage: (b, image, clip, cx) => {
      const tint = (v, [mul, add]) => Math.max(0, Math.min(255, Math.floor(v * mul + add)));
      for (let y = clip.y0; y < clip.y1; y++) {
        for (let x = clip.x0; x < clip.x1; x++) {
          const i = (y * b.width + x) * 4;
          if (cx) over(b, i, tint(image[i], cx[0]), tint(image[i + 1], cx[1]), tint(image[i + 2], cx[2]), tint(image[i + 3], cx[3]));
          else over(b, i, image[i], image[i + 1], image[i + 2], image[i + 3]);
        }
      }
      changed(b);
    },
  };
}
