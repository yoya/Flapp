// スクリプトから作るフィルタ（flash.filters のクラス）の定義。AS1/2 と AS3 で共通で、VM ごとの値の扱いは avm1/filters.js と
// avm2/filters.js にある。
//
// props は、コンストラクタの引数の順に並べた、プロパティの名前と既定値と型。
//   kind: 'num'（lo〜hi に収める）、'int'（整数にして lo〜hi に収める）、'uint'（色）、'bool'、'type'（"inner" | "outer" | "full"）、
//         'list'（配列。colors / alphas / ratios / matrix）
// toDesc(p) は、プロパティの値から、表示オブジェクトのフィルタ（swf/display.js の filterList と同じ形式）を作る。
// fromDesc(d) は、その逆（タイムラインで付いたフィルタを filters で読むときに使う）。
// 角度は、スクリプトでは度、フィルタの形式ではラジアン。品質（quality）は、ぼかしを重ねる回数（passes）。

// 範囲は実機で確かめた: ぼかし量は 0〜255（NaN はそのまま）、品質は 0〜15 の整数、強さは 0〜255 で 1/256 刻み、alpha は 0〜1 で 1/255 刻み（切り捨て）。
// 距離は制限なしで NaN もそのまま、角度は 360 で割った余り（400 は 40、-400 は -40、720 は 0）。
const num = (def, lo = 0, hi = 255) => ({ def, kind: 'num', lo, hi, keepNaN: true }); // ぼかし量の NaN は、そのまま（実機で確認）
const free = (def) => ({ def, kind: 'num', lo: -Infinity, hi: Infinity, keepNaN: true });
const angle = (def) => ({ ...free(def), mod: 360 });
const strength = (def) => ({ def, kind: 'num', lo: 0, hi: 255, step: 256 }); // NaN は 0
const alphaOf = (def) => ({ def, kind: 'num', lo: 0, hi: 1, step: 255 });
const int = (def, lo = 0, hi = 15) => ({ def, kind: 'int', lo, hi });
const bool = (def) => ({ def, kind: 'bool' });
const uint = (def) => ({ def, kind: 'uint' });
const kind = (def = 'inner') => ({ def, kind: 'type' });
const list = (def = []) => ({ def, kind: 'list' });
const any = (def = null) => ({ def, kind: 'any' }); // スクリプトの値のまま（ビットマップ）
const point = () => ({ def: { x: 0, y: 0 }, kind: 'point' }); // { x, y }
const u32 = (def) => ({ def, kind: 'u32' });
const mode = (def) => ({ def, kind: 'mode', values: ['wrap', 'clamp', 'ignore', 'color'] }); // 決まった名前（ほかは呼ぶ側が #2008）

const rgba = (color, alpha) => ({ r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff, a: Math.round(Math.min(Math.max(alpha, 0), 1) * 255) });
const rgb = (c) => (c.r << 16) | (c.g << 8) | c.b;
const alpha = (c) => c.a / 255;
const RAD = Math.PI / 180;
const flags = (type) => ({ inner: type === 'inner', onTop: type === 'full' });
const typeOf = (d) => (d.inner ? 'inner' : d.onTop ? 'full' : 'outer');

const shadow = (type) => ({
  toDesc: (p) => ({ type, color: rgba(p.color, p.alpha), blurX: p.blurX, blurY: p.blurY, angle: p.angle * RAD, distance: p.distance, strength: p.strength, inner: p.inner, knockout: p.knockout, compositeSource: !p.hideObject, passes: p.quality }),
});

