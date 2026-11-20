// 表示オブジェクトのうち、値を保つだけのプロパティと、実機で確かめた検査（範囲外の値の例外）を持つもの:
// blendMode、cacheAsBitmap、scrollRect、scale9Grid、mask、3D の値、タブ順、フォーカスの枠、コンテキストメニュー、hitArea、
// ドラッグ、MovieClip.enabled、Stage の設定、getObjectsUnderPoint。値と例外は、実機の trace（test/as3/apiprobe2.as）に合わせた。
import { ASArray, ASClass, ASObject, publicKey } from './object.js';

const BLEND_MODES = ['add', 'alpha', 'darken', 'difference', 'erase', 'hardlight', 'invert', 'layer', 'lighten', 'multiply', 'normal', 'overlay', 'screen', 'subtract', 'shader'];
const QUALITIES = ['low', 'medium', 'high', 'best', '8x8', '8x8linear', '16x16', '16x16linear'];
const SCALE_MODES = ['exactFit', 'noBorder', 'noScale', 'showAll'];

export function installDisplayExtras(vm, { movie, display, D }) {
  const c = vm.classes;
  const num = (v) => vm.toNumber(v);
  const str = (v) => vm.toStr(v);
  const bool = (v) => vm.toBoolean(v);
  // 特性は、クラスを作るときに親から写されるので、あとから親に足したものは、すでにあるサブクラスにも写す
  // （自分で同じ名前を持っているクラスは、そのまま）。
  const classes = [...vm.nativeGlobal.values.values()].filter((v) => v instanceof ASClass);
  const add = (klass, name, trait) => {
    const key = publicKey(name);
    const old = klass.instanceTraits.get(key);
    klass.instanceTraits.set(key, trait);
    for (const sub of classes) {
      if (sub === klass || !sub.isSubclassOf(klass) || sub.isInterface) continue;
      if (sub.instanceTraits.get(key) === old) sub.instanceTraits.set(key, trait);
    }
  };
  const accessor = (klass, name, get, set = null) => add(klass, name, { kind: 'accessor', key: publicKey(name), name, get: vm.native(get), set: set ? vm.native((self, [v]) => set(self, v)) : null });
  const method = (klass, name, fn) => add(klass, name, { kind: 'method', key: publicKey(name), name, fn: vm.native(fn, name) });
  const nonNull = (v, name) => { if (v === null || v === undefined) vm.throwError('TypeError', 2007, `Parameter ${name} must be non-null.`); };
  const rect = (r) => (r ? vm.construct(c.Rectangle, [r.x, r.y, r.width, r.height]) : null);
  const readRect = (o, name) => {
    nonNull(o, name);
    const f = (k) => num(o.values.get(publicKey(k)));
    return { x: f('x'), y: f('y'), width: f('width'), height: f('height') };
  };
  // プレイヤー側の表示オブジェクトに持たせる値（d.ext）。表示や当たり判定に効くものは、別の項目にする。
  const X = (self) => (D(self).ext ??= {});

  // --- DisplayObject ---
  const DO = c.DisplayObject;
  accessor(DO, 'blendMode', (self) => D(self).blendMode ?? 'normal', (self, v) => {
    nonNull(v, 'blendMode');
    if (!BLEND_MODES.includes(str(v))) vm.throwError('ArgumentError', 2008, 'Parameter blendMode must be one of the accepted values.');
    D(self).blendMode = str(v);
  });
  accessor(DO, 'cacheAsBitmap', (self) => X(self).cacheAsBitmap ?? false, (self, v) => { X(self).cacheAsBitmap = bool(v); });
  accessor(DO, 'accessibilityProperties', (self) => X(self).accessibilityProperties ?? null, (self, v) => { X(self).accessibilityProperties = v ?? null; });
  // 読むたびに新しい Rectangle で、代入した Rectangle を後から変えても影響しない。
  accessor(DO, 'scrollRect', (self) => rect(D(self).scrollRect), (self, v) => { D(self).scrollRect = v === null || v === undefined ? null : readRect(v, 'scrollRect'); });
  accessor(DO, 'scale9Grid', (self) => rect(D(self).scale9Grid ?? null), (self, v) => {
    if (v === null || v === undefined) { D(self).scale9Grid = null; return; }
    const r = readRect(v, 'scale9Grid');
    const b = D(self).boundsInParent?.();
    // 中身の無いものには付けられない（実機で確認: #2004）。
    if (!b) vm.throwError('ArgumentError', 2004, 'One of the parameters is invalid.');
    D(self).scale9Grid = r;
  });
  // マスク。AS2 の setMask と同じ仕組み（マスクにしたものは描かれず、掛けられた側の形が切り抜かれる）。実機は、マスクの側の mask も
  // 掛けた側を返す（mask.mask == 掛けられた側）。
  accessor(DO, 'mask', (self) => {
    const d = D(self);
    const other = d.maskedBy ?? d.maskFor ?? null;
    return other ? display.wrap(other) : null;
  }, (self, v) => {
    const d = D(self);
    if (d.maskedBy) d.maskedBy.maskFor = null;
    const target = v instanceof ASObject && v.display && v.display !== d ? v.display : null;
    d.maskedBy = target;
    if (target) target.maskFor = d;
  });
  // 3D の値は、持つだけ（3D の描画はしない）。
  for (const [name, initial] of [['z', 0], ['rotationX', 0], ['rotationY', 0], ['rotationZ', 0], ['scaleZ', 1]]) {
    accessor(DO, name, (self) => X(self)[name] ?? initial, (self, v) => { X(self)[name] = num(v); });
  }

  // --- InteractiveObject と DisplayObjectContainer ---
  const IO = c.InteractiveObject;
  accessor(IO, 'tabIndex', (self) => X(self).tabIndex ?? -1, (self, v) => {
    const n = vm.toInt32(v);
    if (n < -1) vm.throwError('RangeError', 2027, `Parameter tabIndex must be a non-negative number; got ${n}.`);
    X(self).tabIndex = n;
  });
  accessor(IO, 'tabEnabled', (self) => X(self).tabEnabled ?? D(self).type === 'input', (self, v) => { X(self).tabEnabled = bool(v); });
  accessor(IO, 'focusRect', (self) => (X(self).focusRect === undefined ? null : X(self).focusRect), (self, v) => { X(self).focusRect = v === undefined ? null : v; });
  accessor(IO, 'contextMenu', (self) => X(self).contextMenu ?? null, (self, v) => { X(self).contextMenu = v ?? null; });
  const DOC = c.DisplayObjectContainer;
  accessor(DOC, 'tabChildren', (self) => X(self).tabChildren ?? true, (self, v) => { X(self).tabChildren = bool(v); });
  // 点 (x, y)（twips、ステージの座標）にある、いちばん奥の子孫（子を持たないもの）から手前へ。
  const under = (container, x, y, out) => {
    for (const child of container.sortedChildren()) {
      if (!child.visible || child.clipDepth) continue;
      const kids = child.children && child.sortedChildren().length > 0;
      if (kids && !child.hitArea) under(child, x, y, out);
      if ((!kids || child.drawingPaths?.()) && child.hitPoint(x, y)) out.push(display.wrap(child));
    }
    return out;
  };
  method(DOC, 'getObjectsUnderPoint', (self, [pt]) => {
    nonNull(pt, 'point');
    const f = (k) => num(pt.values.get(publicKey(k)));
    const d = D(self);
    const m = d.worldMatrix ? d.worldMatrix() : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const [px, py] = [f('x') * 20, f('y') * 20];
    return new ASArray(vm, under(d, m.a * px + m.c * py + m.tx, m.b * px + m.d * py + m.ty, []));
  });
  method(DOC, 'areInaccessibleObjectsUnderPoint', () => false);
  method(DOC, 'stopAllMovieClips', (self) => {
    const stop = (d) => { d.stopped = true; for (const k of d.children?.values?.() ?? []) stop(k); };
    for (const k of D(self).children?.values?.() ?? []) stop(k);
  });

  // --- Sprite と MovieClip ---
  accessor(c.Sprite, 'hitArea', (self) => (D(self).hitArea ? display.wrap(D(self).hitArea) : null), (self, v) => { D(self).hitArea = v instanceof ASObject && v.display ? v.display : null; });
  accessor(c.Sprite, 'dropTarget', () => null);
  method(c.Sprite, 'startDrag', (self, [lock, bounds]) => {
    const b = bounds === null || bounds === undefined ? undefined : readRect(bounds, 'bounds');
    movie.startDrag(D(self), bool(lock), b && { left: b.x * 20, top: b.y * 20, right: (b.x + b.width) * 20, bottom: (b.y + b.height) * 20 });
  });
  method(c.Sprite, 'stopDrag', () => { movie.stopDrag(); });
  accessor(c.MovieClip, 'enabled', (self) => D(self).enabled ?? true, (self, v) => { D(self).enabled = bool(v); });
  accessor(c.MovieClip, 'trackAsMenu', (self) => X(self).trackAsMenu ?? false, (self, v) => { X(self).trackAsMenu = bool(v); });

  // --- Stage ---
  const ST = c.Stage;
  const state = (display.stageState = { quality: 'HIGH', scaleMode: 'showAll', align: '' });
  const stageW = () => (movie.frameSize.xmax - movie.frameSize.xmin) / 20;
  const stageH = () => (movie.frameSize.ymax - movie.frameSize.ymin) / 20;
  // 品質は、大文字で返る（実機で確認）。知らない名前は無視される。
  accessor(ST, 'quality', () => state.quality, (_, v) => { nonNull(v, 'quality'); if (QUALITIES.includes(str(v).toLowerCase())) state.quality = str(v).toUpperCase(); });
  accessor(ST, 'displayState', () => 'normal', () => {}); // 全画面にはしない
  accessor(ST, 'fullScreenWidth', () => stageW());
  accessor(ST, 'fullScreenHeight', () => stageH());
  accessor(ST, 'fullScreenSourceRect', () => null, () => {});
  accessor(ST, 'allowsFullScreen', () => true);
  accessor(ST, 'allowsFullScreenInteractive', () => false);
  accessor(ST, 'stageFocusRect', () => state.stageFocusRect ?? true, (_, v) => { state.stageFocusRect = bool(v); });
  accessor(ST, 'wmodeGPU', () => false);
  accessor(ST, 'showDefaultContextMenu', () => state.showDefaultContextMenu ?? true, (_, v) => { state.showDefaultContextMenu = bool(v); });
  // 背景色は、不透明な ARGB（0xFFRRGGBB）で読み書きする。
  accessor(ST, 'color', () => { const b = movie.backgroundColor ?? { r: 255, g: 255, b: 255 }; return ((0xff << 24) | (b.r << 16) | (b.g << 8) | b.b) >>> 0; }, (_, v) => {
    const n = vm.toUint32(v);
    movie.backgroundColor = { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 };
  });
  accessor(ST, 'scaleMode', () => state.scaleMode, (_, v) => {
    nonNull(v, 'scaleMode');
    if (!SCALE_MODES.includes(str(v))) vm.throwError('ArgumentError', 2008, 'Parameter scaleMode must be one of the accepted values.');
    state.scaleMode = str(v);
  });
  accessor(ST, 'align', () => state.align, (_, v) => { state.align = v === null || v === undefined ? '' : str(v); });
  accessor(ST, 'frameRate', () => movie.frameRate, (_, v) => { const n = num(v); if (n > 0) movie.frameRate = Math.min(n, 1000); });
  accessor(ST, 'focus', () => (movie.focus ? display.wrap(movie.focus) : null), (_, v) => { movie.setFocus(v instanceof ASObject && v.klass?.isSubclassOf(c.InteractiveObject) ? v.display : null); });
  method(ST, 'invalidate', () => {});
}
