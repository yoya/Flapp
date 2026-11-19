// beginGradientFill の、範囲外の値・null・色の数などの扱い（実機は、種類が null・未知なら例外、ratios が 255 を超えると塗らない、など）。画面と trace で実機と比べる
// size: 560x560
var n:int = 0;
var c3:Array = [0xff0000, 0x00ff00, 0x0000ff];
var a3:Array = [1, 1, 1];
var r3:Array = [0, 128, 255];
var cell:Function = function(f:Function):void {
  var s:Sprite = new Sprite();
  s.x = 10 + (n % 5) * 110;
  s.y = 10 + int(n / 5) * 110;
  addChild(s);
  try { f(s.graphics); } catch (e:Error) { trace("cell", n, e.errorID); }
  n++;
};
var sq:Function = function(g:Graphics):void { g.moveTo(0, 0); g.lineTo(100, 0); g.lineTo(100, 100); g.lineTo(0, 100); g.lineTo(0, 0); g.endFill(); };
var box:Function = function(x:Number, y:Number, w:Number, h:Number, r:Number):Matrix { var m:Matrix = new Matrix(); m.createGradientBox(w, h, r, x, y); return m; };
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, null, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill("LINEAR", c3, a3, r3, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, [], [], [], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, [2, -1, 0.5], r3, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, [0, 300, 255], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, [-5, 128, 255], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.RADIAL, c3, a3, r3, box(0, 0, 100, 100, 0), SpreadMethod.PAD, InterpolationMethod.RGB, 2); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.RADIAL, c3, a3, r3, box(0, 0, 100, 100, 0), SpreadMethod.PAD, InterpolationMethod.RGB, -0.5); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, box(0, 0, 100, 100, 0), SpreadMethod.PAD, InterpolationMethod.RGB, 0.8); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.RADIAL, c3, a3, r3, box(0, 0, 100, 100, Math.PI / 3), SpreadMethod.REFLECT, InterpolationMethod.LINEAR_RGB, 0.4); sq(g); });
trace("done");
