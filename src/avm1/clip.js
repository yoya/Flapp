// スクリプトから見たムービークリップ。表示リスト上のクリップ (player/movie.js の MovieClip) を包む。
import { toBool, toInt32, toNumber, toStr } from './convert.js';
import { gradientStyle, lineOptions } from '../player/drawing.js';
import { AVMArray, AVMFunction, AVMObject, DONT_DELETE, DONT_ENUM, NONE } from './object.js';

const HIDDEN = DONT_ENUM | DONT_DELETE;
const DEPTH_OFFSET = 16384; // スクリプトの深度 0 は、表示リストの深度 16384
const IDENTITY_CX = { rm: 256, gm: 256, bm: 256, am: 256, ra: 0, ga: 0, ba: 0, aa: 0 };
const DEG = 180 / Math.PI;

// 行列を拡大率と回転に分ける。
function decompose(m) {
  // + 0 は -0 を 0 にする（左右反転した行列の回転を -180 ではなく 180 にする。実機で確認）。
  return { sx: Math.hypot(m.a, m.b), sy: Math.hypot(m.c, m.d), rx: Math.atan2(m.b + 0, m.a), ry: Math.atan2(-m.c + 0, m.d) };
}
function compose(t, tx, ty) {
  return { a: t.sx * Math.cos(t.rx), b: t.sx * Math.sin(t.rx), c: -t.sy * Math.sin(t.ry), d: t.sy * Math.cos(t.ry), tx, ty };
}

// スクリプトから見た拡大率（%）と回転（度）。代入された値をそのまま覚えておき、行列はそこから作り直す
// （行列から逆算すると 90 が 89.9999 になるような誤差が出るため）。
function xform(c) {
  if (!c.xform) {
    const t = decompose(c.matrix);
    c.xform = { xscale: t.sx * 100, yscale: t.sy * 100, rotation: t.rx * DEG, skew: t.ry - t.rx };
  }
  return c.xform;
}
function setXform(c, values, vm) {
  if (vm.version < 5) {
    setFixedXform(c, values);
    return;
  }
  const t = Object.assign(xform(c), values);
  const rx = t.rotation / DEG;
  c.setMatrix(compose({ sx: t.xscale / 100, sy: t.yscale / 100, rx, ry: rx + t.skew }, c.matrix.tx, c.matrix.ty));
}

