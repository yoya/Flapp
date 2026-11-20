// AS2（SWF 8）の flash.geom（Point・Rectangle・Matrix・ColorTransform・Transform）と flash.display.BitmapData、
// MovieClip の transform・attachBitmap・beginBitmapFill。画素の操作は player/bitmapops.js（AS3 の BitmapData と共通）。
// AS3 との違い（実機で確認。test/as/geombitmap.as）: メソッドとプロパティは列挙される。Point などは値を数に直さずに持つ。
// getPixel32 は符号付きの整数。BitmapData の矩形は rectangle。大きさが 1〜2880 の外なら new が undefined になる。
// 捨てた（dispose）BitmapData の width・height・getPixel は -1。
import { bitmapOps } from '../player/bitmapops.js';
import { toBool, toInt32, toNumber, toStr } from './convert.js';
import { AVMObject, DONT_DELETE, DONT_ENUM } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const MAX_SIDE = 2880; // 1 辺の上限（SWF 8 の実機）

export function installGeom(vm) {
  const num = (v) => toNumber(vm, v);
  const int = (v) => toInt32(vm, v);
  // 列挙されるメソッド（AS2 の flash.geom のクラスは、メソッドが列挙される。実機で確認）。
  const methods = (obj, list) => { for (const [name, fn] of Object.entries(list)) obj.set(name, vm.native(fn)); };
  const accessor = (obj, name, get, set) => obj.defineAccessor(name, vm.native((_, self) => get(self)), set ? vm.native((_, self, [v]) => { set(self, v); }) : null, 0);
  const pkg = (name) => {
    let flash = vm.global.get('flash');
    if (!(flash instanceof AVMObject)) { flash = new AVMObject(vm, vm.objectProto); vm.global.define('flash', flash, DONT_ENUM); }
    let p = flash.get(name);
    if (!(p instanceof AVMObject)) { p = new AVMObject(vm, vm.objectProto); flash.define(name, p, HIDDEN); }
    return p;
  };
  const geom = pkg('geom'), display = pkg('display');
  const klass = (where, name, proto, construct, statics = {}) => {
    const ctor = vm.native(() => undefined, construct);
    ctor.define('prototype', proto, HIDDEN);
    proto.define('constructor', ctor, HIDDEN);
    methods(ctor, statics);
    where.define(name, ctor, HIDDEN);
    return ctor;
  };
  const arg = (v, otherwise) => (v === undefined ? otherwise : v);

  // --- Point ---
  const pointProto = new AVMObject(vm, vm.objectProto);
  const point = (x, y) => { const p = new AVMObject(vm, pointProto); p.set('x', x); p.set('y', y); return p; };
  const xy = (p) => (p instanceof AVMObject ? { x: num(p.get('x')), y: num(p.get('y')) } : { x: NaN, y: NaN });
  accessor(pointProto, 'length', (self) => Math.hypot(num(self.get('x')), num(self.get('y'))));
  methods(pointProto, {
    add: (_, self, [o]) => point(num(self.get('x')) + xy(o).x, num(self.get('y')) + xy(o).y),
    subtract: (_, self, [o]) => point(num(self.get('x')) - xy(o).x, num(self.get('y')) - xy(o).y),
    clone: (_, self) => point(self.get('x'), self.get('y')),
    equals: (_, self, [o]) => o instanceof AVMObject && num(self.get('x')) === num(o.get('x')) && num(self.get('y')) === num(o.get('y')),
    normalize: (_, self, [len]) => {
      const x = num(self.get('x')), y = num(self.get('y')), l = Math.hypot(x, y);
      if (l > 0) { self.set('x', (x / l) * num(len)); self.set('y', (y / l) * num(len)); }
    },
    offset: (_, self, [dx, dy]) => { self.set('x', num(self.get('x')) + num(dx)); self.set('y', num(self.get('y')) + num(dy)); },
    toString: (_, self) => `(x=${toStr(vm, self.get('x'))}, y=${toStr(vm, self.get('y'))})`,
  });
  klass(geom, 'Point', pointProto, (_, [x, y]) => point(arg(x, 0), arg(y, 0)), {
    distance: (_, __, [a, b]) => Math.hypot(xy(a).x - xy(b).x, xy(a).y - xy(b).y),
    interpolate: (_, __, [a, b, f]) => { const t = num(f); return point(xy(b).x + (xy(a).x - xy(b).x) * t, xy(b).y + (xy(a).y - xy(b).y) * t); },
    polar: (_, __, [len, angle]) => point(num(len) * Math.cos(num(angle)), num(len) * Math.sin(num(angle))),
  });

  // --- Rectangle ---
  const rectProto = new AVMObject(vm, vm.objectProto);
  const rect = (x, y, w, h) => { const r = new AVMObject(vm, rectProto); r.set('x', x); r.set('y', y); r.set('width', w); r.set('height', h); return r; };
  const xywh = (r) => (r instanceof AVMObject ? { x: num(r.get('x')), y: num(r.get('y')), width: num(r.get('width')), height: num(r.get('height')) } : { x: NaN, y: NaN, width: NaN, height: NaN });
  const R = (self) => xywh(self);
  const setR = (self, r) => { self.set('x', r.x); self.set('y', r.y); self.set('width', r.width); self.set('height', r.height); };
  accessor(rectProto, 'left', (s) => R(s).x, (s, v) => { const r = R(s); setR(s, { ...r, x: num(v), width: r.width + r.x - num(v) }); });
  accessor(rectProto, 'right', (s) => R(s).x + R(s).width, (s, v) => { const r = R(s); setR(s, { ...r, width: num(v) - r.x }); });
  accessor(rectProto, 'top', (s) => R(s).y, (s, v) => { const r = R(s); setR(s, { ...r, y: num(v), height: r.height + r.y - num(v) }); });
  accessor(rectProto, 'bottom', (s) => R(s).y + R(s).height, (s, v) => { const r = R(s); setR(s, { ...r, height: num(v) - r.y }); });
  accessor(rectProto, 'topLeft', (s) => point(R(s).x, R(s).y), (s, v) => { const r = R(s), p = xy(v); setR(s, { x: p.x, y: p.y, width: r.width + r.x - p.x, height: r.height + r.y - p.y }); });
  accessor(rectProto, 'bottomRight', (s) => point(R(s).x + R(s).width, R(s).y + R(s).height), (s, v) => { const r = R(s), p = xy(v); setR(s, { ...r, width: p.x - r.x, height: p.y - r.y }); });
  accessor(rectProto, 'size', (s) => point(R(s).width, R(s).height), (s, v) => { const p = xy(v); setR(s, { ...R(s), width: p.x, height: p.y }); });
  const empty = (r) => !(r.width > 0 && r.height > 0);
  methods(rectProto, {
    clone: (_, self) => rect(self.get('x'), self.get('y'), self.get('width'), self.get('height')),
    contains: (_, self, [x, y]) => { const r = R(self), px = num(x), py = num(y); return px >= r.x && py >= r.y && px < r.x + r.width && py < r.y + r.height; },
    containsPoint: (_, self, [p]) => { const r = R(self), q = xy(p); return q.x >= r.x && q.y >= r.y && q.x < r.x + r.width && q.y < r.y + r.height; },
    containsRectangle: (_, self, [o]) => { const r = R(self), q = xywh(o); return q.x >= r.x && q.y >= r.y && q.x + q.width <= r.x + r.width && q.y + q.height <= r.y + r.height; },
    equals: (_, self, [o]) => { const r = R(self), q = xywh(o); return o instanceof AVMObject && r.x === q.x && r.y === q.y && r.width === q.width && r.height === q.height; },
    inflate: (_, self, [dx, dy]) => { const r = R(self); setR(self, { x: r.x - num(dx), y: r.y - num(dy), width: r.width + 2 * num(dx), height: r.height + 2 * num(dy) }); },
    inflatePoint: (_, self, [p]) => { const r = R(self), q = xy(p); setR(self, { x: r.x - q.x, y: r.y - q.y, width: r.width + 2 * q.x, height: r.height + 2 * q.y }); },
    intersection: (_, self, [o]) => {
      const a = R(self), b = xywh(o);
      const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
      return x1 > x0 && y1 > y0 ? rect(x0, y0, x1 - x0, y1 - y0) : rect(0, 0, 0, 0);
    },
    intersects: (_, self, [o]) => {
      const a = R(self), b = xywh(o);
      return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
    },
    isEmpty: (_, self) => empty(R(self)),
    offset: (_, self, [dx, dy]) => { const r = R(self); setR(self, { ...r, x: r.x + num(dx), y: r.y + num(dy) }); },
    offsetPoint: (_, self, [p]) => { const r = R(self), q = xy(p); setR(self, { ...r, x: r.x + q.x, y: r.y + q.y }); },
    setEmpty: (_, self) => setR(self, { x: 0, y: 0, width: 0, height: 0 }),
    toString: (_, self) => `(x=${toStr(vm, self.get('x'))}, y=${toStr(vm, self.get('y'))}, w=${toStr(vm, self.get('width'))}, h=${toStr(vm, self.get('height'))})`,
    union: (_, self, [o]) => {
      const a = R(self), b = xywh(o);
      if (empty(a)) return rect(b.x, b.y, b.width, b.height);
      if (empty(b)) return rect(a.x, a.y, a.width, a.height);
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
      return rect(x0, y0, Math.max(a.x + a.width, b.x + b.width) - x0, Math.max(a.y + a.height, b.y + b.height) - y0);
    },
  });
  klass(geom, 'Rectangle', rectProto, (_, [x, y, w, h]) => rect(arg(x, 0), arg(y, 0), arg(w, 0), arg(h, 0)));

  // --- Matrix ---
  const matrixProto = new AVMObject(vm, vm.objectProto);
  const KEYS = ['a', 'b', 'c', 'd', 'tx', 'ty'];
  const matrix = (m) => { const o = new AVMObject(vm, matrixProto); for (const k of KEYS) o.set(k, m[k]); return o; };
  const M = (o) => Object.fromEntries(KEYS.map((k) => [k, num(o.get(k))]));
  const setM = (o, m) => { for (const k of KEYS) o.set(k, m[k]); };
  const concat = (m, n) => ({ a: m.a * n.a + m.b * n.c, b: m.a * n.b + m.b * n.d, c: m.c * n.a + m.d * n.c, d: m.c * n.b + m.d * n.d, tx: m.tx * n.a + m.ty * n.c + n.tx, ty: m.tx * n.b + m.ty * n.d + n.ty });
  const box = (sx, sy, r, tx, ty) => ({ a: sx * Math.cos(r), b: sx * Math.sin(r), c: -sy * Math.sin(r), d: sy * Math.cos(r), tx, ty });
  methods(matrixProto, {
    clone: (_, self) => matrix(M(self)),
    concat: (_, self, [o]) => setM(self, concat(M(self), M(o))),
    createBox: (_, self, [sx, sy, r = 0, tx = 0, ty = 0]) => setM(self, box(num(sx), num(sy), num(r), num(tx), num(ty))),
    createGradientBox: (_, self, [w, h, r = 0, tx = 0, ty = 0]) => setM(self, box(num(w) / 1638.4, num(h) / 1638.4, num(r), num(tx) + num(w) / 2, num(ty) + num(h) / 2)),
    deltaTransformPoint: (_, self, [p]) => { const m = M(self), q = xy(p); return point(m.a * q.x + m.c * q.y, m.b * q.x + m.d * q.y); },
    transformPoint: (_, self, [p]) => { const m = M(self), q = xy(p); return point(m.a * q.x + m.c * q.y + m.tx, m.b * q.x + m.d * q.y + m.ty); },
    identity: (_, self) => setM(self, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }),
    invert: (_, self) => {
      const m = M(self), det = m.a * m.d - m.b * m.c;
      setM(self, det === 0 ? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } : { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, tx: (m.c * m.ty - m.d * m.tx) / det, ty: (m.b * m.tx - m.a * m.ty) / det });
    },
    rotate: (_, self, [angle]) => setM(self, concat(M(self), box(1, 1, num(angle), 0, 0))),
    scale: (_, self, [sx, sy]) => setM(self, concat(M(self), { a: num(sx), b: 0, c: 0, d: num(sy), tx: 0, ty: 0 })),
    translate: (_, self, [dx, dy]) => { const m = M(self); setM(self, { ...m, tx: m.tx + num(dx), ty: m.ty + num(dy) }); },
    toString: (_, self) => `(${KEYS.map((k) => `${k}=${toStr(vm, self.get(k))}`).join(', ')})`,
  });
  klass(geom, 'Matrix', matrixProto, (_, [a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0]) => matrix({ a, b, c, d, tx, ty }));

  // --- ColorTransform ---
  const ctProto = new AVMObject(vm, vm.objectProto);
  const CT_KEYS = ['redMultiplier', 'greenMultiplier', 'blueMultiplier', 'alphaMultiplier', 'redOffset', 'greenOffset', 'blueOffset', 'alphaOffset'];
  const colorTransform = (values) => { const o = new AVMObject(vm, ctProto); CT_KEYS.forEach((k, i) => o.set(k, values[i])); return o; };
  const CTv = (o) => CT_KEYS.map((k) => num(o.get(k)));
  accessor(ctProto, 'rgb', (s) => ((num(s.get('redOffset')) << 16) | (num(s.get('greenOffset')) << 8) | num(s.get('blueOffset'))) >>> 0, (s, v) => {
    const n = int(v);
    for (const k of ['redMultiplier', 'greenMultiplier', 'blueMultiplier']) s.set(k, 0);
    s.set('redOffset', (n >> 16) & 0xff); s.set('greenOffset', (n >> 8) & 0xff); s.set('blueOffset', n & 0xff);
  });
  methods(ctProto, {
    // this の後に second を掛ける: 倍率は積、加算は this の加算 + this の倍率 × second の加算。
    concat: (_, self, [o]) => {
      const a = CTv(self), b = CTv(o);
      CT_KEYS.forEach((k, i) => self.set(k, i < 4 ? a[i] * b[i] : a[i] + a[i - 4] * b[i]));
    },
    toString: (_, self) => `(${CT_KEYS.map((k) => `${k}=${toStr(vm, self.get(k))}`).join(', ')})`,
  });
  klass(geom, 'ColorTransform', ctProto, (_, args) => colorTransform([1, 1, 1, 1, 0, 0, 0, 0].map((d, i) => arg(args[i], d))));
  const ctOf = (cx) => (cx ? [cx.rm / 256, cx.gm / 256, cx.bm / 256, cx.am / 256, cx.ra, cx.ga, cx.ba, cx.aa] : [1, 1, 1, 1, 0, 0, 0, 0]);

  // --- Transform（MovieClip.transform）: 行列と色変換は、クリップのものを読み書きする ---
  const transformProto = new AVMObject(vm, vm.objectProto);
  const clipOf = (self) => self.get('__target')?.clip;
  const worldOf = (clip) => clip.worldMatrix();
  const px = (m) => ({ ...m, tx: m.tx / 20, ty: m.ty / 20 });
  accessor(transformProto, 'matrix', (s) => { const c = clipOf(s); return c ? matrix(px(c.matrix)) : undefined; }, (s, v) => {
    const c = clipOf(s);
    if (!c || !(v instanceof AVMObject)) return;
    const m = M(v);
    c.setMatrix({ a: m.a, b: m.b, c: m.c, d: m.d, tx: Math.trunc(m.tx * 20), ty: Math.trunc(m.ty * 20) }); // _xscale などの覚えている値は変わらない（実機で確認）
  });
  accessor(transformProto, 'concatenatedMatrix', (s) => { const c = clipOf(s); return c ? matrix(px(worldOf(c))) : undefined; });
  accessor(transformProto, 'colorTransform', (s) => { const c = clipOf(s); return c ? colorTransform(ctOf(c.cxform)) : undefined; }, (s, v) => {
    const c = clipOf(s);
    if (!c || !(v instanceof AVMObject)) return;
    const [rm, gm, bm, am, ra, ga, ba, aa] = CTv(v);
    c.setCxform({ rm: Math.trunc(rm * 256), gm: Math.trunc(gm * 256), bm: Math.trunc(bm * 256), am: Math.trunc(am * 256), ra: Math.trunc(ra), ga: Math.trunc(ga), ba: Math.trunc(ba), aa: Math.trunc(aa) });
  });
  accessor(transformProto, 'concatenatedColorTransform', (s) => {
    let out = [1, 1, 1, 1, 0, 0, 0, 0];
    for (let a = clipOf(s); a; a = a.parent) { const cx = ctOf(a.cxform); out = [0, 1, 2, 3].map((i) => out[i] * cx[i]).concat([0, 1, 2, 3].map((i) => out[i + 4] * cx[i] + cx[i + 4])); }
    return colorTransform(out);
  });
  // ステージの上での外接矩形（px、整数に広げる）。
  accessor(transformProto, 'pixelBounds', (s) => {
    const c = clipOf(s), b = c?.bounds(worldOf(c));
    if (!b) return rect(0, 0, 0, 0);
    const x = Math.floor(b.xmin / 20), y = Math.floor(b.ymin / 20);
    return rect(x, y, Math.ceil(b.xmax / 20) - x, Math.ceil(b.ymax / 20) - y);
  });
  const transformOf = (clipObject) => { const t = new AVMObject(vm, transformProto); t.define('__target', clipObject, HIDDEN); return t; };
  klass(geom, 'Transform', transformProto, (_, [mc]) => (mc?.isMovieClip ? transformOf(mc) : undefined));
  vm.movieClipProto.defineAccessor('transform', vm.native((_, self) => (self?.isMovieClip ? transformOf(self) : undefined)), vm.native((_, self, [v]) => {
    const from = v instanceof AVMObject ? v : null;
    if (!self?.isMovieClip || !from) return;
    const t = transformOf(self);
    t.set('matrix', from.get('matrix'));
    t.set('colorTransform', from.get('colorTransform'));
  }), HIDDEN);

  // --- BitmapData ---
  const ops = bitmapOps({ charge: (n) => vm.charge?.(n), step: () => {}, invalid: () => { throw new RangeError('invalid bitmap'); } });
  const bdProto = new AVMObject(vm, vm.objectProto);
  const B = (self) => (self instanceof AVMObject && self.bitmap?.rgba ? self.bitmap : null);
  const wrap = (state) => Object.assign(new AVMObject(vm, bdProto), { bitmap: state });
  const ok = (w, h) => w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE;
  const signed = (v) => v | 0; // getPixel32 は符号付き（実機で確認）
  const intRect = (b, r) => ops.clipRect(b, xywh(r));
  accessor(bdProto, 'width', (s) => B(s)?.width ?? -1);
  accessor(bdProto, 'height', (s) => B(s)?.height ?? -1);
  accessor(bdProto, 'transparent', (s) => B(s)?.transparent ?? -1);
  accessor(bdProto, 'rectangle', (s) => (B(s) ? rect(0, 0, B(s).width, B(s).height) : -1));
  const each = (fn) => (_, self, args) => { const b = B(self); return b ? fn(b, args, self) : -1; };
  methods(bdProto, {
    getPixel: each((b, [x, y]) => ops.getPixel32(b, int(x), int(y)) & 0xffffff),
    getPixel32: each((b, [x, y]) => signed(ops.getPixel32(b, int(x), int(y)))),
    setPixel: each((b, [x, y, c]) => { ops.setPixel(b, int(x), int(y), int(c) >>> 0); }),
    setPixel32: each((b, [x, y, c]) => { ops.setPixel32(b, int(x), int(y), int(c) >>> 0); }),
    fillRect: each((b, [r, c]) => { ops.fill(b, intRect(b, r), int(c) >>> 0); }),
    clone: each((b) => wrap(ops.clone(b))),
    dispose: (_, self) => { if (self.bitmap) { self.bitmap.rgba = null; self.bitmap.version++; } },
    copyPixels: each((b, [src, r, p, alphaBitmap, alphaPoint, merge]) => {
      const s = B(src);
      if (!s) return;
      const mask = B(alphaBitmap);
      ops.copyPixels(b, s, xywh(r), xy(p), mask, mask && alphaPoint instanceof AVMObject ? xy(alphaPoint) : null, toBool(vm, merge));
    }),
    copyChannel: each((b, [src, r, p, from, to]) => { const s = B(src); if (s) ops.copyChannel(b, s, xywh(r), xy(p), int(from), int(to)); }),
    colorTransform: each((b, [r, ct]) => { if (ct instanceof AVMObject) { const v = CTv(ct); ops.colorTransform(b, intRect(b, r), [0, 1, 2, 3].map((i) => [v[i], v[i + 4]])); } }),
    floodFill: each((b, [x, y, c]) => { ops.floodFill(b, int(x), int(y), int(c) >>> 0); }),
    scroll: each((b, [x, y]) => { ops.scroll(b, int(x), int(y)); }),
    getColorBoundsRect: each((b, [mask, c, find = true]) => { const r = ops.colorBounds(b, int(mask) >>> 0, int(c) >>> 0, toBool(vm, find)); return rect(r.x, r.y, r.width, r.height); }),
    hitTest: each((b, [first, threshold, second, secondPoint, threshold2 = 1]) => {
      const o = xy(first), ox = Math.round(o.x), oy = Math.round(o.y), limit = int(threshold) >>> 0;
      if (B(second)) { const t = secondPoint instanceof AVMObject ? xy(secondPoint) : { x: 0, y: 0 }; return ops.hitBitmap(b, ox, oy, limit, B(second), Math.round(t.x), Math.round(t.y), int(threshold2) >>> 0); }
      if (second instanceof AVMObject && second.get('width') !== undefined) return ops.hitRect(b, ox, oy, limit, xywh(second));
      const p = xy(second);
      return ops.hitPoint(b, ox, oy, limit - 1, Math.round(p.x), Math.round(p.y)); // AS2 の点との判定は「しきい値以上」（AS3 は「より大きい」。実機で確認）
    }),
    noise: each((b, [seed, low = 0, high = 255, channels = 7, gray = false]) => { ops.noise(b, int(seed), int(low), int(high), int(channels), toBool(vm, gray)); }),
    // draw(元, 行列, 色変換, ブレンド, 切り抜く矩形): 元はクリップか BitmapData。クリップは、描画側があるときだけ描ける。
    draw: each((b, [source, m, ct, , clipRect]) => {
      const mm = m instanceof AVMObject ? M(m) : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
      const clip = clipRect instanceof AVMObject ? intRect(b, clipRect) : ops.whole(b);
      const cx = ct instanceof AVMObject ? (() => { const v = CTv(ct); return [0, 1, 2, 3].map((i) => [v[i], v[i + 4]]); })() : null;
      let image = null;
      if (B(source)) image = ops.transformed(b, B(source), mm, clip);
      else if (source?.isMovieClip) {
        const movie = source.clip.movie;
        image = movie.rasterize?.(source.clip, mm, b.width, b.height) ?? null;
        if (!image) movie.warn('BitmapData.draw of a movie clip needs a renderer');
      }
      if (image) ops.drawImage(b, image, clip, cx);
    }),
    // 以下は AS3 と同じ規則（player/bitmapops.js）。threshold の比べ方が不正なら 0。
    threshold: each((b, [src, r, p, op, threshold, color = 0, mask = 0xffffffff, copySource = false]) => {
      const s = B(src);
      return s ? ops.threshold(b, s, xywh(r), xy(p), toStr(vm, op), int(threshold) >>> 0, int(color) >>> 0, int(mask) >>> 0, toBool(vm, copySource)) ?? 0 : 0;
    }),
    merge: each((b, [src, r, p, rm, gm, bm, am]) => { const s = B(src); if (s) ops.merge(b, s, xywh(r), xy(p), [rm, gm, bm, am].map((v) => int(v) >>> 0)); }),
    paletteMap: each((b, [src, r, p, ...tables]) => {
      const s = B(src);
      const table = (v) => (v?.items ? Array.from({ length: 256 }, (_, i) => int(v.items[i] ?? 0) >>> 0) : null);
      if (s) ops.paletteMap(b, s, xywh(r), xy(p), [0, 1, 2, 3].map((i) => table(tables[i])));
    }),
    compare: each((b, [o]) => { if (!B(o)) return -2; const r = ops.compare(b, B(o)); return typeof r === 'number' ? r : wrap(r); }),
    applyFilter: each((b, [src, r, p, filter]) => {
      const s = B(src), desc = vm.filterDesc?.(filter);
      if (!s || !desc) return -5; // フィルタでないものは -5（実機で確認）
      ops.applyFilter(b, s, xywh(r), xy(p), desc);
      return 0;
    }),
    generateFilterRect: each((b, [r, filter]) => {
      const q = xywh(r), d = vm.filterDesc?.(filter);
      if (!d || d.blurX === undefined || d.inner) return rect(q.x, q.y, q.width, q.height);
      const ex = Math.ceil(Math.max(0, d.blurX - 1) / 2 * d.passes), ey = Math.ceil(Math.max(0, d.blurY - 1) / 2 * d.passes);
      return rect(q.x - ex, q.y - ey, q.width + 2 * ex, q.height + 2 * ey);
    }),
    perlinNoise: () => undefined, pixelDissolve: () => 0,
  });
  klass(display, 'BitmapData', bdProto, (_, [width, height, transparent = true, fill = 0xffffffff]) => {
    const w = int(width), h = int(height);
    if (!ok(w, h)) return undefined; // 大きさが不正なら、作れない（new が undefined になる。実機で確認）
    const b = ops.create(w, h, toBool(vm, transparent));
    ops.fill(b, ops.whole(b), int(fill) >>> 0);
    return wrap(b);
  }, {
    // 書き出し名の付いたビットマップから作る（画素が無ければ undefined）。
    loadBitmap: (_, __, [id]) => {
      const def = vm.currentTarget?.clip?.movie?.exportedBitmap?.(toStr(vm, id));
      if (!def?.rgba) return undefined;
      const b = ops.create(def.width, def.height, true);
      b.rgba.set(def.rgba);
      return wrap(b);
    },
  });

  // --- MovieClip.attachBitmap / beginBitmapFill ---
  vm.movieClipProto.define('attachBitmap', vm.native((_, self, [bmp, depth, , smoothing]) => {
    if (!self?.isMovieClip || !B(bmp)) return;
    const child = self.clip.createEmpty(self.clip.movie.nextInstanceName(), int(depth));
    if (!child) return;
    child.leaf = true;
    child.setPicture(bmp.bitmap, toBool(vm, smoothing));
  }), HIDDEN);
  vm.movieClipProto.define('beginBitmapFill', vm.native((_, self, [bmp, m, repeat = true, smooth = false]) => {
    if (!self?.isMovieClip || !B(bmp)) return;
    const mm = m instanceof AVMObject ? M(m) : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    self.clip.drawing().beginStyle({
      type: 'bitmap', bitmap: bmp.bitmap, matrix: { a: mm.a * 20, b: mm.b * 20, c: mm.c * 20, d: mm.d * 20, tx: mm.tx * 20, ty: mm.ty * 20 }, repeat: toBool(vm, repeat), smooth: toBool(vm, smooth),
    });
  }), HIDDEN);
}
