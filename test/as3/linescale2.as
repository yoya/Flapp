// LineScaleMode.NONE の線の太さが、拡大縮小の向きと大きさで、どう決まるか。画面で実機と比べる
// size: 560x340
var n:int = 0;
var cell:Function = function(mode:String, sx:Number, sy:Number):void {
  var s:Sprite = new Sprite();
  s.x = 10 + (n % 4) * 135;
  s.y = 10 + int(n / 4) * 160;
  s.scaleX = sx; s.scaleY = sy;
  addChild(s);
  var g:Graphics = s.graphics;
  g.lineStyle(10, 0x0000ff, 1, false, mode, CapsStyle.NONE, JointStyle.MITER);
  g.moveTo(10, 40); g.lineTo(60, 40); g.moveTo(35, 10); g.lineTo(35, 70);
  n++;
};
var cfg:Array = [[1, 1], [3, 1], [1, 3], [2, 2], [0.5, 0.5], [3, 2], [2, 3], [4, 0.5]];
for each (var c:Array in cfg) cell(LineScaleMode.NONE, c[0], c[1]);
trace("done");
