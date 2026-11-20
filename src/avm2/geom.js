// flash.geom の Point、Rectangle、Matrix、ColorTransform、Transform と、
// それを使う表示オブジェクトのメソッド（座標の変換、外接矩形、当たり判定）。
import { ASObject, publicKey } from './object.js';

/**
 * クラスを定義する。戻り値は、DisplayObject に持たせるメソッドと、transform プロパティの読み書き（クラスの定義のときに渡す）。
 * @param {import('./vm.js').AVM2} vm
 * @param {(d: object) => boolean} onStage  表示オブジェクトがステージに載っているか
 */
export function installGeom(vm, onStage) {
  const c = vm.classes;
  const num = (v) => vm.toNumber(v);
  const key = { x: publicKey('x'), y: publicKey('y'), width: publicKey('width'), height: publicKey('height') };
  const get = (obj, name) => num(obj.values.get(key[name]));
  const set = (obj, name, v) => { obj.values.set(key[name], num(v)); };
  // 引数が Point / Rectangle でなければ、null を渡したときと同じ誤りにする。
  const need = (obj, klass, name) => {
    if (!(obj instanceof ASObject) || !obj.klass?.isSubclassOf?.(klass)) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`);
    return obj;
  };
  const point = (x, y) => vm.construct(c.Point, [x, y]);
  const rectangle = (x, y, w, h) => vm.construct(c.Rectangle, [x, y, w, h]);

  c.Point = vm.defineClass({
    name: 'flash.geom::Point',
    slots: { x: 0, y: 0 },
    construct: (self, [x = 0, y = 0]) => { set(self, 'x', x); set(self, 'y', y); },
    getters: { length: (self) => Math.hypot(get(self, 'x'), get(self, 'y')) },
    methods: {
      add: (self, [v]) => point(get(self, 'x') + get(need(v, c.Point, 'v'), 'x'), get(self, 'y') + get(v, 'y')),
      subtract: (self, [v]) => point(get(self, 'x') - get(need(v, c.Point, 'v'), 'x'), get(self, 'y') - get(v, 'y')),
      clone: (self) => point(get(self, 'x'), get(self, 'y')),
      equals: (self, [v]) => get(self, 'x') === get(need(v, c.Point, 'toCompare'), 'x') && get(self, 'y') === get(v, 'y'),
      offset: (self, [dx, dy]) => { set(self, 'x', get(self, 'x') + num(dx)); set(self, 'y', get(self, 'y') + num(dy)); },
      normalize: (self, [thickness]) => {
        const length = Math.hypot(get(self, 'x'), get(self, 'y'));
        if (length > 0) { set(self, 'x', (get(self, 'x') * num(thickness)) / length); set(self, 'y', (get(self, 'y') * num(thickness)) / length); }
      },
      setTo: (self, [x, y]) => { set(self, 'x', x); set(self, 'y', y); },
      copyFrom: (self, [v]) => { set(self, 'x', get(need(v, c.Point, 'sourcePoint'), 'x')); set(self, 'y', get(v, 'y')); },
      toString: (self) => `(x=${vm.toStr(get(self, 'x'))}, y=${vm.toStr(get(self, 'y'))})`,
    },
    staticMethods: {
      distance: (_, [a, b]) => Math.hypot(get(need(a, c.Point, 'pt1'), 'x') - get(need(b, c.Point, 'pt2'), 'x'), get(a, 'y') - get(b, 'y')),
      // f が 1 なら pt1、0 なら pt2。
      interpolate: (_, [a, b, f]) => point(get(need(b, c.Point, 'pt2'), 'x') + (get(need(a, c.Point, 'pt1'), 'x') - get(b, 'x')) * num(f), get(b, 'y') + (get(a, 'y') - get(b, 'y')) * num(f)),
      polar: (_, [length, angle]) => point(num(length) * Math.cos(num(angle)), num(length) * Math.sin(num(angle))),
    },
  });

  const R = (r) => ({ x: get(r, 'x'), y: get(r, 'y'), w: get(r, 'width'), h: get(r, 'height') });
  const empty = (r) => r.w <= 0 || r.h <= 0;
  const assign = (self, r) => { set(self, 'x', r.x); set(self, 'y', r.y); set(self, 'width', r.w); set(self, 'height', r.h); };
  const other = (v, name = 'toIntersect') => R(need(v, c.Rectangle, name));
  const intersection = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
    return empty(a) || empty(b) || w <= 0 || h <= 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x, y, w, h };
  };
  c.Rectangle = vm.defineClass({
    name: 'flash.geom::Rectangle',
    slots: { x: 0, y: 0, width: 0, height: 0 },
    construct: (self, [x = 0, y = 0, w = 0, h = 0]) => assign(self, { x, y, w, h }),
    getters: {
      left: (self) => get(self, 'x'), top: (self) => get(self, 'y'),
      right: (self) => get(self, 'x') + get(self, 'width'), bottom: (self) => get(self, 'y') + get(self, 'height'),
      topLeft: (self) => point(get(self, 'x'), get(self, 'y')),
      bottomRight: (self) => point(get(self, 'x') + get(self, 'width'), get(self, 'y') + get(self, 'height')),
      size: (self) => point(get(self, 'width'), get(self, 'height')),
    },
    setters: {
      // left / top を動かしても、右端と下端はそのまま（幅と高さが変わる）。
      left: (self, v) => { set(self, 'width', get(self, 'width') + get(self, 'x') - num(v)); set(self, 'x', v); },
      top: (self, v) => { set(self, 'height', get(self, 'height') + get(self, 'y') - num(v)); set(self, 'y', v); },
      right: (self, v) => set(self, 'width', num(v) - get(self, 'x')),
      bottom: (self, v) => set(self, 'height', num(v) - get(self, 'y')),
      topLeft: (self, v) => {
        const p = need(v, c.Point, 'value');
        set(self, 'width', get(self, 'width') + get(self, 'x') - get(p, 'x')); set(self, 'height', get(self, 'height') + get(self, 'y') - get(p, 'y'));
        set(self, 'x', get(p, 'x')); set(self, 'y', get(p, 'y'));
      },
      bottomRight: (self, v) => { set(self, 'width', get(need(v, c.Point, 'value'), 'x') - get(self, 'x')); set(self, 'height', get(v, 'y') - get(self, 'y')); },
      size: (self, v) => { set(self, 'width', get(need(v, c.Point, 'value'), 'x')); set(self, 'height', get(v, 'y')); },
    },
    methods: {
      clone: (self) => { const r = R(self); return rectangle(r.x, r.y, r.w, r.h); },
      contains: (self, [x, y]) => { const r = R(self); return num(x) >= r.x && num(x) < r.x + r.w && num(y) >= r.y && num(y) < r.y + r.h; },
      containsPoint: (self, [p]) => { const r = R(self); const x = get(need(p, c.Point, 'point'), 'x'), y = get(p, 'y'); return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; },
      containsRect: (self, [v]) => { const r = R(self), o = other(v, 'rect'); return o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h; },
      equals: (self, [v]) => { const r = R(self), o = other(v, 'toCompare'); return r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h; },
      inflate: (self, [dx, dy]) => { const r = R(self); assign(self, { x: r.x - num(dx), y: r.y - num(dy), w: r.w + 2 * num(dx), h: r.h + 2 * num(dy) }); },
      inflatePoint: (self, [p]) => { const r = R(self); const dx = get(need(p, c.Point, 'point'), 'x'), dy = get(p, 'y'); assign(self, { x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy }); },
      intersection: (self, [v]) => { const r = intersection(R(self), other(v)); return rectangle(r.x, r.y, r.w, r.h); },
      intersects: (self, [v]) => !empty(intersection(R(self), other(v))),
      isEmpty: (self) => empty(R(self)),
      offset: (self, [dx, dy]) => { set(self, 'x', get(self, 'x') + num(dx)); set(self, 'y', get(self, 'y') + num(dy)); },
      offsetPoint: (self, [p]) => { set(self, 'x', get(self, 'x') + get(need(p, c.Point, 'point'), 'x')); set(self, 'y', get(self, 'y') + get(p, 'y')); },
      setEmpty: (self) => assign(self, { x: 0, y: 0, w: 0, h: 0 }),
      setTo: (self, [x, y, w, h]) => assign(self, { x, y, w, h }),
      copyFrom: (self, [v]) => assign(self, other(v, 'sourceRect')),
      // 空の矩形との合併は、もう片方になる。
      union: (self, [v]) => {
        const a = R(self), b = other(v, 'toUnion');
        if (empty(a)) return rectangle(b.x, b.y, b.w, b.h);
        if (empty(b)) return rectangle(a.x, a.y, a.w, a.h);
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        return rectangle(x, y, Math.max(a.x + a.w, b.x + b.w) - x, Math.max(a.y + a.h, b.y + b.h) - y);
      },
      toString: (self) => { const r = R(self); return `(x=${vm.toStr(r.x)}, y=${vm.toStr(r.y)}, w=${vm.toStr(r.w)}, h=${vm.toStr(r.h)})`; },
    },
  });

  // --- Matrix ---
  const MATRIX = ['a', 'b', 'c', 'd', 'tx', 'ty'];
  const field = (obj, name) => num(obj.values.get(publicKey(name)));
  const M = (obj) => ({ a: field(obj, 'a'), b: field(obj, 'b'), c: field(obj, 'c'), d: field(obj, 'd'), tx: field(obj, 'tx'), ty: field(obj, 'ty') });
  const put = (obj, values) => { for (const [name, v] of Object.entries(values)) obj.values.set(publicKey(name), num(v)); };
  const matrix = (m) => vm.construct(c.Matrix, MATRIX.map((name) => m[name]));
  // 先に m、次に n を掛けた行列。計算の順序は実機に合わせてある（丸め誤差の出方まで同じになるように）。
  const multiply = (m, n) => {
    const out = { a: m.a * n.a, b: 0, c: 0, d: m.d * n.d, tx: m.tx * n.a + n.tx, ty: m.ty * n.d + n.ty };
    if (m.b !== 0 || m.c !== 0 || n.b !== 0 || n.c !== 0) {
      out.a += m.b * n.c;
      out.d += m.c * n.b;
      out.b += m.a * n.b + m.b * n.d;
      out.c += m.c * n.a + m.d * n.c;
      out.tx += m.ty * n.c;
      out.ty += m.tx * n.b;
    }
    return out;
  };
  // Matrix と ColorTransform のメソッドは、実機では ActionScript で書かれている。null を渡すと、null の参照の誤りになる。
  const given = (obj, klass) => {
    if (obj === null || obj === undefined) vm.throwError('TypeError', 1009, 'Cannot access a property or method of a null object reference.');
    return need(obj, klass, 'value');
  };
  const box = (sx, sy, rotation, tx, ty) => {
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    return rotation === 0 ? { a: sx, b: 0, c: 0, d: sy, tx, ty } : { a: cos * sx, b: sin * sy, c: -sin * sx, d: cos * sy, tx, ty };
  };
  c.Matrix = vm.defineClass({
    name: 'flash.geom::Matrix',
    slots: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    construct: (self, [a = 1, b = 0, cc = 0, d = 1, tx = 0, ty = 0]) => put(self, { a, b, c: cc, d, tx, ty }),
    methods: {
      clone: (self) => matrix(M(self)),
      concat: (self, [m]) => put(self, multiply(M(self), M(given(m, c.Matrix)))),
      // 逆行列。回転も傾きも無ければ、拡大率の逆数を取るだけ（0 なら無限大になる）。それ以外で行列式が 0 なら、単位行列になる。
      invert: (self) => {
        const m = M(self);
        if (m.b === 0 && m.c === 0) {
          const a = 1 / m.a, d = 1 / m.d;
          return put(self, { a, b: 0, c: 0, d, tx: -a * m.tx, ty: -d * m.ty });
        }
        const det = m.a * m.d - m.b * m.c;
        if (det === 0) return put(self, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
        const inv = 1 / det;
        const a = m.d * inv, b = -m.b * inv, cc = -m.c * inv, d = m.a * inv;
        return put(self, { a, b, c: cc, d, tx: -(a * m.tx + cc * m.ty), ty: -(b * m.tx + d * m.ty) });
      },
      identity: (self) => put(self, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }),
      rotate: (self, [angle]) => { const cos = Math.cos(num(angle)), sin = Math.sin(num(angle)); put(self, multiply(M(self), { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 })); },
      scale: (self, [sx, sy]) => put(self, multiply(M(self), { a: num(sx), b: 0, c: 0, d: num(sy), tx: 0, ty: 0 })),
      translate: (self, [dx, dy]) => put(self, { tx: field(self, 'tx') + num(dx), ty: field(self, 'ty') + num(dy) }),
      transformPoint: (self, [p]) => { const m = M(self); const x = get(given(p, c.Point), 'x'), y = get(p, 'y'); return point(m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty); },
      deltaTransformPoint: (self, [p]) => { const m = M(self); const x = get(given(p, c.Point), 'x'), y = get(p, 'y'); return point(m.a * x + m.c * y, m.b * x + m.d * y); },
      createBox: (self, [sx, sy, rotation = 0, tx = 0, ty = 0]) => put(self, box(num(sx), num(sy), num(rotation), num(tx), num(ty))),
      // グラデーション用の行列: 1638.4 px 四方の基準の箱を、指定の大きさと位置に合わせる。
      createGradientBox: (self, [width, height, rotation = 0, tx = 0, ty = 0]) => put(self, box(num(width) / 1638.4, num(height) / 1638.4, num(rotation), num(tx) + num(width) / 2, num(ty) + num(height) / 2)),
      copyFrom: (self, [m]) => put(self, M(given(m, c.Matrix))),
      setTo: (self, [a, b, cc, d, tx, ty]) => put(self, { a, b, c: cc, d, tx, ty }),
      toString: (self) => `(${MATRIX.map((name) => `${name}=${vm.toStr(field(self, name))}`).join(', ')})`,
    },
  });

  // --- ColorTransform ---
  const COLOR = ['redMultiplier', 'greenMultiplier', 'blueMultiplier', 'alphaMultiplier', 'redOffset', 'greenOffset', 'blueOffset', 'alphaOffset'];
  const colorTransform = (values) => vm.construct(c.ColorTransform, values);
  c.ColorTransform = vm.defineClass({
    name: 'flash.geom::ColorTransform',
    slots: Object.fromEntries(COLOR.map((name, i) => [name, i < 4 ? 1 : 0])),
    construct: (self, args) => { COLOR.forEach((name, i) => self.values.set(publicKey(name), args[i] === undefined ? (i < 4 ? 1 : 0) : num(args[i]))); },
    getters: { color: (self) => ((field(self, 'redOffset') << 16) | (field(self, 'greenOffset') << 8) | field(self, 'blueOffset')) >>> 0 },
    setters: {
      // color を設定すると、RGB の倍率が 0 になり、加算値がその色になる。
      color: (self, v) => {
        const rgb = vm.toUint32(v);
        put(self, { redMultiplier: 0, greenMultiplier: 0, blueMultiplier: 0, redOffset: (rgb >> 16) & 0xff, greenOffset: (rgb >> 8) & 0xff, blueOffset: rgb & 0xff });
      },
    },
    methods: {
      // この変換の後に second を適用したものにする。
      concat: (self, [second]) => {
        given(second, c.ColorTransform);
        for (const ch of ['red', 'green', 'blue', 'alpha']) {
          put(self, {
            [`${ch}Offset`]: field(self, `${ch}Offset`) + field(self, `${ch}Multiplier`) * field(second, `${ch}Offset`),
            [`${ch}Multiplier`]: field(self, `${ch}Multiplier`) * field(second, `${ch}Multiplier`),
          });
        }
      },
      toString: (self) => `(${COLOR.map((name) => `${name}=${vm.toStr(field(self, name))}`).join(', ')})`,
    },
  });

  // --- Transform（表示オブジェクトの transform プロパティ） ---
  // 行列と色変換は表示オブジェクトが持つ。ここから読むと写しが返り、代入すると表示オブジェクトに反映される。
  const cxOf = (cx) => (cx ? [cx.rm / 256, cx.gm / 256, cx.bm / 256, cx.am / 256, cx.ra, cx.ga, cx.ba, cx.aa] : [1, 1, 1, 1, 0, 0, 0, 0]);
  const worldCx = (d) => {
    let out = [1, 1, 1, 1, 0, 0, 0, 0];
    for (let a = d; a; a = a.parent) {
      const cx = cxOf(a.cxform); // 親の変換を、後から掛ける
      out = [0, 1, 2, 3].map((i) => out[i] * cx[i]).concat([0, 1, 2, 3].map((i) => out[i + 4] * cx[i] + cx[i + 4]));
    }
    return out;
  };
  c.Transform = vm.defineClass({
    name: 'flash.geom::Transform',
    getters: {
      // matrix に null を代入した後は、null が読める（行列そのものは変わらない。実機で確認）。
      matrix: (self) => { const m = self.target.matrix; return self.target.matrixHidden || self.target.t3 ? null : matrix({ ...m, tx: m.tx / 20, ty: m.ty / 20 }); }, // 3D のものは null
      colorTransform: (self) => colorTransform(cxOf(self.target.cxform)),
      // ステージに載っていないものは、親の変形を含まず、自分の行列の全体が 5 倍されたものになる（実機で確認）。
      concatenatedMatrix: (self) => {
        const staged = onStage(self.target);
        const m = staged ? self.target.worldMatrix() : self.target.matrix;
        const k = staged ? 1 : 5;
        return matrix({ a: m.a * k, b: m.b * k, c: m.c * k, d: m.d * k, tx: (m.tx / 20) * k, ty: (m.ty / 20) * k });
      },
      concatenatedColorTransform: (self) => colorTransform(worldCx(self.target)),
      pixelBounds: (self) => {
        const b = self.target.bounds(self.target.worldMatrix());
        if (!b) return rectangle(0, 0, 0, 0);
        const x = Math.floor(b.xmin / 20), y = Math.floor(b.ymin / 20);
        return rectangle(x, y, Math.ceil(b.xmax / 20) - x, Math.ceil(b.ymax / 20) - y);
      },
    },
    setters: {
      // 拡大と回転は単精度の浮動小数点数で、位置は twips に切り捨てて持つ。色変換の倍率は 1/256 刻みに、加算値は整数に切り捨てる（実機で確認）。
      matrix: (self, v) => {
        self.target.matrixHidden = v === null || v === undefined;
        if (self.target.matrixHidden) return;
        self.target.t3 = null; // 2D の行列を代入すると、3D でなくなる（実機で確認）
        const m = M(need(v, c.Matrix, 'value'));
        self.target.setMatrix({ a: Math.fround(m.a), b: Math.fround(m.b), c: Math.fround(m.c), d: Math.fround(m.d), tx: Math.trunc(m.tx * 20), ty: Math.trunc(m.ty * 20) });
        self.target.xform = null; // 拡大率と回転は、行列から取り直す
      },
      colorTransform: (self, v) => {
        need(v, c.ColorTransform, 'value');
        const [rm, gm, bm, am, ra, ga, ba, aa] = COLOR.map((name) => field(v, name));
        self.target.setCxform({ rm: Math.trunc(rm * 256), gm: Math.trunc(gm * 256), bm: Math.trunc(bm * 256), am: Math.trunc(am * 256), ra: Math.trunc(ra), ga: Math.trunc(ga), ba: Math.trunc(ba), aa: Math.trunc(aa) });
      },
    },
  });
  const transformOf = (self) => Object.assign(new ASObject(c.Transform), { target: self.display });

  // --- 表示オブジェクトのメソッド ---
  const D = (self) => self.display;
  const displayOf = (obj, name) => {
    if (obj === null || obj === undefined) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`);
    if (!(obj instanceof ASObject) || !obj.display?.worldMatrix) vm.throwError('TypeError', 1034, `Type Coercion failed: cannot convert ${vm.className(obj)} to flash.display.DisplayObject.`);
    return obj.display;
  };
  // 外接矩形（twips）を Rectangle にする。中身が無いものは幅も高さも 0 で、位置は、自分の座標系なら (0, 0)、
  // ほかの座標系なら「自分の座標系の (0x8000000, 0x8000000) twips」をそこへ移した点になる（単精度で計算される。実機で確認）。
  const EMPTY_AT = 0x8000000;
  const boundsRect = (b, d, target) => {
    if (b) return rectangle(b.xmin / 20, b.ymin / 20, (b.xmax - b.xmin) / 20, (b.ymax - b.ymin) / 20);
    if (target === d) return rectangle(0, 0, 0, 0);
    const m = d.worldMatrix();
    const p = target.globalToLocal(m.a * EMPTY_AT + m.c * EMPTY_AT + m.tx, m.b * EMPTY_AT + m.d * EMPTY_AT + m.ty);
    return rectangle(Math.fround(p.x) / 20, Math.fround(p.y) / 20, 0, 0);
  };
  const space = (self, target) => (target === null || target === undefined ? D(self) : displayOf(target, 'targetCoordinateSpace'));
  const methods = {
    localToGlobal: (self, [p]) => {
      const m = D(self).worldMatrix();
      const x = get(need(p, c.Point, 'point'), 'x') * 20, y = get(p, 'y') * 20;
      return point((m.a * x + m.c * y + m.tx) / 20, (m.b * x + m.d * y + m.ty) / 20);
    },
    globalToLocal: (self, [p]) => {
      const q = D(self).globalToLocal(get(need(p, c.Point, 'point'), 'x') * 20, get(p, 'y') * 20);
      return point(q.x / 20, q.y / 20);
    },
    // target の座標系での外接矩形。getRect は線の太さを含めない。
    getBounds: (self, [target]) => { const to = space(self, target); return boundsRect(D(self).boundsIn(to), D(self), to); },
    getRect: (self, [target]) => { const to = space(self, target); return boundsRect(D(self).boundsIn(to, true), D(self), to); },
    // 点はステージの座標。shapeFlag が真なら実際の形で、偽なら外接矩形で判定する。
    hitTestPoint: (self, [x, y, shapeFlag]) => {
      const px = num(x) * 20, py = num(y) * 20;
      if (vm.toBoolean(shapeFlag)) return D(self).hitPoint(px, py);
      const b = D(self).bounds(D(self).worldMatrix());
      return !!b && px >= b.xmin && px < b.xmax && py >= b.ymin && py < b.ymax;
    },
    hitTestObject: (self, [obj]) => {
      const a = D(self).bounds(D(self).worldMatrix());
      const b = displayOf(obj, 'obj').bounds(obj.display.worldMatrix());
      return !!a && !!b && a.xmin < b.xmax && b.xmin < a.xmax && a.ymin < b.ymax && b.ymin < a.ymax;
    },
  };
  return {
    methods,
    getTransform: transformOf,
    // d.transform = t: 相手の行列と色変換を写す。
    setTransform: (self, v) => {
      const from = need(v, c.Transform, 'value').target;
      self.display.setMatrix({ ...from.matrix });
      self.display.xform = null;
      self.display.setCxform(from.cxform ? { ...from.cxform } : null);
    },
  };
}
