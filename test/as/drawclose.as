// 塗りを閉じるときの輪郭線。線を引いたまま塗りを終わる（endFill、次の beginFill、描き終わり）と、閉じる辺にも線が引かれるか。画面で実機と比べる
// swf: 8
// size: 560x240
var n = 0;
function cell(f) {
  var mc = _root.createEmptyMovieClip("c" + n, n + 1);
  mc._x = 10 + (n % 5) * 110;
  mc._y = 10 + Math.floor(n / 5) * 110;
  n++;
  f(mc);
}
cell(function(mc) { mc.lineStyle(4, 0xff0000); mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineTo(90, 10); mc.lineTo(50, 90); mc.endFill(); });
cell(function(mc) { mc.lineStyle(4, 0xff0000); mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineTo(90, 10); mc.lineTo(50, 90); });
cell(function(mc) { mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineTo(90, 10); mc.lineTo(50, 90); mc.lineStyle(4, 0xff0000); mc.lineTo(10, 60); });
cell(function(mc) { mc.lineStyle(4, 0xff0000); mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineTo(50, 10); mc.lineTo(30, 50); mc.moveTo(60, 50); mc.lineTo(95, 50); mc.lineTo(80, 90); mc.endFill(); });
cell(function(mc) { mc.lineStyle(4, 0xff0000); mc.moveTo(10, 10); mc.lineTo(90, 10); mc.lineTo(50, 90); });
cell(function(mc) { mc.lineStyle(4, 0xff0000); mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineTo(90, 10); mc.lineTo(50, 90); mc.beginFill(0x0000cc); mc.moveTo(60, 60); mc.lineTo(95, 60); mc.lineTo(95, 95); mc.endFill(); });
cell(function(mc) { mc.lineStyle(4, 0xff0000); mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineTo(90, 10); mc.lineStyle(undefined); mc.lineTo(50, 90); mc.endFill(); });
cell(function(mc) { mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineStyle(4, 0xff0000); mc.lineTo(90, 10); mc.lineStyle(4, 0x0000ff); mc.lineTo(50, 90); mc.endFill(); });
cell(function(mc) { mc.lineStyle(4, 0xff0000); mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineTo(90, 10); mc.lineTo(90, 90); mc.lineTo(10, 90); mc.lineTo(10, 10); mc.endFill(); });
cell(function(mc) { mc.lineStyle(4, 0xff0000); mc.beginFill(0x00cc00); mc.moveTo(10, 10); mc.lineTo(90, 10); mc.lineTo(50, 90); mc.clear(); mc.lineStyle(2, 0x000000); mc.moveTo(10, 10); mc.lineTo(90, 90); });
trace("done");
