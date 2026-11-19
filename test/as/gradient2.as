// beginGradientFill の、範囲外の値・空の配列・色の数・大文字の種類などの扱い。画面で実機と比べる
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
cell(function(mc) { mc.beginGradientFill("LINEAR", c3, a3, r3, box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", [], [], [], box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, [200, -50, 50], r3, box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, [0, 300, 255], box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, [-5, 128, 255], box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], [0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240], box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("radial", c3, a3, r3, box(0, 0, 100, 100, 0), "pad", "RGB", 2); sq(mc); });
cell(function(mc) { mc.beginGradientFill("radial", c3, a3, r3, box(0, 0, 100, 100, 0), "pad", "RGB", -0.5); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, 0), "bogus", "bogus"); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(25, 25, 50, 50, 0), "REFLECT"); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, 0), "pad", "LINEARRGB"); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, 0), "pad", "RGB", 0.8); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, null, box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, null, r3, box(0, 0, 100, 100, 0)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, mx(100, 0, 0, 0, 100, 0, 50, 50, 1)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, mx(200, 0, 0, 0, 50, 0, 0, 0, 1)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, mx(0, 100, 0, 100, 0, 0, 50, 50, 1)); sq(mc); });
cell(function(mc) { mc.beginGradientFill("linear", c3, a3, r3, mx(80, 0, 20, 0, 80, 30, 50, 50, 1)); sq(mc); });
trace("done");
