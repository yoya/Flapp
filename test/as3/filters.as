// flash.filters のクラスと DisplayObject.filters。画面で実機と比べ、プロパティの既定値・範囲・読み戻しは trace で比べる
// size: 560x560
var n:int = 0;
var cell:Function = function(list:Array, sx:Number = 1, sy:Number = 1):Sprite {
  var s:Sprite = new Sprite();
  s.x = 10 + (n % 5) * 110;
  s.y = 10 + int(n / 5) * 110;
  s.scaleX = sx; s.scaleY = sy;
  var g:Graphics = s.graphics;
  g.lineStyle(2, 0x000000); g.beginFill(0x33aa33); g.drawCircle(40, 40, 25); g.endFill();
  g.lineStyle(0, 0x000000, 0); g.beginFill(0xcc3333, 0.8); g.drawRect(50, 50, 30, 30); g.endFill();
  addChild(s);
  try { s.filters = list; } catch (e:Error) { trace("cell", n, e.errorID); }
  n++;
  return s;
};
cell([new BlurFilter(8, 8, 2)]);
cell([new BlurFilter(20, 2, 3)]);
cell([new DropShadowFilter()]);
cell([new DropShadowFilter(8, 135, 0x0000ff, 0.6, 6, 6, 2, 3)]);
cell([new DropShadowFilter(6, 45, 0x000000, 1, 4, 4, 1, 2, true)]);
cell([new DropShadowFilter(6, 45, 0x000000, 1, 4, 4, 1, 2, false, true, true)]);
cell([new GlowFilter()]);
cell([new GlowFilter(0x00ffff, 1, 8, 8, 3, 2, true, false)]);
cell([new GlowFilter(0xffff00, 1, 8, 8, 3, 2, false, true)]);
cell([new BevelFilter()]);
cell([new BevelFilter(6, 225, 0xffff00, 1, 0x0000ff, 1, 8, 8, 2, 2, "outer")]);
cell([new BevelFilter(6, 45, 0xffffff, 1, 0x000000, 1, 6, 6, 2, 2, "full")]);
cell([new GradientGlowFilter(4, 45, [0xff0000, 0x00ff00, 0x0000ff], [0, 1, 1], [0, 128, 255], 8, 8, 2, 2, "outer")]);
cell([new GradientBevelFilter(4, 45, [0xffffff, 0x888888, 0x000000], [1, 0, 1], [0, 128, 255], 6, 6, 2, 2, "inner")]);
cell([new ColorMatrixFilter([0.3, 0.6, 0.1, 0, 0, 0.3, 0.6, 0.1, 0, 0, 0.3, 0.6, 0.1, 0, 0, 0, 0, 0, 1, 0])]);
cell([new ConvolutionFilter(3, 3, [0, -1, 0, -1, 5, -1, 0, -1, 0], 1, 0, true, true, 0, 0)]);
cell([new BlurFilter(6, 6, 1), new GlowFilter(0xff00ff, 1, 8, 8, 2, 1)]);
cell([new DropShadowFilter(8, 45, 0, 0.7, 6, 6, 1, 2)], 1.6, 0.8);
cell([new GlowFilter(0xff8800, 1, 12, 12, 4, 3)], 0.6, 0.6);
cell([new ColorMatrixFilter([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0])]);
cell([new BlurFilter(0, 0, 1)]);
cell([new BlurFilter(1, 1, 1)]);
cell([new BlurFilter(300, -5, 99)]);
cell([new GlowFilter(0xff0000, 5, 6, 6, 500, 1)]);
cell([]);
trace("done");
var s:Sprite = new Sprite();
var f1:DropShadowFilter = new DropShadowFilter();
trace("drop", f1.distance, f1.angle, f1.color, f1.alpha, f1.blurX, f1.blurY, f1.strength, f1.quality, f1.inner, f1.knockout, f1.hideObject);
var f2:GlowFilter = new GlowFilter();
trace("glow", f2.color, f2.alpha, f2.blurX, f2.blurY, f2.strength, f2.quality, f2.inner, f2.knockout);
var f3:BevelFilter = new BevelFilter();
trace("bevel", f3.distance, f3.angle, f3.highlightColor, f3.highlightAlpha, f3.shadowColor, f3.shadowAlpha, f3.blurX, f3.blurY, f3.strength, f3.quality, f3.type, f3.knockout);
var f4:BlurFilter = new BlurFilter(300, -5, 99);
trace("blur", f4.blurX, f4.blurY, f4.quality);
var f5:GradientGlowFilter = new GradientGlowFilter();
trace("gg", f5.distance, f5.angle, f5.colors, f5.alphas, f5.ratios, f5.blurX, f5.strength, f5.quality, f5.type);
var f6:ConvolutionFilter = new ConvolutionFilter();
trace("conv", f6.matrixX, f6.matrixY, f6.matrix, f6.divisor, f6.bias, f6.preserveAlpha, f6.clamp, f6.color, f6.alpha);
var f7:ColorMatrixFilter = new ColorMatrixFilter();
trace("cm", f7.matrix);
s.filters = [f1, f4];
trace("len", s.filters.length, s.filters[0] is DropShadowFilter, s.filters[1] is BlurFilter, s.filters[0] == f1, s.filters[0] == s.filters[0]);
f1.distance = 99;
trace("after", s.filters[0].distance, f1.distance);
s.filters = null;
trace("null", s.filters.length);
var c1:BlurFilter = f4.clone() as BlurFilter;
trace("clone", c1.blurX, c1 != f4, c1 is BitmapFilter);
f1.angle = 400; f1.alpha = -3; f1.strength = 999; f1.quality = -1; f1.color = 0x1ffffff;
trace("set", f1.angle, f1.alpha, f1.strength, f1.quality, f1.color);
f3.type = "bogus";
trace("type", f3.type);
var f8:DropShadowFilter = new DropShadowFilter();
var f9:BevelFilter = new BevelFilter();
var f10:GradientGlowFilter = new GradientGlowFilter();
var out:Array = [];
for each (var a:Number in [400, -400, 181, 225, -190, 720, 360, -180, 180, 179.5, 0.5, -0.5, 1e10, NaN]) { f8.angle = a; f9.angle = a; f10.angle = a; out.push(f8.angle + "/" + f9.angle + "/" + f10.angle); }
trace("angles", out.join(" "));
var d:Array = [];
for each (var v:Number in [40000, -40000, 100, -100, 0.5, NaN, Infinity]) { f8.distance = v; f9.distance = v; d.push(f8.distance + "/" + f9.distance); }
trace("dist", d.join(" "));
var b:Array = [];
for each (var w:Number in [0.5, 255.5, 256, -1, NaN, 1.7]) { f8.blurX = w; f8.quality = w; f8.strength = w; b.push(f8.blurX + "/" + f8.quality + "/" + f8.strength); }
trace("blur", b.join(" "));
f9.type = "outer"; var t1:String = f9.type; f9.type = "FULL"; var t2:String = f9.type; var t3:String = "skipped"; f9.type = ""; var t4:String = f9.type; f9.type = "inner"; var t5:String = f9.type;
trace("types", t1, t2, t3, t4, t5);
f10.colors = [0xff0000, 0x00ff00]; f10.alphas = [1, 0.5, 0.25]; f10.ratios = [0, 255];
trace("arrays", f10.colors, f10.alphas, f10.ratios, f10.colors.length);
var q1:DropShadowFilter = new DropShadowFilter(); q1.alpha = 0.5; var q2:GlowFilter = new GlowFilter(0, 0.3); trace("alpha", q1.alpha, q2.alpha, new BevelFilter(4, 45, 0, 0.7, 0, 0.2).highlightAlpha);
var cm:ColorMatrixFilter = new ColorMatrixFilter([1, 2, 3]);
trace("cm3", cm.matrix, cm.matrix.length);

cm.matrix = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]; trace("cm22", cm.matrix.length);
var cv:ConvolutionFilter = new ConvolutionFilter(3, 3, [1, 2, 3]);
trace("cv", cv.matrix, cv.matrix.length, cv.matrixX);
var gl:GlowFilter = new GlowFilter(0xff0000, 1, 6, 6, 2, 1);
var sp:Sprite = new Sprite(); sp.filters = [gl, new BlurFilter(2, 2, 1), new DropShadowFilter(), new BevelFilter(), new GradientGlowFilter(), new ColorMatrixFilter()];
trace("many", sp.filters.length);
var sp2:Sprite = new Sprite(); try { sp2.filters = [new BlurFilter(), null]; } catch (e:Error) { trace("nullitem", e.errorID); }
var sp3:Sprite = new Sprite(); try { sp3.filters = ["a"]; trace("strfilter", sp3.filters.length); } catch (e:Error) { trace("strfilter", e.errorID); }
var sp4:Sprite = new Sprite(); sp4.filters = [new BlurFilter(2, 2, 1)]; var got:Array = sp4.filters; got.push(new GlowFilter()); trace("mut", sp4.filters.length, got.length);
