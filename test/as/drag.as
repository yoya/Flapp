// startDrag / stopDrag、_droptarget、形状での hitTest
// 入力の手順は test/fixtures/as-drag.input.json
// sprite: 1 name a depth 1 square 40 at 20,20
// sprite: 2 name b depth 2 square 40 at 120,20
// sprite: 3 name pair depth 3 at 20,100
// sprite: 4 name left in 3 depth 1 square 20
// sprite: 5 name right in 3 depth 2 square 20 at 60,0
function where() { return "a=" + a._x + "," + a._y + " b=" + b._x + "," + b._y; }
function dropA() { this.stopDrag(); trace("a stop " + where() + " drop=[" + this._droptarget + "]"); }
function dropB() { stopDrag(); trace("b stop " + where() + " drop=[" + this._droptarget + "] eval=" + eval(this._droptarget)); }
a.onPress = function() { this.startDrag(false); trace("a start " + where()); };
a.onRelease = dropA;
a.onReleaseOutside = dropA;
b.onPress = function() { startDrag(this, true, 100, 0, 180, 60); trace("b start " + where()); };
b.onRelease = dropB;
b.onReleaseOutside = dropB;
var kl = new Object();
kl.onKeyDown = function() { trace("now " + where() + " drop a=[" + a._droptarget + "] b=[" + b._droptarget + "]"); };
Key.addListener(kl);
trace("pair hit " + pair.hitTest(30, 110, true) + " " + pair.hitTest(50, 110, true) + " " + pair.hitTest(50, 110, false) + " " + pair.hitTest(90, 110, true) + " " + pair.hitTest(50, 110));
trace("clips " + a.hitTest(b) + " " + pair.hitTest(pair.left) + " " + a.hitTest(a) + " inside " + a.hitTest(21, 21, true) + " " + a.hitTest(59, 59, true) + " outside " + a.hitTest(19, 30, true) + " " + a.hitTest(30, 61, true));
stop();