export const FILTER_SPECS = {
  BlurFilter: {
    props: { blurX: num(4), blurY: num(4), quality: int(1) },
    toDesc: (p) => ({ type: 'blur', blurX: p.blurX, blurY: p.blurY, passes: p.quality }),
    fromDesc: (d) => ({ blurX: d.blurX, blurY: d.blurY, quality: d.passes }),
  },
  DropShadowFilter: {
    props: { distance: free(4), angle: angle(45), color: uint(0), alpha: alphaOf(1), blurX: num(4), blurY: num(4), strength: strength(1), quality: int(1), inner: bool(false), knockout: bool(false), hideObject: bool(false) },
    ...shadow('dropShadow'),
    fromDesc: (d) => ({ distance: d.distance, angle: d.angle / RAD, color: rgb(d.color), alpha: alpha(d.color), blurX: d.blurX, blurY: d.blurY, strength: d.strength, quality: d.passes, inner: d.inner, knockout: d.knockout, hideObject: !d.compositeSource }),
  },
  GlowFilter: {
    props: { color: uint(0xff0000), alpha: alphaOf(1), blurX: num(6), blurY: num(6), strength: strength(2), quality: int(1), inner: bool(false), knockout: bool(false) },
    toDesc: (p) => ({ type: 'glow', color: rgba(p.color, p.alpha), blurX: p.blurX, blurY: p.blurY, strength: p.strength, inner: p.inner, knockout: p.knockout, compositeSource: true, passes: p.quality }),
    fromDesc: (d) => ({ color: rgb(d.color), alpha: alpha(d.color), blurX: d.blurX, blurY: d.blurY, strength: d.strength, quality: d.passes, inner: d.inner, knockout: d.knockout }),
  },
  BevelFilter: {
    props: { distance: free(4), angle: angle(45), highlightColor: uint(0xffffff), highlightAlpha: alphaOf(1), shadowColor: uint(0), shadowAlpha: alphaOf(1), blurX: num(4), blurY: num(4), strength: strength(1), quality: int(1), type: kind(), knockout: bool(false) },
    toDesc: (p) => ({ type: 'bevel', shadowColor: rgba(p.highlightColor, p.highlightAlpha), highlightColor: rgba(p.shadowColor, p.shadowAlpha), blurX: p.blurX, blurY: p.blurY, angle: p.angle * RAD, distance: p.distance, strength: p.strength, ...flags(p.type), knockout: p.knockout, compositeSource: true, passes: p.quality }),
    fromDesc: (d) => ({ distance: d.distance, angle: d.angle / RAD, highlightColor: rgb(d.shadowColor), highlightAlpha: alpha(d.shadowColor), shadowColor: rgb(d.highlightColor), shadowAlpha: alpha(d.highlightColor), blurX: d.blurX, blurY: d.blurY, strength: d.strength, quality: d.passes, type: typeOf(d), knockout: d.knockout }),
  },
  GradientGlowFilter: gradient('gradientGlow'),
  GradientBevelFilter: gradient('gradientBevel'),
  ColorMatrixFilter: {
    props: { matrix: list([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]) },
    toDesc: (p) => ({ type: 'colorMatrix', matrix: p.matrix }),
    fix: (p) => { p.matrix = Array.from({ length: 20 }, (_, i) => p.matrix[i] ?? 0); }, // 20 個にそろえる（足りなければ 0、多ければ切る。実機で確認）
    fromDesc: (d) => ({ matrix: d.matrix }),
  },
  ConvolutionFilter: {
    props: { matrixX: num(0, 0, 15), matrixY: num(0, 0, 15), matrix: list(), divisor: num(1, -Infinity, Infinity), bias: num(0, -Infinity, Infinity), preserveAlpha: bool(true), clamp: bool(true), color: uint(0), alpha: alphaOf(0) },
    fix: (p) => { p.matrix = Array.from({ length: p.matrixX * p.matrixY }, (_, i) => p.matrix[i] ?? 0); }, // matrixX × matrixY 個にそろえる（実機で確認）
    toDesc: (p) => {
      const [x, y] = [Math.trunc(p.matrixX), Math.trunc(p.matrixY)];
      const matrix = Array.from({ length: x * y }, (_, i) => p.matrix[i] ?? 0);
      return { type: 'convolution', matrixX: x, matrixY: y, divisor: p.divisor, bias: p.bias, matrix, defaultColor: rgba(p.color, p.alpha), clamp: p.clamp, preserveAlpha: p.preserveAlpha };
    },
    fromDesc: (d) => ({ matrixX: d.matrixX, matrixY: d.matrixY, matrix: d.matrix, divisor: d.divisor, bias: d.bias, preserveAlpha: d.preserveAlpha, clamp: d.clamp, color: rgb(d.defaultColor), alpha: alpha(d.defaultColor) }),
  },
  // 変位マップ（AS3 だけ）。mapBitmap はスクリプトの BitmapData（描くときは、その画素 .bitmap を参照で使う）。
  // scaleX / scaleY は ±65535 に収める。値は実機で確認（test/as3/displace.as）。
  DisplacementMapFilter: {
    as3Only: true,
    props: { mapBitmap: any(), mapPoint: point(), componentX: u32(0), componentY: u32(0), scaleX: num(0, -65535, 65535), scaleY: num(0, -65535, 65535), mode: mode('wrap'), color: uint(0), alpha: alphaOf(0) },
    toDesc: (p) => ({ type: 'displacement', mapObject: p.mapBitmap, map: p.mapBitmap?.bitmap ?? null, point: { ...p.mapPoint }, componentX: p.componentX, componentY: p.componentY, scaleX: p.scaleX, scaleY: p.scaleY, mode: p.mode, color: rgba(p.color, p.alpha) }),
    fromDesc: (d) => ({ mapBitmap: d.mapObject, mapPoint: { ...d.point }, componentX: d.componentX, componentY: d.componentY, scaleX: d.scaleX, scaleY: d.scaleY, mode: d.mode, color: rgb(d.color), alpha: alpha(d.color) }),
  },
};

