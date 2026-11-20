// flash.display: BitmapData と Bitmap。画素の操作は player/bitmapops.js（AS2 の BitmapData と共通）。
//
// 大きさには上限を設ける（全体で 16,777,215 px）。作るたびに、スクリプトの割り当ての上限から引く。
// 表示オブジェクトの描き込み（draw）は、描画側（movie.rasterize。ブラウザでは render/canvas.js）があるときだけできる。
// フィルタ（applyFilter）とパーリンノイズは未対応。
import { bitmapOps } from '../player/bitmapops.js';
import { ASArray, ASObject, ASVector, publicKey } from './object.js';

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
  const ops = bitmapOps({ charge: (n) => vm.charge(n), step: (n) => vm.step(n), invalid });
  const { create, pixel, put, argbAt, inside, whole, work, changed, fill } = ops;
  const rectOf = (r, name) => { need(r, c.Rectangle, name); return { x: field(r, 'x'), y: field(r, 'y'), width: field(r, 'width'), height: field(r, 'height') }; };
  const pointOf = (p, name) => { need(p, c.Point, name); return { x: field(p, 'x'), y: field(p, 'y') }; };
  // Rectangle を、ビットマップの範囲に収めた整数の矩形 { x0, y0, x1, y1 } にする。
  const area = (b, rect, name = 'rect') => ops.clipRect(b, rectOf(rect, name));
  const wrap = (state) => Object.assign(new ASObject(c.BitmapData), { bitmap: state });
  const ctOf = (ct) => ['red', 'green', 'blue', 'alpha'].map((ch) => [field(ct, `${ch}Multiplier`), field(ct, `${ch}Offset`)]);

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
      getPixel: (self, [x, y]) => ops.getPixel32(B(self), int(x), int(y)) & 0xffffff,
      getPixel32: (self, [x, y]) => ops.getPixel32(B(self), int(x), int(y)),
      setPixel: (self, [x, y, color]) => ops.setPixel(B(self), int(x), int(y), vm.toUint32(color)),
      setPixel32: (self, [x, y, color]) => ops.setPixel32(B(self), int(x), int(y), vm.toUint32(color)),
      fillRect: (self, [rect, color]) => { const b = B(self); fill(b, area(b, rect), vm.toUint32(color)); },
      clone: (self) => wrap(ops.clone(B(self))),
      dispose: (self) => { if (self.bitmap) { self.bitmap.rgba = null; self.bitmap.version++; } },
      lock: () => {}, unlock: () => {},
      // copyPixels(元, 元の矩形, 先の点, アルファ用のビットマップ, その点, mergeAlpha): mergeAlpha が真なら、元を先の上に重ねる。
      copyPixels: (self, [source, rect, point, alphaSource = null, alphaPoint = null, mergeAlpha = false]) => {
        const b = B(self), s = other(source, 'sourceBitmapData');
        const mask = alphaSource === null || alphaSource === undefined ? null : other(alphaSource, 'alphaBitmapData');
        const r = rectOf(rect, 'sourceRect'), p = pointOf(point, 'destPoint');
        ops.copyPixels(b, s, r, p, mask, mask && alphaPoint ? { x: field(alphaPoint, 'x'), y: field(alphaPoint, 'y') } : null, vm.toBoolean(mergeAlpha));
      },
      copyChannel: (self, [source, rect, point, from, to]) => {
        const b = B(self), s = other(source, 'sourceBitmapData');
        ops.copyChannel(b, s, rectOf(rect, 'sourceRect'), pointOf(point, 'destPoint'), int(from), int(to));
      },
      colorTransform: (self, [rect, ct]) => { const b = B(self); const r = area(b, rect); ops.colorTransform(b, r, ctOf(need(ct, c.ColorTransform, 'colorTransform'))); },
      floodFill: (self, [x, y, color]) => ops.floodFill(B(self), int(x), int(y), vm.toUint32(color)),
      scroll: (self, [x, y]) => ops.scroll(B(self), int(x), int(y)),
      getColorBoundsRect: (self, [mask, color, findColor = true]) => {
        const r = ops.colorBounds(B(self), vm.toUint32(mask), vm.toUint32(color), vm.toBoolean(findColor));
        return vm.construct(c.Rectangle, [r.x, r.y, r.width, r.height]);
      },
      // hitTest(このビットマップの左上の点, アルファのしきい値, 相手): 相手は Point、Rectangle、または BitmapData（左上の点としきい値つき）。
      hitTest: (self, [firstPoint, threshold, second, secondPoint = null, secondThreshold = 1]) => {
        const b = B(self);
        const o = pointOf(firstPoint, 'firstPoint'), ox = Math.round(o.x), oy = Math.round(o.y);
        const limit = vm.toUint32(threshold);
        if (second instanceof ASObject && second.klass === c.Point) return ops.hitPoint(b, ox, oy, limit, Math.round(field(second, 'x')), Math.round(field(second, 'y')));
        if (second instanceof ASObject && second.klass === c.Rectangle) return ops.hitRect(b, ox, oy, limit, rectOf(second, 'secondObject'));
        const s = other(second, 'secondObject');
        const tx = secondPoint ? Math.round(field(secondPoint, 'x')) : 0, ty = secondPoint ? Math.round(field(secondPoint, 'y')) : 0;
        return ops.hitBitmap(b, ox, oy, limit, s, tx, ty, vm.toUint32(secondThreshold));
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
      noise: (self, [seed, low = 0, high = 255, channels = 7, gray = false]) => ops.noise(B(self), int(seed), int(low), int(high), int(channels), vm.toBoolean(gray)),
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
        const cx = colorTransform === null || colorTransform === undefined ? null : ctOf(need(colorTransform, c.ColorTransform, 'colorTransform'));
        void blendMode;
        work(clip);
        const image = source.bitmap ? ops.transformed(b, B(source), m, clip) : movie.rasterize?.(source.display, m, b.width, b.height);
        if (!image) {
          if (!source.bitmap) movie.warn('BitmapData.draw of a display object needs a renderer');
          return;
        }
        ops.drawImage(b, image, clip, cx);
      },
      // threshold(元, 矩形, 点, 比べ方, しきい値, 色, マスク, 元を写すか): 当てはまった画素の数。比べ方が不正なら ArgumentError #2005（実機で確認）。
      threshold: (self, [source, rect, point, operation, threshold, color = 0, mask = 0xffffffff, copySource = false]) => {
        const n = ops.threshold(B(self), other(source, 'sourceBitmapData'), rectOf(rect, 'sourceRect'), pointOf(point, 'destPoint'), vm.toStr(operation), vm.toUint32(threshold), vm.toUint32(color), vm.toUint32(mask), vm.toBoolean(copySource));
        if (n === null) vm.throwError('ArgumentError', 2005, 'Parameter 0 is of the incorrect type.');
        return n;
      },
      merge: (self, [source, rect, point, r, g, b, a]) => ops.merge(B(self), other(source, 'sourceBitmapData'), rectOf(rect, 'sourceRect'), pointOf(point, 'destPoint'), [r, g, b, a].map((v) => vm.toUint32(v))),
      paletteMap: (self, [source, rect, point, r = null, g = null, b = null, a = null]) => {
        const table = (v) => (v instanceof ASArray ? Array.from({ length: 256 }, (_, i) => vm.toUint32(v.items[i] ?? 0)) : null);
        ops.paletteMap(B(self), other(source, 'sourceBitmapData'), rectOf(rect, 'sourceRect'), pointOf(point, 'destPoint'), [r, g, b, a].map(table));
      },
      compare: (self, [o]) => { const r = ops.compare(B(self), other(o, 'otherBitmapData')); return typeof r === 'number' ? r : wrap(r); },
      // applyFilter(元, 矩形, 点, フィルタ): フィルタが null なら TypeError #2007（実機で確認）。
      applyFilter: (self, [source, rect, point, filter]) => {
        const desc = filter === null || filter === undefined ? vm.throwError('TypeError', 2007, 'Parameter filter must be non-null.') : vm.filterDesc?.(filter);
        if (desc) ops.applyFilter(B(self), other(source, 'sourceBitmapData'), rectOf(rect, 'sourceRect'), pointOf(point, 'destPoint'), desc);
      },
      // generateFilterRect: フィルタで広がる範囲。ぼかしは 1 回に (量 − 1) / 2 px ずつ、回数ぶん（端数は切り上げ）。影はずらした分も含める。
      generateFilterRect: (self, [rect, filter]) => {
        B(self);
        const r = rectOf(rect, 'sourceRect');
        const d = filter === null || filter === undefined ? vm.throwError('TypeError', 2007, 'Parameter filter must be non-null.') : vm.filterDesc?.(filter);
        if (!d || d.blurX === undefined || d.inner) return vm.construct(c.Rectangle, [r.x, r.y, r.width, r.height]);
        const ex = Math.ceil(Math.max(0, d.blurX - 1) / 2 * d.passes), ey = Math.ceil(Math.max(0, d.blurY - 1) / 2 * d.passes);
        const dx = d.distance ? Math.cos(d.angle) * d.distance : 0, dy = d.distance ? Math.sin(d.angle) * d.distance : 0;
        const x0 = Math.min(r.x, r.x + dx - ex), y0 = Math.min(r.y, r.y + dy - ey), x1 = Math.max(r.x + r.width, r.x + r.width + dx + ex), y1 = Math.max(r.y + r.height, r.y + r.height + dy + ey);
        return vm.construct(c.Rectangle, [Math.floor(x0), Math.floor(y0), Math.ceil(x1) - Math.floor(x0), Math.ceil(y1) - Math.floor(y0)]);
      },
      perlinNoise: (self, [baseX, baseY, octaves, seed, stitch, fractal, channels = 7, gray = false, offsets = null]) => {
        const offs = offsets instanceof ASArray ? offsets.items.map((p) => (p instanceof ASObject ? { x: field(p, 'x'), y: field(p, 'y') } : { x: 0, y: 0 })) : null;
        ops.perlinNoise(B(self), num(baseX), num(baseY), Math.min(int(octaves), 16), int(seed), vm.toBoolean(stitch), vm.toBoolean(fractal), int(channels), vm.toBoolean(gray), offs);
      },
      pixelDissolve: (self, [source, rect, point, seed = 0, count = 0, color = 0]) => ops.pixelDissolve(B(self), other(source, 'sourceBitmapData'), rectOf(rect, 'sourceRect'), pointOf(point, 'destPoint'), int(seed), int(count), vm.toUint32(color)),
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
