// flash.display: BitmapData と Bitmap。
//
// 画素は RGBA（アルファを掛けていない値）の配列で持つ。実機は、アルファを掛けた値（乗算済み）で持つので、
// 半透明の画素は書き込んだ色と少し違う色が読める。ここでは、書き込むときにその往復を行って同じ値にする。
// 大きさには上限を設ける（全体で 16,777,215 px。古い実機と同じ値で、今の実機はもっと大きなものも作れる）。
// 作るたびに、スクリプトの割り当ての上限から引く。
// 表示オブジェクトの描き込み（draw）は、描画側（movie.rasterize。ブラウザでは render/canvas.js）があるときだけできる。
// フィルタ（applyFilter）とパーリンノイズは未対応。
import { ASArray, ASObject, ASVector, publicKey } from './object.js';

const MAX_PIXELS = 16777215;

// 色の成分 c（0〜255）にアルファ a を掛ける・戻す。戻すほうは、255/a を 1/256 刻みに丸めた値を掛けて、端数を
// 「0.5 以下なら切り捨て」にする（実機の出力から求めた式。各アルファ値で実機と一致する）。
const premultiply = (c, a) => Math.round((c * a) / 255);
const unmultiply = (c, a) => Math.min(255, (c * Math.round(65280 / a) + 127) >> 8);

/**
 * @param {import('./vm.js').AVM2} vm
 * @param {import('../player/movie.js').Movie} movie
 */
