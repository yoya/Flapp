// flash.geom の Point と Rectangle、それを使う表示オブジェクトのメソッド（座標の変換、外接矩形、当たり判定）。
import { ASObject, publicKey } from './object.js';

/**
 * Point と Rectangle を定義する。戻り値は、DisplayObject に持たせるメソッド（クラスの定義のときに渡す）。
 * @param {import('./vm.js').AVM2} vm
 */
export function installGeom(vm) {
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

  // --- 表示オブジェクトのメソッド ---
  const D = (self) => self.display;
  const displayOf = (obj, name) => {
    if (obj === null || obj === undefined) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`);
    if (!(obj instanceof ASObject) || !obj.display?.worldMatrix) vm.throwError('TypeError', 1034, `Type Coercion failed: cannot convert ${vm.className(obj)} to flash.display.DisplayObject.`);
    return obj.display;
  };
  // 外接矩形（twips）を Rectangle にする。中身が無いものは、幅も高さも 0 で、位置が 6710886.4（0x8000000 twips）になる（実機の値）。
  const boundsRect = (b) => (b ? rectangle(b.xmin / 20, b.ymin / 20, (b.xmax - b.xmin) / 20, (b.ymax - b.ymin) / 20) : rectangle(0x8000000 / 20, 0x8000000 / 20, 0, 0));
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
    getBounds: (self, [target]) => boundsRect(D(self).boundsIn(space(self, target))),
    getRect: (self, [target]) => boundsRect(D(self).boundsIn(space(self, target), true)),
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
  return methods;
}
