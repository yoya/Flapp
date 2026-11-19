// lineStyle の端・角・miterLimit・拡大縮小・pixelHinting と、lineGradientStyle。画面で実機と比べる
// size: 560x340
var n:int = 0;
var cell:Function = function(f:Function, sx:Number = 1, sy:Number = 1):void {
  var s:Sprite = new Sprite();
  s.x = 10 + (n % 5) * 110;
  s.y = 10 + int(n / 5) * 110;
  s.scaleX = sx; s.scaleY = sy;
  addChild(s);
  try { f(s.graphics); } catch (e:Error) { trace("cell", n, e.errorID); }
  n++;
};
var vee:Function = function(g:Graphics):void { g.moveTo(15, 15); g.lineTo(50, 80); g.lineTo(85, 15); };
var sharp:Function = function(g:Graphics):void { g.moveTo(10, 15); g.lineTo(90, 50); g.lineTo(10, 85); };
cell(function(g:Graphics):void { g.lineStyle(16, 0xff0000, 1, false, "normal", CapsStyle.ROUND, JointStyle.ROUND); vee(g); });
cell(function(g:Graphics):void { g.lineStyle(16, 0xff0000, 1, false, "normal", CapsStyle.NONE, JointStyle.ROUND); vee(g); });
cell(function(g:Graphics):void { g.lineStyle(16, 0xff0000, 1, false, "normal", CapsStyle.SQUARE, JointStyle.ROUND); vee(g); });
cell(function(g:Graphics):void { g.lineStyle(16, 0xff0000, 1, false, "normal", CapsStyle.NONE, JointStyle.BEVEL); vee(g); });
cell(function(g:Graphics):void { g.lineStyle(16, 0xff0000, 1, false, "normal", CapsStyle.NONE, JointStyle.MITER); vee(g); });
cell(function(g:Graphics):void { g.lineStyle(16, 0xff0000, 1, false, "normal", CapsStyle.NONE, JointStyle.MITER, 1); sharp(g); });
cell(function(g:Graphics):void { g.lineStyle(16, 0xff0000, 1, false, "normal", CapsStyle.NONE, JointStyle.MITER, 10); sharp(g); });
cell(function(g:Graphics):void { g.lineStyle(16, 0xff0000, 1, false, "normal", CapsStyle.NONE, JointStyle.MITER, 3); sharp(g); });
cell(function(g:Graphics):void { g.lineStyle(10, 0x0000ff, 1, false, LineScaleMode.NORMAL); vee(g); }, 1.6, 0.7);
cell(function(g:Graphics):void { g.lineStyle(10, 0x0000ff, 1, false, LineScaleMode.NONE); vee(g); }, 1.6, 0.7);
cell(function(g:Graphics):void { g.lineStyle(10, 0x0000ff, 1, false, LineScaleMode.VERTICAL); vee(g); }, 1.6, 0.7);
cell(function(g:Graphics):void { g.lineStyle(10, 0x0000ff, 1, false, LineScaleMode.HORIZONTAL); vee(g); }, 1.6, 0.7);
cell(function(g:Graphics):void { g.lineStyle(14, 0x000000, 1, false, "normal", CapsStyle.ROUND, JointStyle.ROUND); var m:Matrix = new Matrix(); m.createGradientBox(100, 100, 0, 0, 0); g.lineGradientStyle(GradientType.LINEAR, [0xff0000, 0x00ff00, 0x0000ff], [1, 1, 1], [0, 128, 255], m); vee(g); });
cell(function(g:Graphics):void { g.lineStyle(14, 0x000000, 1, false, "normal", CapsStyle.ROUND, JointStyle.ROUND); var m:Matrix = new Matrix(); m.createGradientBox(100, 100, 0, 0, 0); g.lineGradientStyle(GradientType.RADIAL, [0xff0000, 0x00ff00, 0x0000ff], [1, 1, 1], [0, 128, 255], m); g.drawRect(15, 15, 70, 70); });
cell(function(g:Graphics):void { var m:Matrix = new Matrix(); m.createGradientBox(100, 100, 0, 0, 0); g.lineGradientStyle(GradientType.LINEAR, [0xff0000, 0x00ff00], [1, 1], [0, 255], m); vee(g); });
trace("done");
