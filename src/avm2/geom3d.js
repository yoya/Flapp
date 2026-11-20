// flash.geom の 3D: Matrix3D、PerspectiveProjection、Utils3D と、Transform.matrix3D / perspectiveProjection、
// DisplayObject.local3DToGlobal / globalToLocal3D。計算は player/matrix3d.js。値は実機で確認（test/as3/threed.as）。
import * as M3 from '../player/matrix3d.js';
import { ASObject, ASVector, publicKey } from './object.js';

/**
 * @param {import('./vm.js').AVM2} vm
 * @param {import('../player/movie.js').Movie} movie
 * @returns {{ methods: object }} DisplayObject に付けるメソッド
 */
export function installGeom3D(vm, movie) {
  const c = vm.classes;
  const num = (v) => vm.toNumber(v);
  const get = (obj, name) => num(obj.values.get(publicKey(name)));
  const need = (obj, klass, name) => {
    if (!(obj instanceof ASObject) || !obj.klass?.isSubclassOf?.(klass)) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`);
    return obj;
  };
  const vec = (v) => ({ x: get(v, 'x'), y: get(v, 'y'), z: get(v, 'z'), w: get(v, 'w') });
  const vector3D = (x, y, z, w = 0) => vm.construct(c.Vector3D, [x, y, z, w]);
  const numbers = (items) => new ASVector(vm.applyType(c.Vector, [c.Number]), items);
  const R = (self) => self.m3;

  // --- Matrix3D（self.m3 に 16 個の数） ---
  const set16 = (self, list) => { for (let i = 0; i < 16; i++) self.m3[i] = list[i]; };
  const scaleArgs = (x, y, z) => {
    const s = [num(x), num(y), num(z)];
    if (s.some((v) => v === 0)) vm.throwError('ArgumentError', 2183, 'Scale may not be zero.');
    return s;
  };
  const rotationArgs = (deg, axis, pivot) => {
    const r = M3.rotation(num(deg), vec(need(axis, c.Vector3D, 'axis')));
    if (!(pivot instanceof ASObject)) return r;
    const p = vec(pivot);
    return M3.multiply(M3.translation(p.x, p.y, p.z), M3.multiply(r, M3.translation(-p.x, -p.y, -p.z)));
  };
  const append = (self, m) => set16(self, M3.multiply(m, R(self)));
  const prepend = (self, m) => set16(self, M3.multiply(R(self), m));
  const matrix3D = (list) => Object.assign(new ASObject(c.Matrix3D), { m3: [...list] });
  c.Matrix3D = vm.defineClass({
    name: 'flash.geom::Matrix3D',
    allocate: (klass) => Object.assign(new ASObject(klass), { m3: M3.identity() }),
    construct: (self, [v]) => { if (v instanceof ASVector) set16(self, M3.identity().map((d, i) => (i < v.items.length ? num(v.items[i]) : d))); },
    getters: {
      rawData: (self) => numbers([...R(self)]),
      determinant: (self) => M3.determinant(R(self)),
      position: (self) => vector3D(R(self)[12], R(self)[13], R(self)[14]),
    },
    setters: {
      rawData: (self, v) => { if (v instanceof ASVector) set16(self, R(self).map((d, i) => (i < v.items.length ? num(v.items[i]) : d))); },
      position: (self, v) => { const p = vec(need(v, c.Vector3D, 'value')); Object.assign(self.m3, { 12: p.x, 13: p.y, 14: p.z }); },
    },
    methods: {
      identity: (self) => set16(self, M3.identity()),
      clone: (self) => matrix3D(R(self)),
      copyFrom: (self, [other]) => set16(self, R(need(other, c.Matrix3D, 'sourceMatrix3D'))),
      copyToMatrix3D: (self, [other]) => set16(need(other, c.Matrix3D, 'dest'), R(self)),
      copyRawDataFrom: (self, [v, index = 0, transpose = false]) => {
        const items = v.items.slice(vm.toInt32(index), vm.toInt32(index) + 16).map(num);
        set16(self, vm.toBoolean(transpose) ? items.map((_, i) => items[(i % 4) * 4 + Math.floor(i / 4)]) : items);
      },
      copyRawDataTo: (self, [v, index = 0, transpose = false]) => {
        const m = R(self), out = vm.toBoolean(transpose) ? m.map((_, i) => m[(i % 4) * 4 + Math.floor(i / 4)]) : m;
        out.forEach((x, i) => { v.items[vm.toInt32(index) + i] = x; });
      },
      append: (self, [other]) => append(self, R(need(other, c.Matrix3D, 'lhs'))),
      prepend: (self, [other]) => prepend(self, R(need(other, c.Matrix3D, 'rhs'))),
      appendTranslation: (self, [x, y, z]) => append(self, M3.translation(num(x), num(y), num(z))),
      prependTranslation: (self, [x, y, z]) => prepend(self, M3.translation(num(x), num(y), num(z))),
      appendScale: (self, [x, y, z]) => append(self, M3.scaling(...scaleArgs(x, y, z))),
      prependScale: (self, [x, y, z]) => prepend(self, M3.scaling(...scaleArgs(x, y, z))),
      appendRotation: (self, [deg, axis, pivot]) => append(self, rotationArgs(deg, axis, pivot)),
      prependRotation: (self, [deg, axis, pivot]) => prepend(self, rotationArgs(deg, axis, pivot)),
      invert: (self) => { const inv = M3.invert(R(self)); if (inv) set16(self, inv); return !!inv; },
      transpose: (self) => { const m = [...R(self)]; set16(self, m.map((_, i) => m[(i % 4) * 4 + Math.floor(i / 4)])); },
      transformVector: (self, [v]) => { const p = vec(need(v, c.Vector3D, 'v')); const [x, y, z, w] = M3.transform(R(self), p.x, p.y, p.z, 1); return vector3D(x, y, z, w); },
      deltaTransformVector: (self, [v]) => { const p = vec(need(v, c.Vector3D, 'v')); const [x, y, z] = M3.transform(R(self), p.x, p.y, p.z, 0); return vector3D(x, y, z, 0); },
      transformVectors: (self, [vin, vout]) => {
        const items = vin.items.map(num), out = [];
        for (let i = 0; i + 2 < items.length; i += 3) out.push(...M3.transform(R(self), items[i], items[i + 1], items[i + 2], 1).slice(0, 3));
        vout.items.length = 0;
        vout.items.push(...out);
      },
      // [平行移動, 回転（ラジアン）, 拡大] の 3 つの Vector3D。
      decompose: (self) => {
        const d = M3.decompose(R(self));
        return new ASVector(vm.applyType(c.Vector, [c.Vector3D]), [d.translation, d.rotation, d.scale].map((v) => vector3D(v.x, v.y, v.z)));
      },
      recompose: (self, [list]) => {
        const [t, r, s] = list.items.map(vec);
        if (!s || s.x === 0 || s.y === 0 || s.z === 0) return false;
        set16(self, M3.compose({ x: t.x, y: t.y, z: t.z, rotationX: (r.x * 180) / Math.PI, rotationY: (r.y * 180) / Math.PI, rotationZ: (r.z * 180) / Math.PI, scaleX: s.x, scaleY: s.y, scaleZ: s.z }));
        return true;
      },
      // 位置を保ったまま、z 軸の向きを pos へ向ける（up は y 軸の向きの目安。既定は (0, -1, 0)）。
      pointAt: (self, [pos, at, up]) => {
        const m = R(self), p = vec(need(pos, c.Vector3D, 'pos'));
        const forward = at instanceof ASObject ? vec(at) : { x: 0, y: 0, z: -1 };
        const upward = up instanceof ASObject ? vec(up) : { x: 0, y: -1, z: 0 };
        void forward;
        const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
        const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
        const z = norm({ x: p.x - m[12], y: p.y - m[13], z: p.z - m[14] });
        const x = norm(cross(upward, z));
        const y = cross(z, x);
        set16(self, [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, m[12], m[13], m[14], 1].map((v) => v + 0));
      },
      interpolateTo: (self, [to, percent]) => { const t = num(percent), b = R(need(to, c.Matrix3D, 'toMat')); set16(self, R(self).map((a, i) => a + (b[i] - a) * t)); },
    },
    staticMethods: {
      interpolate: (_, [from, to, percent]) => { const t = num(percent), a = R(need(from, c.Matrix3D, 'thisMat')), b = R(need(to, c.Matrix3D, 'toMat')); return matrix3D(a.map((x, i) => x + (b[i] - x) * t)); },
    },
  });

  // --- PerspectiveProjection（self.pp は { fieldOfView, center, width }。表示オブジェクトに付いたものは、その表示オブジェクトと共有する） ---
  // 視野角は 0 より大きく 180 より小さい（ほかは ArgumentError #2182）。中心の既定は、どこにも付いていなければ (250, 250)、
  // ルートのものはステージの中央。焦点距離は (幅 / 2) / tan(視野角 / 2)（幅は、どこにも付いていなければ 500、ルートはステージの幅）。
  const stageSize = () => ({ width: (movie.frameSize.xmax - movie.frameSize.xmin) / 20, height: (movie.frameSize.ymax - movie.frameSize.ymin) / 20 });
  const centerOf = (pp) => pp.center ?? (pp.root ? { x: stageSize().width / 2, y: stageSize().height / 2 } : { x: 250, y: 250 });
  const widthOf = (pp) => (pp.root ? stageSize().width : 500);
  const ppObject = (state) => Object.assign(new ASObject(c.PerspectiveProjection), { pp: state });
  c.PerspectiveProjection = vm.defineClass({
    name: 'flash.geom::PerspectiveProjection',
    allocate: (klass) => Object.assign(new ASObject(klass), { pp: { fieldOfView: 55, center: null, root: false } }),
    construct: () => {},
    getters: {
      fieldOfView: (self) => self.pp.fieldOfView,
      focalLength: (self) => M3.focalLength(self.pp.fieldOfView, widthOf(self.pp)),
      projectionCenter: (self) => { const p = centerOf(self.pp); return vm.construct(c.Point, [p.x, p.y]); },
    },
    setters: {
      fieldOfView: (self, v) => {
        const n = num(v);
        if (!(n > 0 && n < 180)) vm.throwError('ArgumentError', 2182, 'Invalid fieldOfView value.  The value must be greater than 0 and less than 180.');
        self.pp.fieldOfView = n;
      },
      focalLength: (self, v) => { const f = num(v); if (f > 0) self.pp.fieldOfView = (2 * Math.atan(widthOf(self.pp) / 2 / f) * 180) / Math.PI; },
      projectionCenter: (self, v) => { const p = need(v, c.Point, 'value'); self.pp.center = { x: get(p, 'x'), y: get(p, 'y') }; },
    },
    methods: {
      toMatrix3D: (self) => { const f = M3.focalLength(self.pp.fieldOfView, widthOf(self.pp)); return matrix3D([f, 0, 0, 0, 0, f, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]); },
    },
  });
  // ルートの射影（無ければ作る）。
  const rootProjection = () => (movie.root.pp ??= { fieldOfView: 55, center: null, root: true });

  // --- Utils3D ---
  vm.defineClass({
    name: 'flash.geom::Utils3D', final: true,
    staticMethods: {
      projectVector: (_, [m, v]) => {
        const p = vec(need(v, c.Vector3D, 'v'));
        const [x, y, z, w] = M3.transform(R(need(m, c.Matrix3D, 'm')), p.x, p.y, p.z, 1);
        return vector3D(x / w, y / w, z / w, w);
      },
      projectVectors: (_, [m, verts, projected, uvts]) => {
        const mm = R(need(m, c.Matrix3D, 'm')), items = verts.items.map(num), out = [];
        for (let i = 0, k = 0; i + 2 < items.length; i += 3, k++) {
          const [x, y, , w] = M3.transform(mm, items[i], items[i + 1], items[i + 2], 1);
          out.push(x / w, y / w);
          if (uvts instanceof ASVector && k * 3 + 2 < uvts.items.length) uvts.items[k * 3 + 2] = 1 / w;
        }
        projected.items.length = 0;
        projected.items.push(...out);
      },
      pointTowards: () => null,
    },
  });

  // --- 表示オブジェクトの 3D ---
  const world3D = (d) => d.world3D();
  const projection = (d) => movie.projection(d);
  const methods = {
    local3DToGlobal: (self, [v]) => {
      const p = vec(need(v, c.Vector3D, 'point3d')), { center, focal } = projection(self.display);
      const q = M3.project(M3.transform(world3D(self.display), p.x, p.y, p.z, 1), center, focal) ?? { x: 0, y: 0 };
      return vm.construct(c.Point, [q.x, q.y]);
    },
    // ステージの点の上にある、自分の z = 0 の面の点。
    globalToLocal3D: (self, [pt]) => {
      const p = need(pt, c.Point, 'point'), px = get(p, 'x'), py = get(p, 'y');
      const w = world3D(self.display), { center, focal } = projection(self.display);
      // (px - cx)(f + wz) = f (wx - cx) を、x と y の 2 つの式で解く（wx = x W0 + y W4 + W12 など）。
      const row = (axis, target, c0) => [
        (target - c0) * w[2] - focal * w[axis], (target - c0) * w[6] - focal * w[4 + axis], focal * (w[12 + axis] - c0) - (target - c0) * (focal + w[14]),
      ];
      const [a1, b1, r1] = row(0, px, center.x), [a2, b2, r2] = row(1, py, center.y);
      const det = a1 * b2 - a2 * b1;
      return det ? vector3D((r1 * b2 - r2 * b1) / det, (a1 * r2 - a2 * r1) / det, 0) : vector3D(0, 0, 0);
    },
  };

  // Transform.matrix3D: 3D なら、その行列（代入した Matrix3D は、そのまま返る）。2D なら null。null を代入すると、変形が全部消える（実機で確認）。
  // Transform.perspectiveProjection: ルートと、代入したものだけが持つ。
  const accessor = (klass, name, getter, setter) => klass.instanceTraits.set(publicKey(name), { kind: 'accessor', key: publicKey(name), name, get: vm.native(getter), set: vm.native((self, [v]) => setter(self, v)) });
  accessor(c.Transform, 'matrix3D', (self) => {
    const d = self.target;
    if (!d.t3) return null;
    const raw = d.local3D();
    if (d.matrix3DObject && d.matrix3DObject.m3.every((v, i) => Math.abs(v - raw[i]) < 1e-9)) return d.matrix3DObject;
    return matrix3D(raw);
  }, (self, v) => {
    const d = self.target;
    d.matrix3DObject = null;
    if (v === null || v === undefined) { d.t3 = null; d.setMatrix({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }); d.xform = null; return; }
    const m = R(need(v, c.Matrix3D, 'value')), parts = M3.decompose(m);
    const deg = (r) => (r * 180) / Math.PI;
    const rz = parts.rotation.z, cos = Math.cos(rz), sin = Math.sin(rz);
    d.setMatrix({ a: parts.scale.x * cos, b: parts.scale.x * sin, c: -parts.scale.y * sin, d: parts.scale.y * cos, tx: Math.trunc(parts.translation.x * 20), ty: Math.trunc(parts.translation.y * 20) });
    d.xform = null;
    d.t3 = { z: parts.translation.z, rotationX: deg(parts.rotation.x), rotationY: deg(parts.rotation.y), scaleZ: parts.scale.z };
    d.matrix3DObject = v;
  });
  accessor(c.Transform, 'perspectiveProjection', (self) => {
    const d = self.target;
    if (d === movie.root) return ppObject(rootProjection());
    return d.pp ? ppObject(d.pp) : null;
  }, (self, v) => {
    const d = self.target;
    if (v === null || v === undefined) { if (d !== movie.root) d.pp = null; return; }
    const src = need(v, c.PerspectiveProjection, 'value').pp;
    d.pp = { fieldOfView: src.fieldOfView, center: src.center ?? (d === movie.root ? null : centerOf(src)), root: d === movie.root };
  });
  return { methods }; // DisplayObject のメソッド（displayext.js が付ける）
}