// --- SWF 4 の拡大率と回転の代入 ---
// SWF 4 には控えが無く、16.16 固定小数の行列だけが残る。読み出しは毎回その行列から求め直すので、
// _xscale = 77 は 76.9989...、_xscale = -50 は 50（と回転 180）として読める。
//
// 行列を作り直すときの sin / cos は、実機の固定小数の計算をなぞる。実機は 0.25 度きざみの sin の表を引き、表の間は
// 直線で補うが、その重みが本来の 1/4 しかない（16.16 の角度の下位 14 ビットを、そのまま 16 ビットの小数として使っている
// ように見える）。そのため、0.25 度の倍数でない角度では、ベクトルの長さが 1 より少し短くなり（最大で 0.3% ほど）、
// 向きも、手前の 0.25 度の倍数から端数の 1/4 ほどしか進まない。回転を読んで足して書き戻すスクリプトでは、この端数が
// 読み戻しの値に表れる。実機に角度を 0.01 度きざみで入れて読み戻した値から求めた規則で、回転は 0.002 度以内で合う。
// （拡大率の読み戻しには、ここで再現していない 0.002 ほどの端数が残る。）
const SIN_TABLE = Float64Array.from({ length: 362 }, (_, i) => Math.sin((i * 0.25) / DEG)); // 0〜90.25 度
const QUARTER = 90 * 65536;
// 0〜90 度（16.16）の sin
const tableSin = (x) => SIN_TABLE[x >> 14] + ((SIN_TABLE[(x >> 14) + 1] - SIN_TABLE[x >> 14]) * (x & 0x3fff)) / 65536;
// 角度（度）を 16.16 にして、-180〜180 度に収める。
function foldAngle(deg) {
  let v = Math.round(deg * 65536) % (4 * QUARTER);
  if (v > 2 * QUARTER) v -= 4 * QUARTER;
  if (v <= -2 * QUARTER) v += 4 * QUARTER;
  return v;
}
function fixedSin(deg) {
  const v = foldAngle(deg), x = Math.abs(v);
  return Math.sign(v) * tableSin(x > QUARTER ? 2 * QUARTER - x : x);
}
function fixedCos(deg) {
  const x = Math.abs(foldAngle(deg));
  return x > QUARTER ? -tableSin(x - QUARTER) : tableSin(QUARTER - x);
}
// 代入された項目に応じて、行列の列を作り直す。拡大率の代入は、その軸の列だけを作り直す（もう一方の列は変わらない）。
function setFixedXform(c, values) {
  const t = decompose(c.matrix);
  const m = { ...c.matrix };
  const fixed = (v) => Math.round(v * 65536) / 65536;
  let rx = t.rx * DEG, ry = t.ry * DEG;
  let { sx, sy } = t;
  const columns = { x: 'rotation' in values || 'xscale' in values, y: 'rotation' in values || 'yscale' in values };
  if ('rotation' in values) {
    ry += values.rotation - rx; // 2 つの列の向きの差は保つ
    rx = values.rotation;
  }
  // 代入された拡大率は、16.16 に切り捨ててから掛ける。今の値との差が 16/65536（約 0.024%）以下なら、実機は何もしない
  // （_xscale が 99.98 のときに 100 を入れても、99.98 のまま。行列も作り直されない）。
  const scale = (value, now) => {
    const next = Math.trunc((value / 100) * 65536);
    return Math.abs(next - Math.round(now * 65536)) <= 16 ? null : next / 65536;
  };
  if ('xscale' in values) {
    sx = scale(values.xscale, t.sx);
    columns.x = sx !== null;
  }
  if ('yscale' in values) {
    sy = scale(values.yscale, t.sy);
    columns.y = sy !== null;
  }
  if (!columns.x && !columns.y) return;
  if (columns.x) Object.assign(m, { a: fixed(sx * fixedCos(rx)), b: fixed(sx * fixedSin(rx)) });
  if (columns.y) Object.assign(m, { c: fixed(-sy * fixedSin(ry)), d: fixed(sy * fixedCos(ry)) });
  c.xform = null;
  c.setMatrix(m);
}
// 回転は -180〜180 度に収める。
function normalizeRotation(v) {
  const r = v % 360;
  return r > 180 ? r - 360 : r < -180 ? r + 360 : r;
}

// 特別なプロパティ（_x など）。get / set は表示オブジェクト c に対する操作。
const rootOf = (c) => {
  let top = c;
  while (top.parent) top = top.parent;
  return top;
};

