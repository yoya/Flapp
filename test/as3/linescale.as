// LineScaleMode ごとの、線の太さの拡大縮小。十字（太さ 10 の横線と縦線）を、横に 2 倍・縦に 0.5 倍など、向きを変えて拡大縮小した中で描く。画面で実機と比べる
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
for each (var mode:String in [LineScaleMode.NORMAL, LineScaleMode.NONE, LineScaleMode.VERTICAL, LineScaleMode.HORIZONTAL]) cell(mode, 2, 0.5);
for each (var mode2:String in [LineScaleMode.NORMAL, LineScaleMode.NONE, LineScaleMode.VERTICAL, LineScaleMode.HORIZONTAL]) cell(mode2, 0.5, 2);
trace("done");
