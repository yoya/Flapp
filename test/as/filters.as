// flash.filters のクラスと MovieClip.filters（SWF 8）。画面で実機と比べ、既定値・範囲・読み戻しは trace で比べる
// swf: 8
// size: 560x340
var n = 0;
function cell(list, sx, sy) {
  var mc = _root.createEmptyMovieClip("c" + n, n + 1);
  mc._x = 10 + (n % 5) * 110;
  mc._y = 10 + Math.floor(n / 5) * 110;
  if (sx != undefined) { mc._xscale = sx * 100; mc._yscale = sy * 100; }
  mc.lineStyle(2, 0x000000); mc.beginFill(0x33aa33); mc.moveTo(65, 40); mc.curveTo(65, 65, 40, 65); mc.curveTo(15, 65, 15, 40); mc.curveTo(15, 15, 40, 15); mc.curveTo(65, 15, 65, 40); mc.endFill();
  mc.lineStyle(0, 0x000000, 0); mc.beginFill(0xcc3333, 80); mc.moveTo(50, 50); mc.lineTo(80, 50); mc.lineTo(80, 80); mc.lineTo(50, 80); mc.lineTo(50, 50); mc.endFill();
  mc.filters = list;
  n++;
  return mc;
}
function fl(name) { return flash.filters[name]; }
cell([new flash.filters.BlurFilter(8, 8, 2)]);
cell([new flash.filters.DropShadowFilter()]);
cell([new flash.filters.DropShadowFilter(8, 135, 0x0000ff, 0.6, 6, 6, 2, 3)]);
cell([new flash.filters.GlowFilter()]);
cell([new flash.filters.GlowFilter(0x00ffff, 1, 8, 8, 3, 2, true, false)]);
cell([new flash.filters.BevelFilter()]);
cell([new flash.filters.BevelFilter(6, 225, 0xffff00, 1, 0x0000ff, 1, 8, 8, 2, 2, "outer")]);
cell([new flash.filters.GradientGlowFilter(4, 45, [0xff0000, 0x00ff00, 0x0000ff], [0, 1, 1], [0, 128, 255], 8, 8, 2, 2, "outer")]);
cell([new flash.filters.ColorMatrixFilter([0.3, 0.6, 0.1, 0, 0, 0.3, 0.6, 0.1, 0, 0, 0.3, 0.6, 0.1, 0, 0, 0, 0, 0, 1, 0])]);
cell([new flash.filters.ConvolutionFilter(3, 3, [0, -1, 0, -1, 5, -1, 0, -1, 0], 1, 0, true, true, 0, 0)]);
cell([new flash.filters.BlurFilter(6, 6, 1), new flash.filters.GlowFilter(0xff00ff, 1, 8, 8, 2, 1)]);
cell([new flash.filters.DropShadowFilter(8, 45, 0, 0.7, 6, 6, 1, 2)], 1.6, 0.8);
trace("done");
var f1 = new flash.filters.DropShadowFilter();
trace("drop " + f1.distance + " " + f1.angle + " " + f1.color + " " + f1.alpha + " " + f1.blurX + " " + f1.blurY + " " + f1.strength + " " + f1.quality + " " + f1.inner + " " + f1.knockout + " " + f1.hideObject);
var f2 = new flash.filters.BlurFilter(300, -5, 99);
trace("blur " + f2.blurX + " " + f2.blurY + " " + f2.quality);
var s1 = _root.createEmptyMovieClip("s1", 100);
s1.filters = [f1, f2];
var got = s1.filters;
trace("len " + got.length + " " + (got[0] == f1) + " " + (got[0] instanceof flash.filters.DropShadowFilter) + " " + got[1].blurX);
f1.distance = 99;
trace("after " + s1.filters[0].distance + " " + f1.distance);
f1.angle = 400; f1.alpha = -3; f1.strength = 999; f1.quality = -1;
trace("set " + f1.angle + " " + f1.alpha + " " + f1.strength + " " + f1.quality);
var f3 = new flash.filters.BevelFilter();
f3.type = "bogus";
trace("type " + f3.type);
var f4 = f2.clone();
trace("clone " + f4.blurX + " " + (f4 != f2));
s1.filters = null;
trace("null " + s1.filters.length);