export const MAGIC = {
  // 位置は twips、アルファは 1/256 単位の整数に切り捨てて持つ（_x = 2.999 は 2.95、_alpha = 33 は 32.8125 と読める）。
  _x: { get: (c) => c.matrix.tx / 20, set: (c, v) => c.setMatrix({ ...c.matrix, tx: Math.trunc(v * 20) }) },
  _y: { get: (c) => c.matrix.ty / 20, set: (c, v) => c.setMatrix({ ...c.matrix, ty: Math.trunc(v * 20) }) },
  _xscale: { get: (c) => xform(c).xscale, set: (c, v, vm) => setXform(c, { xscale: v }, vm) },
  _yscale: { get: (c) => xform(c).yscale, set: (c, v, vm) => setXform(c, { yscale: v }, vm) },
  _rotation: { get: (c) => xform(c).rotation, set: (c, v, vm) => setXform(c, { rotation: normalizeRotation(v) }, vm) },
  _alpha: {
    get: (c) => ((c.cxform?.am ?? 256) * 100) / 256,
    set: (c, v) => c.setCxform({ ...(c.cxform ?? IDENTITY_CX), am: Math.trunc((v * 256) / 100) }),
  },
  // 代入は数値として扱う（0 以外が表示。"" や "true" のように数値でない値は無視）。SWF 4 には真偽値が無く、読むと 1 / 0。
  _visible: { get: (c, vm) => (vm.version >= 5 ? c.visible : c.visible ? 1 : 0), set: (c, v) => { c.visible = v !== 0; } },
  _width: {
    get: (c) => { const b = c.boundsInParent(); return b ? (b.xmax - b.xmin) / 20 : 0; },
    set: (c, v, vm) => {
      const b = c.boundsInParent();
      const w = b ? (b.xmax - b.xmin) / 20 : 0;
      if (w > 0) MAGIC._xscale.set(c, (MAGIC._xscale.get(c) * v) / w, vm);
    },
  },
  _height: {
    get: (c) => { const b = c.boundsInParent(); return b ? (b.ymax - b.ymin) / 20 : 0; },
    set: (c, v, vm) => {
      const b = c.boundsInParent();
      const h = b ? (b.ymax - b.ymin) / 20 : 0;
      if (h > 0) MAGIC._yscale.set(c, (MAGIC._yscale.get(c) * v) / h, vm);
    },
  },
  _currentframe: { get: (c) => c.currentFrame },
  _totalframes: { get: (c) => c.totalFrames },
  _framesloaded: { get: (c) => c.totalFrames },
  _name: { get: (c) => c.name, set: (c, v, vm, raw) => { c.name = toStr(vm, raw); }, raw: true },
  _target: { get: (c) => c.slashPath() },
  _url: { get: () => '' },
  // ドラッグ中にマウスが動くたびに、その位置にあるいちばん手前のクリップのパスが入る（player/movie.js）。ドラッグをやめても残る。
  _droptarget: { get: (c) => c.dropTarget ?? '' },
  _quality: { get: () => 'HIGH', set: () => {} },
  _highquality: { get: () => 1, set: () => {} },
  _focusrect: { get: () => 1, set: () => {} },
  _soundbuftime: { get: () => 5, set: () => {} },
  _xmouse: { get: (c) => c.mouseLocal().x / 20 },
  _ymouse: { get: (c) => c.mouseLocal().y / 20 },
  _parent: { get: (c) => c.parent?.scriptObject() },
  // ルートは親をたどって求める（ルート自身を作っている最中は、まだ movie.root が無い）。
  _root: { get: (c) => rootOf(c).scriptObject() },
  _level0: { get: (c) => (c.movie.levels?.get(0) ?? rootOf(c)).scriptObject() },
};

// getURL / loadVariables のメソッドの指定。"GET" と "POST" だけが意味を持つ（大文字小文字は問わない）。ほかは送らない（''）。
const sendMethod = (method) => {
  const m = typeof method === 'string' ? method.toUpperCase() : '';
  return m === 'GET' || m === 'POST' ? m : '';
};

export class MovieClipObject extends AVMObject {
  /** @param {import('../player/movie.js').MovieClip} clip */
  constructor(vm, clip) {
    super(vm, vm.movieClipProto);
    this.clip = clip;
    this.isMovieClip = true;
  }