function gradient(type) {
  return {
    props: { distance: free(4), angle: angle(45), colors: list(), alphas: list(), ratios: list(), blurX: num(4), blurY: num(4), strength: strength(1), quality: int(1), type: kind(), knockout: bool(false) },
    // 色・alpha・ratio の数が合わなければ、無いものとして扱う。色は 15 まで。
    toDesc: (p) => {
      const n = Math.min(p.colors?.length ?? 0, p.alphas?.length ?? 0, p.ratios?.length ?? 0, 15);
      const colors = Array.from({ length: n }, (_, i) => ({ color: rgba(p.colors[i], p.alphas[i]), ratio: Math.min(Math.max(Math.round(p.ratios[i]), 0), 255) }));
      return { type, colors, blurX: p.blurX, blurY: p.blurY, angle: p.angle * RAD, distance: p.distance, strength: p.strength, ...flags(p.type), knockout: p.knockout, compositeSource: true, passes: p.quality };
    },
    fromDesc: (d) => ({ distance: d.distance, angle: d.angle / RAD, colors: d.colors.map((c) => rgb(c.color)), alphas: d.colors.map((c) => alpha(c.color)), ratios: d.colors.map((c) => c.ratio), blurX: d.blurX, blurY: d.blurY, strength: d.strength, quality: d.passes, type: typeOf(d), knockout: d.knockout }),
  };
}

/** フィルタの形式の type から、スクリプトのクラス名へ。 */
export const FILTER_CLASS = { blur: 'BlurFilter', dropShadow: 'DropShadowFilter', glow: 'GlowFilter', bevel: 'BevelFilter', gradientGlow: 'GradientGlowFilter', gradientBevel: 'GradientBevelFilter', colorMatrix: 'ColorMatrixFilter', convolution: 'ConvolutionFilter', displacement: 'DisplacementMapFilter' };

/**
 * プロパティの値を、型に合わせて収める。value はスクリプトの値を JS の値にしたもの（数・真偽値・文字列・数の配列）。
 * 種類（type）は "inner" と "outer" 以外は "full"（実機で確認。null は呼ぶ側が TypeError にする）。
 */
export function coerceProp(spec, value) {
  switch (spec.kind) {
    case 'num': {
      let n = Number(value);
      if (Number.isNaN(n)) return spec.keepNaN ? NaN : 0;
      if (spec.mod) n %= spec.mod;
      n = Math.min(Math.max(n, spec.lo), spec.hi);
      return spec.step ? Math.trunc(n * spec.step) / spec.step : n;
    }
    case 'int': { const n = Math.trunc(Number(value)); return Number.isNaN(n) ? 0 : Math.min(Math.max(n, spec.lo), spec.hi); }
    case 'uint': return Number(value) >>> 0 & 0xffffff;
    case 'bool': return !!value;
    case 'type': return value === 'inner' || value === 'outer' ? value : 'full';
    case 'u32': return Number(value) >>> 0;
    default: return value;
  }
}
