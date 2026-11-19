// 読み込まれる側のムービー（test/as/loadswf.as が読み込む）。単独で再生しても動く
// sprite: 1 frames 1 name inner depth 1 square 20 at 5,5
// sprite: 2 frames 1 export childSym square 10
trace("child frame 1: this=" + this + " _root=" + _root + " _level0=" + _level0 + " _parent=" + _parent + " inner=" + inner + " _target=" + _target + " " + _currentframe + "/" + _totalframes);
var childVar = "hello";
var made = attachMovie("childSym", "made", 10);
trace("child attach " + made + " " + made._width + " size=" + this._width + "x" + this._height);
//// frame 2
trace("child frame 2: " + this + " " + _currentframe + "/" + _totalframes);
stop();
