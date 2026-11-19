// beginGradientFill（線形・放射・焦点・spread・補間・createGradientBox・行列の省略・数や ratios の扱い）を並べる。画面で実機と比べる
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
cell(function(g:Graphics):void { g.beginGradientFill("linear", c3, a3, r3, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, box(0, 0, 100, 100, Math.PI / 4)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.RADIAL, c3, a3, r3, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.RADIAL, c3, a3, r3, box(20, 20, 60, 60, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.RADIAL, c3, a3, r3, box(0, 0, 100, 100, 0), SpreadMethod.PAD, InterpolationMethod.RGB, 0.8); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, box(25, 25, 50, 50, 0), SpreadMethod.REFLECT); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, box(25, 25, 50, 50, 0), SpreadMethod.REPEAT); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, box(0, 0, 100, 100, 0), SpreadMethod.PAD, InterpolationMethod.LINEAR_RGB); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, [0xff0000, 0xff0000], [1, 0], [0, 255], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, [0xffffff, 0x000000], [1, 1], [64, 192], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, new Matrix(0.1, 0, 0, 0.1, 50, 50)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, new Matrix(0.05, 0.02, -0.02, 0.05, 50, 50)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, [1, 0.5, 1], r3); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, [0xff0000, 0x00ff00, 0x0000ff, 0xffff00], [1, 1, 1], [0, 100, 255], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, [255, 128, 0], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.lineStyle(10, 0x000000); g.beginGradientFill(GradientType.RADIAL, c3, a3, r3, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, [2, -1, 0.5], [0, 300, 255], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, box(0, 0, 100, 100, 0)); g.moveTo(0, 0); g.lineTo(100, 0); g.lineTo(100, 100); g.lineStyle(4, 0xff00ff); g.lineTo(0, 100); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, [1, 1], r3, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, [0, 128], box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, box(0, 0, 100, 100, 0), "bogus"); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, a3, r3, box(0, 0, 100, 100, 0), SpreadMethod.PAD, "bogus"); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(null, c3, a3, r3, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, null, a3, r3, box(0, 0, 100, 100, 0)); sq(g); });
cell(function(g:Graphics):void { g.beginGradientFill(GradientType.LINEAR, c3, null, r3, box(0, 0, 100, 100, 0)); sq(g); });
trace("done");