export function installBitmap(vm, movie) {
  const c = vm.classes;
  const num = (v) => vm.toNumber(v);
  const int = (v) => vm.toInt32(v);
  const field = (obj, name) => num(obj.values.get(publicKey(name)));
  const invalid = () => vm.throwError('ArgumentError', 2015, 'Invalid BitmapData.');
  const B = (self) => (self.bitmap?.rgba ? self.bitmap : invalid());
  const need = (obj, klass, name) => {
    if (!(obj instanceof ASObject) || !obj.klass?.isSubclassOf?.(klass)) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`);
    return obj;
  };
  const other = (obj, name) => B(need(obj, c.BitmapData, name));
  // Rectangle を、ビットマップの範囲に収めた整数の矩形 { x0, y0, x1, y1 } にする。
  const area = (b, rect, name = 'rect') => {
    need(rect, c.Rectangle, name);
    const x = Math.round(field(rect, 'x')), y = Math.round(field(rect, 'y'));
    return { x0: Math.max(0, x), y0: Math.max(0, y), x1: Math.min(b.width, x + Math.round(field(rect, 'width'))), y1: Math.min(b.height, y + Math.round(field(rect, 'height'))) };
  };
  const whole = (b) => ({ x0: 0, y0: 0, x1: b.width, y1: b.height });
  const work = (r) => { if (r.x1 > r.x0 && r.y1 > r.y0) vm.step(((r.x1 - r.x0) * (r.y1 - r.y0)) >> 3); };
  const changed = (b) => { b.version++; };
  const create = (width, height, transparent) => {
    if (!(width >= 1 && height >= 1 && width * height <= MAX_PIXELS)) invalid();
    vm.charge((width * height) >> 4);
    return { width, height, transparent, rgba: new Uint8ClampedArray(width * height * 4), version: 0, type: 'bitmap' };
  };
  const wrap = (state) => Object.assign(new ASObject(c.BitmapData), { bitmap: state });
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
  const fill = (b, r, argb) => {
    work(r);
    const p = pixel(b, argb);
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) put(b, (y * b.width + x) * 4, p);
    changed(b);
  };
  // src の画素 (sr, sg, sb, sa) を、dst の位置 i の画素の上に重ねる。
  const over = (b, i, sr, sg, sb, sa) => {
    if (sa === 255) { put(b, i, [sr, sg, sb, 255]); return; }
    if (sa === 0) return;
    const d = b.rgba;
    const da = d[i + 3];
    const k = (da * (255 - sa)) / 255;
    const a = sa + k;
    put(b, i, [Math.round((sr * sa + d[i] * k) / a), Math.round((sg * sa + d[i + 1] * k) / a), Math.round((sb * sa + d[i + 2] * k) / a), b.transparent ? Math.round(a) : 255]);
  };
  // source の矩形 from を、dest の点 (dx, dy) へ写す。両方の範囲に収まる部分だけ。visit(dest の位置, source の位置) を呼ぶ。
  const transfer = (dest, source, rect, point, visit) => {
    need(rect, c.Rectangle, 'sourceRect');
    need(point, c.Point, 'destPoint');
    const sx = Math.round(field(rect, 'x')), sy = Math.round(field(rect, 'y'));
    const dx = Math.round(field(point, 'x')), dy = Math.round(field(point, 'y'));
    const x0 = Math.max(0, -sx, -dx), y0 = Math.max(0, -sy, -dy);
    const x1 = Math.min(Math.round(field(rect, 'width')), source.width - sx, dest.width - dx), y1 = Math.min(Math.round(field(rect, 'height')), source.height - sy, dest.height - dy);
    work({ x0, y0, x1, y1 });
    // 同じビットマップの中での写しでも壊れないように、元の画素は先に控える。
    const from = source === dest ? source.rgba.slice() : source.rgba;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) visit(((dy + y) * dest.width + dx + x) * 4, ((sy + y) * source.width + sx + x) * 4, from);
    changed(dest);
  };
  const CHANNEL = { 1: 0, 2: 1, 4: 2, 8: 3 }; // BitmapDataChannel の値 → RGBA の中の位置

  const symbolOf = (klass) => {
    for (let k = klass; k; k = k.superClass) {
      const def = movie.linkedCharacter(k.name);
      if (def?.type === 'bitmap') return def;
    }
    return null;
  };

  c.BitmapData = vm.defineClass({
    name: 'flash.display::BitmapData',
    // クラスに結び付けられた（埋め込みの）ビットマップがあれば、その写しを中身にする。
    allocate: (klass) => {
      const obj = new ASObject(klass);
      const def = symbolOf(klass);
      if (def?.rgba) {
        obj.bitmap = create(def.width, def.height, true);
        obj.bitmap.rgba.set(def.rgba);
      }
      return obj;
    },
    construct: (self, [width, height, transparent = true, fillColor = 0xffffffff]) => {
      if (self.bitmap) return; // 埋め込みのビットマップ
      self.bitmap = create(int(width), int(height), vm.toBoolean(transparent));
      fill(self.bitmap, whole(self.bitmap), vm.toUint32(fillColor));
    },
    getters: {
      width: (self) => B(self).width, height: (self) => B(self).height, transparent: (self) => B(self).transparent,
      rect: (self) => vm.construct(c.Rectangle, [0, 0, B(self).width, B(self).height]),
    },
    methods: {
      getPixel: (self, [x, y]) => { const b = B(self); return inside(b, int(x), int(y)) ? argbAt(b, (int(y) * b.width + int(x)) * 4) & 0xffffff : 0; },
      getPixel32: (self, [x, y]) => { const b = B(self); return inside(b, int(x), int(y)) ? argbAt(b, (int(y) * b.width + int(x)) * 4) : 0; },
      // setPixel は色だけを変える（アルファはそのまま）。
      setPixel: (self, [x, y, color]) => {
        const b = B(self);
        if (!inside(b, int(x), int(y))) return;
        const i = (int(y) * b.width + int(x)) * 4;
        put(b, i, pixel(b, ((b.rgba[i + 3] << 24) | (vm.toUint32(color) & 0xffffff)) >>> 0));
        changed(b);
      },
      setPixel32: (self, [x, y, color]) => { const b = B(self); if (inside(b, int(x), int(y))) { put(b, (int(y) * b.width + int(x)) * 4, pixel(b, vm.toUint32(color))); changed(b); } },
      fillRect: (self, [rect, color]) => { const b = B(self); fill(b, area(b, rect), vm.toUint32(color)); },
      clone: (self) => { const b = B(self); const copy = create(b.width, b.height, b.transparent); copy.rgba.set(b.rgba); return wrap(copy); },
      dispose: (self) => { if (self.bitmap) { self.bitmap.rgba = null; self.bitmap.version++; } },
      lock: () => {}, unlock: () => {},
      // copyPixels(元, 元の矩形, 先の点, アルファ用のビットマップ, その点, mergeAlpha): mergeAlpha が真なら、元を先の上に重ねる。
      copyPixels: (self, [source, rect, point, alphaSource = null, alphaPoint = null, mergeAlpha = false]) => {
        const b = B(self);
        const s = other(source, 'sourceBitmapData');
        const mask = alphaSource === null || alphaSource === undefined ? null : other(alphaSource, 'alphaBitmapData');
        const ax = mask && alphaPoint ? Math.round(field(alphaPoint, 'x')) : 0, ay = mask && alphaPoint ? Math.round(field(alphaPoint, 'y')) : 0;
        const sx = Math.round(field(need(rect, c.Rectangle, 'sourceRect'), 'x')), sy = Math.round(field(rect, 'y'));
        const merge = vm.toBoolean(mergeAlpha);
        transfer(b, s, rect, point, (di, si, from) => {
          let a = s.transparent ? from[si + 3] : 255;
          if (mask) {
            const px = (si / 4) % s.width - sx + ax, py = Math.floor(si / 4 / s.width) - sy + ay;
            a = inside(mask, px, py) ? Math.round((a * mask.rgba[(py * mask.width + px) * 4 + 3]) / 255) : 0;
          }
          // 先が不透明なビットマップなら、mergeAlpha の指定にかかわらず、上に重ねる（実機で確認）。
          if (merge || mask || !b.transparent) over(b, di, from[si], from[si + 1], from[si + 2], a);
          else put(b, di, [from[si], from[si + 1], from[si + 2], a]);
        });
      },
      copyChannel: (self, [source, rect, point, from, to]) => {
        const b = B(self);
        const s = other(source, 'sourceBitmapData');
        const si0 = CHANNEL[int(from)], di0 = CHANNEL[int(to)];
        if (si0 === undefined || di0 === undefined) return;
        transfer(b, s, rect, point, (di, si, data) => { if (di0 !== 3 || b.transparent) b.rgba[di + di0] = si0 === 3 && !s.transparent ? 255 : data[si + si0]; });
      },
      colorTransform: (self, [rect, ct]) => {
        const b = B(self);
        const r = area(b, rect);
        need(ct, c.ColorTransform, 'colorTransform');
        const m = ['red', 'green', 'blue', 'alpha'].map((ch) => [field(ct, `${ch}Multiplier`), field(ct, `${ch}Offset`)]);
        work(r);
        for (let y = r.y0; y < r.y1; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const i = (y * b.width + x) * 4;
            // 端数は切り捨てる（アルファ 255 の半分は 127。実機で確認）。
            const at = (k, v) => Math.max(0, Math.min(255, Math.floor(v * m[k][0] + m[k][1])));
            const a = b.transparent ? at(3, b.rgba[i + 3]) : 255;
            put(b, i, pixel(b, ((a << 24) | (at(0, b.rgba[i]) << 16) | (at(1, b.rgba[i + 1]) << 8) | at(2, b.rgba[i + 2])) >>> 0));
          }
        }
        changed(b);
      },
      // floodFill: (x, y) と同じ色でつながった範囲を塗る。
      floodFill: (self, [x, y, color]) => {
        const b = B(self);
        const px = int(x), py = int(y);
        if (!inside(b, px, py)) return;
        const target = argbAt(b, (py * b.width + px) * 4);
        const p = pixel(b, vm.toUint32(color));
        if (argbAt({ rgba: p }, 0) === target) return;
        const stack = [py * b.width + px];
        while (stack.length) {
          const at = stack.pop();
          if (argbAt(b, at * 4) !== target) continue;
          vm.step(1);
          put(b, at * 4, p);
          const cx = at % b.width;
          if (cx > 0) stack.push(at - 1);
          if (cx < b.width - 1) stack.push(at + 1);
          if (at >= b.width) stack.push(at - b.width);
          if (at < b.width * (b.height - 1)) stack.push(at + b.width);
        }
        changed(b);
      },
      scroll: (self, [x, y]) => {
        const b = B(self);
        const dx = int(x), dy = int(y);
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
      // (画素 & mask) が color に等しい（findColor が偽なら、等しくない）画素を囲む矩形。
      getColorBoundsRect: (self, [mask, color, findColor = true]) => {
        const b = B(self);
        const m = vm.toUint32(mask), want = vm.toUint32(color) & m, find = vm.toBoolean(findColor);
        let x0 = b.width, y0 = b.height, x1 = -1, y1 = -1;
        work(whole(b));
        for (let y = 0; y < b.height; y++) {
          for (let x = 0; x < b.width; x++) {
            if ((((argbAt(b, (y * b.width + x) * 4) & m) >>> 0) === (want >>> 0)) !== find) continue;
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
          }
        }
        return x1 < 0 ? vm.construct(c.Rectangle, [0, 0, 0, 0]) : vm.construct(c.Rectangle, [x0, y0, x1 - x0 + 1, y1 - y0 + 1]);
      },
      // hitTest(このビットマップの左上の点, アルファのしきい値, 相手): 相手は Point、Rectangle、または BitmapData（左上の点としきい値つき）。
      hitTest: (self, [firstPoint, threshold, second, secondPoint = null, secondThreshold = 1]) => {
        const b = B(self);
        const ox = Math.round(field(need(firstPoint, c.Point, 'firstPoint'), 'x')), oy = Math.round(field(firstPoint, 'y'));
        // 点との判定は「アルファがしきい値より大きい」、矩形との判定は「しきい値以上」（実機で確認）。
        const limit = vm.toUint32(threshold);
        const solid = (x, y) => inside(b, x, y) && b.rgba[(y * b.width + x) * 4 + 3] >= limit;
        if (second instanceof ASObject && second.klass === c.Point) {
          const x = Math.round(field(second, 'x')) - ox, y = Math.round(field(second, 'y')) - oy;
          return inside(b, x, y) && b.rgba[(y * b.width + x) * 4 + 3] > limit;
        }
        if (second instanceof ASObject && second.klass === c.Rectangle) {
          const r = area(b, vm.construct(c.Rectangle, [field(second, 'x') - ox, field(second, 'y') - oy, field(second, 'width'), field(second, 'height')]));
          work(r);
          for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (solid(x, y)) return true;
          return false;
        }
        const s = other(second, 'secondObject');
        const tx = secondPoint ? Math.round(field(secondPoint, 'x')) : 0, ty = secondPoint ? Math.round(field(secondPoint, 'y')) : 0;
        const limit1 = Math.max(1, limit), limit2 = Math.max(1, vm.toUint32(secondThreshold));
        work(whole(b));
        for (let y = 0; y < b.height; y++) {
          for (let x = 0; x < b.width; x++) {
            const sx = x + ox - tx, sy = y + oy - ty;
            if (b.rgba[(y * b.width + x) * 4 + 3] >= limit1 && inside(s, sx, sy) && s.rgba[(sy * s.width + sx) * 4 + 3] >= limit2) return true;
          }
        }
        return false;
      },
      // 画素を ARGB の 32 ビットの並びとして読み書きする。
      getVector: (self, [rect]) => {
        const b = B(self);
        const r = area(b, rect);
        work(r);
        const items = [];
        for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) items.push(argbAt(b, (y * b.width + x) * 4));
        return new ASVector(vm.applyType(c.Vector, [c.uint]), items);
      },
      setVector: (self, [rect, vector]) => {
        const b = B(self);
        const r = area(b, rect);
        if (!(vector instanceof ASVector) && !(vector instanceof ASArray)) vm.throwError('TypeError', 2007, 'Parameter inputVector must be non-null.');
        work(r);
        let at = 0;
        for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) put(b, (y * b.width + x) * 4, pixel(b, vm.toUint32(vector.items[at++])));
        changed(b);
      },
      getPixels: (self, [rect]) => {
        const b = B(self);
        const r = area(b, rect);
        work(r);
        const bytes = vm.construct(c.ByteArray, []);
        for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) vm.callProperty(bytes, vm.keyName('writeUnsignedInt'), [argbAt(b, (y * b.width + x) * 4)]);
        return bytes; // 位置は末尾のまま（読む側が先頭に戻す）
      },
      setPixels: (self, [rect, bytes]) => {
        const b = B(self);
        const r = area(b, rect);
        work(r);
        for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) put(b, (y * b.width + x) * 4, pixel(b, vm.toUint32(vm.callProperty(bytes, vm.keyName('readUnsignedInt'), []))));
        changed(b);
      },
      // noise: 乱数で埋める（乱数の列は実機と同じではない）。
      noise: (self, [seed, low = 0, high = 255, channels = 7, gray = false]) => {
        const b = B(self);
        let state = (int(seed) || 1) >>> 0;
        const next = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state; };
        const lo = Math.max(0, Math.min(255, int(low))), hi = Math.max(lo, Math.min(255, int(high)));
        const value = () => lo + (next() % (hi - lo + 1));
        work(whole(b));
        for (let i = 0; i < b.rgba.length; i += 4) {
          const g = value();
          const on = (bit) => (vm.toBoolean(gray) ? g : int(channels) & bit ? value() : 0);
          put(b, i, [on(1), on(2), on(4), b.transparent && int(channels) & 8 ? value() : 255]);
        }
        changed(b);
      },
      /**
       * draw(元, 行列, 色変換, ブレンド, 切り抜く矩形, なめらかにするか): 元（表示オブジェクトか BitmapData）を、行列で変形して上に重ねる。
       * 表示オブジェクトは、描画側が無ければ描けない（警告を残して何もしない）。
       */
      draw: (self, [source, matrix = null, colorTransform = null, blendMode = null, clipRect = null]) => {
        const b = B(self);
        if (!(source instanceof ASObject) || (!source.bitmap && !source.display?.worldMatrix)) vm.throwError('TypeError', 2007, 'Parameter source must be non-null.');
        const m = matrix === null || matrix === undefined ? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
          : Object.fromEntries(['a', 'b', 'c', 'd', 'tx', 'ty'].map((name) => [name, field(need(matrix, c.Matrix, 'matrix'), name)]));
        const clip = clipRect === null || clipRect === undefined ? whole(b) : area(b, clipRect, 'clipRect');
        const cx = colorTransform === null || colorTransform === undefined ? null
          : ['red', 'green', 'blue', 'alpha'].map((ch) => [field(need(colorTransform, c.ColorTransform, 'colorTransform'), `${ch}Multiplier`), field(colorTransform, `${ch}Offset`)]);
        void blendMode;
        work(clip);
        let image; // 先のビットマップと同じ大きさの RGBA（行列を当てた後の元の絵）
        if (source.bitmap) {
          const s = B(source);
          const det = m.a * m.d - m.b * m.c;
          if (det === 0) return;
          image = new Uint8ClampedArray(b.width * b.height * 4);
          for (let y = clip.y0; y < clip.y1; y++) {
            for (let x = clip.x0; x < clip.x1; x++) {
              // 先の画素の中心を、逆行列で元の座標へ戻す（いちばん近い画素を取る）。
              const px = x + 0.5 - m.tx, py = y + 0.5 - m.ty;
              const sx = Math.floor((m.d * px - m.c * py) / det), sy = Math.floor((m.a * py - m.b * px) / det);
              if (!inside(s, sx, sy)) continue;
              const si = (sy * s.width + sx) * 4, di = (y * b.width + x) * 4;
              image[di] = s.rgba[si]; image[di + 1] = s.rgba[si + 1]; image[di + 2] = s.rgba[si + 2]; image[di + 3] = s.rgba[si + 3];
            }
          }
        } else {
          image = movie.rasterize?.(source.display, m, b.width, b.height);
          if (!image) {
            movie.warn('BitmapData.draw of a display object needs a renderer');
            return;
          }
        }
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
      applyFilter: () => { movie.warn('BitmapData.applyFilter is not supported'); },
      perlinNoise: () => { movie.warn('BitmapData.perlinNoise is not supported'); },
    },
  });
  vm.defineClass({ name: 'flash.display::BitmapDataChannel', final: true, staticValues: { RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8 } });
  vm.defineClass({ name: 'flash.display::PixelSnapping', final: true, staticValues: { NEVER: 'never', ALWAYS: 'always', AUTO: 'auto' } });

  // --- Bitmap: BitmapData を表示する ---
  // 読み込んだ画像（Loader）の Bitmap は、その bitmapData を替えられるまで、読み込んだ画像を表示する。
  const show = (self) => {
    const loaded = self.loadedImage && self.bitmapData === self.loadedImage.data;
    self.display.setPicture(loaded ? self.loadedImage.def : self.bitmapData?.bitmap ?? null, self.smoothing ?? false);
  };
  /**
   * Loader で読み込んだ画像（JPEG / PNG / GIF）を表示する Bitmap を作る。ホストが画像を画素にできたら（def.rgba）、その BitmapData
   * （アルファの無い画像は、不透明な BitmapData。実機で確認）。できなければ、表示は描画側が行い、bitmapData は同じ大きさの透明な BitmapData。
   */
  vm.display.loadedBitmap = (def) => {
    if (def.rgba) {
      const pixels = create(def.width, def.height, def.transparent === true || !!def.alpha);
      pixels.rgba.set(def.rgba);
      return vm.construct(c.Bitmap, [wrap(pixels)]);
    }
    const data = wrap(create(def.width, def.height, true));
    const bitmap = vm.construct(c.Bitmap, [data]);
    bitmap.loadedImage = { def, data };
    show(bitmap);
    return bitmap;
  };
  c.Bitmap = vm.defineClass({
    name: 'flash.display::Bitmap', base: c.DisplayObject,
    construct: (self, [bitmapData = null, pixelSnapping = 'auto', smoothing = false]) => {
      self.display.leaf = true; // 子を持たず、マウスにも反応しない
      self.pixelSnapping = vm.toStr(pixelSnapping);
      self.smoothing = vm.toBoolean(smoothing);
      // クラスに結び付けられた（埋め込みの）ビットマップがあれば、それを表示する。
      const def = bitmapData === null || bitmapData === undefined ? symbolOf(self.klass) : null;
      if (def?.rgba) {
        const state = create(def.width, def.height, true);
        state.rgba.set(def.rgba);
        self.bitmapData = wrap(state);
      } else self.bitmapData = bitmapData === null || bitmapData === undefined ? null : need(bitmapData, c.BitmapData, 'bitmapData');
      show(self);
    },
    getters: { bitmapData: (self) => self.bitmapData ?? null, pixelSnapping: (self) => self.pixelSnapping ?? 'auto', smoothing: (self) => self.smoothing ?? false },
    setters: {
      bitmapData: (self, v) => { self.bitmapData = v === null || v === undefined ? null : need(v, c.BitmapData, 'bitmapData'); show(self); },
      pixelSnapping: (self, v) => { self.pixelSnapping = vm.toStr(v); },
      smoothing: (self, v) => { self.smoothing = vm.toBoolean(v); show(self); },
    },
  });
}
