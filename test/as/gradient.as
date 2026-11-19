// beginGradientFill（線形・放射・焦点・spread・補間・箱形の行列・一般の行列・色の数や ratios の扱い）を並べる。画面で実機と比べる
// swf: 8
// size: 560x460
var n = 0;
function cell(f) {
  var mc = _root.createEmptyMovieClip("c" + n, n + 1);
  mc._x = 10 + (n % 5) * 110;
  mc._y = 10 + Math.floor(n / 5) * 110;
  n++;
  f(mc);
  return mc;
}
function sq(mc) { mc.moveTo(0, 0); mc.lineTo(100, 0); mc.lineTo(100, 100); mc.lineTo(0, 100); mc.lineTo(0, 0); mc.endFill(); }
function box(x, y, w, h, r) { var o = new Object(); o.matrixType = "box"; o.x = x; o.y = y; o.w = w; o.h = h; o.r = r; return o; }
function mx(a, b, c, d, e, f, g, h, i) { var o = new Object(); o.a = a; o.b = b; o.c = c; o.d = d; o.e = e; o.f = f; o.g = g; o.h = h; o.i = i; return o; }
var c3 = [0xff0000, 0x00ff00, 0x0000ff];
var a3 = [100, 100, 100];
var r3 = [0, 128, 255];
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, Math.PI / 4)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("radial", c3, a3, r3, box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("radial", c3, a3, r3, box(20, 20, 60, 60, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("radial", c3, a3, r3, box(0, 0, 100, 100, 0), "pad", "RGB", 0.8); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(25, 25, 50, 50, 0), "reflect"); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(25, 25, 50, 50, 0), "repeat"); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, 0), "pad", "linearRGB"); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", [0xff0000, 0xff0000], [100, 0], [0, 255], box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", [0xffffff, 0x000000], [100, 100], [64, 192], box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, mx(100, 0, 0, 0, 100, 0, 50, 50, 1)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, mx(80, 30, 0, -30, 80, 0, 50, 50, 1)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, [100, 50, 100], r3); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", [0xff0000, 0x00ff00, 0x0000ff, 0xffff00], [100, 100, 100], [0, 100, 255], box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, [255, 128, 0], box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.lineStyle(10, 0x000000); mc.beginGradientFill("radial", c3, a3, r3, box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("bogus", c3, a3, r3, box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, 0)); mc.moveTo(0, 0); mc.lineTo(100, 0); mc.lineTo(50, 100); mc.beginFill(0x888888); mc.moveTo(0, 0); mc.lineTo(40, 0); mc.lineTo(0, 40); mc.endFill(); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, 0)); mc.moveTo(0, 0); mc.lineTo(100, 0); mc.lineTo(100, 100); mc.lineStyle(4, 0xff00ff); mc.lineTo(0, 100); });
trace("done");