  #magic(name) {
    return name.charCodeAt(0) === 0x5f ? MAGIC[this.vm.caseInsensitive ? name.toLowerCase() : name] : undefined;
  }

  // 表示リストから外されたクリップは、もう何も持っていないように見える。
  get #gone() {
    return this.clip.removed;
  }

  // 変数 → 名前のついた子 → 特別なプロパティ の順に探す。
  ownGet(name, receiver) {
    if (this.#gone) return NONE;
    const v = super.ownGet(name, receiver);
    if (v !== NONE) return v;
    const child = this.clip.childByName(name, this.vm.caseInsensitive);
    if (child) return child.scriptObject();
    const magic = this.#magic(name);
    if (magic) return magic.get(this.clip, this.vm);
    // _level1 などは、そのレベルのルート（無ければ undefined）。
    const level = /^_level(\d+)$/i.exec(name);
    return level && level[1] !== '0' ? this.clip.movie.levels?.get(Number(level[1]))?.scriptObject() ?? NONE : NONE;
  }

  ownSet(name, value, receiver) {
    if (super.ownSet(name, value, receiver)) return true;
    const magic = this.#magic(name);
    if (!magic) return false;
    if (magic.set) {
      if (magic.raw) magic.set(this.clip, undefined, this.vm, value);
      else {
        // 数値にならない代入は無視される。undefined は SWF 6 以前でも 0 にはならず、無視される。
        // SWF 4 の文字列は、全体が数値のときだけ受け付ける（演算と違い、"12abc" や "" は 0 や 12 にならず無視）。
        let n = value === undefined || value === null ? NaN : toNumber(this.vm, value);
        if (this.vm.version < 5 && typeof value === 'string' && !/^[\t\n\r ]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) n = NaN;
        if (!Number.isNaN(n)) magic.set(this.clip, n, this.vm);
      }
    }
    return true;
  }

  // 変数に続いて、名前のついた子のクリップも列挙される（深度の大きい順）。
  ownKeys() {
    if (this.#gone) return [];
    const children = this.clip.sortedChildren().filter((c) => c.scriptObject && c.name).map((c) => c.name).reverse();
    return [...super.ownKeys(), ...children];
  }

  ownHas(name) {
    if (this.#gone) return false;
    return super.ownHas(name) || this.clip.childByName(name, this.vm.caseInsensitive) !== undefined || this.#magic(name) !== undefined;
  }

  // --- インタプリタから呼ばれる操作 ---

  /** 名前のついた子のクリップ。ターゲットパスは、同名の変数があってもクリップの方を指す。 */
  child(name) {
    return this.#gone ? undefined : this.clip.childByName(name, this.vm.caseInsensitive)?.scriptObject();
  }

  /** "_level0.a.b" 形式のパス。表示リストから外れたクリップは空文字。 */
  targetPath() {
    return this.clip.removed ? '' : this.clip.dotPath();
  }

  play() { this.clip.playing = true; }
  stop() { this.clip.playing = false; }
  nextFrame() { this.clip.gotoFrame(this.clip.currentFrame + 1, false); }
  prevFrame() { this.clip.gotoFrame(this.clip.currentFrame - 1, false); }

  /** frame はフレーム番号（1 始まり）かラベル。数字だけの文字列は番号として扱う。 */
  gotoFrame(frame, play) {
    const n = this.clip.frameNumber(typeof frame === 'number' ? frame : toStr(this.vm, frame), false); // 存在しないフレームかどうかを gotoFrame が見分ける
    if (n === undefined) return;
    this.clip.gotoFrame(n, play);
  }

  /** ActionCall 用: 指定フレームのアクション列。 */
  frameActions(frame) {
    const n = this.clip.frameNumber(typeof frame === 'number' ? frame : toStr(this.vm, frame));
    return n === undefined ? [] : this.clip.actionsOfFrame(n);
  }

  /** ActionCloneSprite 用。メソッドの duplicateMovieClip と違い、深度に 16384 を足さない（実機で確認）。 */
  duplicate(name, depth) {
    return this.clip.duplicate(name, Math.trunc(depth))?.scriptObject();
  }

  removeSelf() {
    this.clip.removeDynamic();
  }
}

export function installMovieClip(vm) {
  const proto = new AVMObject(vm, vm.objectProto);
  vm.movieClipProto = proto;
  // ボタンのように反応するかどうかの既定値（インスタンスごとに代入して変えられる）
  proto.define('enabled', true, HIDDEN);
  proto.define('useHandCursor', true, HIDDEN);
  const clipOf = (self) => (self?.isMovieClip && !self.clip.removed ? self.clip : null);
  const num = (v) => toNumber(vm, v);
  const depthArg = (v) => Math.trunc(num(v)) + DEPTH_OFFSET;
  // initObject のプロパティを新しいクリップへ写す。
  const copyInit = (obj, init) => {
    if (obj && init instanceof AVMObject) for (const name of init.ownKeys()) obj.set(name, init.get(name));
    return obj;
  };

  const methods = {
    play: (self) => { self.play(); },
    stop: (self) => { self.stop(); },
    nextFrame: (self) => { self.nextFrame(); },
    prevFrame: (self) => { self.prevFrame(); },
    gotoAndPlay: (self, [frame]) => { self.gotoFrame(frame, true); },
    gotoAndStop: (self, [frame]) => { self.gotoFrame(frame, false); },
    getDepth: (self) => self.clip.depth - DEPTH_OFFSET,
    getNextHighestDepth: (self) => Math.max(0, self.clip.highestDepth() - DEPTH_OFFSET + 1),
    getInstanceAtDepth: (self, [depth]) => self.clip.children.get(depthArg(depth))?.scriptObject?.(),
    // 読み込んだクリップは、読み込んだファイルの大きさ（読み込みの途中は 0）。
    getBytesLoaded: (self) => self.clip.loadInfo?.loaded ?? self.clip.movie.fileLength,
    getBytesTotal: (self) => self.clip.loadInfo?.total ?? self.clip.movie.fileLength,
    swapDepths: (self, [target]) => {
      const parent = self.clip.parent;
      if (!parent) return;
      const other = target?.isMovieClip ? target.clip.depth : depthArg(target);
      if (!Number.isNaN(other)) parent.swapDepths(self.clip.depth, other);
    },
    attachMovie: (self, [id, name, depth, init]) => {
      const child = self.clip.attach(toStr(vm, id), toStr(vm, name), depthArg(depth));
      return copyInit(child?.scriptObject(), init);
    },
    createEmptyMovieClip: (self, [name, depth]) => self.clip.createEmpty(toStr(vm, name), depthArg(depth))?.scriptObject(),
    duplicateMovieClip: (self, [name, depth, init]) => copyInit(self.clip.duplicate(toStr(vm, name), depthArg(depth))?.scriptObject(), init),
    removeMovieClip: (self) => { self.removeSelf(); },
    getBounds: (self, [space]) => {
      const b = self.clip.boundsIn(space?.isMovieClip ? space.clip : self.clip);
      const out = new AVMObject(vm, vm.objectProto);
      if (b) for (const [name, key] of [['xMin', 'xmin'], ['xMax', 'xmax'], ['yMin', 'ymin'], ['yMax', 'ymax']]) out.set(name, b[key] / 20);
      return out;
    },
    hitTest: (self, [x, y, shapeFlag]) => {
      // 相手のクリップとは外接矩形どうしで判定する。ステージ座標の点とは、shapeFlag が真なら中身の形、偽なら外接矩形で判定する。
      // （形での判定は、実機では縁から 0.25 px ほどの範囲で結果がずれる。また実機は最後に描画した時点の形で判定する。）
      if (!x?.isMovieClip && toBool(vm, shapeFlag)) return self.clip.hitPoint(num(x) * 20, num(y) * 20);
      const mine = self.clip.boundsIn(self.clip.movie.root);
      if (!mine) return false;
      if (x?.isMovieClip) {
        const other = x.clip.boundsIn(self.clip.movie.root);
        return !!other && mine.xmin <= other.xmax && other.xmin <= mine.xmax && mine.ymin <= other.ymax && other.ymin <= mine.ymax;
      }
      const px = num(x) * 20;
      const py = num(y) * 20;
      return px >= mine.xmin && px <= mine.xmax && py >= mine.ymin && py <= mine.ymax;
    },
    localToGlobal: (self, [pt]) => { convertPoint(vm, pt, self.clip.worldMatrix()); },
    globalToLocal: (self, [pt]) => { convertPoint(vm, pt, invert(self.clip.worldMatrix())); },
    // --- 描画 API（座標は px） ---
    clear: (self) => { self.clip.drawing().clear(); },
    // 第 4 引数以降（pixelHinting、noScale、capsStyle、jointStyle、miterLimit）は SWF 8 から。名前は大文字と小文字を区別する。
    lineStyle: (self, [width, rgb, alpha, pixelHinting, noScale, capsStyle, jointStyle, miterLimit]) => {
      const word = (v) => (v === undefined ? undefined : toStr(vm, v));
      self.clip.drawing().lineStyle(width === undefined ? undefined : num(width) * 20, color(vm, rgb, alpha), lineOptions({
        pixelHinting: pixelHinting === undefined ? false : toBool(vm, pixelHinting), scaleMode: word(noScale), caps: word(capsStyle), joints: word(jointStyle), miterLimit: miterLimit === undefined ? 3 : toNumber(vm, miterLimit),
      }));
    },
    lineGradientStyle: (self, [type, colors, alphas, ratios, matrix, spread, interpolation, focal]) => {
      self.clip.drawing().lineGradient(gradientFill(vm, { type, colors, alphas, ratios, matrix, spread, interpolation, focal }));
    },
    beginFill: (self, [rgb, alpha]) => { self.clip.drawing().beginFill(rgb === undefined ? undefined : color(vm, rgb, alpha)); },
    beginGradientFill: (self, [type, colors, alphas, ratios, matrix, spread, interpolation, focal]) => {
      self.clip.drawing().beginStyle(gradientFill(vm, { type, colors, alphas, ratios, matrix, spread, interpolation, focal }));
    },
    endFill: (self) => { self.clip.drawing().endFill(); },
    moveTo: (self, [x, y]) => { self.clip.drawing().moveTo(num(x) * 20, num(y) * 20); },
    lineTo: (self, [x, y]) => { self.clip.drawing().lineTo(num(x) * 20, num(y) * 20); },
    curveTo: (self, [cx, cy, x, y]) => { self.clip.drawing().curveTo(num(cx) * 20, num(cy) * 20, num(x) * 20, num(y) * 20); },
    // --- 外部への移動と読み込み ---
    // 要求を記録して、移動と変数の読み込みはホストに任せる（ホストが何もしなければ、何も起きない）。ムービーの読み込みは行わない。
    // 読み込みは行わない。実機で読み込みに失敗したときと同じく、次のフレームの後でクリップが空になる。
    unloadMovie: (self) => { vm.unloadClip(self); },
    // メソッド（GET / POST）を指定すると、このクリップの変数を一緒に送る。
    // 対象がレベル（"_level1" など）なら、そのレベルへの読み込み（loadMovieNum と同じ）。
    getURL: (self, [url, target, method]) => {
      const req = { kind: 'getURL', url: toStr(vm, url), target: target === undefined ? '' : toStr(vm, target), method: sendMethod(method) };
      const level = /^_level(\d+)$/i.exec(req.target);
      if (level) return void vm.loadMovie({ level: Number(level[1]) }, req.url, req.method, self);
      vm.request(req);
      vm.navigate({ ...req, data: req.method ? vm.clipVariables(self) : '' });
    },
    // 画像か SWF を読み込んで、このクリップの中身と置き換える。
    loadMovie: (self, [url, method]) => { vm.loadMovie({ clip: self }, toStr(vm, url), sendMethod(method), self); },
    // 読み込んだ "a=1&b=2" を、このクリップの変数に入れる。
    loadVariables: (self, [url, method]) => {
      const how = sendMethod(method);
      vm.loadText({ url: toStr(vm, url), target: self.targetPath(), method: how, body: how ? vm.clipVariables(self) : '' }, (text) => {
        if (text !== undefined && !self.clip.removed) vm.loadedVariables(self, text);
      });
    },
    startDrag: (self, [lock, left, top, right, bottom]) => {
      const bounds = bottom === undefined ? undefined : { left: num(left) * 20, top: num(top) * 20, right: num(right) * 20, bottom: num(bottom) * 20 };
      self.clip.movie.startDrag(self.clip, toBool(vm, lock), bounds);
    },
    stopDrag: (self) => { self.clip.movie.stopDrag(); },
    // 空のテキストフィールドを作る。SWF 8 以降は作ったフィールドを返す。
    createTextField: (self, [name, depth, x, y, width, height]) => {
      const field = self.clip.createTextField(toStr(vm, name), depthArg(depth), Math.round(num(x) * 20), Math.round(num(y) * 20), Math.round(num(width) * 20), Math.round(num(height) * 20));
      return vm.version >= 8 ? field?.scriptObject() : undefined;
    },
    // 自分を mask の形で切り抜く。mask のクリップ自体は描かれなくなる。null などを渡すと外す。
    setMask: (self, [mask]) => {
      const { clip } = self;
      if (clip.maskedBy) clip.maskedBy.maskFor = null;
      clip.maskedBy = mask?.isMovieClip && mask.clip !== clip ? mask.clip : null;
      if (clip.maskedBy) clip.maskedBy.maskFor = clip;
      return true;
    },
  };
  for (const [name, fn] of Object.entries(methods)) {
    // 表示リストから外れたクリップに対する呼び出しは何もしない。
    proto.define(name, vm.native((_, self, args) => (clipOf(self) ? fn(self, args) : undefined)), HIDDEN);
  }

  const ctor = vm.native(() => undefined);
  ctor.define('prototype', proto, HIDDEN);
  proto.define('constructor', ctor, HIDDEN);
  vm.global.define('MovieClip', ctor, DONT_ENUM);
}

function color(vm, rgb, alpha) {
  const n = toInt32(vm, rgb);
  const a = alpha === undefined ? 100 : toNumber(vm, alpha);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: Math.max(0, Math.min(255, Math.round((a * 255) / 100))) };
}

// beginGradientFill の引数（スクリプトの値）から、塗りのスタイルを作る。数が合わないなどで作れなければ null（塗りなし）。
// 行列は、{ matrixType: "box", x, y, w, h, r }（createGradientBox と同じ）か、{ a, b, c, d, e, f, g, h, i }（a〜e は 1638.4 px 四方の
// 基準の箱を何 px に移すか、g と h は中心の位置。実機で確認）。行列が無い（オブジェクトでない）ときは塗りなし（実機で確認）。
function gradientFill(vm, { type, colors, alphas, ratios, matrix, spread, interpolation, focal }) {
  if (![colors, alphas, ratios].every((v) => v instanceof AVMArray) || colors.items.length !== alphas.items.length || colors.items.length !== ratios.items.length) return null;
  const word = (v) => (v === undefined ? '' : toStr(vm, v)); // 種類・spread・補間の名前は、大文字と小文字を区別する（実機で確認）
  const n = (o, name) => toNumber(vm, o.get(name));
  if (!(matrix instanceof AVMObject)) return null;
  let m;
  if (word(matrix.get('matrixType')) === 'box') {
    const [w, h, r] = [n(matrix, 'w') / 1638.4, n(matrix, 'h') / 1638.4, n(matrix, 'r')];
    m = { a: w * Math.cos(r), b: w * Math.sin(r), c: -h * Math.sin(r), d: h * Math.cos(r), tx: (n(matrix, 'x') + n(matrix, 'w') / 2) * 20, ty: (n(matrix, 'y') + n(matrix, 'h') / 2) * 20 };
  } else {
    m = { a: n(matrix, 'a') / 1638.4, b: n(matrix, 'b') / 1638.4, c: n(matrix, 'd') / 1638.4, d: n(matrix, 'e') / 1638.4, tx: n(matrix, 'g') * 20, ty: n(matrix, 'h') * 20 };
  }
  return gradientStyle({
    type: word(type),
    colors: colors.items.map((rgb, i) => color(vm, rgb, alphas.items[i])),
    ratios: ratios.items.map((v) => toNumber(vm, v)),
    matrix: m,
    spread: ['pad', 'reflect', 'repeat'].find((x) => x === word(spread)),
    linearRGB: word(interpolation) === 'linearRGB',
    focal: focal === undefined ? 0 : toNumber(vm, focal),
  });
}

function invert(m) {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 };
  return {
    a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det,
    tx: (m.c * m.ty - m.d * m.tx) / det, ty: (m.b * m.tx - m.a * m.ty) / det,
  };
}

// { x, y }（px）のオブジェクトを、行列 m（平行移動は twips）で変換して書き戻す。
function convertPoint(vm, pt, m) {
  if (!(pt instanceof AVMObject)) return;
  const x = toNumber(vm, pt.get('x')) * 20;
  const y = toNumber(vm, pt.get('y')) * 20;
  pt.set('x', (m.a * x + m.c * y + m.tx) / 20);
  pt.set('y', (m.b * x + m.d * y + m.ty) / 20);
}

export { AVMFunction, invert };
