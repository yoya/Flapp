// lineStyle の端・角・miterLimit・拡大縮小と、lineGradientStyle（SWF 8）。画面で実機と比べる
// swf: 8
// size: 560x340
var n = 0;
function cell(f, sx, sy) {
  var mc = _root.createEmptyMovieClip("c" + n, n + 1);
  mc._x = 10 + (n % 5) * 110;
  mc._y = 10 + Math.floor(n / 5) * 110;
  if (sx != undefined) { mc._xscale = sx * 100; mc._yscale = sy * 100; }
  n++;
  f(mc);
}
function vee(mc) { mc.moveTo(15, 15); mc.lineTo(50, 80); mc.lineTo(85, 15); }
function sharp(mc) { mc.moveTo(10, 15); mc.lineTo(90, 50); mc.lineTo(10, 85); }
function box(x, y, w, h, r) { var o = new Object(); o.matrixType = "box"; o.x = x; o.y = y; o.w = w; o.h = h; o.r = r; return o; }
cell(function(mc) { mc.lineStyle(16, 0xff0000, 100, false, "normal", "round", "round"); vee(mc); });
cell(function(mc) { mc.lineStyle(16, 0xff0000, 100, false, "normal", "none", "round"); vee(mc); });
cell(function(mc) { mc.lineStyle(16, 0xff0000, 100, false, "normal", "square", "round"); vee(mc); });
cell(function(mc) { mc.lineStyle(16, 0xff0000, 100, false, "normal", "none", "bevel"); vee(mc); });
cell(function(mc) { mc.lineStyle(16, 0xff0000, 100, false, "normal", "none", "miter"); vee(mc); });
cell(function(mc) { mc.lineStyle(16, 0xff0000, 100, false, "normal", "none", "miter", 1); sharp(mc); });
cell(function(mc) { mc.lineStyle(16, 0xff0000, 100, false, "normal", "none", "miter", 10); sharp(mc); });
cell(function(mc) { mc.lineStyle(16, 0xff0000, 100, false, "normal", "none", "miter", 3); sharp(mc); });
cell(function(mc) { mc.lineStyle(10, 0x0000ff, 100, false, "normal"); vee(mc); }, 1.6, 0.7);
cell(function(mc) { mc.lineStyle(10, 0x0000ff, 100, false, "none"); vee(mc); }, 1.6, 0.7);
cell(function(mc) { mc.lineStyle(10, 0x0000ff, 100, false, "vertical"); vee(mc); }, 1.6, 0.7);
cell(function(mc) { mc.lineStyle(10, 0x0000ff, 100, false, "horizontal"); vee(mc); }, 1.6, 0.7);
cell(function(mc) { mc.lineStyle(14, 0x000000, 100, false, "normal", "round", "round"); mc.lineGradientStyle("linear", [0xff0000, 0x00ff00, 0x0000ff], [100, 100, 100], [0, 128, 255], box(0, 0, 100, 100, 0)); vee(mc); });
cell(function(mc) { mc.lineStyle(14, 0x000000, 100, false, "normal", "round", "round"); mc.lineGradientStyle("radial", [0xff0000, 0x00ff00, 0x0000ff], [100, 100, 100], [0, 128, 255], box(0, 0, 100, 100, 0)); mc.moveTo(15, 15); mc.lineTo(85, 15); mc.lineTo(85, 85); mc.lineTo(15, 85); mc.lineTo(15, 15); });
cell(function(mc) { mc.lineGradientStyle("linear", [0xff0000, 0x00ff00], [100, 100], [0, 255], box(0, 0, 100, 100, 0)); vee(mc); });
trace("done");
