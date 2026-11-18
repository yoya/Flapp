// スクリプトで作るクリップと描画 API
// sprite: 1 frames 1 export sym square 30
// sprite: 2 frames 2 export two
trace("-- createEmptyMovieClip");
var e = this.createEmptyMovieClip("empty", 5);
trace(e + " " + empty + " " + e.getDepth() + " " + e._width + " " + e._totalframes + " " + e._currentframe + " " + typeof e);
trace(getNextHighestDepth() + " " + e.getNextHighestDepth());
var nested = e.createEmptyMovieClip("child", 1);
trace(nested + " " + nested._parent + " " + e.child + " " + e.getNextHighestDepth());
trace("-- attachMovie");
var s1 = this.attachMovie("sym", "s1", 10);
trace(s1 + " " + s1._width + " " + s1.getDepth() + " " + s1._name);
var s2 = this.attachMovie("sym", "s2", 11, {_x: 50, custom: "init"});
trace(s2._x + " " + s2.custom + " " + s2._width);
trace(this.attachMovie("nosuch", "s3", 12) + " " + typeof s3);
var replaced = this.attachMovie("sym", "s1b", 10);
trace(s1 + " [" + typeof s1 + "] " + replaced + " " + getInstanceAtDepth(10));
trace("-- duplicateMovieClip");
s2._rotation = 90;
var dup = s2.duplicateMovieClip("dup", 20);
trace(dup + " " + dup._x + " " + dup._rotation + " " + dup.custom + " " + dup.getDepth());
duplicateMovieClip(s2, "dup2", 21);
trace(dup2 + " " + dup2._x);
trace("-- removeMovieClip");
dup.removeMovieClip();
trace("[" + dup + "] " + typeof dup + " " + getInstanceAtDepth(20) + " [" + dup._x + "]");
removeMovieClip("dup2");
trace("[" + dup2 + "]");
trace("-- frame scripts of attached clips");
var t = this.attachMovie("two", "t", 30);
trace("attached " + t._currentframe);
//// sprite 2 frame 1
trace("two frame 1 " + this + " " + _parent);
//// sprite 2 frame 2
trace("two frame 2");
stop();
_root.drawTest();
//// frame 1
trace("-- drawing");
function drawTest() {
  var d = this.createEmptyMovieClip("d", 40);
  trace(d._width + " " + d._height);
  d.lineStyle(2, 0xFF0000, 100);
  d.moveTo(10, 10);
  d.lineTo(60, 10);
  d.lineTo(60, 40);
  trace(d._width + " " + d._height);
  d.clear();
  d.beginFill(0x0000FF, 50);
  d.moveTo(0, 0);
  d.lineTo(100, 0);
  d.curveTo(150, 50, 100, 100);
  d.lineTo(0, 100);
  d.endFill();
  var b = d.getBounds(this);
  trace(d._width + " " + d._height + " " + b.xMin + " " + b.xMax + " " + b.yMin + " " + b.yMax);
  d._x = 20;
  trace(d.getBounds(this).xMin + " " + d.getBounds(d).xMin + " " + d.hitTest(30, 50) + " " + d.hitTest(5, 50));
  trace("-- registerClass");
  function Ball() { trace("Ball constructor " + this._name); this.kind = "ball"; }
  Ball.prototype = new MovieClip();
  Ball.prototype.describe = function() { return "I am " + this._name + " / " + this.kind; };
  Object.registerClass("sym", Ball);
  var ball = this.attachMovie("sym", "ball1", 50);
  trace(ball.describe() + " " + (ball instanceof Ball) + " " + (ball instanceof MovieClip) + " " + ball._width);
  Object.registerClass("sym", null);
  trace(typeof this.attachMovie("sym", "ball2", 51).describe);
}
