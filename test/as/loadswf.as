// loadMovie、MovieClipLoader、loadMovieNum で、ほかの SWF（test/fixtures/as-loadchild.swf）を読み込む
// sprite: 1 frames 1 name box depth 1 square 30 at 100,10
var frame = 0;
box.marker = "old";
box.loadMovie("as-loadchild.swf");
trace("after loadMovie: " + box.marker + " " + box._totalframes);
var holder = this.createEmptyMovieClip("holder", 5);
holder._y = 100;
var loader = new MovieClipLoader();
var listener = {};
listener.onLoadStart = function(t) { trace("onLoadStart " + t); };
listener.onLoadComplete = function(t, status) { trace("onLoadComplete " + t + " childVar=" + t.childVar + " frames=" + t._totalframes); };
listener.onLoadInit = function(t) { trace("onLoadInit " + t + " childVar=" + t.childVar + " inner=" + t.inner + " made=" + t.made + " " + t._currentframe + "/" + t._totalframes); };
listener.onLoadError = function(t, error) { trace("onLoadError " + t + " " + error); };
loader.addListener(listener);
loader.loadClip("as-loadchild.swf", holder);
loadMovieNum("as-loadchild.swf", 1);
trace("level1 right after: " + _level1);
onEnterFrame = function() {
  frame++;
  if (frame == 4) {
    trace("frame 4: box=" + box + " childVar=" + box.childVar + " marker=" + box.marker + " " + box._currentframe + "/" + box._totalframes + " x=" + box._x);
    trace("frame 4: level1=" + _level1 + " childVar=" + _level1.childVar + " " + _level1._currentframe + "/" + _level1._totalframes + " inner=" + _level1.inner);
    trace("frame 4: bytes " + (box.getBytesLoaded() == box.getBytesTotal()) + " " + (box.getBytesTotal() > 0) + " " + (box.getBytesTotal() == _level1.getBytesTotal()));
  }
  if (frame == 6) {
    unloadMovieNum(1);
    box.unloadMovie();
  }
  if (frame == 7) trace("frame 7: level1=" + _level1 + " box=" + box + " " + box._totalframes + " childVar=" + box.childVar);
};
