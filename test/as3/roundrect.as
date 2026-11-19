// drawRoundRect と drawRoundRectComplex。線の太さを付けて、角の曲線の形（始点・ 2 本の 2 次曲線）まで実機と比べる。画面で比較する
// size: 560x340
var n:int = 0;
var cell:Function = function(f:Function):void {
  var s:Sprite = new Sprite();
  s.x = 10 + (n % 5) * 110;
  s.y = 10 + int(n / 5) * 110;
  addChild(s);
  try { f(s.graphics); } catch (e:Error) { trace("cell", n, e.errorID); }
  n++;
};
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, 90, 90, 30); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, 90, 60, 40, 20); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, 90, 90, 0); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, 90, 90, 200); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, 90, 90, 40, 0); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, 90, 90, 20, 60); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, -90, 90, 30); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRectComplex(5, 5, 90, 90, 40, 10, 20, 0); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, 90, 90, 30, NaN); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRect(5, 5, 90, 90); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawCircle(50, 50, 40); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawEllipse(5, 5, 90, 50); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000); g.beginFill(0x00cc00); g.drawRoundRect(5, 5, 90, 90, 30); g.drawRoundRect(30, 30, 40, 40, 20); g.endFill(); });
cell(function(g:Graphics):void { g.lineStyle(6, 0xff0000, 1, false, "normal", CapsStyle.NONE, JointStyle.MITER); g.drawRoundRect(5, 5, 90, 90, 30); });
trace("done");
